from django.conf import settings
from django.db.models import Q
from rest_framework import serializers

from .models import Brand, Category, PriceHistory, Product, ProductBarcode, ProductImage, Tax, Unit

COST_FIELDS = ("cost_last", "cost_avg", "margin_pct", "stock_value")


def media_url(path):
    return f"{settings.MEDIA_URL}{path}" if path else None


class CompanyScopedPK(serializers.PrimaryKeyRelatedField):
    """Clé étrangère restreinte à l'entreprise de l'utilisateur (anti-IDOR)."""

    def get_queryset(self):
        qs = super().get_queryset()
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            qs = qs.filter(company=request.user.company)
        return qs


class TaxSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tax
        fields = ["id", "name", "rate", "is_active", "is_default"]


class CategorySerializer(serializers.ModelSerializer):
    parent = CompanyScopedPK(queryset=Category.objects.all(), allow_null=True, required=False)
    default_tax = CompanyScopedPK(queryset=Tax.objects.all(), allow_null=True, required=False)
    products_count = serializers.IntegerField(read_only=True)
    parent_name = serializers.CharField(source="parent.name", read_only=True, default=None)

    class Meta:
        model = Category
        fields = ["id", "name", "parent", "parent_name", "default_tax", "icon", "color", "is_active", "products_count"]


class BrandSerializer(serializers.ModelSerializer):
    products_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Brand
        fields = ["id", "name", "products_count"]


class UnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = Unit
        fields = ["id", "code", "name", "is_decimal"]


class ProductImageSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    thumbs = serializers.SerializerMethodField()

    class Meta:
        model = ProductImage
        fields = ["id", "url", "thumbs", "is_primary", "position", "caption", "width", "height", "size_bytes", "status", "created_at"]

    def get_url(self, obj):
        return media_url(obj.image.name)

    def get_thumbs(self, obj):
        return {k: media_url(v) for k, v in (obj.thumbs or {}).items()}


class ProductBarcodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductBarcode
        fields = ["id", "barcode", "factor", "label"]


