from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.catalog.models import MONEY, Product
from apps.core.models import BaseModel, Warehouse


class Customer(BaseModel):
    TYPES = [("individual", "Particulier"), ("company", "Entreprise"), ("wholesaler", "Revendeur / grossiste"), ("administration", "Administration")]
    STATUSES = [("active", "Actif"), ("blocked", "Bloqué"), ("archived", "Archivé")]
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=200)
    type = models.CharField(max_length=20, choices=TYPES, default="individual")
    phone = models.CharField(max_length=60, blank=True)
    whatsapp = models.CharField(max_length=60, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=300, blank=True)
    city = models.CharField(max_length=100, blank=True)
    tax_id = models.CharField(max_length=60, blank=True)
    credit_limit = models.DecimalField(**MONEY, default=0)
    payment_terms_days = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUSES, default="active")
    is_walkin = models.BooleanField(default=False)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["company", "code"], name="uq_customer_code"),
            models.UniqueConstraint(fields=["company"], condition=Q(is_walkin=True), name="uq_walkin_customer"),
        ]

    def __str__(self):
        return self.name


class DocumentTotals(models.Model):
    subtotal = models.DecimalField(**MONEY, default=0)  # HT après remises
    discount_total = models.DecimalField(**MONEY, default=0)
    tax_total = models.DecimalField(**MONEY, default=0)
    total = models.DecimalField(**MONEY, default=0)  # TTC
    global_discount_type = models.CharField(max_length=10, default="percent")
    global_discount_value = models.DecimalField(**MONEY, default=0)

    class Meta:
        abstract = True


class Quote(BaseModel, DocumentTotals):
    STATUSES = [("draft", "Brouillon"), ("sent", "Envoyé"), ("accepted", "Accepté"), ("refused", "Refusé"), ("expired", "Expiré"), ("converted", "Converti")]
    number = models.CharField(max_length=40)
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="quotes")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="+")
    seller = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    issue_date = models.DateField()
    valid_until = models.DateField()
    status = models.CharField(max_length=10, choices=STATUSES, default="draft")
    notes = models.TextField(blank=True)
    converted_sale = models.ForeignKey("Sale", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")


class LineFields(models.Model):
    description = models.CharField(max_length=250)
    quantity = models.DecimalField(**MONEY)
    unit_price = models.DecimalField(**MONEY)
    discount_type = models.CharField(max_length=10, default="percent")
    discount_value = models.DecimalField(**MONEY, default=0)
    discount_amount = models.DecimalField(**MONEY, default=0)
    tax_rate = models.DecimalField(max_digits=6, decimal_places=3, default=0)
    line_subtotal = models.DecimalField(**MONEY, default=0)  # HT net (après remises ligne + globale)
    tax_amount = models.DecimalField(**MONEY, default=0)
    line_total = models.DecimalField(**MONEY, default=0)  # TTC

    class Meta:
        abstract = True


class QuoteItem(LineFields):
    quote = models.ForeignKey(Quote, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="+")


class Sale(BaseModel, DocumentTotals):
    """Facture / ticket : document unique (§20.7)."""

    TYPES = [("invoice", "Facture"), ("pos", "Ticket de caisse")]
    STATUSES = [("issued", "Impayée"), ("partial", "Partiellement payée"), ("paid", "Payée"), ("cancelled", "Annulée")]
    number = models.CharField(max_length=40)
    type = models.CharField(max_length=10, choices=TYPES, default="pos")
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="sales")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="+")
    register_session = models.ForeignKey("finance.RegisterSession", null=True, blank=True, on_delete=models.PROTECT, related_name="sales")
    seller = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    status = models.CharField(max_length=10, choices=STATUSES, default="issued")
    issue_date = models.DateField()
    due_date = models.DateField(null=True, blank=True)
    paid_amount = models.DecimalField(**MONEY, default=0)
    credited_amount = models.DecimalField(**MONEY, default=0)
    cost_total = models.DecimalField(**MONEY, default=0)
    idempotency_key = models.CharField(max_length=80, null=True, blank=True)
    discount_authorized_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    credit_override_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    quote = models.ForeignKey(Quote, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    customer_reference = models.CharField(max_length=80, blank=True)
    notes = models.TextField(blank=True)
    print_count = models.PositiveIntegerField(default=0)
    offline_ref = models.CharField(max_length=60, blank=True)  # numéro provisoire OFF-… (§24.2)
    offline_created_at = models.DateTimeField(null=True, blank=True)  # horodatage local de l'appareil

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["company", "number"], name="uq_sale_number"),
            models.UniqueConstraint(fields=["company", "idempotency_key"], name="uq_sale_idem"),
        ]
        indexes = [models.Index(fields=["company", "issue_date"]), models.Index(fields=["customer", "status"])]

    @property
    def balance(self):
        return self.total - self.paid_amount - self.credited_amount


class SaleItem(LineFields):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="sale_items")
    unit_cost = models.DecimalField(**MONEY, default=0)  # COGS figé
    returned_qty = models.DecimalField(**MONEY, default=0)


class CreditNote(BaseModel):
    SETTLEMENTS = [("refund", "Remboursement"), ("credit", "Crédit sur compte"), ("deduct", "Imputation sur la facture")]
    number = models.CharField(max_length=40)
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="credit_notes")
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="credit_notes")
    reason = models.CharField(max_length=250)
    settlement = models.CharField(max_length=10, choices=SETTLEMENTS, default="deduct")
    is_full_cancellation = models.BooleanField(default=False)
    subtotal = models.DecimalField(**MONEY, default=0)
    tax_total = models.DecimalField(**MONEY, default=0)
    total = models.DecimalField(**MONEY, default=0)
    refunded_amount = models.DecimalField(**MONEY, default=0)


class CreditNoteItem(models.Model):
    CONDITIONS = [("resellable", "Réintégrable"), ("defective", "Défectueux"), ("destroyed", "Détruit")]
    credit_note = models.ForeignKey(CreditNote, on_delete=models.CASCADE, related_name="items")
    sale_item = models.ForeignKey(SaleItem, on_delete=models.PROTECT, related_name="credit_items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="+")
    quantity = models.DecimalField(**MONEY)
    unit_price = models.DecimalField(**MONEY)
    line_subtotal = models.DecimalField(**MONEY)
    tax_amount = models.DecimalField(**MONEY)
    line_total = models.DecimalField(**MONEY)
    condition = models.CharField(max_length=12, choices=CONDITIONS, default="resellable")
