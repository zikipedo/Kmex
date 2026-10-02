"""Paiements, caisse et dépenses (§11, §11 bis, RG-PAY-*, RG-DEP-*)."""
from collections import defaultdict
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.exceptions import BusinessError
from apps.core.services import audit, money, next_number, notify, users_with_perm

from .models import CashMovement, Expense, ExpenseApproval, Payment, PaymentAllocation, RegisterSession

D0 = Decimal("0")


def open_session_of(user):
    return RegisterSession.objects.filter(opened_by=user, status="open").select_related("register", "register__cash_account").first()


def resolve_account(user, method, require_session_for_cash=True):
    """Compte de trésorerie et session d'un mouvement selon le moyen de paiement."""
    session = open_session_of(user)
    if method.type == "cash":
        if not session:
            if require_session_for_cash:
                raise BusinessError("Ouvrez votre caisse pour encaisser ou décaisser des espèces.", code="NO_OPEN_SESSION")
            return None, None
        return session.register.cash_account, session
    if not method.account_id:
        raise BusinessError(f"Le moyen « {method.name} » n'est rattaché à aucun compte de trésorerie.", code="METHOD_NO_ACCOUNT")
    return method.account, session


def cash_movement(company, *, account, session, method, direction, amount, category, label, source, user):
    return CashMovement.objects.create(
        company=company, account=account, session=session, method=method, direction=direction, amount=amount,
        category=category, label=label[:250], source_type=type(source).__name__.lower() if source else "",
        source_id=str(getattr(source, "pk", "") or ""), source_number=getattr(source, "number", "") or "", user=user,
    )


def refresh_sale_status(sale):
    if sale.status == "cancelled":
        return
    bal = sale.total - sale.paid_amount - sale.credited_amount
    if bal <= 0:
        sale.status = "paid"
    elif sale.paid_amount > 0 or sale.credited_amount > 0:
        sale.status = "partial"
    else:
        sale.status = "issued"


def refresh_purchase_invoice_status(inv):
    if inv.status == "cancelled":
        return
    if inv.paid_amount >= inv.total:
        inv.status = "paid"
    elif inv.paid_amount > 0:
        inv.status = "partial"
    else:
        inv.status = "unpaid"


def _check_reference(method, reference):
    if method.requires_reference and not (reference or "").strip():
        raise BusinessError(
            f"La référence de transaction est obligatoire pour « {method.name} ».", code="REFERENCE_REQUIRED",
            errors=[{"field": "reference", "message": "Référence obligatoire"}],
        )


def record_customer_payment(*, user, customer, method, amount, reference="", sale=None, idempotency_key=None,
                            note="", category="customer_payment", fifo=True, session_required=True):
    """Encaissement client avec affectation (facture précise ou FIFO) — PAY-001, idempotent (PAY-001b)."""
    from apps.sales.models import Sale

    company = user.company
    amount = money(amount, company.currency_decimals)
    if amount <= 0:
        raise BusinessError("Le montant doit être supérieur à zéro.", code="INVALID_AMOUNT")
    if idempotency_key:
        existing = Payment.objects.filter(company=company, idempotency_key=idempotency_key).first()
        if existing:
            return existing
    _check_reference(method, reference)
    account, session = resolve_account(user, method, session_required)

    with transaction.atomic():
        try:
            with transaction.atomic():
                payment = Payment.objects.create(
                    company=company, number=next_number(company, "payment_in"), direction="in", customer=customer,
                    method=method, amount=amount, unallocated=amount, reference=reference, paid_at=timezone.now(),
                    session=session, account=account, idempotency_key=idempotency_key, note=note, created_by=user,
                )
        except IntegrityError:
            return Payment.objects.get(company=company, idempotency_key=idempotency_key)

        targets = []
        if sale is not None:
            targets = [Sale.objects.select_for_update().get(pk=sale.pk)]
        elif fifo:
            targets = list(
                Sale.objects.select_for_update().filter(customer=customer, status__in=["issued", "partial"]).order_by("issue_date", "created_at")
            )
        left = amount
        for s in targets:
            if left <= 0:
                break
            due = s.total - s.paid_amount - s.credited_amount
            if due <= 0:
                continue
            part = min(due, left)
            PaymentAllocation.objects.create(payment=payment, sale=s, amount=part)
            s.paid_amount += part
            refresh_sale_status(s)
            s.save(update_fields=["paid_amount", "status", "updated_at"])
            left -= part
        if left > 0 and customer.is_walkin:
            raise BusinessError("Un client comptoir ne peut pas avoir d'avoir ou d'acompte : identifiez le client.", code="WALKIN_CREDIT")
        payment.unallocated = left
        payment.save(update_fields=["unallocated"])
        cash_movement(company, account=account, session=session, method=method, direction="in", amount=amount,
                      category=category, label=f"Encaissement {customer.name}", source=payment, user=user)
        audit(company, user, "PAYMENT", "payment", payment, label=payment.number,
              new={"amount": amount, "method": method.code, "customer": customer.name, "reference": reference})
    return payment


