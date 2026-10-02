"""Validation transactionnelle des ventes, avoirs et annulations (SALE-002 à SALE-009, §27.1, §27.3)."""
from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import F, Q, Sum
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Product
from apps.core.exceptions import BusinessError
from apps.core.models import Warehouse
from apps.core.services import audit, money, next_number
from apps.finance.models import Payment, PaymentAllocation, PaymentMethod
from apps.finance.services import (
    cash_movement, open_session_of, record_customer_payment, refresh_sale_status, resolve_account,
)
from apps.inventory.services import move_stock

from .calc import compute_document
from .models import CreditNote, CreditNoteItem, Customer, Sale, SaleItem

D0 = Decimal("0")


def walkin_customer(company):
    customer, _ = Customer.objects.get_or_create(
        company=company, is_walkin=True, defaults={"code": "CLI-COMPTOIR", "name": "Client comptoir"}
    )
    return customer


def customer_outstanding(customer) -> Decimal:
    """Encours = factures ouvertes − crédits non affectés."""
    due = Sale.objects.filter(customer=customer).exclude(status="cancelled").aggregate(
        v=Sum(F("total") - F("paid_amount") - F("credited_amount"))
    )["v"] or D0
    credit = Payment.objects.filter(customer=customer, direction="in", status="valid").aggregate(v=Sum("unallocated"))["v"] or D0
    return due - credit


def authorize_by_pin(company, pin, code, exclude=None):
    """Autorisation par PIN d'un utilisateur disposant de la permission (gérant)."""
    if not pin:
        return None
    for u in User.objects.filter(company=company, is_active=True).exclude(pin_hash=""):
        if exclude is not None and u.pk == exclude.pk:
            continue
        if u.check_pin(str(pin)) and u.has_code(code):
            return u
    return None


def build_lines(company, user, items, customer, price_check=True):
    if not items:
        raise BusinessError("Le panier est vide.", code="EMPTY_CART")
    ids = [i["product_id"] for i in items]
    products = {str(p.pk): p for p in Product.objects.filter(company=company, pk__in=ids).select_related("tax")}
    lines = []
    for raw in items:
        product = products.get(str(raw["product_id"]))
        if not product:
            raise BusinessError("Produit introuvable.", code="PRODUCT_NOT_FOUND")
        if product.status != "active":
            raise BusinessError(f"« {product.name} » n'est plus vendable (archivé ou inactif).", code="PRODUCT_INACTIVE")
        quantity = Decimal(str(raw["quantity"]))
        if quantity <= 0:
            raise BusinessError("La quantité doit être positive.", code="INVALID_QUANTITY")
        if not product.unit.is_decimal and quantity != quantity.to_integral_value():
            raise BusinessError(f"« {product.name} » se vend à l'unité (quantité entière).", code="INVALID_QUANTITY")
        reference_price = product.price_for(quantity, customer=customer)
        price = Decimal(str(raw.get("unit_price"))) if raw.get("unit_price") not in (None, "") else reference_price
        if price_check and price != reference_price and not user.has_code("catalog.price.edit"):
            raise BusinessError(f"Vous n'êtes pas autorisé à modifier le prix de « {product.name} ».", code="PRICE_EDIT_FORBIDDEN", status_code=403)
        lines.append({
            "product": product, "description": raw.get("description") or product.name, "quantity": quantity,
            "unit_price": price, "discount_type": raw.get("discount_type") or "percent",
            "discount_value": Decimal(str(raw.get("discount_value") or 0)), "tax_rate": product.tax_rate,
        })
    return lines


