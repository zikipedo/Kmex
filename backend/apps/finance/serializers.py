from django.conf import settings
from rest_framework import serializers

from apps.catalog.serializers import CompanyScopedPK
from apps.core.models import Warehouse

from .models import (
    CashMovement, CashRegister, Expense, ExpenseAttachment, ExpenseApproval, ExpenseCategory, Income, Payment,
    PaymentMethod, RegisterSession, TreasuryAccount,
)


class TreasuryAccountSerializer(serializers.ModelSerializer):
    balance = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True, default=None)
    type_label = serializers.CharField(source="get_type_display", read_only=True)

    class Meta:
        model = TreasuryAccount
        fields = ["id", "type", "type_label", "name", "is_active", "balance"]


class PaymentMethodSerializer(serializers.ModelSerializer):
    account = CompanyScopedPK(queryset=TreasuryAccount.objects.all(), allow_null=True, required=False)

    class Meta:
        model = PaymentMethod
        fields = ["id", "code", "name", "type", "account", "requires_reference", "color", "is_active", "position"]


class CashRegisterSerializer(serializers.ModelSerializer):
    warehouse = CompanyScopedPK(queryset=Warehouse.objects.all())
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    open_session = serializers.SerializerMethodField()

    class Meta:
        model = CashRegister
        fields = ["id", "name", "warehouse", "warehouse_name", "is_active", "open_session"]

    def get_open_session(self, obj):
        s = obj.sessions.filter(status="open").select_related("opened_by").first()
        return {"id": str(s.id), "opened_by": s.opened_by.full_name, "opened_at": s.opened_at} if s else None


class RegisterSessionSerializer(serializers.ModelSerializer):
    register_name = serializers.CharField(source="register.name", read_only=True)
    warehouse_name = serializers.CharField(source="register.warehouse.name", read_only=True)
    opened_by_name = serializers.CharField(source="opened_by.full_name", read_only=True)
    closed_by_name = serializers.CharField(source="closed_by.full_name", read_only=True, default="")
    validated_by_name = serializers.CharField(source="validated_by.full_name", read_only=True, default="")
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    sales_count = serializers.IntegerField(read_only=True, default=None)
    sales_total = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True, default=None)

    class Meta:
        model = RegisterSession
        fields = [
            "id", "register", "register_name", "warehouse_name", "opened_by", "opened_by_name", "opened_at",
            "opening_float", "closed_by_name", "closed_at", "expected", "counted", "denominations", "difference",
            "difference_reason", "status", "status_label", "validated_by_name", "validated_at", "z_number",
            "sales_count", "sales_total",
        ]


class PaymentSerializer(serializers.ModelSerializer):
    method_name = serializers.CharField(source="method.name", read_only=True)
    method_type = serializers.CharField(source="method.type", read_only=True)
    party_name = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")
    allocations = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            "id", "number", "direction", "customer", "supplier", "party_name", "method", "method_name", "method_type",
            "amount", "unallocated", "reference", "paid_at", "session", "status", "note", "reversal_reason",
            "created_by_name", "allocations",
        ]

    def get_party_name(self, obj):
        return obj.customer.name if obj.customer_id else obj.supplier.name if obj.supplier_id else ""

    def get_allocations(self, obj):
        return [
            {"amount": str(a.amount), "document": (a.sale.number if a.sale_id else a.purchase_invoice.number if a.purchase_invoice_id else ""),
             "sale_id": str(a.sale_id) if a.sale_id else None}
            for a in obj.allocations.select_related("sale", "purchase_invoice")
        ]


class CashMovementSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True)
    method_name = serializers.CharField(source="method.name", read_only=True, default="")
    category_label = serializers.CharField(source="get_category_display", read_only=True)
    user_name = serializers.CharField(source="user.full_name", read_only=True, default="")

    class Meta:
        model = CashMovement
        fields = ["id", "account", "account_name", "session", "method_name", "direction", "amount", "category",
                  "category_label", "label", "source_type", "source_id", "source_number", "user_name", "occurred_at"]