def record_supplier_payment(*, user, supplier, method, amount, reference="", invoice=None, idempotency_key=None, note=""):
    from apps.purchasing.models import PurchaseInvoice

    company = user.company
    amount = money(amount, company.currency_decimals)
    if amount <= 0:
        raise BusinessError("Le montant doit être supérieur à zéro.", code="INVALID_AMOUNT")
    if idempotency_key:
        existing = Payment.objects.filter(company=company, idempotency_key=idempotency_key).first()
        if existing:
            return existing
    _check_reference(method, reference)
    account, session = resolve_account(user, method)
    with transaction.atomic():
        if method.type == "cash":
            available = session_expected(session).get(method.code, D0)
            if amount > available:
                raise BusinessError(f"Espèces insuffisantes en caisse (théorique : {available:.0f}).", code="CASH_INSUFFICIENT")
        payment = Payment.objects.create(
            company=company, number=next_number(company, "payment_out"), direction="out", supplier=supplier,
            method=method, amount=amount, unallocated=amount, reference=reference, paid_at=timezone.now(),
            session=session, account=account, idempotency_key=idempotency_key, note=note, created_by=user,
        )
        targets = (
            [PurchaseInvoice.objects.select_for_update().get(pk=invoice.pk)] if invoice is not None
            else list(PurchaseInvoice.objects.select_for_update().filter(supplier=supplier, status__in=["unpaid", "partial"]).order_by("due_date"))
        )
        left = amount
        for inv in targets:
            if left <= 0:
                break
            part = min(inv.total - inv.paid_amount, left)
            if part <= 0:
                continue
            PaymentAllocation.objects.create(payment=payment, purchase_invoice=inv, amount=part)
            inv.paid_amount += part
            refresh_purchase_invoice_status(inv)
            inv.save(update_fields=["paid_amount", "status", "updated_at"])
            left -= part
        payment.unallocated = left
        payment.save(update_fields=["unallocated"])
        cash_movement(company, account=account, session=session, method=method, direction="out", amount=amount,
                      category="supplier_payment", label=f"Paiement {supplier.name}", source=payment, user=user)
        audit(company, user, "PAYMENT", "payment", payment, label=payment.number,
              new={"amount": amount, "method": method.code, "supplier": supplier.name})
    return payment


