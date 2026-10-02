"""Moteur de mouvements de stock atomiques (STOCK-001, CMUP STOCK-007, concurrence STOCK-010)."""
from decimal import Decimal

from django.db import transaction
from django.db.models import F, Sum

from apps.core.exceptions import BusinessError
from apps.core.services import notify, qty, users_with_perm

from .models import IN_TYPES, StockLevel, StockMovement

COSTED_ENTRIES = {"purchase_receipt", "transfer_in", "initial"}
D0 = Decimal("0")


def lock_level(company, product, warehouse) -> StockLevel:
    level, _ = StockLevel.objects.get_or_create(company=company, product=product, warehouse=warehouse)
    return StockLevel.objects.select_for_update().get(pk=level.pk)


def move_stock(
    *, company, product, warehouse, quantity, movement_type, user, unit_cost=None, document_type="",
    document_id="", document_number="", reason="", note="", allow_negative=None,
):
    """Crée un mouvement immuable et met à jour le niveau dans la même transaction.

    quantity est signée (positive = entrée, négative = sortie).
    """
    if not product.track_stock:
        return None
    quantity = qty(quantity)
    if quantity == 0:
        return None
    is_entry = movement_type in IN_TYPES
    if is_entry != (quantity > 0):
        raise BusinessError("Sens du mouvement incohérent.", code="MOVEMENT_DIRECTION")

    with transaction.atomic():
        level = lock_level(company, product, warehouse)
        before = level.on_hand
        after = before + quantity
        if quantity < 0 and after < 0:
            permitted = allow_negative
            if permitted is None:
                permitted = warehouse.allow_negative_stock and user is not None and user.has_code("stock.negative.allow")
            if not permitted:
                available = max(before - level.reserved, D0)
                raise BusinessError(
                    f"Stock insuffisant pour « {product.name} » : disponible {available.normalize():f}, demandé {(-quantity).normalize():f}.",
                    code="STOCK_INSUFFICIENT",
                    extra={"product_id": str(product.pk), "available": str(available)},
                )

        movement_cost = level.avg_cost
        if is_entry and unit_cost is not None and movement_type in COSTED_ENTRIES:
            unit_cost = Decimal(unit_cost)
            base = max(before, D0)
            if base + quantity > 0:
                level.avg_cost = ((base * level.avg_cost) + (quantity * unit_cost)) / (base + quantity)
            movement_cost = unit_cost
        elif is_entry and level.avg_cost == 0 and product.cost_avg:
            level.avg_cost = product.cost_avg
            movement_cost = product.cost_avg

        level.on_hand = after
        level.version = F("version") + 1
        level.save(update_fields=["on_hand", "avg_cost", "version", "updated_at"])

        movement = StockMovement.objects.create(
            company=company, product=product, warehouse=warehouse, movement_type=movement_type, quantity=quantity,
            qty_before=before, qty_after=after, unit_cost=movement_cost, reason=reason[:200], note=note,
            document_type=document_type, document_id=str(document_id or ""), document_number=document_number,
            user=user,
        )

        if is_entry and movement_type in COSTED_ENTRIES:
            _refresh_product_cost(product, last_cost=unit_cost if movement_type == "purchase_receipt" else None)

        _stock_alerts(company, product, warehouse, before, after)
        movement.cogs_unit = movement_cost
        return movement


def _refresh_product_cost(product, last_cost=None):
    """CMUP global du produit = moyenne des CMUP par dépôt pondérée par les quantités."""
    agg = StockLevel.objects.filter(product=product, on_hand__gt=0).aggregate(
        q=Sum("on_hand"), v=Sum(F("on_hand") * F("avg_cost"))
    )
    fields = []
    if agg["q"]:
        product.cost_avg = agg["v"] / agg["q"]
        fields.append("cost_avg")
    if last_cost is not None:
        product.cost_last = last_cost
        fields.append("cost_last")
    if fields:
        type(product).objects.filter(pk=product.pk).update(**{f: getattr(product, f) for f in fields})


def _stock_alerts(company, product, warehouse, before, after):
    threshold = Decimal(str(product.min_stock or 0))
    def link():
        return f"/products/{product.pk}"
    if after <= 0 < before:
        transaction.on_commit(lambda: notify(
            company, users_with_perm(company, "stock.adjust"), "out_of_stock", f"Rupture : {product.name}",
            f"Plus aucun stock disponible au dépôt {warehouse.name}.", link(), "danger", f"oos:{product.pk}:{warehouse.pk}",
        ))
    elif threshold > 0 and after <= threshold < before:
        transaction.on_commit(lambda: notify(
            company, users_with_perm(company, "stock.adjust"), "low_stock", f"Stock faible : {product.name}",
            f"Il reste {after.normalize():f} au dépôt {warehouse.name} (minimum {threshold.normalize():f}).", link(), "warning",
            f"low:{product.pk}:{warehouse.pk}",
        ))


def stock_of(product, warehouse) -> Decimal:
    lvl = StockLevel.objects.filter(product=product, warehouse=warehouse).first()
    return lvl.on_hand if lvl else D0


def integrity_check(company):
    """STOCK-008 : stock_levels.on_hand doit égaler la somme des mouvements."""
    anomalies = []
    sums = {
        (r["product_id"], r["warehouse_id"]): r["s"]
        for r in StockMovement.objects.filter(company=company).values("product_id", "warehouse_id").annotate(s=Sum("quantity"))
    }
    for lvl in StockLevel.objects.filter(company=company).select_related("product", "warehouse"):
        expected = sums.get((lvl.product_id, lvl.warehouse_id), D0)
        if expected != lvl.on_hand:
            anomalies.append({"product": lvl.product.name, "warehouse": lvl.warehouse.name, "level": str(lvl.on_hand), "movements": str(expected)})
    return anomalies
