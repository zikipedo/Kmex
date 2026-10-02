from django.db import connection
from django.db.models import Q
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .exceptions import BusinessError
from .files import read_upload, store_raw
from .models import AuditLog, Notification, Warehouse
from .permissions import CompanyViewSet, HasPerm, require
from .serializers import AuditLogSerializer, CompanySerializer, CompanyUpdateSerializer, NotificationSerializer, WarehouseSerializer
from .services import audit, verify_audit_chain


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    with connection.cursor() as cur:
        cur.execute("SELECT 1")
    return Response({"status": "ok", "time": timezone.now()})


@api_view(["GET", "PUT", "PATCH"])
def company(request):
    c = request.user.company
    if request.method == "GET":
        return Response(CompanySerializer(c).data)
    require(request.user, "settings.manage")
    before = CompanySerializer(c).data
    ser = CompanyUpdateSerializer(c, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    ser.save()
    after = CompanySerializer(c).data
    changed_old = {k: before[k] for k in after if before.get(k) != after.get(k)}
    changed_new = {k: after[k] for k in after if before.get(k) != after.get(k)}
    if changed_new:
        audit(c, request.user, "SETTING_CHANGE", "company", c, label=c.name, old=changed_old, new=changed_new)
    return Response(after)


@api_view(["POST"])
def company_logo(request):
    require(request.user, "settings.manage")
    c = request.user.company
    data, mime, _sha = read_upload(request.FILES.get("file"))
    c.logo.name = store_raw(data, f"company/{c.pk}/logo", mime.split("/")[-1].replace("jpeg", "jpg"))
    c.save(update_fields=["logo"])
    audit(c, request.user, "SETTING_CHANGE", "company", c, label="Logo")
    return Response(CompanySerializer(c).data)


class WarehouseViewSet(CompanyViewSet):
    queryset = Warehouse.objects.select_related("manager").prefetch_related("registers")
    serializer_class = WarehouseSerializer
    required_perms = {"list": None, "retrieve": None, "*": "warehouses.manage"}
    pagination_class = None
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("all") == "1" and self.request.user.has_code("warehouses.manage"):
            return qs
        return qs.filter(id__in=self.request.user.allowed_warehouse_ids())

    def perform_create(self, serializer):
        w = serializer.save(company=self.request.user.company, created_by=self.request.user)
        audit(w.company, self.request.user, "CREATE", "warehouse", w, label=w.name)

    def perform_update(self, serializer):
        w = serializer.save()
        audit(w.company, self.request.user, "UPDATE", "warehouse", w, label=w.name, new=serializer.validated_data)


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificationSerializer

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user)
        if self.request.query_params.get("unread") == "1":
            qs = qs.filter(read_at__isnull=True)
        return qs

    def list(self, request, *args, **kwargs):
        resp = super().list(request, *args, **kwargs)
        resp.data["meta"]["unread"] = Notification.objects.filter(user=request.user, read_at__isnull=True).count()
        return resp

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        Notification.objects.filter(user=request.user, pk=pk).update(read_at=timezone.now())
        return Response({"ok": True})

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        Notification.objects.filter(user=request.user, read_at__isnull=True).update(read_at=timezone.now())
        return Response({"ok": True})


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [HasPerm]
    required_perms = {"*": "audit.view"}
    filterset_fields = ["action", "entity_type", "user"]
    search_fields = ["entity_label", "user_name", "reason", "entity_id"]

    def get_queryset(self):
        qs = super().get_queryset().filter(company=self.request.user.company)
        p = self.request.query_params
        if p.get("date_from"):
            qs = qs.filter(created_at__date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(created_at__date__lte=p["date_to"])
        return qs

    def list(self, request, *args, **kwargs):
        # La consultation du journal est elle-même auditée (§22.3) — une fois par page 1.
        if request.query_params.get("page", "1") == "1":
            audit(request.user.company, request.user, "AUDIT_VIEW", "audit_log", label="Consultation du journal")
        return super().list(request, *args, **kwargs)

    @action(detail=False, methods=["get"])
    def verify(self, request):
        broken = verify_audit_chain(request.user.company)
        return Response({"intact": broken is None, "broken_at": broken, "entries": AuditLog.objects.filter(company=request.user.company).count()})


@api_view(["GET"])
def search(request):
    """Recherche globale groupée et filtrée par permissions (§15)."""
    from apps.catalog.models import Product
    from apps.catalog.serializers import product_search_q
    from apps.purchasing.models import PurchaseOrder, Supplier
    from apps.sales.models import Customer, Sale

    q = (request.query_params.get("q") or "").strip()
    u = request.user
    if len(q) < 2:
        return Response({"results": []})
    company = u.company
    results = []
    if u.has_code("catalog.view"):
        for p in Product.objects.filter(company=company).exclude(status="archived").filter(product_search_q(q)).distinct()[:6]:
            results.append({"type": "product", "id": str(p.pk), "title": p.name, "subtitle": f"{p.sku} · {p.price_retail:.0f}", "link": f"/products/{p.pk}"})
    if u.has_code("sales.view") or u.has_code("sales.create"):
        for c in Customer.objects.filter(company=company).filter(Q(name__unaccent__icontains=q) | Q(phone__icontains=q) | Q(code__iexact=q))[:5]:
            results.append({"type": "customer", "id": str(c.pk), "title": c.name, "subtitle": c.phone or c.code, "link": f"/customers/{c.pk}"})
        for s in Sale.objects.filter(company=company, warehouse_id__in=u.allowed_warehouse_ids()).filter(Q(number__icontains=q) | Q(customer__name__icontains=q))[:5]:
            results.append({"type": "sale", "id": str(s.pk), "title": s.number, "subtitle": f"{s.customer.name} · {s.total:.0f}", "link": f"/sales/{s.pk}"})
    if u.has_code("purchase.view"):
        for s in Supplier.objects.filter(company=company).filter(Q(name__unaccent__icontains=q) | Q(phone__icontains=q))[:4]:
            results.append({"type": "supplier", "id": str(s.pk), "title": s.name, "subtitle": s.phone or s.code, "link": f"/suppliers/{s.pk}"})
        for o in PurchaseOrder.objects.filter(company=company, number__icontains=q)[:4]:
            results.append({"type": "purchase_order", "id": str(o.pk), "title": o.number, "subtitle": o.supplier.name, "link": f"/purchases/orders/{o.pk}"})
    return Response({"results": results})