def reverse_payment(*, user, payment, reason):
    """Extourne (RG-PAY-02) : mouvement inverse, ré-ouverture des créances/dettes."""
    if payment.status == "reversed":
        raise BusinessError("Ce paiement est déjà extourné.", code="ALREADY_REVERSED")
    if not reason:
        raise BusinessError("Le motif est obligatoire.", code="REASON_REQUIRED")
    if payment.session and payment.session.status != "open":
        raise BusinessError("La session de caisse de ce paiement est clôturée : passez par une régularisation.", code="SESSION_CLOSED")
    with transaction.atomic():
        for alloc in payment.allocations.select_related("sale", "purchase_invoice"):
            if alloc.sale:
                s = alloc.sale
                s.paid_amount -= alloc.amount
                refresh_sale_status(s)
                s.save(update_fields=["paid_amount", "status", "updated_at"])
            if alloc.purchase_invoice:
                inv = alloc.purchase_invoice
                inv.paid_amount -= alloc.amount
                refresh_purchase_invoice_status(inv)
                inv.save(update_fields=["paid_amount", "status", "updated_at"])
        payment.status = "reversed"
        payment.reversal_reason = reason
        payment.save(update_fields=["status", "reversal_reason", "updated_at"])
        cash_movement(payment.company, account=payment.account, session=payment.session, method=payment.method,
                      direction="out" if payment.direction == "in" else "in", amount=payment.amount,
                      category="payment_reversal", label=f"Extourne {payment.number}", source=payment, user=user)
        audit(payment.company, user, "REVERSE", "payment", payment, label=payment.number, reason=reason)
    return payment


# --- Caisse --------------------------------------------------------------------------------

def session_expected(session):
    """Théorique par moyen = fond de caisse (espèces) + Σ entrées − Σ sorties de la session.

    Le fond de caisse n'est pas un flux de trésorerie : il est déjà dans le compte « caisse ».
    """
    from .models import PaymentMethod

    out = defaultdict(lambda: D0)
    cash = PaymentMethod.objects.filter(company=session.company, type="cash").values_list("code", flat=True).first() or "cash"
    out[cash] += session.opening_float or D0
    rows = CashMovement.objects.filter(session=session).values("method__code", "direction").annotate(s=Sum("amount"))
    for r in rows:
        code = r["method__code"] or "cash"
        out[code] += r["s"] if r["direction"] == "in" else -r["s"]
    return dict(out)


def open_session(*, user, register, opening_float):
    from .models import PaymentMethod

    if not user.can_access_warehouse(register.warehouse):
        raise BusinessError("Vous n'êtes pas affecté à ce dépôt.", code="WAREHOUSE_FORBIDDEN", status_code=403)
    if RegisterSession.objects.filter(register=register, status="open").exists():
        raise BusinessError("Une session est déjà ouverte sur cette caisse.", code="SESSION_ALREADY_OPEN", status_code=409)
    if RegisterSession.objects.filter(opened_by=user, status="open").exists():
        raise BusinessError("Vous avez déjà une session de caisse ouverte.", code="USER_SESSION_OPEN", status_code=409)
    with transaction.atomic():
        try:
            session = RegisterSession.objects.create(
                company=user.company, register=register, opened_by=user, opening_float=opening_float, created_by=user
            )
        except IntegrityError:
            raise BusinessError("Une session est déjà ouverte sur cette caisse.", code="SESSION_ALREADY_OPEN", status_code=409)
        audit(user.company, user, "OPEN", "register_session", session, label=register.name, new={"opening_float": opening_float})
    return session


def close_session(*, user, session, counted: dict, reason="", denominations=None):
    if session.status != "open":
        raise BusinessError("Cette session n'est pas ouverte.", code="SESSION_NOT_OPEN")
    if session.opened_by_id != user.pk and not user.has_code("cash.session.validate"):
        raise BusinessError("Seul le caissier de la session ou un gérant peut la clôturer.", code="NOT_SESSION_OWNER", status_code=403)
    company = session.company
    expected = session_expected(session)
    counted = {k: Decimal(str(v or 0)) for k, v in (counted or {}).items()}
    for code in expected:
        counted.setdefault(code, D0)
    diff_total = sum((counted[c] - expected.get(c, D0) for c in counted), D0)
    tolerance = Decimal(str(company.setting("cash_tolerance")))
    if abs(diff_total) > tolerance and len((reason or "").strip()) < 3:
        raise BusinessError(
            f"Écart de {diff_total:+.0f} supérieur à la tolérance ({tolerance:.0f}) : une justification est obligatoire.",
            code="DIFFERENCE_REASON_REQUIRED", errors=[{"field": "reason", "message": "Justification requise"}],
        )
    with transaction.atomic():
        session.expected = {k: str(v) for k, v in expected.items()}
        session.counted = {k: str(v) for k, v in counted.items()}
        session.denominations = denominations or {}
        session.difference = diff_total
        session.difference_reason = reason or ""
        session.closed_by = user
        session.closed_at = timezone.now()
        session.status = "closed"
        session.z_number = next_number(company, "z_report")
        session.save()
        audit(company, user, "CLOSE", "register_session", session, label=session.z_number,
              new={"expected": session.expected, "counted": session.counted, "difference": diff_total}, reason=reason)
    level = "danger" if abs(diff_total) > tolerance else "info"
    notify(company, users_with_perm(company, "cash.session.validate"), "cash_closed",
           f"Clôture {session.register.name} — {session.z_number}",
           f"Écart : {diff_total:+.0f} {company.currency_symbol}", f"/cash/sessions/{session.pk}", level)
    return session


