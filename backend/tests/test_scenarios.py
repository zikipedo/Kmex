"""Scénarios de recette du cahier des charges (§33.2, §38) exécutés contre une vraie base PostgreSQL."""
import threading
from decimal import Decimal

import pytest
from django.db import connection, transaction
from django.db.utils import InternalError, ProgrammingError

from apps.core.exceptions import BusinessError
from apps.core.models import AuditLog
from apps.core.services import verify_audit_chain
from apps.finance import services as fin
from apps.finance.models import CashMovement, Expense
from apps.inventory.models import StockLevel, StockMovement
from apps.inventory.services import move_stock
from apps.inventory.services_ops import create_adjustment, approve_adjustment, start_inventory, count_items, validate_inventory
from apps.purchasing.models import PurchaseOrder, PurchaseOrderItem, Supplier
from apps.purchasing.services import compute_order, receive, send_order
from apps.sales.calc import compute_document
from apps.sales.services import create_credit_note, create_sale

D = Decimal


def level(e, product=None, wh=None):
    return StockLevel.objects.get(product=product or e.product, warehouse=wh or e.wh)


def open_cash(e, user=None):
    return fin.open_session(user=user or e.cashier, register=e.register, opening_float=D("10000"))


def pos(e, user, qty, payments=None, **extra):
    data = {"type": "pos", "warehouse_id": e.wh.pk, "items": [{"product_id": e.product.pk, "quantity": qty}], **extra}
    data["payments"] = payments if payments is not None else [{"method_id": e.cash.pk, "amount": 1180 * int(qty)}]
    return create_sale(user=user, data=data)


# --- Stock ------------------------------------------------------------------------------------

def test_stk_01_entry_creates_movement_and_audit(env):
    env.stock(env.product, 10)
    resp = env.client(env.stockman).post("/api/v1/stock/entries", {
        "warehouse_id": str(env.wh.pk), "product_id": str(env.product.pk), "quantity": "20", "reason": "Stock initial", "movement_type": "manual_in"}, format="json")
    assert resp.status_code == 201, resp.data
    assert level(env).on_hand == 30
    mv = StockMovement.objects.filter(product=env.product).latest("id")
    assert (mv.qty_before, mv.qty_after, mv.quantity) == (10, 30, 20)
    assert AuditLog.objects.filter(action="STOCK_MOVE").exists()


def test_stk_02_exit_refused_when_insufficient(env):
    env.stock(env.product, 3)
    resp = env.client(env.stockman).post("/api/v1/stock/exits", {
        "warehouse_id": str(env.wh.pk), "product_id": str(env.product.pk), "quantity": "5", "reason": "Casse", "movement_type": "damaged"}, format="json")
    assert resp.status_code == 422
    assert resp.data["code"] == "STOCK_INSUFFICIENT"
    assert "disponible 3" in resp.data["detail"]
    assert level(env).on_hand == 3
    assert StockMovement.objects.filter(product=env.product).count() == 1