def create_sale(*, user, data, idempotency_key=None, offline=None):
    """Création + validation atomique d'une vente (SALE-004) — tout ou rien."""
    company = user.company
    if idempotency_key:
        existing = Sale.objects.filter(company=company, idempotency_key=idempotency_key).first()
        if existing:
            existing._replayed = True
            return existing

    sale_type = data.get("type", "pos")
    warehouse = Warehouse.objects.filter(company=company, pk=data.get("warehouse_id")).first()
    if not warehouse:
        raise BusinessError("Dépôt de vente introuvable.", code="WAREHOUSE_REQUIRED")
    if not user.can_access_warehouse(warehouse):
        raise BusinessError("Vous n'êtes pas affecté à ce dépôt.", code="WAREHOUSE_FORBIDDEN", status_code=403)

    customer = (
        Customer.objects.filter(company=company, pk=data["customer_id"]).first() if data.get("customer_id") else walkin_customer(company)
    )
    if customer is None:
        raise BusinessError("Client introuvable.", code="CUSTOMER_NOT_FOUND")
    if customer.status == "archived":
        raise BusinessError("Ce client est archivé.", code="CUSTOMER_ARCHIVED")

    session = None
    if offline and offline.get("register_session_id"):
        from apps.finance.models import RegisterSession

        session = RegisterSession.objects.filter(pk=offline["register_session_id"], opened_by=user, status="open").select_related("register").first()
    session = session or open_session_of(user)
    if sale_type == "pos" and not session:
        if offline:
            raise BusinessError("Aucune caisse ouverte : ouvrez votre caisse puis relancez la synchronisation.", code="SYNC_NO_SESSION")
        raise BusinessError("Ouvrez votre caisse avant de vendre.", code="NO_OPEN_SESSION")
    if session and sale_type == "pos" and session.register.warehouse_id != warehouse.pk:
        raise BusinessError("Votre caisse est rattachée à un autre dépôt.", code="SESSION_WAREHOUSE_MISMATCH")

    prices_ttc = bool(company.setting("prices_include_tax"))
    decimals = company.currency_decimals
    # Hors-ligne : le prix appliqué au client est conservé (la vente a eu lieu à ce prix, §24.3).
    lines = build_lines(company, user, data.get("items") or [], customer, price_check=not offline)
    computed, totals = compute_document(
        lines, data.get("global_discount_type", "percent"), data.get("global_discount_value", 0), prices_ttc, decimals
    )
    warnings = []

    # Plafond de remise (SALE-009)
    discount_authorizer = None
    cap = Decimal(str(user.max_discount_pct))
    global_pct = (totals["discount_total"] / totals["gross"] * 100) if totals["gross"] else D0
    if max(totals["max_line_discount_pct"], global_pct) > cap + Decimal("0.0001") and not user.has_code("sales.discount.override"):
        discount_authorizer = authorize_by_pin(company, data.get("override_pin"), "sales.discount.override", exclude=user)
        if not discount_authorizer:
            raise BusinessError(
                f"Remise supérieure à votre plafond ({cap:.0f} %) : autorisation d'un gérant requise.",
                code="DISCOUNT_AUTH_REQUIRED", status_code=403, extra={"cap": str(cap)},
            )

    # Paiements et rendu monnaie
    payments_in = []
    paid = D0
    methods = {str(m.pk): m for m in PaymentMethod.objects.filter(company=company, is_active=True)}
    for p in data.get("payments") or []:
        m = methods.get(str(p.get("method_id")))
        if not m:
            raise BusinessError("Moyen de paiement invalide.", code="METHOD_INVALID")
        amt = money(p.get("amount"), decimals)
        if amt <= 0:
            continue
        payments_in.append({"method": m, "amount": amt, "reference": (p.get("reference") or "").strip()})
        paid += amt
    total = totals["total"]
    change = D0
    if paid > total:
        overpay = paid - total
        cash_part = sum((p["amount"] for p in payments_in if p["method"].type == "cash"), D0)
        if cash_part >= overpay:
            change = overpay
            for p in payments_in:
                if p["method"].type == "cash":
                    take = min(p["amount"], overpay)
                    p["amount"] -= take
                    overpay -= take
                    if overpay == 0:
                        break
            payments_in = [p for p in payments_in if p["amount"] > 0]
        elif customer.is_walkin:
            raise BusinessError("Montant payé supérieur au total : identifiez le client pour créditer l'excédent.", code="OVERPAYMENT")
        paid = sum((p["amount"] for p in payments_in), D0)

    # Contrôle de crédit (SALE-008)
    remaining = total - min(paid, total)
    credit_authorizer = None
    if remaining > 0:
        if customer.is_walkin:
            raise BusinessError("Vente sans client : le paiement complet est obligatoire (pas de crédit au client comptoir).", code="WALKIN_FULL_PAYMENT")
        if not user.has_code("sales.credit"):
            raise BusinessError("Vous n'êtes pas autorisé à vendre à crédit.", code="CREDIT_FORBIDDEN", status_code=403)
        if customer.status == "blocked":
            raise BusinessError("Client bloqué : vente à crédit impossible.", code="CUSTOMER_BLOCKED")
        outstanding = customer_outstanding(customer)
        if outstanding + remaining > customer.credit_limit:
            if user.has_code("sales.credit.override"):
                credit_authorizer = user
            else:
                credit_authorizer = authorize_by_pin(company, data.get("credit_override_pin"), "sales.credit.override", exclude=user)
            if not credit_authorizer:
                raise BusinessError(
                    f"Limite de crédit dépassée : encours {outstanding:.0f} + {remaining:.0f} > limite {customer.credit_limit:.0f}.",
                    code="CREDIT_LIMIT_EXCEEDED", status_code=403,
                    extra={"outstanding": str(outstanding), "limit": str(customer.credit_limit)},
                )
            warnings.append("Dérogation de crédit accordée.")

    with transaction.atomic():
        today = timezone.localdate()
        try:
            with transaction.atomic():
                sale = Sale.objects.create(
                    company=company, number=next_number(company, sale_type), type=sale_type, customer=customer,
                    warehouse=warehouse, register_session=session, seller=user, issue_date=today,
                    due_date=today + timedelta(days=customer.payment_terms_days or 0) if remaining > 0 else None,
                    subtotal=totals["subtotal"], discount_total=totals["discount_total"], tax_total=totals["tax_total"],
                    total=total, global_discount_type=data.get("global_discount_type", "percent"),
                    global_discount_value=Decimal(str(data.get("global_discount_value") or 0)),
                    idempotency_key=idempotency_key, discount_authorized_by=discount_authorizer,
                    credit_override_by=credit_authorizer if credit_authorizer and credit_authorizer != user else None,
                    notes=data.get("notes", ""), customer_reference=data.get("customer_reference", ""),
                    offline_ref=(offline or {}).get("provisional_number", ""), offline_created_at=(offline or {}).get("created_at_local"),
                    quote_id=data.get("quote_id"), created_by=user,
                )
        except IntegrityError:
            if idempotency_key:
                existing = Sale.objects.get(company=company, idempotency_key=idempotency_key)
                existing._replayed = True
                return existing
            raise

        cost_total = D0
        # Verrous ordonnés par produit (évite les interblocages, §20.11)
        for c in sorted(computed, key=lambda x: str(x["product"].pk)):
            product = c["product"]
            movement = move_stock(
                company=company, product=product, warehouse=warehouse, quantity=-c["quantity"], movement_type="sale",
                user=user, document_type="sale", document_id=sale.pk, document_number=sale.number,
                allow_negative=True if offline else None,
                reason="Vente hors-ligne synchronisée" if offline else "",
            )
            unit_cost = movement.cogs_unit if movement else product.cost_avg
            if movement and movement.qty_after < 0:
                warnings.append(f"Stock négatif pour « {product.name} »" + (" dû à la synchronisation" if offline else "") + " : à régulariser.")
            c["unit_cost"] = unit_cost
            cost_total += unit_cost * c["quantity"]
        SaleItem.objects.bulk_create([
            SaleItem(
                sale=sale, product=c["product"], description=c["description"], quantity=c["quantity"],
                unit_price=c["unit_price"], discount_type=c["discount_type"], discount_value=c["discount_value"],
                discount_amount=c["discount_amount"], tax_rate=c["tax_rate"], line_subtotal=c["line_subtotal"],
                tax_amount=c["tax_amount"], line_total=c["line_total"], unit_cost=c["unit_cost"],
            )
            for c in computed
        ])
        if not company.setting("allow_sale_below_cost"):
            for c in computed:
                if c["quantity"] and c["unit_cost"] and c["line_subtotal"] / c["quantity"] < c["unit_cost"]:
                    warnings.append(f"« {c['product'].name} » vendu sous son coût de revient.")
        sale.cost_total = cost_total
        sale.save(update_fields=["cost_total"])

        for p in payments_in:
            record_customer_payment(
                user=user, customer=customer, method=p["method"], amount=p["amount"], reference=p["reference"],
                sale=sale, category="sale", session_required=True,
            )
        sale.refresh_from_db()
        refresh_sale_status(sale)
        sale.save(update_fields=["status"])

        if data.get("quote_id"):
            from .models import Quote

            Quote.objects.filter(company=company, pk=data["quote_id"]).update(status="converted", converted_sale=sale)

        audit(company, user, "VALIDATE", "sale", sale, label=sale.number,
              new={"total": total, "paid": sale.paid_amount, "customer": customer.name, "items": len(computed)})
        if discount_authorizer:
            audit(company, discount_authorizer, "DISCOUNT_OVERRIDE", "sale", sale, label=sale.number,
                  new={"discount_total": totals["discount_total"], "seller": user.full_name}, reason=data.get("override_reason", ""))
        if credit_authorizer:
            audit(company, credit_authorizer, "CREDIT_OVERRIDE", "sale", sale, label=sale.number,
                  new={"remaining": remaining, "limit": customer.credit_limit})

    sale._change = change
    sale._warnings = warnings
    return sale