def validate_session(*, user, session):
    from .models import PaymentMethod

    if session.status != "closed":
        raise BusinessError("Seule une session clôturée peut être validée.", code="SESSION_NOT_CLOSED")
    with transaction.atomic():
        cash = PaymentMethod.objects.filter(company=session.company, type="cash").first()
        expected = {k: Decimal(v) for k, v in session.expected.items()}
        counted = {k: Decimal(v) for k, v in session.counted.items()}
        for code, value in counted.items():
            diff = value - expected.get(code, D0)
            if diff != 0 and code == (cash.code if cash else "cash"):
                cash_movement(session.company, account=session.register.cash_account, session=session, method=cash,
                              direction="in" if diff > 0 else "out", amount=abs(diff), category="cash_difference",
                              label=f"Régularisation écart {session.z_number} ({'excédent' if diff > 0 else 'manque'})",
                              source=session, user=user)
        session.status = "validated"
        session.validated_by = user
        session.validated_at = timezone.now()
        session.save(update_fields=["status", "validated_by", "validated_at", "updated_at"])
        audit(session.company, user, "VALIDATE", "register_session", session, label=session.z_number)
    return session


def account_balance(account):
    agg = CashMovement.objects.filter(account=account).values("direction").annotate(s=Sum("amount"))
    return sum((r["s"] if r["direction"] == "in" else -r["s"] for r in agg), D0)


def transfer_funds(*, user, from_account, to_account, amount, reference="", note=""):
    """Transfert de fonds sans impact sur le résultat (CASH-004) : dépôt en banque, alimentation Mobile Money…"""
    from .models import PaymentMethod

    amount = money(amount, user.company.currency_decimals)
    if amount <= 0:
        raise BusinessError("Le montant doit être supérieur à zéro.", code="INVALID_AMOUNT")
    if from_account.pk == to_account.pk:
        raise BusinessError("Les comptes source et destination doivent être différents.", code="SAME_ACCOUNT")
    with transaction.atomic():
        # Verrou sur le compte source pour éviter un double retrait concurrent.
        type(from_account).objects.select_for_update().get(pk=from_account.pk)
        available = account_balance(from_account)
        out_session = RegisterSession.objects.filter(register__cash_account=from_account, status="open").first() if from_account.type == "cash" else None
        in_session = RegisterSession.objects.filter(register__cash_account=to_account, status="open").first() if to_account.type == "cash" else None
        if out_session:
            available = min(available, session_expected(out_session).get("cash", D0) - out_session.opening_float)
        if amount > available:
            raise BusinessError(f"Solde insuffisant sur « {from_account.name} » (disponible : {available:.0f}).", code="FUNDS_INSUFFICIENT")
        label = note or f"Transfert {from_account.name} → {to_account.name}"
        method_out = PaymentMethod.objects.filter(company=user.company, type="cash").first() if from_account.type == "cash" else None
        method_in = PaymentMethod.objects.filter(company=user.company, type="cash").first() if to_account.type == "cash" else None
        out = CashMovement.objects.create(company=user.company, account=from_account, session=out_session, method=method_out, direction="out",
                                          amount=amount, category="transfer", label=label[:250], source_type="transfer",
                                          source_number=reference, user=user)
        CashMovement.objects.create(company=user.company, account=to_account, session=in_session, method=method_in, direction="in", amount=amount,
                                    category="transfer", label=label[:250], source_type="transfer", source_id=str(out.pk),
                                    source_number=reference, user=user)
        audit(user.company, user, "TRANSFER", "treasury", entity_id=str(out.pk), label=label,
              new={"from": from_account.name, "to": to_account.name, "amount": amount, "reference": reference})
    return out


