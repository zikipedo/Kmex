"""Jeu de données de démonstration cohérent : 60 jours d'activité générés via les services métier."""
import random
from datetime import datetime, time, timedelta
from decimal import Decimal
from unittest import mock

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.catalog import DEFAULT_ROLES, PERMISSIONS
from apps.accounts.models import Permission, Role, User
from apps.catalog.models import Brand, Category, Product, Tax, Unit
from apps.core.models import Company, Warehouse
from apps.finance import services as fin
from apps.finance.models import CashRegister, Expense, ExpenseCategory, PaymentMethod, TreasuryAccount
from apps.inventory.services import move_stock
from apps.purchasing.models import Supplier
from apps.purchasing.services import direct_purchase
from apps.sales.models import Customer
from apps.sales.services import create_credit_note, create_sale, walkin_customer

PASSWORD = "Demo@2026!"


def ean13(seed: int) -> str:
    base = f"200{seed:09d}"[:12]
    total = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(base))
    return base + str((10 - total % 10) % 10)


def receipt_image(title, amount, payee, day):
    """Reçu photographié simulé (PNG) pour les justificatifs de démonstration."""
    import io

    from PIL import Image, ImageDraw

    img = Image.new("RGB", (480, 640), (250, 248, 240))
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, 460, 620], outline=(200, 195, 180), width=2)
    lines = ["REÇU", "", payee.upper(), f"Date : {day:%d/%m/%Y}", "", title, "", f"MONTANT : {amount:,.0f} F CFA".replace(",", " "), "", "Merci"]
    y = 60
    for ln in lines:
        d.text((50, y), ln, fill=(40, 40, 50))
        y += 40
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def attach_receipt(expense, user):
    from apps.core.files import process_image
    from apps.finance.models import ExpenseAttachment

    import hashlib

    data = receipt_image(expense.description, expense.amount, expense.payee_name or "Fournisseur", expense.expense_date)
    path, thumbs, _ = process_image(data, f"company/{expense.company_id}/expenses/{expense.pk}")
    ExpenseAttachment.objects.create(company=expense.company, expense=expense, file=path, thumb=thumbs["200"], mime="image/png",
                                     sha256=hashlib.sha256(data).hexdigest(), size_bytes=len(data), created_by=user)


CATEGORIES = [
    ("Boissons", "cup-soda", "#38bdf8"),
    ("Épicerie", "wheat", "#f59e0b"),
    ("Produits laitiers", "milk", "#a5b4fc"),
    ("Hygiène & beauté", "sparkles", "#f472b6"),
    ("Entretien", "spray-can", "#34d399"),
    ("Électronique", "smartphone", "#a78bfa"),
    ("Textile", "shirt", "#fb7185"),
    ("Quincaillerie", "wrench", "#fbbf24"),
]

