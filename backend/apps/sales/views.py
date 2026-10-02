from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, DecimalField, F, Max, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import mixins, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from apps.core.exceptions import BusinessError
from apps.core.models import Warehouse
from apps.core.permissions import CompanyViewSet, HasPerm, require
from apps.core.services import audit, next_code, next_number
from apps.finance.models import Payment

from . import pdf as pdfgen
from . import services
from .calc import compute_document
from .models import CreditNote, Customer, Quote, QuoteItem, Sale
from .serializers import CreditNoteSerializer, CustomerSerializer, QuoteSerializer, SaleDetailSerializer, SaleListSerializer

ZERO = Value(Decimal("0"), output_field=DecimalField(max_digits=18, decimal_places=4))


class CustomerViewSet(CompanyViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
    required_perms = {"list": ["sales.view", "sales.create"], "retrieve": ["sales.view", "sales.create"], "statement": "sales.view", "*": "customer.manage"}
    search_fields = ["name", "code", "phone", "email", "whatsapp"]
    filterset_fields = ["status", "type"]
    ordering_fields = ["name", "balance", "total_sales", "last_purchase"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list" and not self.request.query_params.get("status"):
            qs = qs.exclude(status="archived")
        if self.request.query_params.get("hide_walkin") == "1":
            qs = qs.filter(is_walkin=False)
        due = Sale.objects.filter(customer=OuterRef("pk")).exclude(status="cancelled").values("customer").annotate(
            v=Sum(F("total") - F("paid_amount") - F("credited_amount"))).values("v")
        credit = Payment.objects.filter(customer=OuterRef("pk"), direction="in", status="valid").values("customer").annotate(
            v=Sum("unallocated")).values("v")
        tot = Sale.objects.filter(customer=OuterRef("pk")).exclude(status="cancelled").values("customer").annotate(v=Sum("total")).values("v")
        cnt = Sale.objects.filter(customer=OuterRef("pk")).values("customer").annotate(v=Count("id")).values("v")
        last = Sale.objects.filter(customer=OuterRef("pk")).values("customer").annotate(v=Max("issue_date")).values("v")
        qs = qs.annotate(
            balance=Coalesce(Subquery(due), ZERO) - Coalesce(Subquery(credit), ZERO),
            total_sales=Coalesce(Subquery(tot), ZERO), sales_count=Coalesce(Subquery(cnt), 0), last_purchase=Subquery(last),
        )
        if self.request.query_params.get("with_balance") == "1":
            qs = qs.filter(balance__gt=0)
        return qs

    def perform_create(self, serializer):
        company = self.request.user.company
        dup = None
        phone = serializer.validated_data.get("phone")
        if phone:
            dup = Customer.objects.filter(company=company, phone=phone).first()
        if dup:
            raise BusinessError(f"Un client avec ce téléphone existe déjà : {dup.name} ({dup.code}).", code="DUPLICATE_CUSTOMER", status_code=409)
        c = serializer.save(company=company, created_by=self.request.user, code=next_code(company, "customer", "CLI", 5))
        audit(company, self.request.user, "CREATE", "customer", c, label=c.name)

    def perform_update(self, serializer):
        old = {"credit_limit": serializer.instance.credit_limit, "status": serializer.instance.status}
        c = serializer.save()
        audit(c.company, self.request.user, "UPDATE", "customer", c, label=c.name, old=old, new={"credit_limit": c.credit_limit, "status": c.status})

    def perform_destroy(self, instance):
        if instance.is_walkin:
            raise BusinessError("Le client comptoir ne peut pas être supprimé.", code="WALKIN_PROTECTED")
        if instance.sales.exists():
            instance.status = "archived"
            instance.save(update_fields=["status"])
            audit(instance.company, self.request.user, "ARCHIVE", "customer", instance, label=instance.name)
        else:
            audit(instance.company, self.request.user, "DELETE", "customer", instance, label=instance.name)
            instance.delete()

    @action(detail=True, methods=["get"])
    def statement(self, request, pk=None):
        customer = self.get_object()
        rows = services.customer_statement(customer)
        open_sales = Sale.objects.filter(customer=customer, status__in=["issued", "partial"])
        return Response({
            "rows": rows,
            "aging": services.aging_buckets(open_sales),
            "outstanding": services.customer_outstanding(customer),
            "credit_available": Payment.objects.filter(customer=customer, direction="in", status="valid").aggregate(v=Coalesce(Sum("unallocated"), ZERO))["v"],
        })


class SaleViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Sale.objects.select_related("customer", "seller", "warehouse", "discount_authorized_by")
    permission_classes = [HasPerm]
    required_perms = {"create": "sales.create", "cancel": "sales.cancel", "credit_note": "sales.cancel", "pay": "sales.payment",
                      "apply_credit": "sales.payment", "preview": "sales.create", "*": ["sales.view", "sales.create"]}
    filterset_fields = ["status", "type", "customer", "warehouse", "seller"]
    search_fields = ["number", "customer__name", "customer__phone"]
    ordering_fields = ["created_at", "total", "number", "issue_date"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        return SaleDetailSerializer if self.action not in ("list",) else SaleListSerializer

    def get_queryset(self):
        u = self.request.user
        qs = super().get_queryset().filter(company=u.company, warehouse_id__in=u.allowed_warehouse_ids())
        if not u.has_code("sales.view"):
            qs = qs.filter(seller=u)
        p = self.request.query_params
        if p.get("date_from"):
            qs = qs.filter(issue_date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(issue_date__lte=p["date_to"])
        if p.get("open") == "1":
            qs = qs.filter(status__in=["issued", "partial"])
        if p.get("overdue") == "1":
            qs = qs.filter(status__in=["issued", "partial"], due_date__lt=timezone.localdate())
        if self.action == "list":
            qs = qs.annotate(items_count=Count("items"))
        else:
            qs = qs.prefetch_related("items__product__unit", "credit_notes__items__sale_item")
        return qs

    def create(self, request):
        sale = services.create_sale(user=request.user, data=request.data, idempotency_key=request.headers.get("Idempotency-Key"))
        data = SaleDetailSerializer(sale, context={"request": request}).data
        data["change"] = str(getattr(sale, "_change", Decimal(0)))
        data["warnings"] = getattr(sale, "_warnings", [])
        data["replayed"] = getattr(sale, "_replayed", False)
        return Response(data, status=200 if data["replayed"] else 201)

    @action(detail=False, methods=["post"])
    def preview(self, request):
        """Aperçu des totaux (le serveur reste la référence de calcul)."""
        company = request.user.company
        customer = Customer.objects.filter(company=company, pk=request.data.get("customer_id")).first() if request.data.get("customer_id") else None
        lines = services.build_lines(company, request.user, request.data.get("items") or [], customer, price_check=False)
        computed, totals = compute_document(lines, request.data.get("global_discount_type", "percent"),
                                            request.data.get("global_discount_value", 0), bool(company.setting("prices_include_tax")), company.currency_decimals)
        return Response({
            "lines": [{"product_id": str(c["product"].pk), "unit_price": str(c["unit_price"]), "line_total": str(c["line_total"]), "discount_amount": str(c["discount_amount"])} for c in computed],
            "totals": {k: (str(v) if not isinstance(v, list) else [{kk: str(vv) for kk, vv in t.items()} for t in v]) for k, v in totals.items()},
        })

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        from apps.finance.models import PaymentMethod
        from apps.finance.serializers import PaymentSerializer
        from apps.finance.services import record_customer_payment

        sale = self.get_object()
        if sale.status in ("paid", "cancelled"):
            raise BusinessError("Cette facture est déjà soldée ou annulée.", code="INVALID_STATUS")
        method = PaymentMethod.objects.get(company=request.user.company, pk=request.data.get("method_id"))
        p = record_customer_payment(user=request.user, customer=sale.customer, method=method, amount=request.data.get("amount"),
                                    reference=request.data.get("reference", ""), sale=sale, idempotency_key=request.headers.get("Idempotency-Key"))
        return Response(PaymentSerializer(p).data, status=201)

    @action(detail=True, methods=["post"], url_path="apply-credit")
    def apply_credit(self, request, pk=None):
        sale = services.apply_customer_credit(user=request.user, sale=self.get_object())
        return Response(SaleDetailSerializer(sale, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="credit-notes")
    def credit_note(self, request, pk=None):
        d = request.data
        note = services.create_credit_note(user=request.user, sale=self.get_object(), items=d.get("items", []), reason=d.get("reason", ""),
                                           settlement=d.get("settlement", "deduct"), method_id=d.get("method_id"), reference=d.get("reference", ""))
        return Response(CreditNoteSerializer(note).data, status=201)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        d = request.data
        note = services.create_credit_note(user=request.user, sale=self.get_object(), items=[], reason=d.get("reason", ""),
                                           settlement=d.get("settlement", "refund"), method_id=d.get("method_id"),
                                           full=True, restock=bool(d.get("restock", True)))
        return Response(CreditNoteSerializer(note).data, status=201)

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        sale = self.get_object()
        fmt = request.query_params.get("paper", "a4")
        duplicate = sale.print_count > 0
        Sale.objects.filter(pk=sale.pk).update(print_count=F("print_count") + 1)
        if duplicate:
            audit(sale.company, request.user, "REPRINT", "sale", sale, label=sale.number)
        data, sha = pdfgen.ticket_80mm(sale, duplicate) if fmt == "ticket" else pdfgen.invoice_a4(sale, duplicate)
        resp = HttpResponse(data, content_type="application/pdf")
        resp["Content-Disposition"] = f'inline; filename="{sale.number}.pdf"'
        resp["X-Document-SHA256"] = sha
        return resp


class CreditNoteViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = CreditNote.objects.select_related("sale", "customer", "created_by").prefetch_related("items__sale_item")
    serializer_class = CreditNoteSerializer
    permission_classes = [HasPerm]
    required_perms = {"*": "sales.view"}
    search_fields = ["number", "sale__number", "customer__name"]

    def get_queryset(self):
        return super().get_queryset().filter(company=self.request.user.company)


class QuoteViewSet(CompanyViewSet):
    queryset = Quote.objects.select_related("customer", "seller", "converted_sale").prefetch_related("items")
    serializer_class = QuoteSerializer
    required_perms = {"list": ["sales.view", "sales.create"], "retrieve": ["sales.view", "sales.create"], "*": "sales.create"}
    filterset_fields = ["status", "customer"]
    search_fields = ["number", "customer__name"]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def create(self, request, *args, **kwargs):
        d = request.data
        u = request.user
        company = u.company
        customer = Customer.objects.get(company=company, pk=d.get("customer_id"))
        wh = Warehouse.objects.get(company=company, pk=d.get("warehouse_id"))
        lines = services.build_lines(company, u, d.get("items") or [], customer)
        computed, totals = compute_document(lines, d.get("global_discount_type", "percent"), d.get("global_discount_value", 0),
                                            bool(company.setting("prices_include_tax")), company.currency_decimals)
        valid_until = parse_date(d.get("valid_until") or "") or timezone.localdate() + timedelta(days=15)
        with transaction.atomic():
            q = Quote.objects.create(
                company=company, number=next_number(company, "quote"), customer=customer, warehouse=wh, seller=u,
                issue_date=timezone.localdate(), valid_until=valid_until, status="sent" if d.get("send") else "draft",
                subtotal=totals["subtotal"], discount_total=totals["discount_total"], tax_total=totals["tax_total"], total=totals["total"],
                global_discount_type=d.get("global_discount_type", "percent"), global_discount_value=Decimal(str(d.get("global_discount_value") or 0)),
                notes=d.get("notes", ""), created_by=u,
            )
            QuoteItem.objects.bulk_create([QuoteItem(
                quote=q, product=c["product"], description=c["description"], quantity=c["quantity"], unit_price=c["unit_price"],
                discount_type=c["discount_type"], discount_value=c["discount_value"], discount_amount=c["discount_amount"],
                tax_rate=c["tax_rate"], line_subtotal=c["line_subtotal"], tax_amount=c["tax_amount"], line_total=c["line_total"],
            ) for c in computed])
            audit(company, u, "CREATE", "quote", q, label=q.number, new={"total": q.total})
        return Response(self.get_serializer(q).data, status=201)

    def perform_destroy(self, instance):
        if instance.status == "converted":
            raise BusinessError("Un devis converti ne peut être supprimé.", code="INVALID_STATUS")
        instance.status = "refused"
        instance.save(update_fields=["status"])

    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        q = self.get_object()
        new = request.data.get("status")
        if new not in ("sent", "accepted", "refused") or q.status == "converted":
            raise BusinessError("Changement de statut invalide.", code="INVALID_STATUS")
        if new == "accepted" and q.valid_until < timezone.localdate():
            raise BusinessError("Devis expiré : prolongez-le avant de l'accepter.", code="QUOTE_EXPIRED")
        q.status = new
        q.save(update_fields=["status"])
        return Response(self.get_serializer(q).data)

    @action(detail=True, methods=["post"])
    def extend(self, request, pk=None):
        q = self.get_object()
        q.valid_until = parse_date(request.data.get("valid_until") or "") or timezone.localdate() + timedelta(days=15)
        if q.status == "expired":
            q.status = "sent"
        q.save(update_fields=["valid_until", "status"])
        return Response(self.get_serializer(q).data)

    @action(detail=True, methods=["post"])
    def convert(self, request, pk=None):
        """Conversion en facture (RG-VTE-12 : un devis expiré doit être prolongé)."""
        q = self.get_object()
        if q.status in ("converted", "refused"):
            raise BusinessError("Ce devis ne peut plus être converti.", code="INVALID_STATUS")
        if q.valid_until < timezone.localdate():
            raise BusinessError("Devis expiré : prolongez-le avant conversion.", code="QUOTE_EXPIRED")
        data = {
            "type": "invoice", "customer_id": str(q.customer_id), "warehouse_id": str(q.warehouse_id), "quote_id": str(q.pk),
            "global_discount_type": q.global_discount_type, "global_discount_value": str(q.global_discount_value),
            "items": [{"product_id": str(i.product_id), "quantity": str(i.quantity), "unit_price": str(i.unit_price),
                       "discount_type": i.discount_type, "discount_value": str(i.discount_value), "description": i.description} for i in q.items.all()],
            "payments": request.data.get("payments", []), "override_pin": request.data.get("override_pin"),
            "credit_override_pin": request.data.get("credit_override_pin"),
        }
        sale = services.create_sale(user=request.user, data=data, idempotency_key=f"quote-{q.pk}")
        return Response(SaleDetailSerializer(sale, context={"request": request}).data, status=201)


@api_view(["POST"])
def verify_pin(request):
    """Vérifie un PIN gérant pour une autorisation (remise / crédit) sans l'enregistrer."""
    code = request.data.get("permission", "sales.discount.override")
    if code not in ("sales.discount.override", "sales.credit.override"):
        raise BusinessError("Permission invalide.", code="INVALID_PERMISSION")
    u = services.authorize_by_pin(request.user.company, request.data.get("pin"), code, exclude=request.user)
    if not u:
        raise BusinessError("PIN invalide ou utilisateur non habilité.", code="PIN_INVALID", status_code=403)
    return Response({"authorized_by": u.full_name})
