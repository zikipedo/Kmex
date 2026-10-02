from django.conf import settings
from django.db import models

from apps.catalog.models import MONEY, Product
from apps.core.models import BaseModel, Warehouse


class Supplier(BaseModel):
    STATUSES = [("active", "Actif"), ("archived", "Archivé")]
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=200)
    contact_name = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=60, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=300, blank=True)
    country = models.CharField(max_length=80, blank=True)
    tax_id = models.CharField(max_length=60, blank=True)
    payment_terms_days = models.PositiveIntegerField(default=30)
    lead_time_days = models.PositiveIntegerField(default=7)
    status = models.CharField(max_length=10, choices=STATUSES, default="active")
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["company", "code"], name="uq_supplier_code")]

    def __str__(self):
        return self.name


class PurchaseOrder(BaseModel):
    STATUSES = [
        ("draft", "Brouillon"), ("sent", "Envoyée"), ("partial", "Partiellement reçue"),
        ("received", "Reçue"), ("closed", "Clôturée"), ("cancelled", "Annulée"),
    ]
    number = models.CharField(max_length=40, blank=True)
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="orders")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=10, choices=STATUSES, default="draft")
    order_date = models.DateField()
    expected_date = models.DateField(null=True, blank=True)
    subtotal = models.DecimalField(**MONEY, default=0)
    tax_total = models.DecimalField(**MONEY, default=0)
    total = models.DecimalField(**MONEY, default=0)
    notes = models.TextField(blank=True)
    close_reason = models.CharField(max_length=200, blank=True)


class PurchaseOrderItem(models.Model):
    order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="+")
    qty_ordered = models.DecimalField(**MONEY)
    qty_received = models.DecimalField(**MONEY, default=0)
    unit_price = models.DecimalField(**MONEY)
    tax_rate = models.DecimalField(max_digits=6, decimal_places=3, default=0)
    line_total = models.DecimalField(**MONEY, default=0)

    @property
    def qty_remaining(self):
        return max(self.qty_ordered - self.qty_received, 0)


class PurchaseReceipt(BaseModel):
    number = models.CharField(max_length=40)
    order = models.ForeignKey(PurchaseOrder, null=True, blank=True, on_delete=models.PROTECT, related_name="receipts")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="receipts")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="+")
    received_at = models.DateTimeField(auto_now_add=True)
    note = models.TextField(blank=True)
    total = models.DecimalField(**MONEY, default=0)
    is_invoiced = models.BooleanField(default=False)


class PurchaseReceiptItem(models.Model):
    CONDITIONS = [("good", "Bon état"), ("damaged", "Abîmé")]
    receipt = models.ForeignKey(PurchaseReceipt, on_delete=models.CASCADE, related_name="items")
    order_item = models.ForeignKey(PurchaseOrderItem, null=True, blank=True, on_delete=models.PROTECT, related_name="receipt_items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="+")
    quantity = models.DecimalField(**MONEY)
    unit_cost = models.DecimalField(**MONEY)
    condition = models.CharField(max_length=10, choices=CONDITIONS, default="good")


class PurchaseInvoice(BaseModel):
    STATUSES = [("unpaid", "Impayée"), ("partial", "Partiellement payée"), ("paid", "Payée"), ("cancelled", "Annulée")]
    number = models.CharField(max_length=40)
    supplier_ref = models.CharField(max_length=60, blank=True)
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="invoices")
    order = models.ForeignKey(PurchaseOrder, null=True, blank=True, on_delete=models.PROTECT, related_name="invoices")
    receipt = models.ForeignKey(PurchaseReceipt, null=True, blank=True, on_delete=models.PROTECT, related_name="invoices")
    issue_date = models.DateField()
    due_date = models.DateField()
    subtotal = models.DecimalField(**MONEY, default=0)
    tax_total = models.DecimalField(**MONEY, default=0)
    total = models.DecimalField(**MONEY)
    paid_amount = models.DecimalField(**MONEY, default=0)
    status = models.CharField(max_length=10, choices=STATUSES, default="unpaid")
    discrepancy = models.TextField(blank=True)
    notes = models.TextField(blank=True)

    @property
    def balance(self):
        return self.total - self.paid_amount