@pytest.mark.django_db(transaction=True)
def test_stk_03_concurrent_sales_never_negative(env):
    env.stock(env.product, 3)
    errors, ok = [], []

    def sell():
        try:
            move_stock(company=env.company, product=env.product, warehouse=env.wh, quantity=D(-2), movement_type="sale", user=env.cashier)
            ok.append(1)
        except BusinessError as exc:
            errors.append(exc.code)
        finally:
            connection.close()

    threads = [threading.Thread(target=sell) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(ok) == 1 and errors == ["STOCK_INSUFFICIENT"]
    assert level(env).on_hand == 1


def test_stk_07_cmup_and_frozen_cogs(env):
    env.stock(env.product, 10, cost=100)
    move_stock(company=env.company, product=env.product, warehouse=env.wh, quantity=D(10), movement_type="purchase_receipt", user=env.owner, unit_cost=D(120))
    assert level(env).avg_cost == 110
    open_cash(env)
    sale = pos(env, env.cashier, 5)
    assert sale.items.first().unit_cost == 110
    assert level(env).avg_cost == 110


def test_stk_04_adjustment_double_validation(env):
    env.stock(env.product, 5000, cost=100)
    adj = create_adjustment(user=env.stockman, warehouse=env.wh, reason="Casse", lines=[{"product_id": env.product.pk, "qty_diff": -2500}])
    assert adj.status == "pending" and level(env).on_hand == 5000
    with pytest.raises(BusinessError) as exc:
        approve_adjustment(user=env.stockman, adj=adj)
    assert exc.value.code == "SELF_APPROVAL"
    approve_adjustment(user=env.manager, adj=adj)
    assert level(env).on_hand == 2500


def test_stk_06_inventory_gap_creates_adjustment(env):
    env.stock(env.product, 50)
    inv = start_inventory(user=env.stockman, warehouse=env.wh)
    count_items(user=env.storekeeper, inv=inv, counts=[{"product_id": env.product.pk, "qty_counted": 47}])
    validate_inventory(user=env.manager, inv=inv)
    assert level(env).on_hand == 47
    inv.refresh_from_db()
    assert inv.status == "validated" and inv.adjustments.count() == 1
    with pytest.raises(BusinessError):
        count_items(user=env.storekeeper, inv=inv, counts=[{"product_id": env.product.pk, "qty_counted": 50}])


def test_stk_05_transfer_with_gap(env):
    from apps.inventory.services_ops import create_transfer, receive_transfer, ship_transfer

    env.stock(env.product, 20)
    env.stock(env.product, 5, wh=env.wh_b)
    tr = create_transfer(user=env.stockman, from_wh=env.wh, to_wh=env.wh_b, lines=[{"product_id": env.product.pk, "quantity": 10}])
    ship_transfer(user=env.stockman, tr=tr)
    item = tr.items.first()
    receive_transfer(user=env.stockman, tr=tr, lines=[{"item_id": item.pk, "quantity": 8}])
    assert level(env).on_hand == 10 and level(env, wh=env.wh_b).on_hand == 13
    tr.refresh_from_db()
    assert tr.status == "partially_received"


# --- Achats ------------------------------------------------------------------------------------

def test_pur_02_partial_reception(env):
    sup = Supplier.objects.create(company=env.company, code="F1", name="Fournisseur")
    po = PurchaseOrder.objects.create(company=env.company, supplier=sup, warehouse=env.wh, order_date="2026-10-01")
    item = PurchaseOrderItem.objects.create(order=po, product=env.product, qty_ordered=100, unit_price=100)
    compute_order(po)
    send_order(user=env.stockman, order=po)
    receive(user=env.stockman, order=po, lines=[{"order_item_id": item.pk, "quantity": 60}])
    po.refresh_from_db()
    assert po.status == "partial" and level(env).on_hand == 60
    receive(user=env.stockman, order=po, lines=[{"order_item_id": item.pk, "quantity": 40}])
    po.refresh_from_db()
    assert po.status == "received"
    with pytest.raises(BusinessError):
        receive(user=env.stockman, order=po, lines=[{"order_item_id": item.pk, "quantity": 1}])


# --- Facturation ------------------------------------------------------------------------------

def test_inv_01_totals_two_rates_discounts():
    lines = [
        {"quantity": D(2), "unit_price": D(1180), "discount_type": "percent", "discount_value": D(10), "tax_rate": D(18)},
        {"quantity": D(1), "unit_price": D(5000), "discount_type": "amount", "discount_value": D(0), "tax_rate": D(0)},
    ]
    computed, t = compute_document(lines, "percent", 5, True, 0)
    assert t["total"] == sum(c["line_total"] for c in computed)
    assert t["subtotal"] + t["tax_total"] == t["total"]
    # 2*1180=2360 -10% = 2124 ; base 7124 ; remise globale 5% = 356.2 répartie
    assert t["total"] == D("6768")
    assert all(c["line_total"] == c["line_total"].quantize(D(1)) for c in computed)


@pytest.mark.django_db(transaction=True)
def test_inv_02_parallel_numbering_no_gap(env):
    from apps.core.services import next_number

    numbers = []

    def take():
        with transaction.atomic():
            numbers.append(next_number(env.company, "invoice"))
        connection.close()

    threads = [threading.Thread(target=take) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    seqs = sorted(int(n.split("-")[-1]) for n in numbers)
    assert seqs == list(range(1, 7))


def test_sale_atomic_rollback_on_insufficient_stock(env):
    env.stock(env.product, 1)
    open_cash(env)
    with pytest.raises(BusinessError):
        pos(env, env.cashier, 5)
    assert level(env).on_hand == 1
    assert not CashMovement.objects.filter(category="sale").exists()


def test_inv_03_full_cancellation(env):
    env.stock(env.product, 10)
    open_cash(env)
    sale = pos(env, env.cashier, 4)
    assert sale.status == "paid"
    note = create_credit_note(user=env.cashier, sale=sale, items=[], reason="Erreur de client", settlement="refund", full=True)
    sale.refresh_from_db()
    assert sale.status == "cancelled" and note.total == sale.total
    assert level(env).on_hand == 10
    assert sale.number.startswith("TCK-")


def test_sale_006_partial_return_and_cumulative_check(env):
    env.stock(env.product, 20)
    open_cash(env)
    sale = pos(env, env.cashier, 10)
    item = sale.items.first()
    create_credit_note(user=env.cashier, sale=sale, items=[{"sale_item_id": item.pk, "quantity": 4}], reason="Retour", settlement="refund")
    assert level(env).on_hand == 14
    with pytest.raises(BusinessError) as exc:
        create_credit_note(user=env.cashier, sale=sale, items=[{"sale_item_id": item.pk, "quantity": 7}], reason="Retour 2")
    assert exc.value.code == "RETURN_EXCEEDS_SOLD"


# --- Paiements --------------------------------------------------------------------------------

def test_pay_01_partial_payment(env):
    env.stock(env.product, 10)
    open_cash(env, env.manager)
    data = {"type": "invoice", "warehouse_id": env.wh.pk, "customer_id": env.customer.pk,
            "items": [{"product_id": env.product.pk, "quantity": 2, "unit_price": 1250}], "payments": [{"method_id": env.cash.pk, "amount": 1000}]}
    sale = create_sale(user=env.manager, data=data)
    assert sale.total == 2500 and sale.status == "partial" and sale.balance == 1500
    fin.record_customer_payment(user=env.manager, customer=env.customer, method=env.cash, amount=1500, sale=sale)
    sale.refresh_from_db()
    assert sale.status == "paid"


def test_pay_02_idempotent_payment(env):
    open_cash(env)
    p1 = fin.record_customer_payment(user=env.cashier, customer=env.customer, method=env.cash, amount=1000, idempotency_key="k-1")
    p2 = fin.record_customer_payment(user=env.cashier, customer=env.customer, method=env.cash, amount=1000, idempotency_key="k-1")
    assert p1.pk == p2.pk


def test_pay_03_mobile_money_reference_required(env):
    with pytest.raises(BusinessError) as exc:
        fin.record_customer_payment(user=env.manager, customer=env.customer, method=env.om, amount=1000)
    assert exc.value.code == "REFERENCE_REQUIRED"


def test_sale_idempotency_key(env):
    env.stock(env.product, 10)
    open_cash(env)
    data = {"type": "pos", "warehouse_id": env.wh.pk, "items": [{"product_id": env.product.pk, "quantity": 1}], "payments": [{"method_id": env.cash.pk, "amount": 1180}]}
    s1 = create_sale(user=env.cashier, data=data, idempotency_key="abc")
    s2 = create_sale(user=env.cashier, data=data, idempotency_key="abc")
    assert s1.pk == s2.pk and level(env).on_hand == 9


def test_sale_008_credit_limit(env):
    env.stock(env.product, 500)
    env.customer.credit_limit = D(300000)
    env.customer.save()
    base = {"type": "invoice", "warehouse_id": env.wh.pk, "customer_id": env.customer.pk, "payments": []}
    create_sale(user=env.seller, data={**base, "items": [{"product_id": env.product.pk, "quantity": 211}]})  # 248 980 d'encours
    with pytest.raises(BusinessError) as exc:
        create_sale(user=env.seller, data={**base, "items": [{"product_id": env.product.pk, "quantity": 85}]})
    assert exc.value.code == "CREDIT_LIMIT_EXCEEDED"
    sale = create_sale(user=env.seller, data={**base, "items": [{"product_id": env.product.pk, "quantity": 85}], "credit_override_pin": "1234"})
    assert sale.credit_override_by == env.manager


def test_walkin_requires_full_payment(env):
    env.stock(env.product, 5)
    open_cash(env)
    with pytest.raises(BusinessError) as exc:
        pos(env, env.cashier, 2, payments=[{"method_id": env.cash.pk, "amount": 1000}])
    assert exc.value.code == "WALKIN_FULL_PAYMENT"


def test_prm_01_discount_cap_requires_manager_pin(env):
    env.stock(env.product, 5)
    open_cash(env)
    with pytest.raises(BusinessError) as exc:
        pos(env, env.cashier, 1, global_discount_value=30, payments=[{"method_id": env.cash.pk, "amount": 826}])
    assert exc.value.code == "DISCOUNT_AUTH_REQUIRED"
    sale = pos(env, env.cashier, 1, global_discount_value=30, override_pin="1234", payments=[{"method_id": env.cash.pk, "amount": 826}])
    assert sale.discount_authorized_by == env.manager


def test_change_returned_in_cash(env):
    env.stock(env.product, 5)
    open_cash(env)
    sale = pos(env, env.cashier, 1, payments=[{"method_id": env.cash.pk, "amount": 2000}])
    assert sale._change == 820 and sale.paid_amount == 1180


# --- Caisse -----------------------------------------------------------------------------------

def test_csh_01_session_rules_and_close_with_gap(env):
    s = open_cash(env)
    with pytest.raises(BusinessError) as exc:
        fin.open_session(user=env.manager, register=env.register, opening_float=0)
    assert exc.value.code == "SESSION_ALREADY_OPEN"
    env.stock(env.product, 5)
    pos(env, env.cashier, 1)
    expected = fin.session_expected(s)
    assert expected["cash"] == D(11180)
    with pytest.raises(BusinessError) as exc:
        fin.close_session(user=env.cashier, session=s, counted={"cash": 10180})
    assert exc.value.code == "DIFFERENCE_REASON_REQUIRED"
    s = fin.close_session(user=env.cashier, session=s, counted={"cash": 10180}, reason="Erreur de rendu")
    assert s.difference == -1000 and s.z_number.startswith("Z-")
    fin.validate_session(user=env.manager, session=s)
    assert CashMovement.objects.filter(category="cash_difference", amount=1000, direction="out").exists()


# --- Dépenses ---------------------------------------------------------------------------------

def test_exp_01_cash_expense_reduces_session(env):
    s = open_cash(env)
    e = Expense.objects.create(company=env.company, expense_date="2026-10-01", category=env.exp_cat, amount=5000, description="Transport livraison", created_by=env.cashier)
    fin.submit_expense(user=env.cashier, expense=e, pay={"method": env.cash})
    e.refresh_from_db()
    assert e.status == "paid" and e.number.startswith("DEP-")
    assert fin.session_expected(s)["cash"] == D(5000)


def test_exp_02_cash_without_session_refused(env):
    e = Expense.objects.create(company=env.company, expense_date="2026-10-01", category=env.exp_cat, amount=5000, description="Transport livraison", created_by=env.cashier)
    with pytest.raises(BusinessError) as exc:
        fin.submit_expense(user=env.cashier, expense=e, pay={"method": env.cash})
    assert exc.value.code == "NO_OPEN_SESSION"


def test_exp_03_04_approval_threshold_and_self_approval(env):
    e = Expense.objects.create(company=env.company, expense_date="2026-10-01", category=env.exp_cat, amount=24000, description="Achat fournitures", created_by=env.cashier)
    fin.submit_expense(user=env.cashier, expense=e)
    assert e.status == "pending"
    assert not CashMovement.objects.filter(category="expense").exists()
    e2 = Expense.objects.create(company=env.company, expense_date="2026-10-01", category=env.exp_cat, amount=600000, description="Gros achat", created_by=env.manager)
    e2_cat = env.exp_cat
    e2_cat.receipt_required_above = None
    e2_cat.save()
    fin.submit_expense(user=env.manager, expense=e2)
    assert e2.status == "pending"
    with pytest.raises(BusinessError) as exc:
        fin.approve_expense(user=env.manager, expense=e2)
    assert exc.value.code == "SELF_APPROVAL"


def test_exp_receipt_required(env):
    e = Expense.objects.create(company=env.company, expense_date="2026-10-01", category=env.exp_cat, amount=30000, description="Location camion", created_by=env.manager)
    with pytest.raises(BusinessError) as exc:
        fin.submit_expense(user=env.manager, expense=e)
    assert exc.value.code == "RECEIPT_REQUIRED"


def test_exp_05_cancel_paid_expense_restores_cash(env):
    s = open_cash(env)
    e = Expense.objects.create(company=env.company, expense_date="2026-10-01", category=env.exp_cat, amount=5000, description="Transport livraison", created_by=env.cashier)
    fin.submit_expense(user=env.cashier, expense=e, pay={"method": env.cash})
    fin.cancel_expense(user=env.manager, expense=e, reason="Saisie en double")
    assert e.status == "cancelled"
    assert fin.session_expected(s)["cash"] == D(10000)


# --- Sécurité ---------------------------------------------------------------------------------

def test_sec_01_storekeeper_never_sees_costs(env):
    resp = env.client(env.storekeeper).get("/api/v1/products")
    assert resp.status_code == 200
    first = resp.data["data"][0]
    assert "cost_avg" not in first and "cost_last" not in first and "margin_pct" not in first


def test_sec_02_idor_other_company(env):
    from apps.core.models import Company
    from apps.sales.models import Customer

    other = Company.objects.create(name="Autre")
    foreign = Customer.objects.create(company=other, code="Z", name="Étranger")
    resp = env.client(env.manager).get(f"/api/v1/customers/{foreign.pk}")
    assert resp.status_code == 404


def test_sec_03_lockout_after_failures(env):
    from rest_framework.test import APIClient

    cl = APIClient()
    for _ in range(5):
        cl.post("/api/v1/auth/login", {"identifier": "cashier@t.ml", "password": "wrong"}, format="json")
    resp = cl.post("/api/v1/auth/login", {"identifier": "cashier@t.ml", "password": "Test@Password2026"}, format="json")
    assert resp.status_code == 423
    resp = cl.post("/api/v1/auth/login", {"identifier": "nobody@t.ml", "password": "x"}, format="json")
    assert resp.status_code == 401 and resp.data["detail"] == "Identifiants incorrects."


def test_sec_04_audit_and_movements_immutable(env):
    env.stock(env.product, 5)
    with pytest.raises((InternalError, ProgrammingError)):
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute("UPDATE inventory_stockmovement SET quantity = 999")
    from apps.core.services import audit

    audit(env.company, env.owner, "TEST", "x")
    with pytest.raises((InternalError, ProgrammingError)):
        with transaction.atomic():
            AuditLog.objects.all().delete()
    assert verify_audit_chain(env.company) is None


def test_user_003_anti_escalation(env):
    resp = env.client(env.manager).post("/api/v1/roles", {"name": "Hack", "permissions": ["users.manage"]}, format="json")
    assert resp.status_code == 403  # pas users.manage → refusé dès la garde
    admin_role_user = env.owner
    resp = env.client(admin_role_user).post("/api/v1/roles", {"name": "Ok", "permissions": ["sales.view"]}, format="json")
    assert resp.status_code == 201


def test_cashier_cannot_change_price(env):
    env.stock(env.product, 5)
    open_cash(env)
    data = {"type": "pos", "warehouse_id": env.wh.pk, "items": [{"product_id": env.product.pk, "quantity": 1, "unit_price": 500}],
            "payments": [{"method_id": env.cash.pk, "amount": 500}]}
    with pytest.raises(BusinessError) as exc:
        create_sale(user=env.cashier, data=data)
    assert exc.value.code == "PRICE_EDIT_FORBIDDEN"


def test_api_sale_flow_and_pdf(env):
    env.stock(env.product, 5)
    open_cash(env)
    cl = env.client(env.cashier)
    resp = cl.post("/api/v1/sales", {"type": "pos", "warehouse_id": str(env.wh.pk), "items": [{"product_id": str(env.product.pk), "quantity": "1"}],
                                     "payments": [{"method_id": str(env.cash.pk), "amount": "2000"}]}, format="json", HTTP_IDEMPOTENCY_KEY="z1")
    assert resp.status_code == 201, resp.data
    assert resp.data["change"] == "820.0000" or D(resp.data["change"]) == 820
    pdf = cl.get(f"/api/v1/sales/{resp.data['id']}/pdf?paper=ticket")
    assert pdf.status_code == 200 and pdf["Content-Type"] == "application/pdf"
    a4 = cl.get(f"/api/v1/sales/{resp.data['id']}/pdf")
    assert a4.content[:4] == b"%PDF"


def test_dashboard_and_reports(env):
    env.stock(env.product, 5)
    open_cash(env)
    pos(env, env.cashier, 2)
    cl = env.client(env.owner)
    d = cl.get("/api/v1/dashboard?period=month")
    assert d.status_code == 200 and D(d.data["kpis"]["revenue"]) == 2360
    for name in ("sales-by-day", "sales-by-product", "stock-valuation", "receivables", "profit", "expenses-by-category", "low-stock"):
        r = cl.get(f"/api/v1/reports/{name}?period=month")
        assert r.status_code == 200, (name, r.data)
    x = cl.get("/api/v1/reports/sales-by-product?period=month&export=xlsx")
    assert x.status_code == 200
    c = env.client(env.cashier).get("/api/v1/dashboard")
    assert "gross_margin" not in c.data["kpis"]


def test_cash_004_bank_deposit_keeps_float(env):
    """CASH-004 : le dépôt en banque ne peut vider le fond de caisse ; aucun effet sur le résultat."""
    from apps.finance.services import account_balance, transfer_funds

    s = open_cash(env)
    env.stock(env.product, 5)
    pos(env, env.cashier, 2)  # +2360 espèces
    with pytest.raises(BusinessError) as exc:
        transfer_funds(user=env.manager, from_account=env.cash_acc, to_account=env.bank, amount=5000)
    assert exc.value.code == "FUNDS_INSUFFICIENT"
    transfer_funds(user=env.manager, from_account=env.cash_acc, to_account=env.bank, amount=2360)
    assert account_balance(env.bank) == 2360
    assert fin.session_expected(s)["cash"] == D(10000)  # il ne reste que le fond de caisse
