from rest_framework import serializers

from .models import (
    MOVEMENT_TYPES, Inventory, InventoryItem, StockAdjustment, StockAdjustmentItem, StockLevel, StockMovement,
    StockTransfer, StockTransferItem,
)


class CostMaskMixin:
    cost_fields = ("unit_cost", "avg_cost", "value", "total_value", "diff_value")

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request and not request.user.has_code("catalog.cost.view"):
            for f in self.cost_fields:
                data.pop(f, None)
        return data


class StockMovementSerializer(CostMaskMixin, serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    user_name = serializers.CharField(source="user.full_name", read_only=True, default="Système")
    type_label = serializers.SerializerMethodField()

    class Meta:
        model = StockMovement
        fields = [
            "id", "product", "product_name", "product_sku", "warehouse", "warehouse_name", "movement_type", "type_label",
            "quantity", "qty_before", "qty_after", "unit_cost", "reason", "note", "document_type", "document_id",
            "document_number", "user_name", "created_at",
        ]

    def get_type_label(self, obj):
        return MOVEMENT_TYPES.get(obj.movement_type, obj.movement_type)


class StockLevelSerializer(CostMaskMixin, serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    category_name = serializers.CharField(source="product.category.name", read_only=True)
    unit = serializers.CharField(source="product.unit.code", read_only=True)
    min_stock = serializers.DecimalField(source="product.min_stock", max_digits=18, decimal_places=4, read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    available = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    value = serializers.SerializerMethodField()
    state = serializers.SerializerMethodField()

    class Meta:
        model = StockLevel
        fields = [
            "id", "product", "product_name", "product_sku", "category_name", "unit", "warehouse", "warehouse_name",
            "on_hand", "reserved", "available", "avg_cost", "value", "min_stock", "state", "updated_at",
        ]

    def get_value(self, obj):
        return str(round(obj.on_hand * obj.avg_cost, 4))

    def get_state(self, obj):
        if obj.on_hand <= 0:
            return "out"
        if obj.product.min_stock and obj.on_hand <= obj.product.min_stock:
            return "low"
        if obj.product.max_stock and obj.on_hand > obj.product.max_stock:
            return "over"
        return "ok"


class AdjustmentItemSerializer(CostMaskMixin, serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = StockAdjustmentItem
        fields = ["id", "product", "product_name", "qty_diff", "unit_cost"]


class AdjustmentSerializer(CostMaskMixin, serializers.ModelSerializer):
    items = AdjustmentItemSerializer(many=True, read_only=True)
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")
    approved_by_name = serializers.CharField(source="approved_by.full_name", read_only=True, default="")
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = StockAdjustment
        fields = [
            "id", "number", "warehouse", "warehouse_name", "reason", "note", "status", "status_label", "total_value",
            "created_by_name", "approved_by_name", "approved_at", "created_at", "items", "inventory",
        ]


class InventoryItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    barcode = serializers.CharField(source="product.barcode", read_only=True)
    unit = serializers.CharField(source="product.unit.code", read_only=True)
    diff = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    diff_value = serializers.SerializerMethodField()
    counted_by_name = serializers.CharField(source="counted_by.full_name", read_only=True, default="")

    class Meta:
        model = InventoryItem
        fields = [
            "id", "product", "product_name", "product_sku", "barcode", "unit", "qty_theoretical", "qty_counted",
            "diff", "unit_cost", "diff_value", "counted_by_name", "counted_at",
        ]

    def get_diff_value(self, obj):
        return None if obj.diff is None else str(obj.diff * obj.unit_cost)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        inv = instance.inventory
        if inv.blind_mode and inv.status == "counting" and request and not request.user.has_code("stock.adjust.approve"):
            for f in ("qty_theoretical", "diff", "diff_value"):
                data[f] = None
        if request and not request.user.has_code("catalog.cost.view"):
            data.pop("unit_cost", None)
            data.pop("diff_value", None)
        return data


class InventorySerializer(serializers.ModelSerializer):
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")
    validated_by_name = serializers.CharField(source="validated_by.full_name", read_only=True, default="")
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    stats = serializers.SerializerMethodField()

    class Meta:
        model = Inventory
        fields = [
            "id", "number", "warehouse", "warehouse_name", "category", "category_name", "blind_mode", "status",
            "status_label", "snapshot_at", "created_by_name", "validated_by_name", "validated_at", "note", "stats",
        ]

    def get_stats(self, obj):
        items = list(obj.items.all())
        counted = [i for i in items if i.qty_counted is not None]
        return {
            "total": len(items),
            "counted": len(counted),
            "with_gap": sum(1 for i in counted if i.diff != 0),
        }


class TransferItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = StockTransferItem
        fields = ["id", "product", "product_name", "qty_requested", "qty_shipped", "qty_received"]


class TransferSerializer(serializers.ModelSerializer):
    items = TransferItemSerializer(many=True, read_only=True)
    from_name = serializers.CharField(source="from_warehouse.name", read_only=True)
    to_name = serializers.CharField(source="to_warehouse.name", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")

    class Meta:
        model = StockTransfer
        fields = [
            "id", "number", "from_warehouse", "from_name", "to_warehouse", "to_name", "status", "status_label", "note",
            "created_by_name", "shipped_at", "received_at", "created_at", "items",
        ]
