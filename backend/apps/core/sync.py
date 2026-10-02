"""Synchronisation des opérations hors-ligne (§24.2, §24.3, SYNC-001/002, T-OFF-01).

Principes : les opérations sont des commandes rejouées une seule fois par (appareil, op_id) ; les données
financières et de stock ne sont jamais écrasées, les conflits sont tracés et résolus par des mouvements correctifs.
"""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.catalog.models import Category, Product
from apps.catalog.serializers import ProductSerializer
from apps.core.exceptions import BusinessError
from apps.core.permissions import require
from apps.core.services import _client_ip, audit, notify, users_with_perm

from .sync_models import SyncDevice, SyncOperation

MAX_OPS = 200
CLOCK_SKEW_MINUTES = 5


def _device(request, device_id, name=""):
    if not device_id or len(device_id) > 64:
        raise BusinessError("Identifiant d'appareil invalide.", code="DEVICE_INVALID", status_code=400)
    dev, created = SyncDevice.objects.get_or_create(
        company=request.user.company, device_id=device_id,
        defaults={"name": name or "Appareil", "user": request.user, "user_agent": request.META.get("HTTP_USER_AGENT", "")[:300]},
    )
    if dev.revoked_at:
        raise BusinessError("Cet appareil a été révoqué par l'administrateur : reconnectez-vous depuis un appareil autorisé.",
                            code="DEVICE_REVOKED", status_code=403)
    if created:
        audit(request.user.company, request.user, "DEVICE_REGISTER", "sync_device", dev, label=dev.name,
              new={"device_id": device_id, "ip": _client_ip(request)})
    return dev


def _price_warnings(company, items):
    out = []
    ids = [i.get("product_id") for i in items]
    current = {str(p.pk): p for p in Product.objects.filter(company=company, pk__in=ids)}
    for it in items:
        p = current.get(str(it.get("product_id")))
        if p and it.get("unit_price") not in (None, "") and float(it["unit_price"]) != float(p.price_for(1)):
            out.append(f"Prix de « {p.name} » modifié entre-temps : vendu {float(it['unit_price']):.0f}, prix actuel {float(p.price_for(1)):.0f}.")
        if p and p.status != "active":
            out.append(f"« {p.name} » a été archivé/désactivé pendant la coupure : vente conservée.")
    return out


def run_operation(op: SyncOperation, user):
    """Exécute une opération ; met à jour statut/résultat. Idempotent via la clé de vente."""
    from apps.sales.services import create_sale

    if op.type != "sale":
        op.status, op.conflict_reason = "rejected", f"Type d'opération non pris en charge hors-ligne : {op.type}"
        return op
    payload = dict(op.payload)
    offline = {
        "register_session_id": payload.pop("register_session_id", None),
        "provisional_number": payload.pop("provisional_number", ""),
        "created_at_local": op.created_at_local,
    }
    payload.pop("user_id", None)
    # Si la vente a été tentée en ligne avant la coupure, on réutilise sa clé : aucun doublon possible.
    key = payload.pop("idempotency_key", None) or f"sync:{op.device.device_id}:{op.op_id}"
    payload["type"] = "pos"
    warnings = _price_warnings(user.company, payload.get("items") or [])
    try:
        with transaction.atomic():
            sale = create_sale(user=user, data=payload, idempotency_key=key, offline=offline)
    except BusinessError as exc:
        op.status = "conflict"
        op.conflict_reason = str(exc.detail)[:300]
        op.result = {"code": exc.code}
        return op
    warnings += getattr(sale, "_warnings", [])
    op.status = "done"
    op.conflict_reason = ""
    op.warnings = warnings
    op.result = {
        "sale_id": str(sale.pk), "number": sale.number, "total": str(sale.total), "status": sale.status,
        "provisional_number": offline["provisional_number"],
    }
    if warnings:
        transaction.on_commit(lambda: notify(
            user.company, users_with_perm(user.company, "stock.adjust.approve"), "sync_warning",
            f"Synchronisation {sale.number} : {len(warnings)} point(s) à vérifier", " · ".join(warnings)[:500],
            "/sync", "warning", f"sync:{op.pk}",
        ))
    return op


@api_view(["POST"])
def push(request):
    """Reçoit la file d'opérations d'un appareil. Rejouer la même file ne crée rien deux fois."""
    require(request.user, "sales.create")
    d = request.data
    ops = d.get("operations") or []
    if len(ops) > MAX_OPS:
        raise BusinessError(f"Lot trop volumineux (max {MAX_OPS} opérations).", code="BATCH_TOO_LARGE", status_code=400)
    device = _device(request, d.get("device_id"), d.get("device_name", ""))
    skew_warning = None
    device_time = parse_datetime(d.get("device_time") or "")
    if device_time and abs((timezone.now() - device_time).total_seconds()) > CLOCK_SKEW_MINUTES * 60:
        skew_warning = "Horloge de l'appareil décalée : l'horodatage serveur fait foi."

    results = []
    for raw in sorted(ops, key=lambda o: o.get("created_at_local") or ""):
        op_id = str(raw.get("op_id") or "")[:64]
        if not op_id:
            continue
        existing = SyncOperation.objects.filter(device=device, op_id=op_id).first()
        if existing and existing.status == "done":
            results.append(_out(existing))  # rejeu : on renvoie le même résultat
            continue
        payload = raw.get("payload") or {}
        if str(payload.get("user_id") or request.user.pk) != str(request.user.pk):
            raise BusinessError("Ces opérations appartiennent à un autre utilisateur.", code="SYNC_WRONG_USER", status_code=403)
        op = existing or SyncOperation(
            company=request.user.company, device=device, op_id=op_id, type=raw.get("type", "sale"), payload=payload,
            user=request.user, created_at_local=parse_datetime(raw.get("created_at_local") or "") or None, status="conflict",
        )
        if existing:
            op.attempts += 1
        run_operation(op, request.user)
        if skew_warning:
            op.warnings = [*op.warnings, skew_warning]
        op.save()
        results.append(_out(op))

    device.last_sync_at = timezone.now()
    device.user = request.user
    device.save(update_fields=["last_sync_at", "user"])
    done = sum(1 for r in results if r["status"] == "done")
    if results:
        audit(request.user.company, request.user, "SYNC", "sync_device", device, label=device.name,
              new={"received": len(results), "done": done, "conflicts": len(results) - done})
    return Response({"server_time": timezone.now(), "results": results})