# --- Dépenses --------------------------------------------------------------------------------

def _limit_ok(limit, amount):
    return limit is None or amount <= limit


def submit_expense(*, user, expense, pay=None):
    """Contrôles, numéro, approbation automatique ou demande (EXP-002/003/005), paiement immédiat optionnel."""
    company = expense.company
    if expense.status not in ("draft",):
        raise BusinessError("Seul un brouillon peut être soumis.", code="INVALID_STATUS")
    if expense.amount <= 0:
        raise BusinessError("Le montant doit être supérieur à zéro.", code="INVALID_AMOUNT")
    if len(expense.description.strip()) < 5:
        raise BusinessError("Le motif doit contenir au moins 5 caractères.", code="DESCRIPTION_TOO_SHORT")
    cat = expense.category
    if cat.receipt_required_above is not None and expense.amount >= cat.receipt_required_above and not expense.attachments.exists():
        raise BusinessError("Justificatif requis pour ce montant dans cette catégorie.", code="RECEIPT_REQUIRED",
                            errors=[{"field": "attachments", "message": "Justificatif requis"}])
    user_limit = user.expense_approval_limit
    cat_limit = cat.approval_above
    needs_approval = not _limit_ok(user_limit, expense.amount) or (cat_limit is not None and expense.amount > cat_limit and not user.has_code("expense.approve"))
    with transaction.atomic():
        expense.number = expense.number or next_number(company, "expense")
        if needs_approval:
            expense.status = "pending"
            expense.save()
            audit(company, user, "SUBMIT", "expense", expense, label=expense.number, new={"amount": expense.amount})
            approvers = [u for u in users_with_perm(company, "expense.approve") if u.pk != user.pk and _limit_ok(u.expense_approval_limit, expense.amount)]
            transaction.on_commit(lambda: notify(
                company, approvers, "expense_approval", f"Dépense à approuver : {expense.number}",
                f"{expense.description} — {expense.amount:.0f} {company.currency_symbol} ({user.full_name})",
                f"/expenses/{expense.pk}", "warning",
            ))
            return expense
        expense.status = "approved"
        expense.approved_by = user
        expense.approved_at = timezone.now()
        expense.save()
        audit(company, user, "APPROVE", "expense", expense, label=expense.number, reason="Approbation automatique (sous le seuil)")
        if pay is not None:
            pay_expense(user=user, expense=expense, **pay)
    return expense


def approve_expense(*, user, expense, comment=""):
    if expense.status != "pending":
        raise BusinessError("Cette dépense n'est pas en attente d'approbation.", code="INVALID_STATUS")
    if expense.created_by_id == user.pk:
        raise BusinessError("Séparation des tâches : vous ne pouvez pas approuver votre propre dépense.", code="SELF_APPROVAL", status_code=403)
    if not _limit_ok(user.expense_approval_limit, expense.amount):
        raise BusinessError("Montant supérieur à votre plafond d'approbation.", code="APPROVAL_LIMIT", status_code=403)
    with transaction.atomic():
        expense.status = "approved"
        expense.approved_by = user
        expense.approved_at = timezone.now()
        expense.save()
        ExpenseApproval.objects.create(expense=expense, approver=user, decision="approved", comment=comment)
        audit(expense.company, user, "APPROVE", "expense", expense, label=expense.number, reason=comment)
    if expense.created_by:
        notify(expense.company, [expense.created_by], "expense_approved", f"Dépense approuvée : {expense.number}",
               expense.description, f"/expenses/{expense.pk}", "success")
    return expense


