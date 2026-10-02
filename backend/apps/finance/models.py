from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.catalog.models import MONEY
from apps.core.models import BaseModel, Warehouse


class TreasuryAccount(BaseModel):
    TYPES = [("cash", "Espèces"), ("bank", "Banque"), ("mobile_money", "Mobile Money"), ("cheque", "Chèques à encaisser")]
    type = models.CharField(max_length=15, choices=TYPES)
    name = models.CharField(max_length=120)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["type", "name"]

    def __str__(self):
        return self.name


class PaymentMethod(BaseModel):
    TYPES = [("cash", "Espèces"), ("card", "Carte"), ("transfer", "Virement"), ("cheque", "Chèque"), ("mobile_money", "Mobile Money"), ("other", "Autre")]
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=80)
    type = models.CharField(max_length=15, choices=TYPES)
    account = models.ForeignKey(TreasuryAccount, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    requires_reference = models.BooleanField(default=False)
    color = models.CharField(max_length=20, default="#a78bfa")
    is_active = models.BooleanField(default=True)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "name"]
        constraints = [models.UniqueConstraint(fields=["company", "code"], name="uq_payment_method")]

    def __str__(self):
        return self.name


class CashRegister(BaseModel):
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="registers")
    name = models.CharField(max_length=80)
    cash_account = models.ForeignKey(TreasuryAccount, on_delete=models.PROTECT, related_name="+")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class RegisterSession(BaseModel):
    STATUSES = [("open", "Ouverte"), ("closed", "Clôturée"), ("validated", "Validée")]
    register = models.ForeignKey(CashRegister, on_delete=models.PROTECT, related_name="sessions")
    opened_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    opened_at = models.DateTimeField(auto_now_add=True)
    opening_float = models.DecimalField(**MONEY, default=0)
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    closed_at = models.DateTimeField(null=True, blank=True)
    expected = models.JSONField(default=dict, blank=True)
    counted = models.JSONField(default=dict, blank=True)
    denominations = models.JSONField(default=dict, blank=True)
    difference = models.DecimalField(**MONEY, default=0)
    difference_reason = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=STATUSES, default="open")
    validated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    validated_at = models.DateTimeField(null=True, blank=True)
    z_number = models.CharField(max_length=40, blank=True)

    class Meta:
        ordering = ["-opened_at"]
        constraints = [
            models.UniqueConstraint(fields=["register"], condition=Q(status="open"), name="uq_open_session_register"),
            models.UniqueConstraint(fields=["opened_by"], condition=Q(status="open"), name="uq_open_session_user"),
        ]


class Payment(BaseModel):
    DIRECTIONS = [("in", "Encaissement"), ("out", "Décaissement")]
    STATUSES = [("valid", "Valide"), ("reversed", "Extourné")]
    number = models.CharField(max_length=40)
    direction = models.CharField(max_length=3, choices=DIRECTIONS)
    customer = models.ForeignKey("sales.Customer", null=True, blank=True, on_delete=models.PROTECT, related_name="payments")
    supplier = models.ForeignKey("purchasing.Supplier", null=True, blank=True, on_delete=models.PROTECT, related_name="payments")
    method = models.ForeignKey(PaymentMethod, on_delete=models.PROTECT, related_name="+")
    amount = models.DecimalField(**MONEY)
    unallocated = models.DecimalField(**MONEY, default=0)
    reference = models.CharField(max_length=80, blank=True)
    paid_at = models.DateTimeField()
    session = models.ForeignKey(RegisterSession, null=True, blank=True, on_delete=models.PROTECT, related_name="payments")
    account = models.ForeignKey(TreasuryAccount, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=10, choices=STATUSES, default="valid")
    idempotency_key = models.CharField(max_length=80, null=True, blank=True)
    note = models.CharField(max_length=250, blank=True)
    reversal_reason = models.CharField(max_length=250, blank=True)

    class Meta:
        ordering = ["-paid_at"]
        constraints = [models.UniqueConstraint(fields=["company", "idempotency_key"], name="uq_payment_idem")]


class PaymentAllocation(models.Model):
    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name="allocations")
    sale = models.ForeignKey("sales.Sale", null=True, blank=True, on_delete=models.PROTECT, related_name="allocations")
    purchase_invoice = models.ForeignKey("purchasing.PurchaseInvoice", null=True, blank=True, on_delete=models.PROTECT, related_name="allocations")
    amount = models.DecimalField(**MONEY)


