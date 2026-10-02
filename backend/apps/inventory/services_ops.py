"""Ajustements (double validation), inventaires (snapshot → comptage → validation) et transferts."""
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.catalog.models import Product
from apps.core.exceptions import BusinessError
from apps.core.services import audit, next_number, notify, users_with_perm

from .models import Inventory, InventoryItem, StockAdjustment, StockAdjustmentItem, StockLevel, StockTransfer, StockTransferItem
from .services import move_stock

D0 = Decimal("0")


def _apply_adjustment(user, adj):
    for it in adj.items.select_related("product").order_by("product_id"):
        move_stock(
            company=adj.company, product=it.product, warehouse=adj.warehouse, quantity=it.qty_diff,
            movement_type="adjustment_in" if it.qty_diff > 0 else "adjustment_out", user=user,
            document_type="adjustment", document_id=adj.pk, document_number=adj.number, reason=adj.reason,
            allow_negative=False,
        )
    adj.status = "applied"


def create_adjustment(*, user, warehouse, reason, lines, note="", inventory=None):
    """STOCK-004 : au-delà du seuil de valeur, en attente d'approbation par un autre utilisateur."""
    company = user.company
    if not reason:
        raise BusinessError("Le motif est obligatoire.", code="REASON_REQUIRED")
    with transaction.atomic():
        adj = StockAdjustment.objects.create(
            company=company, number=next_number(company, "adjustment"), warehouse=warehouse, reason=reason, note=note,
            inventory=inventory, created_by=user,
        )
        total = D0
        products = {str(p.pk): p for p in Product.objects.filter(company=company, pk__in=[l["product_id"] for l in lines])}
        for raw in lines:
            p = products[str(raw["product_id"])]
            diff = Decimal(str(raw["qty_diff"]))
            if diff == 0:
                continue
            lvl = StockLevel.objects.filter(product=p, warehouse=warehouse).first()
            cost = lvl.avg_cost if lvl and lvl.avg_cost else p.cost_avg
            StockAdjustmentItem.objects.create(adjustment=adj, product=p, qty_diff=diff, unit_cost=cost)
            total += abs(diff) * cost
        if not adj.items.exists():
            raise BusinessError("Aucune ligne d'ajustement.", code="EMPTY_ADJUSTMENT")
        adj.total_value = total
        threshold = Decimal(str(company.setting("adjustment_approval_threshold")))
        if total > threshold and inventory is None:
            adj.status = "pending"
            adj.save()
            audit(company, user, "CREATE", "adjustment", adj, label=adj.number, new={"value": total, "status": "pending"}, reason=reason)
            approvers = [u for u in users_with_perm(company, "stock.adjust.approve") if u.pk != user.pk]
            transaction.on_commit(lambda: notify(company, approvers, "adjustment_approval", f"Ajustement à valider : {adj.number}",
                                                 f"Valeur {total:.0f} — {reason}", "/stock/adjustments", "warning"))
            return adj
        _apply_adjustment(user, adj)
        adj.approved_by = user
        adj.approved_at = timezone.now()
        adj.save()
        audit(company, user, "VALIDATE", "adjustment", adj, label=adj.number, new={"value": total}, reason=reason)
    return adj


def approve_adjustment(*, user, adj):
    if adj.status != "pending":
        raise BusinessError("Cet ajustement n'est pas en attente.", code="INVALID_STATUS")
    if adj.created_by_id == user.pk:
        raise BusinessError("Séparation des tâches : vous ne pouvez pas approuver votre propre ajustement.", code="SELF_APPROVAL", status_code=403)
    with transaction.atomic():
        _apply_adjustment(user, adj)
        adj.approved_by = user
        adj.approved_at = timezone.now()
        adj.save()
        audit(adj.company, user, "APPROVE", "adjustment", adj, label=adj.number, new={"value": adj.total_value})
    return adj


def reject_adjustment(*, user, adj, reason):
    if adj.status != "pending":
        raise BusinessError("Cet ajustement n'est pas en attente.", code="INVALID_STATUS")
    adj.status = "rejected"
    adj.note = (adj.note + "\nRejet : " + reason).strip()
    adj.save()
    audit(adj.company, user, "REJECT", "adjustment", adj, label=adj.number, reason=reason)
    return adj


def start_inventory(*, user, warehouse, category=None, blind_mode=True, note=""):
    company = user.company
    if Inventory.objects.filter(company=company, warehouse=warehouse, status="counting").exists():
        raise BusinessError("Un inventaire est déjà en cours sur ce dépôt.", code="INVENTORY_IN_PROGRESS", status_code=409)
    with transaction.atomic():
        inv = Inventory.objects.create(
            company=company, number=next_number(company, "inventory"), warehouse=warehouse, category=category,
            blind_mode=blind_mode, note=note, created_by=user,
        )
        products = Product.objects.filter(company=company, status="active", track_stock=True)
        if category:
            products = products.filter(category=category)
        levels = {l.product_id: l for l in StockLevel.objects.filter(warehouse=warehouse)}
        InventoryItem.objects.bulk_create([
            InventoryItem(
                inventory=inv, product=p, qty_theoretical=levels[p.pk].on_hand if p.pk in levels else D0,
                unit_cost=(levels[p.pk].avg_cost if p.pk in levels else p.cost_avg) or p.cost_avg,
            )
            for p in products
        ])
        audit(company, user, "CREATE", "inventory", inv, label=inv.number, new={"items": inv.items.count()})
    return inv


