from django.conf import settings
from django.db import models

from apps.catalog.models import MONEY, Product
from apps.core.models import BaseModel, Warehouse

IN_TYPES = {
    "purchase_receipt": "Réception fournisseur",
    "customer_return": "Retour client",
    "adjustment_in": "Ajustement positif",
    "transfer_in": "Transfert entrant",
    "initial": "Stock initial",
    "manual_in": "Entrée manuelle",
}
OUT_TYPES = {
    "sale": "Vente",
    "supplier_return": "Retour fournisseur",
    "adjustment_out": "Ajustement négatif",
    "transfer_out": "Transfert sortant",
    "damaged": "Produit endommagé",
    "expired": "Produit périmé",
    "loss": "Perte / vol",
    "internal_use": "Consommation interne",
    "manual_out": "Sortie manuelle",
}
MOVEMENT_TYPES = {**IN_TYPES, **OUT_TYPES}


class StockLevel(BaseModel):
    """Cache transactionnel du stock (dérivé des mouvements, §2.3)."""

    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="stock_levels")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="stock_levels")
    on_hand = models.DecimalField(**MONEY, default=0)
    reserved = models.DecimalField(**MONEY, default=0)
    avg_cost = models.DecimalField(**MONEY, default=0)
    min_qty = models.DecimalField(**MONEY, null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["product", "warehouse"], name="uq_stock_level")]

    @property
    def available(self):
        return self.on_hand - self.reserved


class StockMovement(models.Model):
    """Registre immuable (UPDATE/DELETE interdits par trigger PostgreSQL)."""

    id = models.BigAutoField(primary_key=True)
    company = models.ForeignKey("core.Company", on_delete=models.PROTECT, related_name="+")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="movements")
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="movements")
    movement_type = models.CharField(max_length=30, choices=list(MOVEMENT_TYPES.items()))
    quantity = models.DecimalField(**MONEY)
    qty_before = models.DecimalField(**MONEY)
    qty_after = models.DecimalField(**MONEY)
    unit_cost = models.DecimalField(**MONEY, default=0)
    reason = models.CharField(max_length=200, blank=True)
    note = models.TextField(blank=True)
    document_type = models.CharField(max_length=30, blank=True)
    document_id = models.CharField(max_length=64, blank=True)
    document_number = models.CharField(max_length=40, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["product", "warehouse", "created_at"]),
            models.Index(fields=["document_type", "document_id"]),
            models.Index(fields=["company", "created_at"]),
        ]


class StockAdjustment(BaseModel):
    STATUSES = [("pending", "En attente d'approbation"), ("applied", "Appliqué"), ("rejected", "Rejeté")]
    number = models.CharField(max_length=40)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="+")
    reason = models.CharField(max_length=200)
    note = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=STATUSES, default="pending")
    total_value = models.DecimalField(**MONEY, default=0)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)
    inventory = models.ForeignKey("Inventory", null=True, blank=True, on_delete=models.PROTECT, related_name="adjustments")


class StockAdjustmentItem(models.Model):
    adjustment = models.ForeignKey(StockAdjustment, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="+")
    qty_diff = models.DecimalField(**MONEY)
    unit_cost = models.DecimalField(**MONEY, default=0)


class Inventory(BaseModel):
    STATUSES = [("counting", "Comptage en cours"), ("validated", "Validé"), ("cancelled", "Annulé")]
    number = models.CharField(max_length=40)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="+")
    category = models.ForeignKey("catalog.Category", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    blind_mode = models.BooleanField(default=True)
    status = models.CharField(max_length=12, choices=STATUSES, default="counting")
    snapshot_at = models.DateTimeField(auto_now_add=True)
    validated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    validated_at = models.DateTimeField(null=True, blank=True)
    note = models.TextField(blank=True)


class InventoryItem(models.Model):
    inventory = models.ForeignKey(Inventory, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="+")
    qty_theoretical = models.DecimalField(**MONEY)
    qty_counted = models.DecimalField(**MONEY, null=True, blank=True)
    unit_cost = models.DecimalField(**MONEY, default=0)
    counted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    counted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["product__name"]
        constraints = [models.UniqueConstraint(fields=["inventory", "product"], name="uq_inventory_product")]

    @property
    def diff(self):
        return None if self.qty_counted is None else self.qty_counted - self.qty_theoretical


class StockTransfer(BaseModel):
    STATUSES = [
        ("requested", "Demandé"), ("in_transit", "En transit"), ("received", "Reçu"),
        ("partially_received", "Reçu avec écart"), ("cancelled", "Annulé"),
    ]
    number = models.CharField(max_length=40)
    from_warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="+")
    to_warehouse = models.ForeignKey(Warehouse, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=20, choices=STATUSES, default="requested")
    note = models.TextField(blank=True)
    shipped_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    shipped_at = models.DateTimeField(null=True, blank=True)
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    received_at = models.DateTimeField(null=True, blank=True)


class StockTransferItem(models.Model):
    transfer = models.ForeignKey(StockTransfer, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="+")
    qty_requested = models.DecimalField(**MONEY)
    qty_shipped = models.DecimalField(**MONEY, default=0)
    qty_received = models.DecimalField(**MONEY, default=0)
    unit_cost = models.DecimalField(**MONEY, default=0)
