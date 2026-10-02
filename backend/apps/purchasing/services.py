"""Achats : commande → réception (partielle) → facture → paiement (§7, PUR-001 à PUR-005)."""
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date

from apps.catalog.models import Product
from apps.core.exceptions import BusinessError
from apps.core.services import audit, money, next_number
from apps.finance.models import PaymentMethod
from apps.finance.services import record_supplier_payment
from apps.inventory.services import move_stock

from .models import PurchaseInvoice, PurchaseOrder, PurchaseOrderItem, PurchaseReceipt, PurchaseReceiptItem

D0 = Decimal("0")


def compute_order(order):
    decimals = order.company.currency_decimals
    sub = tax = D0
    for it in order.items.all():
        it.line_total = money(it.qty_ordered * it.unit_price, decimals)
        it.save(update_fields=["line_total"])
        sub += it.line_total
        tax += money(it.line_total * it.tax_rate / 100, decimals)
    order.subtotal, order.tax_total, order.total = sub, tax, sub + tax
    order.save(update_fields=["subtotal", "tax_total", "total", "updated_at"])


def send_order(*, user, order):
    if order.status != "draft":
        raise BusinessError("Seule une commande brouillon peut être envoyée.", code="INVALID_STATUS")
    if not order.items.exists():
        raise BusinessError("La commande ne contient aucune ligne.", code="EMPTY_ORDER")
    with transaction.atomic():
        order.number = next_number(order.company, "purchase_order")
        order.status = "sent"
        order.save(update_fields=["number", "status", "updated_at"])
        audit(order.company, user, "VALIDATE", "purchase_order", order, label=order.number, new={"total": order.total})
    return order


def receive(*, user, order, lines, note=""):
    """Réception (partielle) avec contrôle de sur-livraison (PUR-002), recalcul CMUP, statut de commande."""
    company = order.company
    if order.status not in ("sent", "partial"):
        raise BusinessError("Cette commande ne peut plus être réceptionnée.", code="INVALID_STATUS")
    tol = Decimal(str(company.setting("overdelivery_tolerance_pct") or 0))
    with transaction.atomic():
        order = PurchaseOrder.objects.select_for_update().get(pk=order.pk)
        items = {str(i.pk): i for i in order.items.select_related("product")}
        receipt = PurchaseReceipt.objects.create(
            company=company, number=next_number(company, "purchase_receipt"), order=order, supplier=order.supplier,
            warehouse=order.warehouse, note=note, created_by=user,
        )
        total = D0
        received_any = False
        for raw in sorted(lines, key=lambda r: str(r.get("order_item_id"))):
            it = items.get(str(raw.get("order_item_id")))
            if not it:
                raise BusinessError("Ligne de commande invalide.", code="INVALID_LINE")
            q = Decimal(str(raw.get("quantity") or 0))
            if q <= 0:
                continue
            limit = it.qty_ordered * (1 + tol / 100)
            if it.qty_received + q > limit:
                raise BusinessError(
                    f"Sur-livraison refusée pour « {it.product.name} » : commandé {it.qty_ordered.normalize():f}, déjà reçu {it.qty_received.normalize():f}.",
                    code="OVER_DELIVERY",
                )
            condition = raw.get("condition", "good")
            cost = Decimal(str(raw.get("unit_cost") or it.unit_price))
            PurchaseReceiptItem.objects.create(receipt=receipt, order_item=it, product=it.product, quantity=q, unit_cost=cost, condition=condition)
            it.qty_received += q
            it.save(update_fields=["qty_received"])
            if condition == "good":
                move_stock(company=company, product=it.product, warehouse=order.warehouse, quantity=q,
                           movement_type="purchase_receipt", user=user, unit_cost=cost, document_type="purchase_receipt",
                           document_id=receipt.pk, document_number=receipt.number)
            total += q * cost
            received_any = True
        if not received_any:
            raise BusinessError("Saisissez au moins une quantité reçue.", code="EMPTY_RECEIPT")
        receipt.total = money(total, company.currency_decimals)
        receipt.save(update_fields=["total"])
        all_done = all(i.qty_received >= i.qty_ordered for i in order.items.all())
        order.status = "received" if all_done else "partial"
        order.save(update_fields=["status", "updated_at"])
        audit(company, user, "RECEIVE", "purchase_order", order, label=order.number,
              new={"receipt": receipt.number, "status": order.status, "total": receipt.total})
    return receipt