def _out(op):
    return {"op_id": op.op_id, "status": op.status, "result": op.result, "conflict_reason": op.conflict_reason,
            "warnings": op.warnings}


@api_view(["GET"])
def pull(request):
    """Données de référence pour le cache local (catalogue, clients, moyens de paiement), incrémental par curseur."""
    require(request.user, "catalog.view")
    since = parse_datetime(request.query_params.get("since") or "")
    wh = request.query_params.get("warehouse")
    from apps.catalog.views import ProductViewSet
    from apps.finance.models import PaymentMethod
    from apps.sales.models import Customer

    view = ProductViewSet()
    view.request = request
    view.format_kwarg = None
    view.action = "pull"
    qs = view.get_queryset().filter(company=request.user.company)
    if since:
        qs = qs.filter(updated_at__gte=since - timedelta(seconds=5))
    customers = Customer.objects.filter(company=request.user.company).exclude(status="archived")
    if since:
        customers = customers.filter(updated_at__gte=since - timedelta(seconds=5))
    ctx = {"request": request, "company": request.user.company}
    return Response({
        "server_time": timezone.now(),
        "full": since is None,
        "warehouse": wh,
        "products": ProductSerializer(qs[:5000], many=True, context=ctx).data,
        "customers": [{"id": str(c.pk), "name": c.name, "phone": c.phone, "code": c.code, "status": c.status,
                       "credit_limit": str(c.credit_limit), "is_walkin": c.is_walkin, "type": c.type} for c in customers[:5000]],
        "payment_methods": [{"id": str(m.pk), "code": m.code, "name": m.name, "type": m.type, "requires_reference": m.requires_reference,
                             "color": m.color, "is_active": m.is_active} for m in PaymentMethod.objects.filter(company=request.user.company)],
        "categories": [{"id": str(c.pk), "name": c.name, "color": c.color, "icon": c.icon, "is_active": c.is_active,
                        "products_count": c.products.exclude(status="archived").count()} for c in Category.objects.filter(company=request.user.company)],
    })


class OperationSerializer(serializers.ModelSerializer):
    device_name = serializers.CharField(source="device.name", read_only=True)
    user_name = serializers.CharField(source="user.full_name", read_only=True, default="")
    total = serializers.SerializerMethodField()

    class Meta:
        model = SyncOperation
        fields = ["id", "op_id", "type", "status", "result", "conflict_reason", "warnings", "device_name", "user_name",
                  "created_at_local", "received_at", "updated_at", "attempts", "total"]

    def get_total(self, obj):
        items = (obj.payload or {}).get("items") or []
        return obj.payload.get("expected_total") or sum(float(i.get("unit_price") or 0) * float(i.get("quantity") or 0) for i in items)


@api_view(["GET"])
def operations(request):
    """Tableau « État de synchronisation » (§24.4) : opérations reçues, conflits à traiter."""
    qs = SyncOperation.objects.filter(company=request.user.company).select_related("device", "user")
    if not request.user.has_code("cash.session.validate"):
        qs = qs.filter(user=request.user)
    status_ = request.query_params.get("status")
    if status_:
        qs = qs.filter(status=status_)
    return Response({
        "data": OperationSerializer(qs[:200], many=True).data,
        "counts": {s: SyncOperation.objects.filter(company=request.user.company, status=s).count() for s, _ in SyncOperation.STATUSES},
    })


@api_view(["POST"])
def retry(request, pk):
    """Relance d'une opération en conflit (ex. après réouverture de caisse)."""
    op = SyncOperation.objects.select_related("device", "user").get(company=request.user.company, pk=pk)
    if op.user_id != request.user.pk:
        require(request.user, "cash.session.validate")
    if op.status == "done":
        return Response(_out(op))
    op.attempts += 1
    run_operation(op, op.user or request.user)
    op.save()
    audit(request.user.company, request.user, "SYNC_RETRY", "sync_operation", entity_id=str(op.pk), label=op.op_id,
          new={"status": op.status, "reason": op.conflict_reason})
    return Response(_out(op))


@api_view(["GET"])
def devices(request):
    require(request.user, "users.manage")
    rows = SyncDevice.objects.filter(company=request.user.company).select_related("user")
    return Response([
        {"id": str(d.pk), "device_id": d.device_id, "name": d.name, "user": d.user.full_name if d.user else "",
         "last_sync_at": d.last_sync_at, "revoked_at": d.revoked_at, "user_agent": d.user_agent,
         "operations": d.operations.count(), "conflicts": d.operations.filter(status="conflict").count()}
        for d in rows
    ])


@api_view(["POST"])
def revoke_device(request, pk):
    require(request.user, "users.manage")
    d = SyncDevice.objects.get(company=request.user.company, pk=pk)
    d.revoked_at = None if d.revoked_at else timezone.now()
    d.save(update_fields=["revoked_at"])
    audit(request.user.company, request.user, "DEVICE_REVOKE" if d.revoked_at else "DEVICE_RESTORE", "sync_device", d, label=d.name)
    return Response({"revoked_at": d.revoked_at})