class CashMovement(models.Model):
    """Mouvement de trésorerie immuable (trigger anti UPDATE/DELETE)."""

    CATEGORIES = [
        ("sale", "Encaissement vente"), ("customer_payment", "Règlement client"), ("refund", "Remboursement client"),
        ("supplier_payment", "Paiement fournisseur"), ("expense", "Dépense"), ("expense_reversal", "Extourne dépense"),
        ("income", "Recette diverse"), ("float", "Fond de caisse"), ("cash_difference", "Écart de caisse"),
        ("payment_reversal", "Extourne paiement"), ("transfer", "Transfert de fonds"),
    ]
    id = models.BigAutoField(primary_key=True)
    company = models.ForeignKey("core.Company", on_delete=models.PROTECT, related_name="+")
    account = models.ForeignKey(TreasuryAccount, on_delete=models.PROTECT, related_name="movements")
    session = models.ForeignKey(RegisterSession, null=True, blank=True, on_delete=models.PROTECT, related_name="movements")
    method = models.ForeignKey(PaymentMethod, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    direction = models.CharField(max_length=3, choices=[("in", "Entrée"), ("out", "Sortie")])
    amount = models.DecimalField(**MONEY)
    category = models.CharField(max_length=20, choices=CATEGORIES)
    label = models.CharField(max_length=250, blank=True)
    source_type = models.CharField(max_length=30, blank=True)
    source_id = models.CharField(max_length=64, blank=True)
    source_number = models.CharField(max_length=40, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
        indexes = [models.Index(fields=["account", "occurred_at"]), models.Index(fields=["session"])]


class ExpenseCategory(BaseModel):
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children")
    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=10, choices=[("fixed", "Fixe"), ("variable", "Variable")], default="variable")
    icon = models.CharField(max_length=40, default="receipt")
    color = models.CharField(max_length=20, default="#f472b6")
    monthly_budget = models.DecimalField(**MONEY, null=True, blank=True)
    receipt_required_above = models.DecimalField(**MONEY, null=True, blank=True)
    approval_above = models.DecimalField(**MONEY, null=True, blank=True)
    is_sensitive = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["company", "parent", "name"], name="uq_expense_category")]

    def __str__(self):
        return self.name


class Expense(BaseModel):
    TYPES = [("simple", "Dépense simple"), ("advance", "Avance"), ("reimbursement", "Remboursement de frais")]
    STATUSES = [
        ("draft", "Brouillon"), ("pending", "En attente d'approbation"), ("approved", "Approuvée"),
        ("paid", "Payée"), ("rejected", "Rejetée"), ("cancelled", "Annulée"),
    ]
    number = models.CharField(max_length=40, blank=True)
    expense_date = models.DateField()
    category = models.ForeignKey(ExpenseCategory, on_delete=models.PROTECT, related_name="expenses")
    type = models.CharField(max_length=15, choices=TYPES, default="simple")
    amount = models.DecimalField(**MONEY)
    tax_recoverable = models.DecimalField(**MONEY, default=0)
    payee_type = models.CharField(max_length=10, choices=[("supplier", "Fournisseur"), ("employee", "Employé"), ("free", "Autre")], default="free")
    payee_name = models.CharField(max_length=200, blank=True)
    supplier = models.ForeignKey("purchasing.Supplier", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    description = models.CharField(max_length=300)
    warehouse = models.ForeignKey(Warehouse, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    method = models.ForeignKey(PaymentMethod, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    account = models.ForeignKey(TreasuryAccount, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    session = models.ForeignKey(RegisterSession, null=True, blank=True, on_delete=models.PROTECT, related_name="expenses")
    payment_reference = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=10, choices=STATUSES, default="draft")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)
    paid_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    paid_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.CharField(max_length=250, blank=True)
    reject_reason = models.CharField(max_length=250, blank=True)
    tags = models.CharField(max_length=200, blank=True)
    idempotency_key = models.CharField(max_length=80, null=True, blank=True)

    class Meta:
        ordering = ["-expense_date", "-created_at"]
        constraints = [models.UniqueConstraint(fields=["company", "idempotency_key"], name="uq_expense_idem")]
        indexes = [models.Index(fields=["category", "expense_date"]), models.Index(fields=["status"])]


class ExpenseAttachment(BaseModel):
    expense = models.ForeignKey(Expense, on_delete=models.PROTECT, related_name="attachments")
    file = models.FileField(upload_to="expenses/", max_length=300)
    thumb = models.CharField(max_length=300, blank=True)
    mime = models.CharField(max_length=60)
    sha256 = models.CharField(max_length=64, db_index=True)
    size_bytes = models.PositiveIntegerField(default=0)


class ExpenseApproval(models.Model):
    expense = models.ForeignKey(Expense, on_delete=models.CASCADE, related_name="approvals")
    approver = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    decision = models.CharField(max_length=10, choices=[("approved", "Approuvée"), ("rejected", "Rejetée")])
    comment = models.CharField(max_length=250, blank=True)
    decided_at = models.DateTimeField(auto_now_add=True)


class Income(BaseModel):
    number = models.CharField(max_length=40)
    category = models.CharField(max_length=80)
    amount = models.DecimalField(**MONEY)
    method = models.ForeignKey(PaymentMethod, on_delete=models.PROTECT, related_name="+")
    account = models.ForeignKey(TreasuryAccount, on_delete=models.PROTECT, related_name="+")
    session = models.ForeignKey(RegisterSession, null=True, blank=True, on_delete=models.PROTECT, related_name="incomes")
    reference = models.CharField(max_length=80, blank=True)
    description = models.CharField(max_length=300)
    income_date = models.DateField()
