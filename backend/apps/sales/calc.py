"""Moteur de calcul de document (SALE-001) : remises ligne/globale, taxes, arrondis (§8.3)."""
from collections import defaultdict
from decimal import Decimal

from apps.core.services import money

D0 = Decimal("0")
HUNDRED = Decimal("100")


def _discount(base: Decimal, dtype: str, value) -> Decimal:
    value = Decimal(value or 0)
    if value <= 0 or base <= 0:
        return D0
    if dtype == "amount":
        return min(value, base)
    return min(base * value / HUNDRED, base)


def compute_document(lines, global_type="percent", global_value=0, prices_include_tax=True, decimals=0):
    """lines : [{quantity, unit_price, discount_type, discount_value, tax_rate}] → lignes calculées + totaux.

    Les prix saisis sont TTC si prices_include_tax, sinon HT. L'arrondi se fait à la ligne,
    puis les totaux sont la somme exacte des lignes (cohérence partout).
    """
    computed = []
    for ln in lines:
        q = Decimal(ln["quantity"])
        price = Decimal(ln["unit_price"])
        gross = q * price
        ldisc = _discount(gross, ln.get("discount_type", "percent"), ln.get("discount_value", 0))
        computed.append({**ln, "gross": gross, "line_discount": ldisc, "net": gross - ldisc})

    base = sum((c["net"] for c in computed), D0)
    gdisc = _discount(base, global_type, global_value)
    remaining = gdisc
    for idx, c in enumerate(computed):
        if idx == len(computed) - 1:
            share = remaining
        else:
            share = (gdisc * c["net"] / base) if base else D0
            remaining -= share
        c["global_share"] = share
        net_after = c["net"] - share
        rate = Decimal(c.get("tax_rate") or 0)
        if prices_include_tax:
            total = money(net_after, decimals)
            subtotal = money(total / (1 + rate / HUNDRED), decimals) if rate else total
            tax = total - subtotal
        else:
            subtotal = money(net_after, decimals)
            tax = money(subtotal * rate / HUNDRED, decimals)
            total = subtotal + tax
        c["line_subtotal"] = subtotal
        c["tax_amount"] = tax
        c["line_total"] = total
        c["discount_amount"] = c["line_discount"] + share

    tax_lines = defaultdict(lambda: {"base": D0, "amount": D0})
    for c in computed:
        key = str(Decimal(c.get("tax_rate") or 0).normalize())
        tax_lines[key]["base"] += c["line_subtotal"]
        tax_lines[key]["amount"] += c["tax_amount"]

    gross_total = sum((c["gross"] for c in computed), D0)
    discount_total = sum((c["discount_amount"] for c in computed), D0)
    totals = {
        "gross": gross_total,
        "discount_total": money(discount_total, decimals),
        "subtotal": sum((c["line_subtotal"] for c in computed), D0),
        "tax_total": sum((c["tax_amount"] for c in computed), D0),
        "total": sum((c["line_total"] for c in computed), D0),
        "tax_lines": [{"rate": k, "base": v["base"], "amount": v["amount"]} for k, v in sorted(tax_lines.items())],
        "max_line_discount_pct": max(
            [(c["discount_amount"] / c["gross"] * HUNDRED) if c["gross"] else D0 for c in computed] or [D0]
        ),
    }
    return computed, totals
