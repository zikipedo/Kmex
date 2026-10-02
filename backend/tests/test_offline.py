"""Mode hors-ligne : scénarios T-OFF-01 / SYNC-001 / SYNC-002 (§24.3)."""
import uuid
from decimal import Decimal

from apps.core.sync_models import SyncDevice, SyncOperation
from apps.finance import services as fin
from apps.inventory.models import StockLevel
from apps.sales.models import Sale

D = Decimal


def sale_op(env, qty=1, price=None, session=None, n=1):
    return {
        "op_id": str(uuid.uuid4()),
        "type": "sale",
        "created_at_local": "2026-10-01T10:0%d:00Z" % n,
        "payload": {
            "user_id": str(env.cashier.pk),
            "warehouse_id": str(env.wh.pk),
            "register_session_id": str(session.pk) if session else None,
            "provisional_number": f"OFF-ABCD-{n:04d}",
            "items": [{"product_id": str(env.product.pk), "quantity": qty, "unit_price": price or "1180"}],
            "payments": [{"method_id": str(env.cash.pk), "amount": str(int(qty) * int(price or 1180))}],
        },
    }


def push(env, ops, device="dev-1"):
    return env.client(env.cashier).post("/api/v1/sync/push", {"device_id": device, "device_name": "Caisse tablette", "operations": ops}, format="json")


def test_off_01_three_sales_replayed_exactly_once(env):
    env.stock(env.product, 10)
    s = fin.open_session(user=env.cashier, register=env.register, opening_float=D(0))
    ops = [sale_op(env, session=s, n=i) for i in range(1, 4)]
    r1 = push(env, ops)
    assert r1.status_code == 200, r1.data
    assert [x["status"] for x in r1.data["results"]] == ["done"] * 3
    r2 = push(env, ops)  # reprise après coupure pendant l'envoi
    assert [x["result"]["number"] for x in r2.data["results"]] == [x["result"]["number"] for x in r1.data["results"]]
    assert Sale.objects.filter(offline_ref__startswith="OFF-ABCD").count() == 3
    assert StockLevel.objects.get(product=env.product, warehouse=env.wh).on_hand == 7
    assert r1.data["results"][0]["result"]["number"].startswith("TCK-")


def test_sync_conflict_negative_stock_is_accepted_and_flagged(env):
    env.stock(env.product, 1)
    s = fin.open_session(user=env.cashier, register=env.register, opening_float=D(0))
    r = push(env, [sale_op(env, qty=3, session=s)])
    res = r.data["results"][0]
    assert res["status"] == "done"
    assert any("synchronisation" in w for w in res["warnings"])
    assert StockLevel.objects.get(product=env.product, warehouse=env.wh).on_hand == -2


def test_sync_offline_price_is_kept(env):
    env.stock(env.product, 5)
    s = fin.open_session(user=env.cashier, register=env.register, opening_float=D(0))
    r = push(env, [sale_op(env, price="1000", session=s)])
    res = r.data["results"][0]
    assert res["status"] == "done" and res["result"]["total"].startswith("1000")
    assert any("modifié" in w for w in res["warnings"])


def test_sync_without_open_session_is_conflict_then_retry(env):
    env.stock(env.product, 5)
    r = push(env, [sale_op(env)])
    res = r.data["results"][0]
    assert res["status"] == "conflict" and res["result"]["code"] == "SYNC_NO_SESSION"
    fin.open_session(user=env.cashier, register=env.register, opening_float=D(0))
    op = SyncOperation.objects.get()
    rr = env.client(env.cashier).post(f"/api/v1/sync/operations/{op.pk}/retry")
    assert rr.data["status"] == "done"
    assert Sale.objects.count() == 1


def test_sync_revoked_device_refused(env):
    SyncDevice.objects.create(company=env.company, device_id="stolen", name="Tablette volée", revoked_at="2026-10-01T00:00:00Z")
    r = push(env, [sale_op(env)], device="stolen")
    assert r.status_code == 403 and r.data["code"] == "DEVICE_REVOKED"


def test_sync_other_user_ops_refused(env):
    op = sale_op(env)
    op["payload"]["user_id"] = str(env.manager.pk)
    r = push(env, [op])
    assert r.status_code == 403


def test_pull_reference_data(env):
    r = env.client(env.cashier).get(f"/api/v1/sync/pull?warehouse={env.wh.pk}")
    assert r.status_code == 200
    assert r.data["full"] is True and len(r.data["products"]) == 2
    assert "cost_avg" not in r.data["products"][0]  # le caissier ne reçoit jamais les coûts