def close_order(*, user, order, reason):
    if order.status not in ("partial", "sent"):
        raise BusinessError("Seule une commande envoyée ou partiellement reçue peut être soldée.", code="INVALID_STATUS")
    if not reason:
        raise BusinessError("Le motif est obligatoire.", code="REASON_REQUIRED")
    order.status = "closed" if order.status == "partial" else "cancelled"
    order.close_reason = reason
    order.save(update_fields=["status", "close_reason", "updated_at"])
    audit(order.company, user, "CLOSE", "purchase_order", order, label=order.number, reason=reason)
    return order


def create_invoice(*, user, supplier, receipt=None, order=None, supplier_ref="", issue_date=None, total=None, tax_total=None, notes=""):
    """Facture fournisseur avec rapprochement 3 voies simplifié (PUR-004) : crée la dette."""
    company = user.company
    if isinstance(issue_date, str):
        issue_date = parse_date(issue_date)
    issue_date = issue_date or timezone.localdate()
    computed_sub = computed_tax = D0
    if receipt:
        for it in receipt.items.select_related("order_item"):
            line = it.quantity * it.unit_cost
            rate = it.order_item.tax_rate if it.order_item else D0
            computed_sub += line
            computed_tax += line * rate / 100
    elif order:
        computed_sub, computed_tax = order.subtotal, order.tax_total
    dec = company.currency_decimals
    computed_total = money(computed_sub, dec) + money(computed_tax, dec)
    final_total = money(total, dec) if total not in (None, "") else computed_total
    discrepancy = ""
    if (receipt or order) and final_total != computed_total:
        discrepancy = f"Écart de rapprochement : facture {final_total:.0f} vs attendu {computed_total:.0f} (réception/commande)."
    if final_total <= 0:
        raise BusinessError("Le montant de la facture doit être positif.", code="INVALID_AMOUNT")
    with transaction.atomic():
        inv = PurchaseInvoice.objects.create(
            company=company, number=next_number(company, "purchase_invoice"), supplier_ref=supplier_ref, supplier=supplier,
            order=order or (receipt.order if receipt else None), receipt=receipt, issue_date=issue_date,
            due_date=issue_date + timedelta(days=supplier.payment_terms_days), subtotal=money(computed_sub, dec),
            tax_total=money(tax_total, dec) if tax_total not in (None, "") else money(computed_tax, dec),
            total=final_total, discrepancy=discrepancy, notes=notes, created_by=user,
        )
        if receipt:
            receipt.is_invoiced = True
            receipt.save(update_fields=["is_invoiced"])
        audit(company, user, "CREATE", "purchase_invoice", inv, label=inv.number, new={"total": final_total, "supplier": supplier.name, "discrepancy": discrepancy})
    return inv


def direct_purchase(*, user, supplier, warehouse, lines, supplier_ref="", payment=None, notes=""):
    """Achat direct (petit commerce) : réception + facture (+ paiement) en un écran (PUR-003)."""
    company = user.company
    if not lines:
        raise BusinessError("Ajoutez au moins un produit.", code="EMPTY_ORDER")
    with transaction.atomic():
        order = PurchaseOrder.objects.create(
            company=company, number=next_number(company, "purchase_order"), supplier=supplier, warehouse=warehouse,
            status="sent", order_date=timezone.localdate(), notes=notes or "Achat direct", created_by=user,
        )
        products = {str(p.pk): p for p in Product.objects.filter(company=company, pk__in=[l["product_id"] for l in lines])}
        for raw in lines:
            p = products.get(str(raw["product_id"]))
            if not p:
                raise BusinessError("Produit introuvable.", code="PRODUCT_NOT_FOUND")
            PurchaseOrderItem.objects.create(
                order=order, product=p, qty_ordered=Decimal(str(raw["quantity"])), unit_price=Decimal(str(raw["unit_cost"])),
                tax_rate=Decimal(str(raw.get("tax_rate") or 0)),
            )
        compute_order(order)
        receipt = receive(user=user, order=order, lines=[{"order_item_id": i.pk, "quantity": i.qty_ordered} for i in order.items.all()], note=notes)
        inv = create_invoice(user=user, supplier=supplier, receipt=receipt, supplier_ref=supplier_ref)
        if payment and Decimal(str(payment.get("amount") or 0)) > 0:
            method = PaymentMethod.objects.get(company=company, pk=payment["method_id"])
            record_supplier_payment(user=user, supplier=supplier, method=method, amount=payment["amount"],
                                    reference=payment.get("reference", ""), invoice=inv)
            inv.refresh_from_db()
    return inv
