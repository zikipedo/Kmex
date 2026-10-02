from decimal import Decimal

from django.db.models import DecimalField, F, OuterRef, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.exceptions import BusinessError
from apps.core.models import Warehouse
from apps.core.permissions import CompanyViewSet, HasPerm
from apps.core.services import audit, next_code
from apps.finance.models import PaymentMethod
from apps.finance.serializers import PaymentSerializer
from apps.finance.services import record_supplier_payment

from . import services
from .models import PurchaseInvoice, PurchaseOrder, PurchaseReceipt, Supplier
from .serializers import PurchaseInvoiceSerializer, PurchaseOrderSerializer, PurchaseReceiptSerializer, SupplierSerializer

ZERO = Value(Decimal("0"), output_field=DecimalField(max_digits=18, decimal_places=4))


class SupplierViewSet(CompanyViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    required_perms = {"list": ["purchase.view", "expense.create"], "retrieve": "purchase.view", "statement": "purchase.view", "pay": "purchase.pay", "*": "supplier.manage"}
    search_fields = ["name", "code", "phone", "email"]
    filterset_fields = ["status"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list" and not self.request.query_params.get("status"):
            qs = qs.exclude(status="archived")
        open_inv = PurchaseInvoice.objects.filter(supplier=OuterRef("pk"), status__in=["unpaid", "partial"]).values("supplier").annotate(
            v=Sum(F("total") - F("paid_amount"))).values("v")
        tot = PurchaseInvoice.objects.filter(supplier=OuterRef("pk")).exclude(status="cancelled").values("supplier").annotate(v=Sum("total")).values("v")
        return qs.annotate(balance=Coalesce(Subquery(open_inv), ZERO), total_purchased=Coalesce(Subquery(tot), ZERO))

    def perform_create(self, serializer):
        company = self.request.user.company
        s = serializer.save(company=company, created_by=self.request.user, code=next_code(company, "supplier", "FRS", 4))
        audit(company, self.request.user, "CREATE", "supplier", s, label=s.name)

    def perform_destroy(self, instance):
        if instance.orders.exists() or instance.invoices.exists():
            instance.status = "archived"
            instance.save(update_fields=["status"])
            audit(instance.company, self.request.user, "ARCHIVE", "supplier", instance, label=instance.name)
        else:
            audit(instance.company, self.request.user, "DELETE", "supplier", instance, label=instance.name)
            instance.delete()

    @action(detail=True, methods=["get"])
    def statement(self, request, pk=None):
        from apps.finance.models import Payment

        supplier = self.get_object()
        rows = []
        for inv in PurchaseInvoice.objects.filter(supplier=supplier):
            rows.append({"date": inv.created_at, "type": "Facture fournisseur", "number": inv.number, "debit": Decimal(0), "credit": inv.total})
        for p in Payment.objects.filter(supplier=supplier).select_related("method"):
            rows.append({"date": p.paid_at, "type": f"Paiement {p.method.name}", "number": p.number, "debit": p.amount, "credit": Decimal(0)})
        rows.sort(key=lambda r: r["date"])
        bal = Decimal(0)
        for r in rows:
            bal += r["credit"] - r["debit"]
            r["balance"] = bal
        return Response(rows)

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        supplier = self.get_object()
        method = PaymentMethod.objects.get(company=request.user.company, pk=request.data.get("method_id"))
        inv = PurchaseInvoice.objects.filter(company=request.user.company, pk=request.data.get("invoice_id")).first() if request.data.get("invoice_id") else None
        p = record_supplier_payment(user=request.user, supplier=supplier, method=method, amount=request.data.get("amount"),
                                    reference=request.data.get("reference", ""), invoice=inv,
                                    idempotency_key=request.headers.get("Idempotency-Key"), note=request.data.get("note", ""))
        return Response(PaymentSerializer(p).data, status=201)


class PurchaseOrderViewSet(CompanyViewSet):
    queryset = PurchaseOrder.objects.select_related("supplier", "warehouse", "created_by").prefetch_related("items__product")
    serializer_class = PurchaseOrderSerializer
    required_perms = {"list": "purchase.view", "retrieve": "purchase.view", "receive": "purchase.receive", "*": "purchase.order"}
    filterset_fields = ["status", "supplier", "warehouse"]
    search_fields = ["number", "supplier__name"]

    def perform_destroy(self, instance):
        if instance.status != "draft":
            raise BusinessError("Seul un brouillon peut être supprimé ; soldez ou annulez la commande.", code="INVALID_STATUS")
        instance.delete()

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        return Response(self.get_serializer(services.send_order(user=request.user, order=self.get_object())).data)

    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        receipt = services.receive(user=request.user, order=self.get_object(), lines=request.data.get("items", []), note=request.data.get("note", ""))
        return Response(PurchaseReceiptSerializer(receipt).data, status=201)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        return Response(self.get_serializer(services.close_order(user=request.user, order=self.get_object(), reason=request.data.get("reason", ""))).data)

    @action(detail=False, methods=["post"])
    def direct(self, request):
        d = request.data
        supplier = Supplier.objects.get(company=request.user.company, pk=d.get("supplier_id"))
        wh = Warehouse.objects.get(company=request.user.company, pk=d.get("warehouse_id"))
        if not request.user.can_access_warehouse(wh):
            raise BusinessError("Vous n'êtes pas affecté à ce dépôt.", code="WAREHOUSE_FORBIDDEN", status_code=403)
        inv = services.direct_purchase(user=request.user, supplier=supplier, warehouse=wh, lines=d.get("items", []),
                                       supplier_ref=d.get("supplier_ref", ""), payment=d.get("payment"), notes=d.get("notes", ""))
        return Response(PurchaseInvoiceSerializer(inv).data, status=201)

    @action(detail=False, methods=["get"])
    def suggestions(self, request):
        """PUR-008 : produits sous le seuil avec quantité suggérée."""
        from apps.catalog.models import Product
        from apps.inventory.models import StockLevel

        wh = request.query_params.get("warehouse")
        rows = []
        for p in Product.objects.filter(company=request.user.company, status="active", track_stock=True, min_stock__gt=0).select_related("main_supplier"):
            lv = StockLevel.objects.filter(product=p, **({"warehouse_id": wh} if wh else {})).aggregate(s=Sum("on_hand"))["s"] or Decimal(0)
            if lv <= p.min_stock:
                target = p.max_stock or p.min_stock * 3
                rows.append({"product_id": str(p.pk), "name": p.name, "sku": p.sku, "stock": str(lv), "min_stock": str(p.min_stock),
                             "suggested": str(max(target - lv, p.min_stock)), "cost": str(p.cost_last or p.cost_avg),
                             "supplier_id": str(p.main_supplier_id) if p.main_supplier_id else None,
                             "supplier": p.main_supplier.name if p.main_supplier else None})
        return Response(rows)


class PurchaseReceiptViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = PurchaseReceipt.objects.select_related("supplier", "warehouse", "order", "created_by").prefetch_related("items__product")
    serializer_class = PurchaseReceiptSerializer
    permission_classes = [HasPerm]
    required_perms = {"*": "purchase.view"}
    filterset_fields = ["supplier", "is_invoiced", "order"]
    search_fields = ["number", "supplier__name"]

    def get_queryset(self):
        return super().get_queryset().filter(company=self.request.user.company)


class PurchaseInvoiceViewSet(CompanyViewSet):
    queryset = PurchaseInvoice.objects.select_related("supplier", "order", "receipt")
    serializer_class = PurchaseInvoiceSerializer
    required_perms = {"list": "purchase.view", "retrieve": "purchase.view", "pay": "purchase.pay", "*": "purchase.invoice"}
    filterset_fields = ["status", "supplier"]
    search_fields = ["number", "supplier_ref", "supplier__name"]
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        d = request.data
        company = request.user.company
        receipt = PurchaseReceipt.objects.filter(company=company, pk=d.get("receipt_id")).first() if d.get("receipt_id") else None
        order = PurchaseOrder.objects.filter(company=company, pk=d.get("order_id")).first() if d.get("order_id") else None
        supplier = receipt.supplier if receipt else order.supplier if order else Supplier.objects.get(company=company, pk=d.get("supplier_id"))
        inv = services.create_invoice(user=request.user, supplier=supplier, receipt=receipt, order=order,
                                      supplier_ref=d.get("supplier_ref", ""), issue_date=d.get("issue_date") or None,
                                      total=d.get("total"), tax_total=d.get("tax_total"), notes=d.get("notes", ""))
        return Response(self.get_serializer(inv).data, status=201)

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        inv = self.get_object()
        method = PaymentMethod.objects.get(company=request.user.company, pk=request.data.get("method_id"))
        p = record_supplier_payment(user=request.user, supplier=inv.supplier, method=method, amount=request.data.get("amount"),
                                    reference=request.data.get("reference", ""), invoice=inv,
                                    idempotency_key=request.headers.get("Idempotency-Key"))
        return Response(PaymentSerializer(p).data, status=201)