class ExpenseCategorySerializer(serializers.ModelSerializer):
    parent = CompanyScopedPK(queryset=ExpenseCategory.objects.all(), allow_null=True, required=False)
    spent_month = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True, default=None)

    class Meta:
        model = ExpenseCategory
        fields = ["id", "name", "parent", "kind", "icon", "color", "monthly_budget", "receipt_required_above",
                  "approval_above", "is_sensitive", "is_active", "spent_month"]


class ExpenseAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    thumb_url = serializers.SerializerMethodField()
    duplicate_of = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseAttachment
        fields = ["id", "url", "thumb_url", "mime", "size_bytes", "created_at", "duplicate_of"]

    def get_url(self, obj):
        return f"{settings.MEDIA_URL}{obj.file.name}"

    def get_thumb_url(self, obj):
        return f"{settings.MEDIA_URL}{obj.thumb}" if obj.thumb else None

    def get_duplicate_of(self, obj):
        other = ExpenseAttachment.objects.filter(company=obj.company, sha256=obj.sha256).exclude(expense=obj.expense).select_related("expense").first()
        return other.expense.number or str(other.expense_id) if other else None


class ExpenseSerializer(serializers.ModelSerializer):
    category = CompanyScopedPK(queryset=ExpenseCategory.objects.all())
    warehouse = CompanyScopedPK(queryset=Warehouse.objects.all(), allow_null=True, required=False)
    category_name = serializers.CharField(source="category.name", read_only=True)
    category_color = serializers.CharField(source="category.color", read_only=True)
    category_icon = serializers.CharField(source="category.icon", read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True, default="")
    method_name = serializers.CharField(source="method.name", read_only=True, default="")
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")
    approved_by_name = serializers.CharField(source="approved_by.full_name", read_only=True, default="")
    paid_by_name = serializers.CharField(source="paid_by.full_name", read_only=True, default="")
    cancelled_by_name = serializers.CharField(source="cancelled_by.full_name", read_only=True, default="")
    attachments = ExpenseAttachmentSerializer(many=True, read_only=True)
    attachments_count = serializers.IntegerField(source="attachments.count", read_only=True)
    approvals = serializers.SerializerMethodField()
    receipt_required = serializers.SerializerMethodField()

    class Meta:
        model = Expense
        fields = [
            "id", "number", "expense_date", "category", "category_name", "category_color", "category_icon", "type",
            "amount", "tax_recoverable", "payee_type", "payee_name", "supplier", "description", "warehouse",
            "warehouse_name", "method", "method_name", "payment_reference", "status", "status_label",
            "created_by", "created_by_name", "approved_by_name", "approved_at", "paid_by_name", "paid_at",
            "cancelled_by_name", "cancelled_at", "cancel_reason", "reject_reason", "tags", "attachments",
            "attachments_count", "approvals", "receipt_required", "created_at",
        ]
        read_only_fields = ["number", "status", "method", "payment_reference", "created_by"]

    def get_approvals(self, obj):
        return [{"approver": a.approver.full_name, "decision": a.decision, "comment": a.comment, "at": a.decided_at}
                for a in ExpenseApproval.objects.filter(expense=obj).select_related("approver")]

    def get_receipt_required(self, obj):
        th = obj.category.receipt_required_above
        return th is not None and obj.amount >= th

    def validate_amount(self, v):
        if v <= 0:
            raise serializers.ValidationError("Le montant doit être supérieur à zéro.")
        return v


class IncomeSerializer(serializers.ModelSerializer):
    method_name = serializers.CharField(source="method.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")

    class Meta:
        model = Income
        fields = ["id", "number", "category", "amount", "method", "method_name", "reference", "description",
                  "income_date", "created_by_name", "created_at"]
        read_only_fields = ["number"]