def create_credit_note(*, user, sale, items, reason, settlement="deduct", method_id=None, reference="", full=False, restock=True):
    """Avoir partiel ou total (SALE-006/007) : prix et taxes d'origine, cumul ≤ vendu, stock si réintégrable."""
    company = user.company
    if not reason or len(reason.strip()) < 3:
        raise BusinessError("Le motif est obligatoire.", code="REASON_REQUIRED")
    if sale.status == "cancelled":
        raise BusinessError("Cette facture est déjà annulée.", code="ALREADY_CANCELLED")
    max_days = int(company.setting("return_max_days") or 0)
    if max_days and not full and (timezone.localdate() - sale.issue_date).days > max_days and not user.has_code("sales.discount.override"):
        raise BusinessError(f"Délai de retour dépassé ({max_days} jours).", code="RETURN_WINDOW_EXPIRED")

    with transaction.atomic():
        sale = Sale.objects.select_for_update().get(pk=sale.pk)
        sale_items = {str(i.pk): i for i in sale.items.select_for_update().select_related("product")}
        if full:
            items = [
                {"sale_item_id": str(i.pk), "quantity": i.quantity - i.returned_qty, "condition": "resellable" if restock else "defective"}
                for i in sale_items.values() if i.quantity - i.returned_qty > 0
            ]
        if not items:
            raise BusinessError("Aucune ligne à retourner.", code="EMPTY_RETURN")
        note = CreditNote.objects.create(
            company=company, number=next_number(company, "credit_note"), sale=sale, customer=sale.customer,
            reason=reason, settlement=settlement, is_full_cancellation=full, created_by=user,
        )
        sub = tax = tot = D0
        for raw in items:
            si = sale_items.get(str(raw["sale_item_id"]))
            if not si:
                raise BusinessError("Ligne de facture invalide.", code="INVALID_LINE")
            q = Decimal(str(raw["quantity"]))
            if q <= 0:
                continue
            if si.returned_qty + q > si.quantity:
                raise BusinessError(
                    f"Retour refusé pour « {si.description} » : déjà retourné {si.returned_qty.normalize():f} sur {si.quantity.normalize():f} vendus.",
                    code="RETURN_EXCEEDS_SOLD",
                )
            ratio = q / si.quantity
            l_total = money(si.line_total * ratio, company.currency_decimals)
            l_sub = money(si.line_subtotal * ratio, company.currency_decimals)
            l_tax = l_total - l_sub
            condition = raw.get("condition", "resellable")
            CreditNoteItem.objects.create(
                credit_note=note, sale_item=si, product=si.product, quantity=q, unit_price=si.unit_price,
                line_subtotal=l_sub, tax_amount=l_tax, line_total=l_total, condition=condition,
            )
            si.returned_qty += q
            si.save(update_fields=["returned_qty"])
            if condition == "resellable":
                move_stock(company=company, product=si.product, warehouse=sale.warehouse, quantity=q,
                           movement_type="customer_return", user=user, document_type="credit_note",
                           document_id=note.pk, document_number=note.number, reason=reason)
            sub += l_sub
            tax += l_tax
            tot += l_total
        note.subtotal, note.tax_total, note.total = sub, tax, tot

        due_before = sale.total - sale.paid_amount - sale.credited_amount
        sale.credited_amount += tot
        excess = tot - max(due_before, D0)
        if excess > 0:
            if sale.customer.is_walkin and settlement == "credit":
                settlement = "refund"
            if settlement == "credit":
                _unallocate(sale, excess)
            else:
                settlement = "refund"
                method = PaymentMethod.objects.filter(company=company, pk=method_id).first() if method_id else PaymentMethod.objects.filter(company=company, type="cash").first()
                account, session = resolve_account(user, method)
                refund = Payment.objects.create(
                    company=company, number=next_number(company, "payment_out"), direction="out", customer=sale.customer,
                    method=method, amount=excess, reference=reference, paid_at=timezone.now(), session=session,
                    account=account, note=f"Remboursement avoir {note.number}", created_by=user,
                )
                PaymentAllocation.objects.create(payment=refund, sale=sale, amount=-excess)
                cash_movement(company, account=account, session=session, method=method, direction="out", amount=excess,
                              category="refund", label=f"Remboursement {note.number}", source=refund, user=user)
                note.refunded_amount = excess
            sale.paid_amount -= excess
        note.settlement = settlement if excess > 0 else "deduct"
        note.save()
        if full:
            sale.status = "cancelled"
        else:
            refresh_sale_status(sale)
        sale.save(update_fields=["credited_amount", "paid_amount", "status", "updated_at"])
        audit(company, user, "CANCEL" if full else "CREDIT_NOTE", "sale", sale, label=sale.number,
              new={"credit_note": note.number, "total": tot, "settlement": note.settlement}, reason=reason)
    return note