def reject_expense(*, user, expense, reason):
    if expense.status != "pending":
        raise BusinessError("Cette dépense n'est pas en attente d'approbation.", code="INVALID_STATUS")
    if not reason:
        raise BusinessError("Le motif du rejet est obligatoire.", code="REASON_REQUIRED")
    with transaction.atomic():
        expense.status = "rejected"
        expense.reject_reason = reason
        expense.save()
        ExpenseApproval.objects.create(expense=expense, approver=user, decision="rejected", comment=reason)
        audit(expense.company, user, "REJECT", "expense", expense, label=expense.number, reason=reason)
    if expense.created_by:
        notify(expense.company, [expense.created_by], "expense_rejected", f"Dépense rejetée : {expense.number}", reason,
               f"/expenses/{expense.pk}", "danger")
    return expense


def pay_expense(*, user, expense, method, reference=""):
    """Décaissement (EXP-004) : session ouverte exigée en espèces, solde suffisant, rapport Z."""
    if expense.status != "approved":
        raise BusinessError("Seule une dépense approuvée peut être payée.", code="INVALID_STATUS")
    _check_reference(method, reference)
    if not user.has_code("expense.approve") and method.type != "cash":
        raise BusinessError("Vous ne pouvez payer qu'en espèces depuis votre caisse.", code="CASHIER_CASH_ONLY", status_code=403)
    account, session = resolve_account(user, method)
    company = expense.company
    with transaction.atomic():
        if method.type == "cash":
            available = session_expected(session).get(method.code, D0)
            if expense.amount > available:
                raise BusinessError(
                    f"Espèces insuffisantes en caisse : théorique {available:.0f} {company.currency_symbol}.",
                    code="CASH_INSUFFICIENT",
                )
        expense.method = method
        expense.account = account
        expense.session = session if method.type == "cash" else None
        expense.payment_reference = reference
        expense.status = "paid"
        expense.paid_by = user
        expense.paid_at = timezone.now()
        expense.save()
        cash_movement(company, account=account, session=expense.session, method=method, direction="out",
                      amount=expense.amount, category="expense", label=f"{expense.category.name} — {expense.description}",
                      source=expense, user=user)
        audit(company, user, "PAY", "expense", expense, label=expense.number, new={"amount": expense.amount, "method": method.code})
    return expense


def cancel_expense(*, user, expense, reason):
    """Annulation par extourne (EXP-006) — jamais de suppression d'une dépense payée."""
    if expense.status in ("cancelled", "rejected"):
        raise BusinessError("Cette dépense est déjà annulée ou rejetée.", code="INVALID_STATUS")
    if not reason or len(reason.strip()) < 3:
        raise BusinessError("Le motif d'annulation est obligatoire.", code="REASON_REQUIRED")
    with transaction.atomic():
        if expense.status == "paid":
            if expense.session and expense.session.status != "open":
                account, session = expense.account, open_session_of(user) if expense.method and expense.method.type == "cash" else None
                if expense.method and expense.method.type == "cash" and not session:
                    raise BusinessError("Ouvrez votre caisse pour restaurer les espèces de cette dépense.", code="NO_OPEN_SESSION")
                if session:
                    account = session.register.cash_account
            else:
                account, session = expense.account, expense.session
            cash_movement(expense.company, account=account, session=session, method=expense.method, direction="in",
                          amount=expense.amount, category="expense_reversal", label=f"Extourne {expense.number}",
                          source=expense, user=user)
        expense.status = "cancelled"
        expense.cancelled_by = user
        expense.cancelled_at = timezone.now()
        expense.cancel_reason = reason
        expense.save()
        audit(expense.company, user, "CANCEL", "expense", expense, label=expense.number, reason=reason)
    return expense
