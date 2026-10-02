from rest_framework import serializers

from apps.catalog.serializers import CompanyScopedPK
from apps.core.models import Warehouse

from .models import PurchaseInvoice, PurchaseOrder, PurchaseOrderItem, PurchaseReceipt, PurchaseReceiptItem, Supplier


class SupplierSerializer(serializers.ModelSerializer):
    balance = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True, default=None)
    total_purchased = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True, default=None)

    class Meta:
        model = Supplier
        fields = [
            "id", "code", "name", "contact_name", "phone", "email", "address", "country", "tax_id",
            "payment_terms_days", "lead_time_days", "status", "notes", "balance", "total_purchased", "created_at",
        ]
        read_only_fields = ["code"]


class POItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    qty_remaining = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)

    class Meta:
        model = PurchaseOrderItem
        fields = ["id", "product", "product_name", "product_sku", "qty_ordered", "qty_received", "qty_remaining", "unit_price", "tax_rate", "line_total"]
        read_only_fields = ["qty_received", "line_total"]


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = POItemSerializer(many=True)
    supplier = CompanyScopedPK(queryset=Supplier.objects.all())
    warehouse = CompanyScopedPK(queryset=Warehouse.objects.all())
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "number", "supplier", "supplier_name", "warehouse", "warehouse_name", "status", "status_label",
            "order_date", "expected_date", "subtotal", "tax_total", "total", "notes", "close_reason", "items",
            "created_by_name", "created_at",
        ]
        read_only_fields = ["number", "status", "subtotal", "tax_total", "total", "close_reason"]

    def _save_items(self, order, items):
        from .services import compute_order

        order.items.all().delete()
        for it in items:
            if it["product"].company_id != order.company_id:
                raise serializers.ValidationError({"items": "Produit invalide."})
            PurchaseOrderItem.objects.create(order=order, **{k: v for k, v in it.items() if k in ("product", "qty_ordered", "unit_price", "tax_rate")})
        compute_order(order)

    def create(self, validated):
        items = validated.pop("items")
        order = PurchaseOrder.objects.create(**validated)
        self._save_items(order, items)
        return order

    def update(self, instance, validated):
        if instance.status != "draft":
            raise serializers.ValidationError("Une commande envoyée n'est plus modifiable.")
        items = validated.pop("items", None)
        for k, v in validated.items():
            setattr(instance, k, v)
        instance.save()
        if items is not None:
            self._save_items(instance, items)
        return instance


class ReceiptItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = PurchaseReceiptItem
        fields = ["id", "product", "product_name", "quantity", "unit_cost", "condition"]


class PurchaseReceiptSerializer(serializers.ModelSerializer):
    items = ReceiptItemSerializer(many=True, read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    order_number = serializers.CharField(source="order.number", read_only=True, default="")
    received_by = serializers.CharField(source="created_by.full_name", read_only=True, default="")

    class Meta:
        model = PurchaseReceipt
        fields = ["id", "number", "order", "order_number", "supplier", "supplier_name", "warehouse", "warehouse_name",
                  "received_at", "received_by", "note", "total", "is_invoiced", "items"]


class PurchaseInvoiceSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    order_number = serializers.CharField(source="order.number", read_only=True, default="")
    receipt_number = serializers.CharField(source="receipt.number", read_only=True, default="")
    balance = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    is_overdue = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseInvoice
        fields = [
            "id", "number", "supplier_ref", "supplier", "supplier_name", "order", "order_number", "receipt",
            "receipt_number", "issue_date", "due_date", "subtotal", "tax_total", "total", "paid_amount", "balance",
            "status", "status_label", "discrepancy", "notes", "is_overdue", "created_at",
        ]

    def get_is_overdue(self, obj):
        from django.utils import timezone

        return obj.status in ("unpaid", "partial") and obj.due_date < timezone.localdate()
