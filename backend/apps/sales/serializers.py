from rest_framework import serializers

from .models import CreditNote, CreditNoteItem, Customer, Quote, QuoteItem, Sale, SaleItem


class CustomerSerializer(serializers.ModelSerializer):
    balance = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True, default=None)
    total_sales = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True, default=None)
    sales_count = serializers.IntegerField(read_only=True, default=None)
    last_purchase = serializers.DateField(read_only=True, default=None)
    type_label = serializers.CharField(source="get_type_display", read_only=True)

    class Meta:
        model = Customer
        fields = [
            "id", "code", "name", "type", "type_label", "phone", "whatsapp", "email", "address", "city", "tax_id",
            "credit_limit", "payment_terms_days", "status", "is_walkin", "notes", "balance", "total_sales",
            "sales_count", "last_purchase", "created_at",
        ]
        read_only_fields = ["code", "is_walkin"]


class SaleItemSerializer(serializers.ModelSerializer):
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    unit = serializers.CharField(source="product.unit.code", read_only=True)

    class Meta:
        model = SaleItem
        fields = [
            "id", "product", "product_sku", "description", "quantity", "unit", "unit_price", "discount_type",
            "discount_value", "discount_amount", "tax_rate", "line_subtotal", "tax_amount", "line_total", "unit_cost",
            "returned_qty",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request and not request.user.has_code("catalog.cost.view"):
            data.pop("unit_cost", None)
        return data


class CreditNoteItemSerializer(serializers.ModelSerializer):
    description = serializers.CharField(source="sale_item.description", read_only=True)

    class Meta:
        model = CreditNoteItem
        fields = ["id", "description", "quantity", "unit_price", "line_total", "condition"]


class CreditNoteSerializer(serializers.ModelSerializer):
    items = CreditNoteItemSerializer(many=True, read_only=True)
    sale_number = serializers.CharField(source="sale.number", read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")

    class Meta:
        model = CreditNote
        fields = ["id", "number", "sale", "sale_number", "customer", "customer_name", "reason", "settlement",
                  "is_full_cancellation", "subtotal", "tax_total", "total", "refunded_amount", "created_by_name", "created_at", "items"]


class SaleListSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    seller_name = serializers.CharField(source="seller.full_name", read_only=True, default="")
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    balance = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    items_count = serializers.IntegerField(read_only=True, default=None)

    class Meta:
        model = Sale
        fields = [
            "id", "number", "type", "customer", "customer_name", "seller_name", "warehouse_name", "status",
            "status_label", "issue_date", "due_date", "total", "paid_amount", "credited_amount", "balance",
            "items_count", "created_at", "offline_ref", "offline_created_at",
        ]


class SaleDetailSerializer(SaleListSerializer):
    items = SaleItemSerializer(many=True, read_only=True)
    credit_notes = CreditNoteSerializer(many=True, read_only=True)
    payments = serializers.SerializerMethodField()
    margin = serializers.SerializerMethodField()
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)
    customer_is_walkin = serializers.BooleanField(source="customer.is_walkin", read_only=True)
    discount_authorized_by_name = serializers.CharField(source="discount_authorized_by.full_name", read_only=True, default="")

    class Meta(SaleListSerializer.Meta):
        fields = SaleListSerializer.Meta.fields + [
            "subtotal", "discount_total", "tax_total", "cost_total", "margin", "global_discount_type",
            "global_discount_value", "notes", "customer_reference", "items", "credit_notes", "payments",
            "customer_phone", "customer_is_walkin", "discount_authorized_by_name", "print_count", "register_session",
        ]

    def get_payments(self, obj):
        return [
            {"id": str(a.payment_id), "number": a.payment.number, "method": a.payment.method.name, "amount": str(a.amount),
             "reference": a.payment.reference, "paid_at": a.payment.paid_at, "status": a.payment.status,
             "direction": a.payment.direction}
            for a in obj.allocations.select_related("payment", "payment__method").order_by("payment__paid_at")
        ]

    def get_margin(self, obj):
        return str(obj.subtotal - obj.cost_total)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request and not request.user.has_code("profit.view"):
            data.pop("margin", None)
        if request and not request.user.has_code("catalog.cost.view"):
            data.pop("cost_total", None)
        return data


class QuoteItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuoteItem
        fields = ["id", "product", "description", "quantity", "unit_price", "discount_type", "discount_value",
                  "discount_amount", "tax_rate", "line_subtotal", "tax_amount", "line_total"]


class QuoteSerializer(serializers.ModelSerializer):
    items = QuoteItemSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    seller_name = serializers.CharField(source="seller.full_name", read_only=True, default="")
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    is_expired = serializers.SerializerMethodField()
    converted_sale_number = serializers.CharField(source="converted_sale.number", read_only=True, default=None)

    class Meta:
        model = Quote
        fields = ["id", "number", "customer", "customer_name", "warehouse", "seller_name", "issue_date", "valid_until",
                  "status", "status_label", "is_expired", "subtotal", "discount_total", "tax_total", "total",
                  "global_discount_type", "global_discount_value", "notes", "items", "converted_sale",
                  "converted_sale_number", "created_at"]

    def get_is_expired(self, obj):
        from django.utils import timezone

        return obj.status not in ("converted", "refused") and obj.valid_until < timezone.localdate()