class ProductSerializer(serializers.ModelSerializer):
    category = CompanyScopedPK(queryset=Category.objects.all())
    brand = CompanyScopedPK(queryset=Brand.objects.all(), allow_null=True, required=False)
    unit = CompanyScopedPK(queryset=Unit.objects.all())
    tax = CompanyScopedPK(queryset=Tax.objects.all(), allow_null=True, required=False)
    category_name = serializers.CharField(source="category.name", read_only=True)
    category_icon = serializers.CharField(source="category.icon", read_only=True)
    category_color = serializers.CharField(source="category.color", read_only=True)
    brand_name = serializers.CharField(source="brand.name", read_only=True, default=None)
    unit_code = serializers.CharField(source="unit.code", read_only=True)
    unit_is_decimal = serializers.BooleanField(source="unit.is_decimal", read_only=True)
    tax_rate = serializers.DecimalField(max_digits=6, decimal_places=3, read_only=True)
    image = serializers.SerializerMethodField()
    stock = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True, default=None)
    stock_value = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True, default=None)
    margin_pct = serializers.SerializerMethodField()
    barcodes = ProductBarcodeSerializer(many=True, required=False)
    price_reason = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Product
        fields = [
            "id", "name", "internal_ref", "sku", "barcode", "type", "category", "category_name", "category_icon",
            "category_color", "brand", "brand_name", "unit", "unit_code", "unit_is_decimal", "tax", "tax_rate",
            "description", "cost_last", "cost_avg", "price_retail", "price_wholesale", "wholesale_min_qty",
            "promo_price", "promo_start", "promo_end", "min_stock", "max_stock", "main_supplier", "track_stock",
            "is_favorite", "status", "tags", "notes", "image", "stock", "stock_value", "margin_pct", "barcodes",
            "price_reason", "created_at", "updated_at", "version",
        ]
        read_only_fields = ["cost_avg", "created_at", "updated_at", "version"]
        extra_kwargs = {"internal_ref": {"required": False}, "sku": {"required": False}}

    def get_image(self, obj):
        imgs = getattr(obj, "_prefetched_objects_cache", {}).get("images")
        if imgs is None:
            img = obj.images.filter(is_primary=True, deleted_at__isnull=True).first()
        else:
            img = next((i for i in imgs if i.is_primary and i.deleted_at is None), None)
        if not img:
            return None
        return {k: media_url(v) for k, v in (img.thumbs or {}).items()}

    def get_margin_pct(self, obj):
        if not obj.price_retail or not obj.cost_avg:
            return None
        price_ht = obj.price_retail
        company = self.context.get("company")
        if company and company.setting("prices_include_tax") and obj.tax_id:
            price_ht = obj.price_retail / (1 + obj.tax.rate / 100)
        return round(float((price_ht - obj.cost_avg) / price_ht * 100), 1) if price_ht else None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        # PROD-006 : masquage serveur des coûts sans permission.
        if request and not request.user.has_code("catalog.cost.view"):
            for f in COST_FIELDS:
                data.pop(f, None)
        if request and not request.user.has_code("profit.view"):
            data.pop("margin_pct", None)
        return data

    def validate(self, attrs):
        company = self.context["company"]
        qs = Product.objects.filter(company=company)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        for field, label in (("sku", "SKU"), ("barcode", "code-barres"), ("internal_ref", "référence")):
            value = attrs.get(field)
            if value:
                other = qs.filter(**{field: value}).first()
                if other:
                    raise serializers.ValidationError({field: f"Ce {label} est déjà utilisé par « {other.name} »."})
        bc = attrs.get("barcode")
        if bc:
            from .models import ProductBarcode as PB

            clash = PB.objects.filter(company=company, barcode=bc)
            if self.instance:
                clash = clash.exclude(product=self.instance)
            if clash.exists():
                raise serializers.ValidationError({"barcode": "Ce code-barres est déjà attribué à un conditionnement."})
            if bc.isdigit() and len(bc) == 13 and not ean13_valid(bc):
                raise serializers.ValidationError({"barcode": "Code EAN-13 invalide (clé de contrôle)."})
        if self.instance and "unit" in attrs and attrs["unit"] != self.instance.unit:
            from apps.inventory.models import StockLevel

            if StockLevel.objects.filter(product=self.instance).exclude(on_hand=0).exists():
                raise serializers.ValidationError({"unit": "Impossible de changer l'unité d'un produit ayant du stock."})
        if attrs.get("type") == "service":
            attrs["track_stock"] = False
        request = self.context.get("request")
        if self.instance and request and not request.user.has_code("catalog.price.edit"):
            for f in PRICE_FIELDS:
                if f in attrs and attrs[f] != getattr(self.instance, f):
                    raise serializers.ValidationError({f: "Vous n'avez pas la permission de modifier les prix."})
        # Le prix d'achat est une donnée sensible (PROD-006) : saisie réservée aux profils qui peuvent le voir.
        if "cost_last" in attrs:
            if request and not request.user.has_code("catalog.cost.view"):
                attrs.pop("cost_last")
            elif attrs["cost_last"] is not None and attrs["cost_last"] < 0:
                raise serializers.ValidationError({"cost_last": "Le prix d'achat ne peut pas être négatif."})
        return attrs

    def create(self, validated):
        from apps.core.services import next_code

        barcodes = validated.pop("barcodes", [])
        validated.pop("price_reason", None)
        company = validated["company"]
        if not validated.get("internal_ref"):
            validated["internal_ref"] = next_code(company, "product", "PRD")
        if not validated.get("sku"):
            validated["sku"] = validated["internal_ref"].replace("PRD-", "SKU-")
        if not validated.get("tax") and validated["category"].default_tax_id:
            validated["tax"] = validated["category"].default_tax
        # Sans stock, le coût moyen (CMUP) démarre au prix d'achat saisi ; il évoluera ensuite à chaque réception.
        if validated.get("cost_last"):
            validated["cost_avg"] = validated["cost_last"]
        product = Product.objects.create(**validated)
        for b in barcodes:
            ProductBarcode.objects.create(company=company, product=product, **b)
        return product

    def update(self, instance, validated):
        barcodes = validated.pop("barcodes", None)
        reason = validated.pop("price_reason", "")
        request = self.context.get("request")
        for f in (*PRICE_FIELDS, "cost_last"):
            if f in validated and validated[f] != getattr(instance, f):
                PriceHistory.objects.create(
                    company=instance.company, product=instance, price_type=f, old_price=getattr(instance, f),
                    new_price=validated[f], reason=reason, created_by=request.user if request else None,
                )
        # Tant qu'aucune unité n'est en stock, le CMUP suit le prix d'achat saisi (sinon il reste calculé par les réceptions).
        if validated.get("cost_last") is not None and validated["cost_last"] != instance.cost_last:
            from apps.inventory.models import StockLevel

            if not StockLevel.objects.filter(product=instance, on_hand__gt=0).exists():
                instance.cost_avg = validated["cost_last"]
        for k, v in validated.items():
            setattr(instance, k, v)
        instance.version += 1
        instance.save()
        if barcodes is not None:
            instance.barcodes.all().delete()
            for b in barcodes:
                ProductBarcode.objects.create(company=instance.company, product=instance, **b)
        return instance


PRICE_FIELDS = ("price_retail", "price_wholesale", "promo_price")


def ean13_valid(code: str) -> bool:
    digits = [int(c) for c in code]
    total = sum(d * (3 if i % 2 else 1) for i, d in enumerate(digits[:12]))
    return (10 - total % 10) % 10 == digits[12]


class PriceHistorySerializer(serializers.ModelSerializer):
    changed_by = serializers.CharField(source="created_by.full_name", default="", read_only=True)

    class Meta:
        model = PriceHistory
        fields = ["id", "price_type", "old_price", "new_price", "reason", "changed_by", "created_at"]


def product_search_q(term):
    return (
        Q(name__unaccent__icontains=term)
        | Q(sku__iexact=term)
        | Q(internal_ref__iexact=term)
        | Q(barcode=term)
        | Q(barcodes__barcode=term)
        | Q(sku__istartswith=term)
        | Q(tags__icontains=term)
        | Q(brand__name__icontains=term)
    )