PRODUCTS = [
    # nom, catégorie, marque, unité, coût, prix, min, fav
    ("Eau minérale Diago 1,5 L", "Boissons", "Diago", "pce", 250, 400, 48, True),
    ("Coca-Cola 33 cl canette", "Boissons", "Coca-Cola", "pce", 300, 500, 48, True),
    ("Jus de bissap 1 L", "Boissons", "Bissap d'Or", "pce", 600, 1000, 24, True),
    ("Café Touba 250 g", "Boissons", "Touba Gold", "pce", 1200, 1900, 20, False),
    ("Thé vert Chinois 500 g", "Boissons", "Lipton", "pce", 1500, 2300, 15, True),
    ("Riz parfumé 25 kg", "Épicerie", "Riz du Delta", "sac", 13500, 19500, 10, True),
    ("Sucre en morceaux 1 kg", "Épicerie", "Sosuco", "pce", 650, 900, 30, True),
    ("Huile Dinor 5 L", "Épicerie", "Dinor", "pce", 6200, 9000, 12, True),
    ("Farine de blé 1 kg", "Épicerie", "Grands Moulins", "pce", 550, 800, 20, False),
    ("Lait en poudre Nido 400 g", "Produits laitiers", "Nido", "pce", 2600, 3900, 15, True),
    ("Lait concentré sucré 397 g", "Produits laitiers", "Bonnet Rouge", "pce", 700, 1000, 24, False),
    ("Yaourt nature x4", "Produits laitiers", "Danone", "pce", 1100, 1600, 10, False),
    ("Savon de Marseille 300 g", "Hygiène & beauté", "Le Chat", "pce", 450, 700, 30, True),
    ("Dentifrice Signal 100 ml", "Hygiène & beauté", "Signal", "pce", 700, 1100, 20, False),
    ("Crème corporelle Nivea 400 ml", "Hygiène & beauté", "Nivea", "pce", 2700, 4300, 10, False),
    ("Parfum d'ambiance 300 ml", "Hygiène & beauté", "Glade", "pce", 1300, 2000, 8, False),
    ("Lessive OMO 1 kg", "Entretien", "OMO", "pce", 1300, 1900, 20, True),
    ("Eau de Javel 1 L", "Entretien", "La Croix", "pce", 400, 650, 20, False),
    ("Liquide vaisselle 750 ml", "Entretien", "Mir", "pce", 750, 1100, 15, False),
    ("Smartphone Tecno Spark 20", "Électronique", "Tecno", "pce", 68000, 99000, 3, True),
    ("Écouteurs Bluetooth Oraimo", "Électronique", "Oraimo", "pce", 6500, 12500, 6, True),
    ("Chargeur rapide USB-C 33 W", "Électronique", "Oraimo", "pce", 3500, 6000, 8, False),
    ("Power bank 20 000 mAh", "Électronique", "Itel", "pce", 9000, 16000, 5, False),
    ("Ampoule LED 12 W", "Électronique", "Philips", "pce", 900, 1500, 20, False),
    ("Bazin riche 5 m", "Textile", "Bazin Getzner", "pce", 22000, 35000, 4, False),
    ("Pagne wax 6 yards", "Textile", "Vlisco", "pce", 12000, 19500, 5, True),
    ("T-shirt coton unisexe", "Textile", "Kmex", "pce", 1800, 3500, 15, False),
    ("Ciment CPJ 50 kg", "Quincaillerie", "Diamond Cement", "sac", 4800, 6500, 20, False),
    ("Fer à béton 10 mm (barre)", "Quincaillerie", "Sotrafer", "pce", 3800, 5200, 30, False),
    ("Peinture acrylique 20 L", "Quincaillerie", "Seigneurie", "pce", 21000, 32000, 3, False),
    ("Cadenas laiton 50 mm", "Quincaillerie", "Tri-Circle", "pce", 1500, 2500, 10, False),
    ("Pâtes spaghetti 500 g", "Épicerie", "Panzani", "pce", 380, 600, 40, True),
    ("Tomate concentrée 400 g", "Épicerie", "Gino", "pce", 450, 700, 40, False),
    ("Bouillon cube x100", "Épicerie", "Maggi", "pce", 1600, 2300, 15, True),
]

SUPPLIERS = [
    ("Grands Distributeurs du Mali", "Moussa Traoré", "+223 20 22 11 00", 30),
    ("SODIMA Import-Export", "Awa Coulibaly", "+223 20 21 45 67", 15),
    ("Tech Afrique Distribution", "Ibrahim Diallo", "+223 76 54 32 10", 30),
    ("Textiles du Sahel", "Fatoumata Keïta", "+223 66 12 34 56", 45),
    ("Matériaux BTP Sénou", "Oumar Sangaré", "+223 79 88 77 66", 30),
]

CUSTOMERS = [
    ("Boutique Fanta Diarra", "wholesaler", "+223 76 11 22 33", 500000),
    ("Restaurant Le Djenné", "company", "+223 20 23 45 12", 300000),
    ("Hôtel Salam", "company", "+223 20 22 12 00", 1000000),
    ("Mamadou Konaté", "individual", "+223 66 77 88 99", 50000),
    ("Aïssata Touré", "individual", "+223 75 44 33 22", 0),
    ("Mairie de la Commune III", "administration", "+223 20 22 56 78", 2000000),
    ("Supérette Kalaban", "wholesaler", "+223 79 12 12 12", 750000),
    ("Seydou Cissé", "individual", "+223 65 98 76 54", 25000),
    ("École Les Lauréats", "company", "+223 20 28 90 90", 400000),
    ("Kadiatou Sidibé", "individual", "+223 78 65 43 21", 0),
    ("Garage Moderne ACI", "company", "+223 76 00 11 22", 200000),
    ("Bintou Maïga", "individual", "+223 74 32 10 98", 0),
]

