from decimal import Decimal

from django.db.models import Q
from rest_framework import mixins, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from apps.catalog.models import Category, Product
from apps.core.exceptions import BusinessError
from apps.core.models import Warehouse
from apps.core.permissions import CompanyViewSet, HasPerm, require
from apps.core.services import audit

from . import services_ops as ops
from .models import IN_TYPES, OUT_TYPES, Inventory, StockAdjustment, StockLevel, StockMovement, StockTransfer
from .serializers import (
    AdjustmentSerializer, InventoryItemSerializer, InventorySerializer, StockLevelSerializer, StockMovementSerializer,
    TransferSerializer,
)
from .services import integrity_check, move_stock


def _warehouse(request, wid, field="warehouse_id"):
    wh = Warehouse.objects.filter(company=request.user.company, pk=wid).first()
    if not wh:
        raise BusinessError("Dépôt introuvable.", code="WAREHOUSE_REQUIRED", errors=[{"field": field, "message": "Requis"}])
    if not request.user.can_access_warehouse(wh):
        raise BusinessError("Vous n'êtes pas affecté à ce dépôt.", code="WAREHOUSE_FORBIDDEN", status_code=403)
    return wh


class ScopedReadOnly(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [HasPerm]
    required_perms = {"*": "stock.view"}

    def get_queryset(self):
        qs = super().get_queryset().filter(company=self.request.user.company)
        wh = self.request.query_params.get("warehouse")
        qs = qs.filter(warehouse_id__in=self.request.user.allowed_warehouse_ids())
        return qs.filter(warehouse_id=wh) if wh else qs


class StockLevelViewSet(ScopedReadOnly):
    queryset = StockLevel.objects.select_related("product", "product__category", "product__unit", "warehouse")
    serializer_class = StockLevelSerializer
    search_fields = ["product__name", "product__sku", "product__barcode"]
    ordering_fields = ["on_hand", "product__name", "avg_cost"]
    ordering = ["product__name"]

    def get_queryset(self):
        qs = super().get_queryset().exclude(product__status="archived")
        state = self.request.query_params.get("state")
        if state == "out":
            qs = qs.filter(on_hand__lte=0)
        elif state == "low":
            from django.db.models import F

            qs = qs.filter(on_hand__gt=0, on_hand__lte=F("product__min_stock"))
        cat = self.request.query_params.get("category")
        return qs.filter(product__category_id=cat) if cat else qs


class StockMovementViewSet(ScopedReadOnly):
    queryset = StockMovement.objects.select_related("product", "warehouse", "user")
    serializer_class = StockMovementSerializer
    filterset_fields = ["movement_type", "product", "user"]
    search_fields = ["product__name", "product__sku", "document_number", "reason"]
    ordering = ["-id"]

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("date_from"):
            qs = qs.filter(created_at__date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(created_at__date__lte=p["date_to"])
        if p.get("direction") == "in":
            qs = qs.filter(quantity__gt=0)
        elif p.get("direction") == "out":
            qs = qs.filter(quantity__lt=0)
        return qs


@api_view(["POST"])
def manual_movement(request, direction):
    """STOCK-002 / STOCK-003 : entrée ou sortie manuelle motivée."""
    require(request.user, "stock.move")
    d = request.data
    wh = _warehouse(request, d.get("warehouse_id"))
    product = Product.objects.filter(company=request.user.company, pk=d.get("product_id")).first()
    if not product:
        raise BusinessError("Produit introuvable.", code="PRODUCT_NOT_FOUND")
    reason = (d.get("reason") or "").strip()
    if not reason:
        raise BusinessError("Le motif est obligatoire.", code="REASON_REQUIRED", errors=[{"field": "reason", "message": "Requis"}])
    q = Decimal(str(d.get("quantity") or 0))
    if q <= 0:
        raise BusinessError("La quantité doit être positive.", code="INVALID_QUANTITY")
    mtype = d.get("movement_type") or ("manual_in" if direction == "entries" else "manual_out")
    valid = IN_TYPES if direction == "entries" else OUT_TYPES
    if mtype not in valid or mtype in ("sale", "purchase_receipt", "transfer_in", "transfer_out", "customer_return", "supplier_return"):
        raise BusinessError("Type de mouvement non autorisé en saisie manuelle.", code="INVALID_MOVEMENT_TYPE")
    cost = d.get("unit_cost")
    if mtype == "initial":
        if StockMovement.objects.filter(product=product, warehouse=wh, movement_type="initial").exists():
            raise BusinessError("Le stock initial a déjà été saisi pour ce produit dans ce dépôt : passez par un ajustement.", code="INITIAL_ALREADY_SET")
    mv = move_stock(
        company=request.user.company, product=product, warehouse=wh, quantity=q if direction == "entries" else -q,
        movement_type=mtype, user=request.user, unit_cost=Decimal(str(cost)) if cost not in (None, "") else None,
        document_type="manual", reason=reason, note=d.get("note", ""),
    )
    audit(request.user.company, request.user, "STOCK_MOVE", "product", product, label=product.name,
          new={"type": mtype, "quantity": str(mv.quantity), "before": str(mv.qty_before), "after": str(mv.qty_after), "warehouse": wh.name},
          reason=reason)
    return Response(StockMovementSerializer(mv, context={"request": request}).data, status=201)


class AdjustmentViewSet(CompanyViewSet):
    queryset = StockAdjustment.objects.select_related("warehouse", "created_by", "approved_by").prefetch_related("items__product")
    serializer_class = AdjustmentSerializer
    required_perms = {"list": "stock.view", "retrieve": "stock.view", "approve": "stock.adjust.approve", "reject": "stock.adjust.approve", "*": "stock.adjust"}
    filterset_fields = ["status", "warehouse"]
    search_fields = ["number", "reason"]
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        wh = _warehouse(request, request.data.get("warehouse_id"))
        adj = ops.create_adjustment(user=request.user, warehouse=wh, reason=request.data.get("reason", ""),
                                    lines=request.data.get("items", []), note=request.data.get("note", ""))
        return Response(self.get_serializer(adj).data, status=201)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return Response(self.get_serializer(ops.approve_adjustment(user=request.user, adj=self.get_object())).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return Response(self.get_serializer(ops.reject_adjustment(user=request.user, adj=self.get_object(), reason=request.data.get("reason", ""))).data)


class InventoryViewSet(CompanyViewSet):
    queryset = Inventory.objects.select_related("warehouse", "category", "created_by", "validated_by").prefetch_related("items")
    serializer_class = InventorySerializer
    required_perms = {
        "list": "stock.inventory.count", "retrieve": "stock.inventory.count", "items": "stock.inventory.count",
        "count": "stock.inventory.count", "validate": "stock.adjust.approve", "cancel": "stock.adjust.approve",
        "*": "stock.adjust",
    }
    filterset_fields = ["status", "warehouse"]
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        wh = _warehouse(request, request.data.get("warehouse_id"))
        cat = Category.objects.filter(company=request.user.company, pk=request.data.get("category_id")).first() if request.data.get("category_id") else None
        inv = ops.start_inventory(user=request.user, warehouse=wh, category=cat, blind_mode=bool(request.data.get("blind_mode", True)), note=request.data.get("note", ""))
        return Response(self.get_serializer(inv).data, status=201)

    @action(detail=True, methods=["get"])
    def items(self, request, pk=None):
        inv = self.get_object()
        qs = inv.items.select_related("product", "product__unit", "counted_by", "inventory")
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(Q(product__name__icontains=q) | Q(product__sku__iexact=q) | Q(product__barcode=q))
        if request.query_params.get("only") == "gaps":
            qs = [i for i in qs if i.qty_counted is not None and i.diff != 0]
        elif request.query_params.get("only") == "uncounted":
            qs = qs.filter(qty_counted__isnull=True)
        return Response(InventoryItemSerializer(qs, many=True, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def count(self, request, pk=None):
        inv = ops.count_items(user=request.user, inv=self.get_object(), counts=request.data.get("counts", []))
        return Response(self.get_serializer(inv).data)

    @action(detail=True, methods=["post"])
    def validate(self, request, pk=None):
        return Response(self.get_serializer(ops.validate_inventory(user=request.user, inv=self.get_object())).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        inv = self.get_object()
        if inv.status != "counting":
            raise BusinessError("Cet inventaire n'est plus en cours.", code="INVENTORY_LOCKED")
        inv.status = "cancelled"
        inv.save(update_fields=["status"])
        audit(inv.company, request.user, "CANCEL", "inventory", inv, label=inv.number, reason=request.data.get("reason", ""))
        return Response(self.get_serializer(inv).data)


class TransferViewSet(CompanyViewSet):
    queryset = StockTransfer.objects.select_related("from_warehouse", "to_warehouse", "created_by").prefetch_related("items__product")
    serializer_class = TransferSerializer
    required_perms = {"list": "stock.view", "retrieve": "stock.view", "create": "stock.transfer.request", "*": "stock.transfer.manage"}
    filterset_fields = ["status"]
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        src = Warehouse.objects.get(company=request.user.company, pk=request.data.get("from_warehouse_id"))
        dst = _warehouse(request, request.data.get("to_warehouse_id"), "to_warehouse_id")
        tr = ops.create_transfer(user=request.user, from_wh=src, to_wh=dst, lines=request.data.get("items", []), note=request.data.get("note", ""))
        return Response(self.get_serializer(tr).data, status=201)

    @action(detail=True, methods=["post"])
    def ship(self, request, pk=None):
        tr = self.get_object()
        _warehouse(request, tr.from_warehouse_id)
        return Response(self.get_serializer(ops.ship_transfer(user=request.user, tr=tr, lines=request.data.get("items"))).data)

    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        tr = self.get_object()
        _warehouse(request, tr.to_warehouse_id)
        return Response(self.get_serializer(ops.receive_transfer(user=request.user, tr=tr, lines=request.data.get("items"))).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        tr = self.get_object()
        if tr.status != "requested":
            raise BusinessError("Annulation impossible après expédition.", code="INVALID_STATUS")
        tr.status = "cancelled"
        tr.save(update_fields=["status"])
        audit(tr.company, request.user, "CANCEL", "transfer", tr, label=tr.number)
        return Response(self.get_serializer(tr).data)


@api_view(["GET"])
def stock_integrity(request):
    require(request.user, "stock.adjust.approve")
    return Response({"anomalies": integrity_check(request.user.company)})


@api_view(["GET"])
def movement_types(request):
    return Response({"in": IN_TYPES, "out": OUT_TYPES})
