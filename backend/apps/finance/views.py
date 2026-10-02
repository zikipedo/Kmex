from decimal import Decimal

from django.db import transaction
from django.db.models import Case, Count, DecimalField, F, OuterRef, Q, Subquery, Sum, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.exceptions import BusinessError
from apps.core.files import process_image, read_upload, store_raw
from apps.core.permissions import CompanyViewSet, HasPerm, require
from apps.core.services import audit, next_number
from apps.sales.models import Customer, Sale

from . import services
from .models import (
    CashMovement, CashRegister, Expense, ExpenseAttachment, ExpenseCategory, Income, Payment, PaymentMethod,
    RegisterSession, TreasuryAccount,
)
from .serializers import (
    CashMovementSerializer, CashRegisterSerializer, ExpenseAttachmentSerializer, ExpenseCategorySerializer,
    ExpenseSerializer, IncomeSerializer, PaymentMethodSerializer, PaymentSerializer, RegisterSessionSerializer,
    TreasuryAccountSerializer,
)

ZERO = Value(Decimal("0"), output_field=DecimalField(max_digits=18, decimal_places=4))


def account_balance_annotation():
    signed = Case(When(movements__direction="in", then=F("movements__amount")), default=-F("movements__amount"),
                  output_field=DecimalField(max_digits=18, decimal_places=4))
    return Coalesce(Sum(signed), ZERO)


class TreasuryAccountViewSet(CompanyViewSet):
    queryset = TreasuryAccount.objects.all()
    serializer_class = TreasuryAccountSerializer
    required_perms = {"list": ["cash.view", "settings.manage"], "retrieve": "cash.view", "transfer": "cash.session.validate", "*": "settings.manage"}
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().annotate(balance=account_balance_annotation())

    @action(detail=False, methods=["post"])
    def transfer(self, request):
        """Transfert de fonds / dépôt en banque (aucun effet sur le résultat)."""
        company = request.user.company
        src = TreasuryAccount.objects.get(company=company, pk=request.data.get("from_account"))
        dst = TreasuryAccount.objects.get(company=company, pk=request.data.get("to_account"))
        services.transfer_funds(user=request.user, from_account=src, to_account=dst, amount=request.data.get("amount"),
                                reference=request.data.get("reference", ""), note=request.data.get("note", ""))
        return Response(TreasuryAccountSerializer(self.get_queryset(), many=True).data, status=201)


class PaymentMethodViewSet(CompanyViewSet):
    queryset = PaymentMethod.objects.all()
    serializer_class = PaymentMethodSerializer
    required_perms = {"list": None, "retrieve": None, "*": "settings.manage"}
    pagination_class = None


class CashRegisterViewSet(CompanyViewSet):
    queryset = CashRegister.objects.select_related("warehouse")
    serializer_class = CashRegisterSerializer
    required_perms = {"list": None, "retrieve": None, "open": "cash.session", "*": "warehouses.manage"}
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().filter(warehouse_id__in=self.request.user.allowed_warehouse_ids())

    def perform_create(self, serializer):
        company = self.request.user.company
        acc = TreasuryAccount.objects.create(company=company, type="cash", name=f"Caisse {serializer.validated_data['name']}")
        serializer.save(company=company, cash_account=acc, created_by=self.request.user)

    @action(detail=True, methods=["post"])
    def open(self, request, pk=None):
        reg = self.get_object()
        amount = request.data.get("opening_float")
        if amount in (None, ""):
            amount = request.user.company.setting("default_opening_float")
        s = services.open_session(user=request.user, register=reg, opening_float=Decimal(str(amount)))
        return Response(RegisterSessionSerializer(s).data, status=201)


class RegisterSessionViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = RegisterSession.objects.select_related("register", "register__warehouse", "opened_by", "closed_by", "validated_by")
    serializer_class = RegisterSessionSerializer
    permission_classes = [HasPerm]
    required_perms = {"validate": "cash.session.validate", "*": ["cash.session", "cash.view"]}
    filterset_fields = ["status", "register"]

    def get_queryset(self):
        qs = super().get_queryset().filter(company=self.request.user.company).annotate(
            sales_count=Count("sales", distinct=True),
            sales_total=Coalesce(Sum("sales__total", distinct=True), ZERO),
        )
        u = self.request.user
        if not (u.has_code("cash.view") or u.has_code("cash.session.validate")):
            qs = qs.filter(opened_by=u)  # Le caissier ne voit que sa session (DASH-002)
        return qs

    @action(detail=True, methods=["get"])
    def summary(self, request, pk=None):
        """Rapport Z : ventes par moyen, remboursements, dépenses, écart (§11.2)."""
        s = self.get_object()
        expected = services.session_expected(s)
        methods = {m.code: m.name for m in PaymentMethod.objects.filter(company=s.company)}
        by_cat = CashMovement.objects.filter(session=s).values("category", "direction").annotate(total=Sum("amount"), n=Count("id"))
        sales = Sale.objects.filter(register_session=s)
        agg = sales.aggregate(n=Count("id"), total=Coalesce(Sum("total"), ZERO), discounts=Coalesce(Sum("discount_total"), ZERO))
        cancelled = sales.filter(status="cancelled").count()
        movements = CashMovementSerializer(CashMovement.objects.filter(session=s).select_related("account", "method", "user").order_by("id"), many=True).data
        return Response({
            "session": RegisterSessionSerializer(s).data,
            "expected": [{"code": k, "name": methods.get(k, k), "amount": str(v), "counted": s.counted.get(k)} for k, v in expected.items()],
            "by_category": [{"category": dict(CashMovement.CATEGORIES).get(r["category"], r["category"]), "direction": r["direction"], "total": str(r["total"]), "count": r["n"]} for r in by_cat],
            "sales": {"count": agg["n"], "total": str(agg["total"]), "discounts": str(agg["discounts"]), "cancelled": cancelled},
            "movements": movements,
        })

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        s = services.close_session(user=request.user, session=self.get_object(), counted=request.data.get("counted", {}),
                                   reason=request.data.get("reason", ""), denominations=request.data.get("denominations"))
        return Response(RegisterSessionSerializer(s).data)

    @action(detail=True, methods=["post"])
    def validate(self, request, pk=None):
        return Response(RegisterSessionSerializer(services.validate_session(user=request.user, session=self.get_object())).data)


class PaymentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Payment.objects.select_related("method", "customer", "supplier", "created_by")
    serializer_class = PaymentSerializer
    permission_classes = [HasPerm]
    required_perms = {"create": "sales.payment", "reverse": "cash.session.validate", "*": ["cash.view", "sales.payment"]}
    filterset_fields = ["direction", "method", "status", "customer", "supplier", "session"]
    search_fields = ["number", "reference", "customer__name", "supplier__name"]

    def get_queryset(self):
        qs = super().get_queryset().filter(company=self.request.user.company)
        p = self.request.query_params
        if p.get("date_from"):
            qs = qs.filter(paid_at__date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(paid_at__date__lte=p["date_to"])
        return qs

    def create(self, request):
        """Règlement client (facture précise ou FIFO)."""
        d = request.data
        company = request.user.company
        customer = Customer.objects.get(company=company, pk=d.get("customer_id"))
        method = PaymentMethod.objects.get(company=company, pk=d.get("method_id"))
        sale = Sale.objects.filter(company=company, pk=d.get("sale_id")).first() if d.get("sale_id") else None
        p = services.record_customer_payment(user=request.user, customer=customer, method=method, amount=d.get("amount"),
                                             reference=d.get("reference", ""), sale=sale,
                                             idempotency_key=request.headers.get("Idempotency-Key"), note=d.get("note", ""))
        return Response(self.get_serializer(p).data, status=201)

    @action(detail=True, methods=["post"])
    def reverse(self, request, pk=None):
        return Response(self.get_serializer(services.reverse_payment(user=request.user, payment=self.get_object(), reason=request.data.get("reason", ""))).data)


class CashMovementViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = CashMovement.objects.select_related("account", "method", "user")
    serializer_class = CashMovementSerializer
    permission_classes = [HasPerm]
    required_perms = {"*": "cash.view"}
    filterset_fields = ["account", "session", "category", "direction"]
    search_fields = ["label", "source_number"]

    def get_queryset(self):
        return super().get_queryset().filter(company=self.request.user.company)


class ExpenseCategoryViewSet(CompanyViewSet):
    queryset = ExpenseCategory.objects.all()
    serializer_class = ExpenseCategorySerializer
    required_perms = {"list": ["expense.view", "expense.create"], "retrieve": "expense.view", "*": "expense.category.manage"}
    pagination_class = None

    def get_queryset(self):
        start = timezone.localdate().replace(day=1)
        spent = Expense.objects.filter(category=OuterRef("pk"), status="paid", expense_date__gte=start).values("category").annotate(s=Sum("amount")).values("s")
        qs = super().get_queryset().annotate(spent_month=Coalesce(Subquery(spent), ZERO))
        if not self.request.user.has_code("expense.sensitive.view"):
            qs = qs.filter(is_sensitive=False)
        return qs

    def perform_destroy(self, instance):
        if instance.expenses.exists():
            instance.is_active = False  # RG-DEP-07 : archivée, jamais supprimée
            instance.save(update_fields=["is_active"])
        else:
            instance.delete()


class ExpenseViewSet(CompanyViewSet):
    queryset = Expense.objects.select_related("category", "warehouse", "method", "created_by", "approved_by", "paid_by", "cancelled_by").prefetch_related("attachments")
    serializer_class = ExpenseSerializer
    required_perms = {
        "list": ["expense.view", "expense.create"], "retrieve": ["expense.view", "expense.create"], "create": "expense.create",
        "update": "expense.edit", "partial_update": "expense.edit", "submit": "expense.create",
        "attachments": "expense.create", "approve": "expense.approve", "reject": "expense.approve",
        "pay": "expense.pay", "cancel": "expense.cancel", "destroy": "expense.create",
    }
    filterset_fields = ["status", "category", "warehouse", "type"]
    search_fields = ["number", "description", "payee_name"]
    ordering_fields = ["expense_date", "amount", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        u = self.request.user
        if not u.has_code("expense.sensitive.view"):
            qs = qs.filter(category__is_sensitive=False)  # RG-DEP-09
        if not u.has_code("expense.view"):
            qs = qs.filter(created_by=u)
        p = self.request.query_params
        if p.get("date_from"):
            qs = qs.filter(expense_date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(expense_date__lte=p["date_to"])
        if p.get("pending_for_me") == "1":
            qs = qs.filter(status="pending").exclude(created_by=u)
        return qs

    def perform_create(self, serializer):
        u = self.request.user
        key = self.request.headers.get("Idempotency-Key")
        if key and Expense.objects.filter(company=u.company, idempotency_key=key).exists():
            serializer.instance = Expense.objects.get(company=u.company, idempotency_key=key)
            return
        exp = serializer.save(company=u.company, created_by=u, idempotency_key=key)
        audit(u.company, u, "CREATE", "expense", exp, label=exp.description, new={"amount": exp.amount})

    def perform_update(self, serializer):
        if serializer.instance.status not in ("draft", "pending"):
            raise BusinessError("Une dépense approuvée ou payée n'est plus modifiable (annulez-la).", code="EXPENSE_LOCKED")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.status != "draft":
            raise BusinessError("Seul un brouillon peut être supprimé ; une dépense payée s'annule par extourne.", code="EXPENSE_LOCKED")
        if instance.created_by_id != self.request.user.pk:
            require(self.request.user, "expense.cancel")
        audit(instance.company, self.request.user, "DELETE", "expense", instance, label=instance.description)
        instance.attachments.all().delete()
        instance.delete()

    def _method(self, request):
        mid = request.data.get("method_id")
        return PaymentMethod.objects.get(company=request.user.company, pk=mid) if mid else None

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        exp = self.get_object()
        method = self._method(request)
        pay = {"method": method, "reference": request.data.get("reference", "")} if method and request.user.has_code("expense.pay") else None
        exp = services.submit_expense(user=request.user, expense=exp, pay=pay)
        exp.refresh_from_db()
        return Response(self.get_serializer(exp).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return Response(self.get_serializer(services.approve_expense(user=request.user, expense=self.get_object(), comment=request.data.get("comment", ""))).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return Response(self.get_serializer(services.reject_expense(user=request.user, expense=self.get_object(), reason=request.data.get("reason", ""))).data)

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        method = self._method(request)
        if not method:
            raise BusinessError("Choisissez un moyen de paiement.", code="METHOD_REQUIRED")
        exp = services.pay_expense(user=request.user, expense=self.get_object(), method=method, reference=request.data.get("reference", ""))
        return Response(self.get_serializer(exp).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return Response(self.get_serializer(services.cancel_expense(user=request.user, expense=self.get_object(), reason=request.data.get("reason", ""))).data)

    @action(detail=True, methods=["post"])
    def attachments(self, request, pk=None):
        """Justificatifs photo/PDF, empreinte SHA-256 → alerte doublon (EXP-003, RG-DEP-10)."""
        exp = self.get_object()
        if exp.status in ("cancelled", "rejected"):
            raise BusinessError("Impossible d'ajouter un justificatif à une dépense annulée.", code="EXPENSE_LOCKED")
        company = request.user.company
        out, warnings = [], []
        for f in request.FILES.getlist("files") or ([request.FILES["file"]] if "file" in request.FILES else []):
            data, mime, sha = read_upload(f, allow_pdf=True)
            base = f"company/{company.pk}/expenses/{exp.pk}"
            if mime == "application/pdf":
                path, thumb = store_raw(data, base, "pdf"), ""
            else:
                path, thumbs, _ = process_image(data, base)
                thumb = thumbs["200"]
            dup = ExpenseAttachment.objects.filter(company=company, sha256=sha).exclude(expense=exp).select_related("expense").first()
            if dup:
                warnings.append(f"Justificatif déjà utilisé sur la dépense {dup.expense.number or dup.expense.description} : doublon possible.")
            att = ExpenseAttachment.objects.create(company=company, expense=exp, file=path, thumb=thumb, mime=mime, sha256=sha,
                                                   size_bytes=len(data), created_by=request.user)
            out.append(att)
        audit(company, request.user, "ATTACH", "expense", exp, label=exp.number or exp.description, new={"files": len(out)})
        return Response({"data": ExpenseAttachmentSerializer(out, many=True).data, "warnings": warnings}, status=201)


class IncomeViewSet(CompanyViewSet):
    queryset = Income.objects.select_related("method", "created_by")
    serializer_class = IncomeSerializer
    required_perms = {"list": ["income.manage", "cash.view"], "retrieve": "income.manage", "*": "income.manage"}
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        d = request.data
        u = request.user
        method = PaymentMethod.objects.get(company=u.company, pk=d.get("method_id"))
        services._check_reference(method, d.get("reference", ""))
        amount = Decimal(str(d.get("amount") or 0))
        if amount <= 0 or len((d.get("description") or "").strip()) < 3:
            raise BusinessError("Montant positif et description obligatoires.", code="INVALID_INCOME")
        account, session = services.resolve_account(u, method)
        with transaction.atomic():
            inc = Income.objects.create(company=u.company, number=next_number(u.company, "income"), category=d.get("category") or "Divers",
                                        amount=amount, method=method, account=account, session=session if method.type == "cash" else None,
                                        reference=d.get("reference", ""), description=d["description"],
                                        income_date=d.get("income_date") or timezone.localdate(), created_by=u)
            services.cash_movement(u.company, account=account, session=inc.session, method=method, direction="in", amount=amount,
                                   category="income", label=f"{inc.category} — {inc.description}", source=inc, user=u)
            audit(u.company, u, "CREATE", "income", inc, label=inc.number, new={"amount": amount})
        return Response(self.get_serializer(inc).data, status=201)
