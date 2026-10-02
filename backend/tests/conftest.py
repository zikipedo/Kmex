from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.accounts.catalog import DEFAULT_ROLES, PERMISSIONS
from apps.accounts.models import Permission, Role, User
from apps.catalog.models import Category, Product, Tax, Unit
from apps.core.models import Company, Warehouse
from apps.finance.models import CashRegister, ExpenseCategory, PaymentMethod, TreasuryAccount
from apps.inventory.services import move_stock
from apps.sales.models import Customer

PWD = "Test@Password2026"


class Env:
    pass


@pytest.fixture
def env(db):
    e = Env()
    for code, (module, label) in PERMISSIONS.items():
        Permission.objects.get_or_create(code=code, defaults={"module": module, "label": label})
    c = e.company = Company.objects.create(name="Test SARL", settings={"adjustment_approval_threshold": "100000"})
    roles = {}
    for name, spec in DEFAULT_ROLES.items():
        r = Role.objects.create(company=c, name=name, is_system=True, max_discount_pct=spec["max_discount_pct"],
                                expense_approval_limit=spec["expense_approval_limit"])
        r.permissions.set(Permission.objects.filter(code__in=spec["perms"]))
        roles[name] = r
    e.wh = Warehouse.objects.create(company=c, code="A", name="Dépôt A")
    e.wh_b = Warehouse.objects.create(company=c, code="B", name="Dépôt B")

    def mk(email, role=None, owner=False, pin=None):
        u = User.objects.create_user(email, PWD, company=c, full_name=email.split("@")[0], is_owner=owner)
        if role:
            u.roles.add(roles[role])
        u.warehouses.set([e.wh, e.wh_b])
        if pin:
            u.set_pin(pin)
            u.save()
        return u

    e.owner = mk("owner@t.ml", owner=True)
    e.manager = mk("manager@t.ml", "Gérant", pin="1234")
    e.manager2 = mk("manager2@t.ml", "Gérant", pin="5678")
    e.cashier = mk("cashier@t.ml", "Caissier")
    e.seller = mk("seller@t.ml", "Vendeur")
    e.storekeeper = mk("store@t.ml", "Magasinier")
    e.stockman = mk("stockman@t.ml", "Responsable de stock")
    e.accountant = mk("acc@t.ml", "Comptable")

    e.cash_acc = TreasuryAccount.objects.create(company=c, type="cash", name="Caisse A")
    e.bank = TreasuryAccount.objects.create(company=c, type="bank", name="Banque")
    e.om_acc = TreasuryAccount.objects.create(company=c, type="mobile_money", name="OM")
    e.register = CashRegister.objects.create(company=c, warehouse=e.wh, name="Caisse 1", cash_account=e.cash_acc)
    e.register2 = CashRegister.objects.create(company=c, warehouse=e.wh, name="Caisse 2",
                                              cash_account=TreasuryAccount.objects.create(company=c, type="cash", name="Caisse B"))
    e.cash = PaymentMethod.objects.create(company=c, code="cash", name="Espèces", type="cash")
    e.om = PaymentMethod.objects.create(company=c, code="orange_money", name="Orange Money", type="mobile_money", account=e.om_acc, requires_reference=True)
    e.transfer = PaymentMethod.objects.create(company=c, code="transfer", name="Virement", type="transfer", account=e.bank, requires_reference=True)

    e.vat = Tax.objects.create(company=c, name="TVA", rate=18)
    e.unit = Unit.objects.create(company=c, code="pce", name="Pièce")
    e.cat = Category.objects.create(company=c, name="Divers", default_tax=e.vat)
    e.product = Product.objects.create(company=c, name="Produit X", internal_ref="PRD-1", sku="X1", barcode="2000000000015",
                                       category=e.cat, unit=e.unit, tax=e.vat, price_retail=Decimal("1180"), cost_avg=100, min_stock=2)
    e.product2 = Product.objects.create(company=c, name="Produit Y", internal_ref="PRD-2", sku="Y1", category=e.cat, unit=e.unit,
                                        tax=e.vat, price_retail=Decimal("2360"), cost_avg=500)
    e.customer = Customer.objects.create(company=c, code="C1", name="Client crédit", credit_limit=Decimal("300000"), payment_terms_days=30)
    e.exp_cat = ExpenseCategory.objects.create(company=c, name="Transport", receipt_required_above=Decimal("25000"))

    def stock(product, qty, wh=None, cost=100):
        move_stock(company=c, product=product, warehouse=wh or e.wh, quantity=Decimal(qty), movement_type="initial",
                   user=e.owner, unit_cost=Decimal(cost))
    e.stock = stock

    def client(user):
        cl = APIClient()
        cl.force_authenticate(user)
        return cl
    e.client = client
    return e