def _unallocate(sale, amount):
    """Transforme une partie du paiement d'une facture en crédit client disponible."""
    left = amount
    for alloc in PaymentAllocation.objects.select_related("payment").filter(sale=sale, amount__gt=0).order_by("-id"):
        if left <= 0:
            break
        take = min(alloc.amount, left)
        alloc.amount -= take
        alloc.save(update_fields=["amount"])
        p = alloc.payment
        p.unallocated += take
        p.save(update_fields=["unallocated"])
        left -= take


def apply_customer_credit(*, user, sale):
    """Impute le crédit client disponible (acomptes/avoirs) sur une facture ouverte."""
    with transaction.atomic():
        sale = Sale.objects.select_for_update().get(pk=sale.pk)
        due = sale.balance
        for p in Payment.objects.select_for_update().filter(customer=sale.customer, direction="in", status="valid", unallocated__gt=0).order_by("paid_at"):
            if due <= 0:
                break
            take = min(p.unallocated, due)
            PaymentAllocation.objects.create(payment=p, sale=sale, amount=take)
            p.unallocated -= take
            p.save(update_fields=["unallocated"])
            sale.paid_amount += take
            due -= take
        refresh_sale_status(sale)
        sale.save(update_fields=["paid_amount", "status", "updated_at"])
        audit(user.company, user, "APPLY_CREDIT", "sale", sale, label=sale.number)
    return sale


