"""Services transverses : numérotation, audit chaîné, notifications, arrondis."""
import hashlib
import json
from decimal import ROUND_HALF_UP, Decimal

from django.db import connection, transaction
from django.utils import timezone

from .context import get_request
from .models import AuditLog, DocumentSequence, Notification

PREFIXES = {
    "invoice": "FAC",
    "pos": "TCK",
    "quote": "DEV",
    "credit_note": "AVO",
    "purchase_order": "BC",
    "purchase_receipt": "BR",
    "purchase_invoice": "FF",
    "payment_in": "REC",
    "payment_out": "DEC",
    "expense": "DEP",
    "income": "RCT",
    "adjustment": "AJU",
    "inventory": "INV",
    "transfer": "TRF",
    "z_report": "Z",
}

D0 = Decimal("0")


def money(value, decimals=0) -> Decimal:
    q = Decimal(1).scaleb(-int(decimals))
    return Decimal(value or 0).quantize(q, rounding=ROUND_HALF_UP)


def qty(value) -> Decimal:
    return Decimal(value or 0).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def next_number(company, doc_type: str) -> str:
    """Attribue le prochain numéro légal — doit être appelé dans une transaction (verrou de ligne)."""
    assert connection.in_atomic_block, "next_number doit être appelé dans transaction.atomic()"
    year = timezone.localdate().year
    seq, _ = DocumentSequence.objects.get_or_create(
        company=company, doc_type=doc_type, year=year, defaults={"prefix": PREFIXES.get(doc_type, doc_type[:3].upper())}
    )
    seq = DocumentSequence.objects.select_for_update().get(pk=seq.pk)
    value = seq.next_value
    seq.next_value = value + 1
    seq.save(update_fields=["next_value"])
    return f"{seq.prefix}-{year}-{value:06d}"


def next_code(company, doc_type: str, prefix: str, width=6) -> str:
    """Code lisible non annuel (produits, clients, fournisseurs) : PRD-000123."""
    with transaction.atomic():
        seq, _ = DocumentSequence.objects.get_or_create(
            company=company, doc_type=doc_type, year=0, defaults={"prefix": prefix}
        )
        seq = DocumentSequence.objects.select_for_update().get(pk=seq.pk)
        value = seq.next_value
        seq.next_value = value + 1
        seq.save(update_fields=["next_value"])
    return f"{prefix}-{value:0{width}d}"


def _client_ip(request):
    if not request:
        return None
    fwd = request.META.get("HTTP_X_FORWARDED_FOR")
    return (fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR")) or None


def _jsonable(data):
    if data is None:
        return None
    return json.loads(json.dumps(data, default=str))


def audit(company, user, action, entity_type, entity=None, *, entity_id="", label="", old=None, new=None, reason=""):
    """Écrit une entrée d'audit chaînée (hash = SHA-256(hash_prev + contenu))."""
    request = get_request()
    with transaction.atomic():
        # Verrou consultatif par entreprise : sérialise le chaînage.
        with connection.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [f"audit:{company.pk}"])
        prev = AuditLog.objects.filter(company=company).order_by("-id").values_list("hash", flat=True).first() or ""
        now = timezone.now()
        roles = ""
        if user is not None and getattr(user, "pk", None):
            roles = ", ".join(user.roles.values_list("name", flat=True))
        payload = {
            "company": str(company.pk),
            "user": str(getattr(user, "pk", "") or ""),
            "action": action,
            "entity_type": entity_type,
            "entity_id": str(entity_id or getattr(entity, "pk", "") or ""),
            "old": _jsonable(old),
            "new": _jsonable(new),
            "reason": reason,
            "at": now.isoformat(),
        }
        digest = hashlib.sha256((prev + json.dumps(payload, sort_keys=True)).encode()).hexdigest()
        return AuditLog.objects.create(
            company=company,
            user=user if getattr(user, "pk", None) else None,
            user_name=getattr(user, "full_name", "") or "Système",
            user_roles=roles,
            action=action,
            entity_type=entity_type,
            entity_id=payload["entity_id"],
            entity_label=label or (str(entity) if entity is not None else ""),
            old_values=payload["old"],
            new_values=payload["new"],
            reason=reason or "",
            ip=_client_ip(request),
            user_agent=(request.META.get("HTTP_USER_AGENT", "")[:300] if request else ""),
            request_id=getattr(request, "request_id", "") if request else "",
            hash_prev=prev,
            hash=digest,
            created_at=now,
        )


def verify_audit_chain(company):
    """Recalcule la chaîne et renvoie l'id de la première entrée corrompue (ou None)."""
    prev = ""
    for log in AuditLog.objects.filter(company=company).order_by("id").iterator():
        payload = {
            "company": str(company.pk),
            "user": str(log.user_id or ""),
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "old": log.old_values,
            "new": log.new_values,
            "reason": log.reason,
            "at": log.created_at.isoformat(),
        }
        digest = hashlib.sha256((prev + json.dumps(payload, sort_keys=True)).encode()).hexdigest()
        if log.hash_prev != prev or log.hash != digest:
            return log.id
        prev = log.hash
    return None


def notify(company, users, type_, title, body="", link="", level="info", dedupe_key=""):
    """Notification in-app, dédoublonnée sur les non-lues de même clé."""
    created = []
    for u in users:
        if dedupe_key and Notification.objects.filter(user=u, dedupe_key=dedupe_key, read_at__isnull=True).exists():
            continue
        created.append(
            Notification(company=company, user=u, type=type_, title=title, body=body, link=link, level=level, dedupe_key=dedupe_key)
        )
    Notification.objects.bulk_create(created)
    return created


def users_with_perm(company, code, warehouse=None):
    from apps.accounts.models import User

    qs = User.objects.filter(company=company, is_active=True).prefetch_related("roles__permissions")
    out = []
    for u in qs:
        if u.has_code(code) and (warehouse is None or u.can_access_warehouse(warehouse)):
            out.append(u)
    return out