EXPENSE_CATEGORIES = [
    ("Loyer et charges locatives", "home", "#a78bfa", "fixed", 350000, False),
    ("Énergie et eau", "zap", "#fbbf24", "variable", 120000, False),
    ("Télécommunications", "wifi", "#38bdf8", "fixed", 40000, False),
    ("Transport et livraison", "truck", "#34d399", "variable", 80000, False),
    ("Personnel", "users", "#f472b6", "fixed", 900000, True),
    ("Entretien et maintenance", "hammer", "#fb923c", "variable", 50000, False),
    ("Fournitures", "package", "#94a3b8", "variable", 30000, False),
    ("Marketing et communication", "megaphone", "#e879f9", "variable", 60000, False),
    ("Frais financiers", "landmark", "#60a5fa", "variable", 20000, False),
    ("Impôts et taxes", "scale", "#f87171", "fixed", 100000, False),
    ("Équipements et investissements", "monitor", "#2dd4bf", "variable", None, False),
    ("Frais divers", "shapes", "#cbd5e1", "variable", 20000, False),
]


class Command(BaseCommand):
    help = "Crée une entreprise de démonstration complète (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=60)
        parser.add_argument("--force", action="store_true")

    def handle(self, *args, **opts):
        if Company.objects.exists() and not opts["force"]:
            self.stdout.write("ℹ️  Données déjà présentes — seed ignoré.")
            return
        self.rng = random.Random(2026)
        self.stdout.write("🌱 Création de l'entreprise de démonstration…")
        with transaction.atomic():
            self.base()
        self.history(opts["days"])
        self.stdout.write(self.style.SUCCESS("✅ Démo prête. Connexion : admin@stockpro.ml / " + PASSWORD))

    # ------------------------------------------------------------------------------------
    def base(self):
        for code, (module, label) in PERMISSIONS.items():
            Permission.objects.update_or_create(code=code, defaults={"module": module, "label": label})

        c = self.company = Company.objects.create(
            name="Kmex Market", legal_name="Kmex Market SARL", address="Avenue de l'Indépendance, ACI 2000", city="Bamako",
            country="Mali", phone="+223 20 22 00 00", email="contact@kmex.ml", website="www.kmex.ml",
            legal_ids={"NIF": "084123456X", "RCCM": "MA.BKO.2021.B.1234"},
        )
        self.roles = {}
        for name, spec in DEFAULT_ROLES.items():
            r = Role.objects.create(company=c, name=name, description=spec["description"], is_system=True,
                                    max_discount_pct=spec["max_discount_pct"], expense_approval_limit=spec["expense_approval_limit"])
            r.permissions.set(Permission.objects.filter(code__in=spec["perms"]))
            self.roles[name] = r

        self.wh = Warehouse.objects.create(company=c, code="MAG", name="Magasin Bamako-Centre", type="store", address="Marché Rose, Bamako", phone="+223 20 22 00 01")
        self.wh2 = Warehouse.objects.create(company=c, code="ENT", name="Entrepôt ACI 2000", type="warehouse", address="Zone industrielle", phone="+223 20 22 00 02")

        def user(email, name, role, title, pin=None, owner=False, whs=None):
            u = User.objects.create_user(email, PASSWORD, company=c, full_name=name, job_title=title, is_owner=owner,
                                         phone="", default_warehouse=self.wh)
            if role:
                u.roles.add(self.roles[role])
            u.warehouses.set(whs or [self.wh])
            if pin:
                u.set_pin(pin)
                u.save()
            return u

        self.admin = user("admin@stockpro.ml", "Abdoulaye Diallo", None, "Directeur général", "0000", owner=True, whs=[self.wh, self.wh2])
        self.manager = user("gerant@stockpro.ml", "Mariam Coulibaly", "Gérant", "Gérante du magasin", "1234", whs=[self.wh, self.wh2])
        self.stockman = user("stock@stockpro.ml", "Boubacar Sanogo", "Responsable de stock", "Responsable logistique", whs=[self.wh, self.wh2])
        user("magasinier@stockpro.ml", "Issa Keïta", "Magasinier", "Magasinier", whs=[self.wh2])
        self.cashier = user("caissier@stockpro.ml", "Awa Traoré", "Caissier", "Caissière", "1111")
        self.cashier2 = user("caissier2@stockpro.ml", "Hamidou Touré", "Caissier", "Caissier", "2222")
        self.seller = user("vendeur@stockpro.ml", "Salif Dembélé", "Vendeur", "Commercial grossistes")
        self.accountant = user("comptable@stockpro.ml", "Kadidia Sow", "Comptable", "Comptable")
        self.wh.manager = self.manager
        self.wh.save()

        bank = self.bank = TreasuryAccount.objects.create(company=c, type="bank", name="Banque BOA Mali")
        om = TreasuryAccount.objects.create(company=c, type="mobile_money", name="Orange Money Pro")
        wave = TreasuryAccount.objects.create(company=c, type="mobile_money", name="Wave Business")
        moov = TreasuryAccount.objects.create(company=c, type="mobile_money", name="Moov Money")
        chq = TreasuryAccount.objects.create(company=c, type="cheque", name="Chèques à encaisser")
        self.reg1 = CashRegister.objects.create(company=c, warehouse=self.wh, name="Caisse 1",
                                                cash_account=TreasuryAccount.objects.create(company=c, type="cash", name="Caisse 1 — Espèces"))
        self.reg2 = CashRegister.objects.create(company=c, warehouse=self.wh, name="Caisse 2",
                                                cash_account=TreasuryAccount.objects.create(company=c, type="cash", name="Caisse 2 — Espèces"))
        methods = [
            ("cash", "Espèces", "cash", None, False, "#34d399"), ("orange_money", "Orange Money", "mobile_money", om, True, "#fb923c"),
            ("wave", "Wave", "mobile_money", wave, True, "#38bdf8"), ("moov_money", "Moov Money", "mobile_money", moov, True, "#60a5fa"),
            ("card", "Carte bancaire", "card", bank, False, "#a78bfa"), ("transfer", "Virement", "transfer", bank, True, "#818cf8"),
            ("cheque", "Chèque", "cheque", chq, True, "#f472b6"),
        ]
        self.methods = {}
        for i, (code, name, type_, acc, ref, color) in enumerate(methods):
            self.methods[code] = PaymentMethod.objects.create(company=c, code=code, name=name, type=type_, account=acc,
                                                              requires_reference=ref, color=color, position=i)

        vat = Tax.objects.create(company=c, name="TVA", rate=18, is_default=True)
        Tax.objects.create(company=c, name="Exonéré", rate=0)
        units = {code: Unit.objects.create(company=c, code=code, name=name, is_decimal=dec) for code, name, dec in [
            ("pce", "Pièce", False), ("kg", "Kilogramme", True), ("L", "Litre", True), ("sac", "Sac", False), ("ctn", "Carton", False), ("m", "Mètre", True)]}
        cats = {n: Category.objects.create(company=c, name=n, icon=i, color=col, default_tax=vat) for n, i, col in CATEGORIES}
        brands = {}
        sups = [Supplier.objects.create(company=c, code=f"FRS-{i+1:04d}", name=n, contact_name=ct, phone=ph, payment_terms_days=t, country="Mali")
                for i, (n, ct, ph, t) in enumerate(SUPPLIERS)]
        sup_for = {"Boissons": sups[1], "Épicerie": sups[0], "Produits laitiers": sups[1], "Hygiène & beauté": sups[0], "Entretien": sups[0],
                   "Électronique": sups[2], "Textile": sups[3], "Quincaillerie": sups[4]}
        self.suppliers = sups
        self.products = []
        for i, (name, cat, brand, unit, cost, price, mn, fav) in enumerate(PRODUCTS):
            if brand not in brands:
                brands[brand] = Brand.objects.create(company=c, name=brand)
            p = Product.objects.create(
                company=c, name=name, internal_ref=f"PRD-{i+1:06d}", sku=f"SKU-{i+1:05d}", barcode=ean13(1000 + i), category=cats[cat],
                brand=brands[brand], unit=units[unit], tax=vat, cost_last=cost, cost_avg=cost, price_retail=price,
                price_wholesale=round(price * 0.92 / 50) * 50 if cat in ("Épicerie", "Boissons", "Entretien") else None,
                wholesale_min_qty=12 if cat in ("Épicerie", "Boissons", "Entretien") else None, min_stock=mn, max_stock=mn * 6,
                is_favorite=fav, main_supplier=sup_for[cat],
            )
            self.products.append(p)
        from apps.core.models import DocumentSequence

        DocumentSequence.objects.create(company=c, doc_type="product", year=0, prefix="PRD", next_value=len(PRODUCTS) + 1)
        DocumentSequence.objects.create(company=c, doc_type="supplier", year=0, prefix="FRS", next_value=len(SUPPLIERS) + 1)
        Product.objects.create(company=c, name="Livraison à domicile", internal_ref="PRD-SRV-001", sku="SRV-LIV", type="service",
                               category=cats["Épicerie"], unit=units["pce"], tax=vat, price_retail=1500, track_stock=False)

        walkin_customer(c)
        self.customers = []
        for i, (n, t, ph, lim) in enumerate(CUSTOMERS):
            self.customers.append(Customer.objects.create(company=c, code=f"CLI-{i+1:05d}", name=n, type=t, phone=ph, whatsapp=ph,
                                                          credit_limit=lim, payment_terms_days=30 if lim else 0, city="Bamako"))
        DocumentSequence.objects.create(company=c, doc_type="customer", year=0, prefix="CLI", next_value=len(CUSTOMERS) + 1)

        self.exp_cats = {}
        for n, icon, color, kind, budget, sensitive in EXPENSE_CATEGORIES:
            self.exp_cats[n] = ExpenseCategory.objects.create(
                company=c, name=n, icon=icon, color=color, kind=kind, monthly_budget=budget, receipt_required_above=25000,
                approval_above=None, is_sensitive=sensitive,
            )

    # ------------------------------------------------------------------------------------
    def at(self, day, hour, minute=0):
        return timezone.make_aware(datetime.combine(day, time(hour, minute)))

    def history(self, days):
        c = self.company
        rng = self.rng
        today = timezone.localdate()
        start = today - timedelta(days=days)
        self.stdout.write(f"📦 Stock initial et {days} jours d'activité…")

        with mock.patch("django.utils.timezone.now", return_value=self.at(start - timedelta(days=1), 8)):
            self.opening_treasury()
            for p in self.products:
                qty = Decimal(p.min_stock * rng.randint(4, 7))
                move_stock(company=c, product=p, warehouse=self.wh, quantity=qty, movement_type="initial", user=self.admin,
                           unit_cost=p.cost_avg, document_type="manual", reason="Stock initial")
                move_stock(company=c, product=p, warehouse=self.wh2, quantity=qty * 2, movement_type="initial", user=self.admin,
                           unit_cost=p.cost_avg, document_type="manual", reason="Stock initial")

        favorites = [p for p in self.products if p.is_favorite]
        for offset in range(days + 1):
            day = start + timedelta(days=offset)
            is_today = day == today
            cashier = self.cashier if offset % 7 != 3 else self.cashier2
            register = self.reg1
            self.stdout.write(f"   · {day:%d/%m}", ending="\r")

            with mock.patch("django.utils.timezone.now", return_value=self.at(day, 8, 2)):
                session = fin.open_session(user=cashier, register=register, opening_float=Decimal("25000"))

            # Réapprovisionnement hebdomadaire
            if offset % 7 == 1 and not is_today:
                with mock.patch("django.utils.timezone.now", return_value=self.at(day, 9, 30)):
                    self.restock(day)

            n_sales = rng.randint(6, 12) + (4 if day.weekday() in (4, 5) else 0)
            if is_today:
                n_sales = min(n_sales, max(3, timezone.localtime().hour - 7))
            last_hour = min(19, max(9, timezone.localtime().hour - 1)) if is_today else 19
            for k in range(n_sales):
                hour = 8 + int((k + 1) * (last_hour - 8) / (n_sales + 1))
                with mock.patch("django.utils.timezone.now", return_value=self.at(day, hour, rng.randint(0, 59))):
                    self.random_sale(cashier, favorites)

            # Ventes à crédit du commercial (grossistes)
            if offset % 3 == 0 and not (is_today and timezone.localtime().hour < 12):
                with mock.patch("django.utils.timezone.now", return_value=self.at(day, 11, 15)):
                    self.credit_sale(day)

            # Dépenses courantes
            if not is_today or timezone.localtime().hour >= 14:
                with mock.patch("django.utils.timezone.now", return_value=self.at(day, 13, 10)):
                    self.daily_expenses(day, offset, cashier)

            # Règlements clients
            if offset % 4 == 2 and not is_today:
                with mock.patch("django.utils.timezone.now", return_value=self.at(day, 16, 0)):
                    self.collect_payment()

            # Retour client occasionnel
            if offset % 11 == 5 and not is_today:
                with mock.patch("django.utils.timezone.now", return_value=self.at(day, 17, 0)):
                    self.random_return(cashier)

            if not is_today:
                with mock.patch("django.utils.timezone.now", return_value=self.at(day, 20, 0)):
                    expected = fin.session_expected(session)
                    counted = dict(expected)
                    if offset % 9 == 4:
                        counted["cash"] = expected.get("cash", Decimal(0)) - Decimal(rng.choice([500, 1000, 2500]))
                    fin.close_session(user=cashier, session=session, counted=counted, reason="Erreur de rendu monnaie" if offset % 9 == 4 else "")
                with mock.patch("django.utils.timezone.now", return_value=self.at(day, 20, 30)):
                    session.refresh_from_db()
                    if offset < days - 1:
                        fin.validate_session(user=self.manager, session=session)
                    deposit = Decimal(session.counted.get("cash", "0")) - session.opening_float
                    if deposit > 0:
                        fin.transfer_funds(user=self.manager, from_account=register.cash_account, to_account=self.bank, amount=deposit,
                                           reference=f"VERS-{day:%y%m%d}", note=f"Versement recette {register.name} du {day:%d/%m}")

        self.stdout.write("")
        with mock.patch("django.utils.timezone.now", return_value=self.at(today, max(8, min(timezone.localtime().hour, 10)), 0)):
            self.pending_items()

    def opening_treasury(self):
        """Apport du propriétaire en banque puis fonds de caisse initiaux (sortis de la banque)."""
        from apps.core.services import next_number
        from apps.finance.models import Income

        c = self.company
        with transaction.atomic():
            inc = Income.objects.create(company=c, number=next_number(c, "income"), category="Apport du propriétaire", amount=Decimal("8000000"),
                                        method=self.methods["transfer"], account=self.bank, reference="APPORT-001",
                                        description="Apport initial du propriétaire", income_date=timezone.localdate(), created_by=self.admin)
            fin.cash_movement(c, account=self.bank, session=None, method=self.methods["transfer"], direction="in", amount=inc.amount,
                              category="income", label=inc.description, source=inc, user=self.admin)
        for reg in (self.reg1, self.reg2):
            fin.transfer_funds(user=self.admin, from_account=self.bank, to_account=reg.cash_account, amount=Decimal("25000"),
                               reference="FOND-INIT", note=f"Fond de caisse initial {reg.name}")

    def restock(self, day):
        by_sup = {}
        from apps.inventory.models import StockLevel

        for p in self.products:
            lvl = StockLevel.objects.filter(product=p, warehouse=self.wh).first()
            if lvl and lvl.on_hand < p.min_stock * 3:
                by_sup.setdefault(p.main_supplier_id, []).append(p)
        for sup_id, prods in by_sup.items():
            sup = next(s for s in self.suppliers if s.pk == sup_id)
            lines = []
            for p in prods:
                drift = Decimal(self.rng.choice([0, 0, 0, 2, 3, -2])) / 100
                lines.append({"product_id": p.pk, "quantity": p.min_stock * 4, "unit_cost": (p.cost_last * (1 + drift)).quantize(Decimal("1")), "tax_rate": 0})
            pay_now = self.rng.random() < 0.6
            inv = direct_purchase(user=self.stockman if not pay_now else self.admin, supplier=sup, warehouse=self.wh, lines=lines,
                                  supplier_ref=f"F{day:%y%m%d}-{self.rng.randint(100, 999)}")
            if pay_now:
                fin.record_supplier_payment(user=self.admin, supplier=sup, method=self.methods["transfer"], amount=inv.total,
                                            reference=f"VIR{self.rng.randint(10000, 99999)}", invoice=inv)

    def _pick(self, pool, n):
        from apps.inventory.models import StockLevel

        chosen = []
        for p in self.rng.sample(pool, min(n, len(pool))):
            lvl = StockLevel.objects.filter(product=p, warehouse=self.wh).first()
            if lvl and lvl.on_hand >= 3:
                chosen.append((p, min(int(lvl.on_hand) - 1, self.rng.choice([1, 1, 1, 2, 2, 3]))))
        return chosen

    def random_sale(self, cashier, favorites):
        rng = self.rng
        pool = favorites if rng.random() < 0.7 else self.products
        items = self._pick(pool, rng.randint(1, 4))
        if not items:
            return
        data = {"type": "pos", "warehouse_id": self.wh.pk, "items": [{"product_id": p.pk, "quantity": q} for p, q in items]}
        if rng.random() < 0.12:
            data["global_discount_value"] = 5
        from apps.sales.calc import compute_document
        from apps.sales.services import build_lines

        lines = build_lines(self.company, cashier, data["items"], None)
        _c, totals = compute_document(lines, "percent", data.get("global_discount_value", 0), True, 0)
        total = totals["total"]
        r = rng.random()
        if r < 0.55:
            data["payments"] = [{"method_id": self.methods["cash"].pk, "amount": int((total + 999) // 1000 * 1000) if rng.random() < 0.5 else total}]
        elif r < 0.75:
            data["payments"] = [{"method_id": self.methods["orange_money"].pk, "amount": total, "reference": f"OM{rng.randint(10**7, 10**8)}"}]
        elif r < 0.9:
            data["payments"] = [{"method_id": self.methods["wave"].pk, "amount": total, "reference": f"WV{rng.randint(10**7, 10**8)}"}]
        else:
            half = (total / 2).quantize(Decimal("1"))
            data["payments"] = [{"method_id": self.methods["cash"].pk, "amount": half},
                                {"method_id": self.methods["card"].pk, "amount": total - half}]
        create_sale(user=cashier, data=data)

    def credit_sale(self, day):
        rng = self.rng
        cust = rng.choice([c for c in self.customers if c.credit_limit >= 200000])
        items = self._pick(self.products, rng.randint(2, 5))
        if not items:
            return
        data = {"type": "invoice", "warehouse_id": self.wh.pk, "customer_id": cust.pk,
                "items": [{"product_id": p.pk, "quantity": q * rng.choice([2, 4, 6])} for p, q in items], "payments": []}
        try:
            with transaction.atomic():
                create_sale(user=self.manager, data=data)
        except Exception:  # noqa: BLE001 — stock/crédit insuffisant : on ignore pour la démo
            pass

    def collect_payment(self):
        from apps.sales.models import Sale

        sale = Sale.objects.filter(company=self.company, status__in=["issued", "partial"]).order_by("issue_date").first()
        if not sale:
            return
        amount = sale.balance if self.rng.random() < 0.6 else (sale.balance / 2).quantize(Decimal("1"))
        fin.record_customer_payment(user=self.accountant, customer=sale.customer, method=self.methods["transfer"], amount=amount,
                                    reference=f"VIR{self.rng.randint(10000, 99999)}", sale=sale)

    def random_return(self, cashier):
        from apps.sales.models import Sale

        sale = Sale.objects.filter(company=self.company, type="pos", status="paid", register_session__status="open").order_by("?").first()
        if not sale:
            return
        item = sale.items.first()
        try:
            with transaction.atomic():
                create_credit_note(user=cashier, sale=sale,
                                   items=[{"sale_item_id": item.pk, "quantity": 1, "condition": "resellable"}],
                                   reason="Produit non conforme au besoin du client", settlement="refund")
        except Exception:  # noqa: BLE001
            pass

    def daily_expenses(self, day, offset, cashier):
        rng = self.rng
        cat = self.exp_cats
        specs = []
        if offset % 2 == 0:
            specs.append((cat["Transport et livraison"], rng.choice([2000, 3500, 5000]), "Taxi-moto livraison clients", "Livreur", cashier, "cash"))
        if offset % 5 == 0:
            specs.append((cat["Fournitures"], rng.choice([3000, 6000]), "Rouleaux de tickets et sachets", "Papeterie du Marché", cashier, "cash"))
        if day.day == 5:
            specs.append((cat["Loyer et charges locatives"], 350000, "Loyer mensuel du magasin", "SCI Bamako Invest", self.admin, "transfer"))
            specs.append((cat["Personnel"], 780000, "Salaires du personnel", "Personnel", self.admin, "transfer"))
        if day.day == 10:
            specs.append((cat["Énergie et eau"], rng.choice([95000, 110000, 125000]), "Facture EDM électricité", "EDM-SA", self.accountant, "orange_money"))
            specs.append((cat["Télécommunications"], 35000, "Abonnement internet fibre", "Orange Mali", self.accountant, "orange_money"))
        if offset % 9 == 0:
            specs.append((cat["Entretien et maintenance"], rng.choice([7500, 15000]), "Réparation climatiseur", "Froid Service", self.manager, "wave"))
        for category, amount, desc, payee, user, method in specs:
            m = self.methods[method]
            if m.type == "cash" and not fin.open_session_of(user):
                continue
            e = Expense.objects.create(company=self.company, expense_date=day, category=category, amount=amount, payee_name=payee,
                                       description=desc, warehouse=self.wh, created_by=user)
            if amount >= 25000:
                attach_receipt(e, user)
            try:
                with transaction.atomic():
                    fin.submit_expense(user=user, expense=e, pay={"method": m, "reference": f"REF{rng.randint(10000, 99999)}" if m.requires_reference else ""})
            except Exception as exc:  # noqa: BLE001
                self.stdout.write(f"\n   ⚠ Dépense « {desc} » non payée : {exc}")
                e.refresh_from_db()
                if e.status == "draft":
                    e.delete()

    def pending_items(self):
        """Éléments en attente visibles dès la connexion (approbations, alertes)."""
        from apps.inventory.services_ops import create_adjustment

        e = Expense.objects.create(company=self.company, expense_date=timezone.localdate(), category=self.exp_cats["Équipements et investissements"],
                                   amount=185000, payee_name="Bureau Vallée Bamako", description="Imprimante thermique 80 mm pour la caisse 2",
                                   warehouse=self.wh, created_by=self.cashier)
        attach_receipt(e, self.cashier)
        fin.submit_expense(user=self.cashier, expense=e)
        p = next(x for x in self.products if "Peinture" in x.name)
        create_adjustment(user=self.stockman, warehouse=self.wh2, reason="Pots endommagés lors du déchargement",
                          lines=[{"product_id": p.pk, "qty_diff": -6}])
        Expense.objects.create(company=self.company, expense_date=timezone.localdate(), category=self.exp_cats["Marketing et communication"],
                               amount=45000, payee_name="Radio Kledu", description="Spot publicitaire week-end", warehouse=self.wh, created_by=self.manager)