def customer_statement(customer):
    """Grand livre client : débits (factures), crédits (paiements, avoirs) et solde progressif."""
    rows = []
    for s in Sale.objects.filter(customer=customer):
        rows.append({"date": s.created_at, "type": "Facture" if s.type == "invoice" else "Ticket", "number": s.number, "debit": s.total, "credit": D0, "id": str(s.pk), "link": f"/sales/{s.pk}"})
    for n in CreditNote.objects.filter(customer=customer):
        rows.append({"date": n.created_at, "type": "Avoir", "number": n.number, "debit": D0, "credit": n.total, "id": str(n.pk), "link": f"/sales/{n.sale_id}"})
    for p in Payment.objects.filter(customer=customer).select_related("method"):
        if p.direction == "in":
            rows.append({"date": p.paid_at, "type": f"Paiement {p.method.name}", "number": p.number, "debit": D0, "credit": p.amount, "id": str(p.pk), "link": ""})
            if p.status == "reversed":
                rows.append({"date": p.updated_at, "type": "Extourne paiement", "number": p.number, "debit": p.amount, "credit": D0, "id": str(p.pk), "link": ""})
        else:
            rows.append({"date": p.paid_at, "type": "Remboursement", "number": p.number, "debit": p.amount, "credit": D0, "id": str(p.pk), "link": ""})
    rows.sort(key=lambda r: r["date"])
    balance = D0
    for r in rows:
        balance += r["debit"] - r["credit"]
        r["balance"] = balance
    return rows


def aging_buckets(qs, today=None):
    today = today or timezone.localdate()
    buckets = {"0_30": D0, "31_60": D0, "61_90": D0, "90_plus": D0}
    for s in qs:
        ref = s.due_date or s.issue_date
        age = (today - ref).days
        due = s.total - s.paid_amount - s.credited_amount
        key = "0_30" if age <= 30 else "31_60" if age <= 60 else "61_90" if age <= 90 else "90_plus"
        buckets[key] += due
    return buckets


def open_sales_q():
    return Q(status__in=["issued", "partial"])
