from decimal import Decimal

from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Count, DecimalField, F, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.exceptions import BusinessError
from apps.core.files import process_image, read_upload
from apps.core.permissions import CompanyViewSet, require
from apps.core.services import audit
from apps.inventory.models import StockLevel, StockMovement

from .models import Brand, Category, PriceHistory, Product, ProductBarcode, ProductImage, Tax, Unit
from .serializers import (
    BrandSerializer, CategorySerializer, PriceHistorySerializer, ProductImageSerializer, ProductSerializer,
    TaxSerializer, UnitSerializer, product_search_q,
)

REF_PERMS = {"list": "catalog.view", "retrieve": "catalog.view", "*": "catalog.manage"}
ZERO = Value(Decimal("0"), output_field=DecimalField(max_digits=18, decimal_places=4))


class TaxViewSet(CompanyViewSet):
    queryset = Tax.objects.all()
    serializer_class = TaxSerializer
    required_perms = {"list": "catalog.view", "retrieve": "catalog.view", "*": "settings.manage"}
    pagination_class = None


class CategoryViewSet(CompanyViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    required_perms = REF_PERMS
    pagination_class = None
    search_fields = ["name"]

    def get_queryset(self):
        return super().get_queryset().annotate(products_count=Count("products", filter=~Q(products__status="archived")))

    def perform_destroy(self, instance):
        if instance.products.exclude(status="archived").exists():
            raise BusinessError("Archivage refusé : des produits actifs sont rattachés à cette catégorie.", code="CATEGORY_IN_USE")
        instance.is_active = False
        instance.save(update_fields=["is_active"])


class BrandViewSet(CompanyViewSet):
    queryset = Brand.objects.all()
    serializer_class = BrandSerializer
    required_perms = REF_PERMS
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().annotate(products_count=Count("products"))

    def perform_destroy(self, instance):
        if instance.products.exists():
            raise BusinessError("Cette marque est utilisée par des produits.", code="BRAND_IN_USE")
        instance.delete()


class UnitViewSet(CompanyViewSet):
    queryset = Unit.objects.all()
    serializer_class = UnitSerializer
    required_perms = REF_PERMS
    pagination_class = None


class ProductViewSet(CompanyViewSet):
    queryset = Product.objects.select_related("category", "brand", "unit", "tax").prefetch_related("images", "barcodes")
    serializer_class = ProductSerializer
    required_perms = {
        "list": "catalog.view", "retrieve": "catalog.view", "by_barcode": "catalog.view", "movements": "stock.view",
        "price_history": "catalog.view", "images": "catalog.view", "upload_image": "catalog.image.upload",
        "set_primary": "catalog.image.upload", "reorder_images": "catalog.image.upload",
        "delete_image": "catalog.image.upload", "destroy": "catalog.archive", "restore": "catalog.archive",
        "*": "catalog.manage",
    }
    filterset_fields = ["category", "brand", "type", "is_favorite"]
    ordering_fields = ["name", "price_retail", "created_at", "stock", "sku"]
    ordering = ["name"]

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        status_ = p.get("status")
        if status_ == "all":
            pass
        elif status_:
            qs = qs.filter(status=status_)
        elif self.action == "list":
            qs = qs.exclude(status="archived")
        if p.get("q"):
            qs = qs.filter(product_search_q(p["q"].strip())).distinct()
        wh = p.get("warehouse")
        levels = StockLevel.objects.filter(product=OuterRef("pk"))
        if wh:
            levels = levels.filter(warehouse_id=wh)
        else:
            levels = levels.filter(warehouse_id__in=self.request.user.allowed_warehouse_ids())
        stock_sq = levels.values("product").annotate(s=Sum("on_hand")).values("s")
        value_sq = levels.values("product").annotate(v=Sum(F("on_hand") * F("avg_cost"))).values("v")
        qs = qs.annotate(stock=Coalesce(Subquery(stock_sq), ZERO), stock_value=Coalesce(Subquery(value_sq), ZERO))
        flt = p.get("stock_state")
        if flt == "low":
            qs = qs.filter(track_stock=True, stock__gt=0, stock__lte=F("min_stock"))
        elif flt == "out":
            qs = qs.filter(track_stock=True, stock__lte=0)
        elif flt == "available":
            qs = qs.filter(Q(stock__gt=0) | Q(track_stock=False))
        return qs

    def list(self, request, *args, **kwargs):
        if request.query_params.get("all") == "1":
            qs = self.filter_queryset(self.get_queryset())[:1000]
            return Response({"data": self.get_serializer(qs, many=True).data, "meta": {"total": len(qs)}})
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        product = serializer.save(company=self.request.user.company, created_by=self.request.user)
        audit(product.company, self.request.user, "CREATE", "product", product, label=product.name,
              new={"sku": product.sku, "price": product.price_retail})

    def perform_update(self, serializer):
        old = {"price_retail": serializer.instance.price_retail, "status": serializer.instance.status, "name": serializer.instance.name}
        product = serializer.save()
        audit(product.company, self.request.user, "UPDATE", "product", product, label=product.name, old=old,
              new={"price_retail": product.price_retail, "status": product.status, "name": product.name})

    def perform_destroy(self, instance):
        """Un produit n'est jamais supprimé physiquement : archivage (RG-STK-13)."""
        instance.status = "archived"
        instance.save(update_fields=["status", "updated_at"])
        audit(instance.company, self.request.user, "ARCHIVE", "product", instance, label=instance.name,
              reason=self.request.data.get("reason", "") if hasattr(self.request, "data") else "")

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        product = self.get_object()
        product.status = "active"
        product.save(update_fields=["status"])
        audit(product.company, request.user, "RESTORE", "product", product, label=product.name)
        return Response(self.get_serializer(product).data)

    @action(detail=False, methods=["get"], url_path=r"by-barcode/(?P<code>[^/]+)")
    def by_barcode(self, request, code=None):
        """Résolution d'un scan : code produit ou conditionnement (quantité du carton)."""
        company = request.user.company
        product = self.get_queryset().filter(Q(barcode=code) | Q(sku__iexact=code)).first()
        factor = Decimal("1")
        if not product:
            extra = ProductBarcode.objects.filter(company=company, barcode=code).first()
            if extra:
                product = self.get_queryset().filter(pk=extra.product_id).first()
                factor = extra.factor
        if not product:
            raise BusinessError("Produit introuvable pour ce code.", code="BARCODE_NOT_FOUND", status_code=404)
        data = self.get_serializer(product).data
        data["scan_quantity"] = str(factor)
        return Response(data)

    @action(detail=True, methods=["get"])
    def movements(self, request, pk=None):
        from apps.inventory.serializers import StockMovementSerializer

        qs = StockMovement.objects.filter(product=self.get_object()).select_related("warehouse", "user")[:200]
        return Response(StockMovementSerializer(qs, many=True, context={"request": request}).data)

    @action(detail=True, methods=["get"], url_path="price-history")
    def price_history(self, request, pk=None):
        qs = PriceHistory.objects.filter(product=self.get_object()).select_related("created_by")
        return Response(PriceHistorySerializer(qs, many=True).data)

    @action(detail=True, methods=["get"], url_path="stock")
    def stock_by_warehouse(self, request, pk=None):
        rows = StockLevel.objects.filter(product=self.get_object()).select_related("warehouse")
        show_cost = request.user.has_code("catalog.cost.view")
        return Response([
            {"warehouse_id": str(r.warehouse_id), "warehouse": r.warehouse.name, "on_hand": str(r.on_hand),
             "reserved": str(r.reserved), "available": str(r.available), **({"avg_cost": str(r.avg_cost)} if show_cost else {})}
            for r in rows
        ])

    # --- Photos (§4.5) ---------------------------------------------------------------------
    @action(detail=True, methods=["get"])
    def images(self, request, pk=None):
        qs = self.get_object().images.filter(deleted_at__isnull=True)
        return Response(ProductImageSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"], url_path="images/upload")
    def upload_image(self, request, pk=None):
        product = self.get_object()
        company = request.user.company
        files = request.FILES.getlist("files") or ([request.FILES["file"]] if "file" in request.FILES else [])
        if not files:
            raise BusinessError("Aucune image reçue.", code="FILE_MISSING", status_code=400)
        active = product.images.filter(deleted_at__isnull=True)
        limit = int(company.setting("max_product_photos") or 8)
        if active.count() + len(files) > limit:
            raise BusinessError(f"Maximum {limit} photos par produit.", code="PHOTO_LIMIT")
        created = []
        for f in files:
            data, _mime, sha = read_upload(f)
            if active.filter(sha256=sha).exists():
                raise BusinessError("Cette photo est déjà présente dans la galerie.", code="DUPLICATE_IMAGE", status_code=409)
            main, thumbs, (w, h) = process_image(data, f"company/{company.pk}/products/{product.pk}")
            with transaction.atomic():
                has_primary = product.images.filter(is_primary=True, deleted_at__isnull=True).exists()
                img = ProductImage.objects.create(
                    company=company, product=product, image=main, thumbs=thumbs, sha256=sha, is_primary=not has_primary,
                    position=active.count(), width=w, height=h, size_bytes=default_storage.size(main), status="ready",
                    uploaded_by=request.user, created_by=request.user,
                )
            audit(company, request.user, "IMAGE_UPLOAD", "product", product, label=product.name, new={"image": str(img.pk)})
            created.append(img)
        return Response(ProductImageSerializer(created, many=True).data, status=201)

    @action(detail=True, methods=["post"], url_path=r"images/(?P<image_id>[0-9a-f-]{36})/primary")
    def set_primary(self, request, pk=None, image_id=None):
        product = self.get_object()
        with transaction.atomic():
            product.images.filter(is_primary=True).update(is_primary=False)
            img = product.images.get(pk=image_id, deleted_at__isnull=True)
            img.is_primary = True
            img.save(update_fields=["is_primary"])
        audit(product.company, request.user, "IMAGE_PRIMARY", "product", product, label=product.name, new={"image": image_id})
        return Response(ProductImageSerializer(product.images.filter(deleted_at__isnull=True), many=True).data)

    @action(detail=True, methods=["put"], url_path="images/order")
    def reorder_images(self, request, pk=None):
        product = self.get_object()
        for idx, iid in enumerate(request.data.get("order", [])):
            product.images.filter(pk=iid).update(position=idx)
        return Response(ProductImageSerializer(product.images.filter(deleted_at__isnull=True), many=True).data)

    @action(detail=True, methods=["delete"], url_path=r"images/(?P<image_id>[0-9a-f-]{36})")
    def delete_image(self, request, pk=None, image_id=None):
        product = self.get_object()
        img = product.images.get(pk=image_id, deleted_at__isnull=True)
        # Le magasinier peut ajouter mais pas supprimer la photo d'un autre (§4.5).
        if img.uploaded_by_id != request.user.pk:
            require(request.user, "catalog.image.delete", "Vous ne pouvez supprimer que vos propres photos.")
        with transaction.atomic():
            img.deleted_at = timezone.now()
            was_primary = img.is_primary
            img.is_primary = False
            img.save(update_fields=["deleted_at", "is_primary"])
            if was_primary:
                nxt = product.images.filter(deleted_at__isnull=True).order_by("position").first()
                if nxt:
                    nxt.is_primary = True
                    nxt.save(update_fields=["is_primary"])
        audit(product.company, request.user, "IMAGE_DELETE", "product", product, label=product.name, old={"image": image_id})
        return Response(ProductImageSerializer(product.images.filter(deleted_at__isnull=True), many=True).data)