def count_items(*, user, inv, counts):
    if inv.status != "counting":
        raise BusinessError("Inventaire verrouillé : comptage impossible.", code="INVENTORY_LOCKED")
    now = timezone.now()
    with transaction.atomic():
        for c in counts:
            item = inv.items.filter(product_id=c["product_id"]).first()
            if not item:
                raise BusinessError("Produit hors périmètre de l'inventaire.", code="OUT_OF_SCOPE")
            value = c.get("qty_counted")
            if c.get("increment"):
                item.qty_counted = (item.qty_counted or D0) + Decimal(str(c["increment"]))
            else:
                item.qty_counted = None if value in (None, "") else Decimal(str(value))
            item.counted_by = user
            item.counted_at = now
            item.save()
    return inv


def validate_inventory(*, user, inv):
    """INV-001 : écarts → ajustements liés ; inventaire verrouillé ; double validation au-delà du seuil."""
    if inv.status != "counting":
        raise BusinessError("Cet inventaire n'est plus en cours.", code="INVENTORY_LOCKED")
    company = inv.company
    lines = []
    value = D0
    for it in inv.items.all():
        if it.qty_counted is None:
            continue
        diff = it.qty_counted - it.qty_theoretical
        if diff != 0:
            lines.append({"product_id": it.product_id, "qty_diff": diff})
            value += abs(diff) * it.unit_cost
    threshold = Decimal(str(company.setting("adjustment_approval_threshold")))
    if value > threshold and inv.created_by_id == user.pk:
        raise BusinessError(
            f"Écarts valorisés à {value:.0f} : la validation doit être faite par un autre responsable (double validation).",
            code="DOUBLE_VALIDATION_REQUIRED", status_code=403,
        )
    with transaction.atomic():
        if lines:
            create_adjustment(user=user, warehouse=inv.warehouse, reason=f"Écarts d'inventaire {inv.number}", lines=lines, inventory=inv)
        inv.status = "validated"
        inv.validated_by = user
        inv.validated_at = timezone.now()
        inv.save()
        audit(company, user, "VALIDATE", "inventory", inv, label=inv.number, new={"lines_adjusted": len(lines), "value": value})
    return inv


def create_transfer(*, user, from_wh, to_wh, lines, note=""):
    if from_wh == to_wh:
        raise BusinessError("Les dépôts source et destination doivent être différents.", code="SAME_WAREHOUSE")
    company = user.company
    with transaction.atomic():
        tr = StockTransfer.objects.create(company=company, number=next_number(company, "transfer"), from_warehouse=from_wh,
                                          to_warehouse=to_wh, note=note, created_by=user)
        products = {str(p.pk): p for p in Product.objects.filter(company=company, pk__in=[l["product_id"] for l in lines])}
        for raw in lines:
            q = Decimal(str(raw["quantity"]))
            if q > 0:
                StockTransferItem.objects.create(transfer=tr, product=products[str(raw["product_id"])], qty_requested=q)
        audit(company, user, "CREATE", "transfer", tr, label=tr.number)
    return tr


def ship_transfer(*, user, tr, lines=None):
    if tr.status != "requested":
        raise BusinessError("Ce transfert ne peut plus être expédié.", code="INVALID_STATUS")
    shipped = {str(l["item_id"]): Decimal(str(l["quantity"])) for l in (lines or [])}
    with transaction.atomic():
        for it in tr.items.select_related("product").order_by("product_id"):
            q = shipped.get(str(it.pk), it.qty_requested)
            if q <= 0:
                continue
            mv = move_stock(company=tr.company, product=it.product, warehouse=tr.from_warehouse, quantity=-q,
                            movement_type="transfer_out", user=user, document_type="transfer", document_id=tr.pk,
                            document_number=tr.number, allow_negative=False)
            it.qty_shipped = q
            it.unit_cost = mv.cogs_unit if mv else it.product.cost_avg
            it.save()
        tr.status = "in_transit"
        tr.shipped_by = user
        tr.shipped_at = timezone.now()
        tr.save()
        audit(tr.company, user, "SHIP", "transfer", tr, label=tr.number)
    return tr


def receive_transfer(*, user, tr, lines=None):
    """WH-002 : entrée au dépôt destination au coût d'origine ; écart conservé à régulariser."""
    if tr.status != "in_transit":
        raise BusinessError("Ce transfert n'est pas en transit.", code="INVALID_STATUS")
    received = {str(l["item_id"]): Decimal(str(l["quantity"])) for l in (lines or [])}
    gap = False
    with transaction.atomic():
        for it in tr.items.select_related("product").order_by("product_id"):
            q = received.get(str(it.pk), it.qty_shipped)
            if q > it.qty_shipped:
                raise BusinessError("Quantité reçue supérieure à la quantité expédiée.", code="OVER_RECEPTION")
            if q > 0:
                move_stock(company=tr.company, product=it.product, warehouse=tr.to_warehouse, quantity=q,
                           movement_type="transfer_in", user=user, unit_cost=it.unit_cost, document_type="transfer",
                           document_id=tr.pk, document_number=tr.number)
            it.qty_received = q
            it.save()
            gap = gap or q != it.qty_shipped
        tr.status = "partially_received" if gap else "received"
        tr.received_by = user
        tr.received_at = timezone.now()
        tr.save()
        audit(tr.company, user, "RECEIVE", "transfer", tr, label=tr.number, new={"gap": gap})
    if gap:
        notify(tr.company, users_with_perm(tr.company, "stock.adjust.approve"), "transfer_gap",
               f"Écart sur transfert {tr.number}", "Des quantités manquent à la réception.", "/stock/transfers", "warning")
    return tr
