from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import BaseModel

MONEY = dict(max_digits=18, decimal_places=4)


class Tax(BaseModel):
    name = models.CharField(max_length=80)
    rate = models.DecimalField(max_digits=6, decimal_places=3, default=0)
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ["rate"]

    def __str__(self):
        return f"{self.name} ({self.rate} %)"


class Category(BaseModel):
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children")
    name = models.CharField(max_length=120)
    default_tax = models.ForeignKey(Tax, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    icon = models.CharField(max_length=40, default="package")
    color = models.CharField(max_length=20, default="#a78bfa")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["company", "parent", "name"], name="uq_category_name")]

    def __str__(self):
        return self.name


class Brand(BaseModel):
    name = models.CharField(max_length=120)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["company", "name"], name="uq_brand_name")]

    def __str__(self):
        return self.name


class Unit(BaseModel):
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=60)
    is_decimal = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["company", "code"], name="uq_unit_code")]

    def __str__(self):
        return self.name


class Product(BaseModel):
    TYPES = [("simple", "Simple"), ("service", "Service")]
    STATUSES = [("active", "Actif"), ("inactive", "Inactif"), ("archived", "Archivé")]

    name = models.CharField(max_length=200)
    internal_ref = models.CharField(max_length=40)
    sku = models.CharField(max_length=60)
    barcode = models.CharField(max_length=60, blank=True)
    type = models.CharField(max_length=10, choices=TYPES, default="simple")
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")
    brand = models.ForeignKey(Brand, null=True, blank=True, on_delete=models.SET_NULL, related_name="products")
    unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="+")
    tax = models.ForeignKey(Tax, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    description = models.TextField(blank=True)
    cost_last = models.DecimalField(**MONEY, default=0)
    cost_avg = models.DecimalField(**MONEY, default=0)
    price_retail = models.DecimalField(**MONEY, default=0)
    price_wholesale = models.DecimalField(**MONEY, null=True, blank=True)
    wholesale_min_qty = models.DecimalField(**MONEY, null=True, blank=True)
    promo_price = models.DecimalField(**MONEY, null=True, blank=True)
    promo_start = models.DateField(null=True, blank=True)
    promo_end = models.DateField(null=True, blank=True)
    min_stock = models.DecimalField(**MONEY, default=0)
    max_stock = models.DecimalField(**MONEY, null=True, blank=True)
    main_supplier = models.ForeignKey("purchasing.Supplier", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    track_stock = models.BooleanField(default=True)
    is_favorite = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=STATUSES, default="active")
    tags = models.CharField(max_length=300, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["company", "internal_ref"], name="uq_product_ref"),
            models.UniqueConstraint(fields=["company", "sku"], name="uq_product_sku"),
            models.UniqueConstraint(fields=["company", "barcode"], condition=~Q(barcode=""), name="uq_product_barcode"),
        ]
        indexes = [models.Index(fields=["company", "status"]), models.Index(fields=["category"])]

    def __str__(self):
        return self.name

    @property
    def tax_rate(self) -> Decimal:
        return self.tax.rate if self.tax_id else Decimal("0")

    def price_for(self, quantity: Decimal, on_date=None, customer=None) -> Decimal:
        """Hiérarchie de prix (RG-VTE-03) : promotion > palier/gros > standard."""
        from django.utils import timezone

        today = on_date or timezone.localdate()
        if self.promo_price and (not self.promo_start or self.promo_start <= today) and (
            not self.promo_end or today <= self.promo_end
        ):
            return self.promo_price
        if self.price_wholesale and self.wholesale_min_qty and Decimal(quantity) >= self.wholesale_min_qty:
            return self.price_wholesale
        if self.price_wholesale and customer is not None and customer.type == "wholesaler":
            return self.price_wholesale
        return self.price_retail


class ProductBarcode(BaseModel):
    """Codes-barres additionnels (carton, pack…) avec facteur de conditionnement."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="barcodes")
    barcode = models.CharField(max_length=60)
    factor = models.DecimalField(**MONEY, default=1)
    label = models.CharField(max_length=60, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["company", "barcode"], name="uq_extra_barcode")]


class PriceHistory(BaseModel):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="price_history")
    price_type = models.CharField(max_length=20)
    old_price = models.DecimalField(**MONEY, null=True)
    new_price = models.DecimalField(**MONEY, null=True)
    reason = models.CharField(max_length=200, blank=True)


def image_path(instance, filename):
    return f"company/{instance.company_id}/products/{instance.product_id}/{filename}"


class ProductImage(BaseModel):
    STATUSES = [("processing", "Traitement"), ("ready", "Prête"), ("failed", "Échec")]
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to=image_path, max_length=300)
    thumbs = models.JSONField(default=dict)
    sha256 = models.CharField(max_length=64, db_index=True)
    is_primary = models.BooleanField(default=False)
    position = models.PositiveIntegerField(default=0)
    caption = models.CharField(max_length=200, blank=True)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    size_bytes = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=12, choices=STATUSES, default="ready")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["position", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["product"], condition=Q(is_primary=True, deleted_at__isnull=True), name="uq_primary_image"
            )
        ]
