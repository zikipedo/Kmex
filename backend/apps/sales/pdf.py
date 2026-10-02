"""Génération PDF côté serveur : facture A4 et ticket 80 mm (§8.4, §17), empreinte SHA-256."""
import hashlib
import io
from decimal import Decimal

from django.utils import timezone
from num2words import num2words
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

INK = colors.HexColor("#0b0b12")
MUTED = colors.HexColor("#6b6b80")
ACCENT = colors.HexColor("#8b5cf6")
PINK = colors.HexColor("#ec4899")
LINE = colors.HexColor("#e7e5ef")


def fmt(value, company):
    d = int(company.currency_decimals)
    v = Decimal(value or 0)
    s = f"{v:,.{d}f}".replace(",", " ").replace(".", ",")
    return f"{s} {company.currency_symbol}"


def qfmt(v):
    v = Decimal(v).normalize()
    return f"{v:f}".replace(".", ",")


def words(value, company):
    try:
        txt = num2words(int(Decimal(value)), lang="fr")
    except Exception:  # pragma: no cover
        txt = str(value)
    return f"{txt[:1].upper()}{txt[1:]} {company.currency_symbol}"


def _status_stamp(sale, duplicate):
    if sale.status == "cancelled":
        return "ANNULÉE", colors.HexColor("#ef4444")
    if duplicate:
        return "DUPLICATA", MUTED
    if sale.status == "paid":
        return "PAYÉE", colors.HexColor("#10b981")
    return None, None


def invoice_a4(sale, duplicate=False):
    company = sale.company
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    title = "FACTURE" if sale.type == "invoice" else "TICKET DE CAISSE"
    c.setTitle(f"{title} {sale.number}")

    # Bandeau dégradé
    steps = 60
    for i in range(steps):
        t = i / steps
        r = 0.55 + (0.93 - 0.55) * t
        g = 0.36 + (0.28 - 0.36) * t
        b = 0.96 + (0.60 - 0.96) * t
        c.setFillColorRGB(r, g, b)
        c.rect(i * W / steps, H - 8 * mm, W / steps + 1, 8 * mm, stroke=0, fill=1)

    y = H - 22 * mm
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(18 * mm, y, company.name)
    c.setFont("Helvetica", 8.5)
    c.setFillColor(MUTED)
    info = [company.legal_name, f"{company.address} {company.city}".strip(), " · ".join(filter(None, [company.phone, company.email])),
            " · ".join(f"{k} : {v}" for k, v in (company.legal_ids or {}).items())]
    for i, line in enumerate(filter(None, info)):
        c.drawString(18 * mm, y - (5 + i * 4) * mm, line)

    c.setFillColor(ACCENT)
    c.setFont("Helvetica-Bold", 22)
    c.drawRightString(W - 18 * mm, y, title)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(W - 18 * mm, y - 7 * mm, sale.number)
    c.setFont("Helvetica", 8.5)
    c.setFillColor(MUTED)
    c.drawRightString(W - 18 * mm, y - 12 * mm, f"Émise le {sale.issue_date:%d/%m/%Y}")
    if sale.due_date:
        c.drawRightString(W - 18 * mm, y - 16 * mm, f"Échéance {sale.due_date:%d/%m/%Y}")
    c.drawRightString(W - 18 * mm, y - 20 * mm, f"{sale.warehouse.name} · Vendeur : {sale.seller.full_name if sale.seller else '-'}")

    # Client
    y -= 34 * mm
    c.setFillColor(colors.HexColor("#f6f4fb"))
    c.roundRect(18 * mm, y - 18 * mm, 85 * mm, 22 * mm, 3 * mm, stroke=0, fill=1)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7.5)
    c.drawString(22 * mm, y, "FACTURÉ À")
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(22 * mm, y - 5 * mm, sale.customer.name[:48])
    c.setFont("Helvetica", 8.5)
    cust = [sale.customer.address, sale.customer.phone, sale.customer.tax_id and f"NIF : {sale.customer.tax_id}"]
    for i, line in enumerate(filter(None, cust)):
        c.drawString(22 * mm, y - (10 + i * 4) * mm, str(line)[:60])

    # Lignes
    y -= 28 * mm
    cols = [18, 100, 126, 150, 163, 189]
    c.setFillColor(INK)
    c.roundRect(18 * mm, y - 2 * mm, W - 36 * mm, 8 * mm, 2 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 8)
    heads = ["Désignation", "Qté", "P.U.", "Remise", "TVA", "Total"]
    for i, h in enumerate(heads):
        if i == 0:
            c.drawString((cols[0] + 3) * mm, y + 0.5 * mm, h)
        else:
            c.drawRightString(cols[i] * mm, y + 0.5 * mm, h)
    y -= 8 * mm
    c.setFont("Helvetica", 8.5)
    for it in sale.items.all():
        if y < 60 * mm:
            c.showPage()
            y = H - 20 * mm
            c.setFont("Helvetica", 8.5)
        c.setFillColor(INK)
        c.drawString((cols[0] + 3) * mm, y, it.description[:40])
        c.drawRightString(cols[1] * mm, y, qfmt(it.quantity))
        c.drawRightString(cols[2] * mm, y, fmt(it.unit_price, company))
        c.drawRightString(cols[3] * mm, y, fmt(it.discount_amount, company) if it.discount_amount else "—")
        c.drawRightString(cols[4] * mm, y, f"{qfmt(it.tax_rate)} %")
        c.drawRightString(cols[5] * mm, y, fmt(it.line_total, company))
        c.setStrokeColor(LINE)
        c.line(18 * mm, y - 2.5 * mm, W - 18 * mm, y - 2.5 * mm)
        y -= 7 * mm

    # Totaux
    y -= 4 * mm
    tx = W - 21 * mm
    lx = W - 85 * mm
    rows = [("Total HT", sale.subtotal), ("Remises", sale.discount_total), ("TVA", sale.tax_total)]
    c.setFont("Helvetica", 9)
    for label, val in rows:
        c.setFillColor(MUTED)
        c.drawString(lx, y, label)
        c.setFillColor(INK)
        c.drawRightString(tx, y, fmt(val, company))
        y -= 5.5 * mm
    y -= 3 * mm
    c.setFillColor(ACCENT)
    c.roundRect(lx - 3 * mm, y - 3.5 * mm, tx - lx + 6 * mm, 10 * mm, 2 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(lx, y - 0.5 * mm, "TOTAL TTC")
    c.drawRightString(tx, y - 0.5 * mm, fmt(sale.total, company))
    y -= 11 * mm
    c.setFont("Helvetica", 9)
    for label, val in (("Payé", sale.paid_amount), ("Avoirs", sale.credited_amount), ("Reste à payer", sale.balance)):
        if label == "Avoirs" and not val:
            continue
        c.setFillColor(MUTED)
        c.drawString(lx, y, label)
        c.setFillColor(INK if label != "Reste à payer" or sale.balance <= 0 else PINK)
        c.drawRightString(tx, y, fmt(val, company))
        y -= 5.5 * mm

    c.setFillColor(MUTED)
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(18 * mm, y + 10 * mm, f"Arrêtée à la somme de : {words(sale.total, company)}")

    # Pied
    c.setFont("Helvetica", 7.5)
    footer = [company.setting("invoice_footer"), company.setting("mobile_money_info")]
    for i, line in enumerate(filter(None, footer)):
        c.drawString(18 * mm, 22 * mm - i * 4 * mm, str(line)[:140])
    c.drawRightString(W - 18 * mm, 12 * mm, f"Généré par StockPro le {timezone.localtime():%d/%m/%Y %H:%M}")

    stamp, color = _status_stamp(sale, duplicate)
    if stamp:
        c.saveState()
        c.setFillColor(color)
        c.setFillAlpha(0.18)
        c.setFont("Helvetica-Bold", 64)
        c.translate(W / 2, H / 2)
        c.rotate(30)
        c.drawCentredString(0, 0, stamp)
        c.restoreState()

    c.showPage()
    c.save()
    pdf = buf.getvalue()
    return pdf, hashlib.sha256(pdf).hexdigest()


def ticket_80mm(sale, duplicate=False, change=None):
    company = sale.company
    items = list(sale.items.all())
    width = 80 * mm
    height = (88 + 9 * len(items)) * mm
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    c.setTitle(f"Ticket {sale.number}")
    y = height - 10 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(width / 2, y, company.name)
    c.setFont("Helvetica", 7)
    for line in filter(None, [company.address, company.phone]):
        y -= 4 * mm
        c.drawCentredString(width / 2, y, line)
    y -= 6 * mm
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(width / 2, y, f"{sale.number}" + (" — DUPLICATA" if duplicate else ""))
    y -= 4 * mm
    c.setFont("Helvetica", 7)
    c.drawCentredString(width / 2, y, f"{timezone.localtime(sale.created_at):%d/%m/%Y %H:%M} · {sale.seller.full_name if sale.seller else ''}")
    y -= 3 * mm
    c.setDash(1, 2)
    c.line(4 * mm, y, width - 4 * mm, y)
    c.setDash()
    for it in items:
        y -= 4.5 * mm
        c.setFont("Helvetica", 7.5)
        c.drawString(4 * mm, y, it.description[:38])
        y -= 3.8 * mm
        c.setFillColor(MUTED)
        c.drawString(6 * mm, y, f"{qfmt(it.quantity)} x {fmt(it.unit_price, company)}" + (f"  (-{fmt(it.discount_amount, company)})" if it.discount_amount else ""))
        c.setFillColor(INK)
        c.drawRightString(width - 4 * mm, y, fmt(it.line_total, company))
    y -= 3 * mm
    c.setDash(1, 2)
    c.line(4 * mm, y, width - 4 * mm, y)
    c.setDash()
    y -= 6 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(4 * mm, y, "TOTAL")
    c.drawRightString(width - 4 * mm, y, fmt(sale.total, company))
    c.setFont("Helvetica", 7.5)
    y -= 4.5 * mm
    c.drawString(4 * mm, y, f"dont TVA : {fmt(sale.tax_total, company)}")
    for a in sale.allocations.select_related("payment__method"):
        y -= 4 * mm
        c.drawString(4 * mm, y, a.payment.method.name + (f" ({a.payment.reference})" if a.payment.reference else ""))
        c.drawRightString(width - 4 * mm, y, fmt(a.amount, company))
    if change:
        y -= 4 * mm
        c.drawString(4 * mm, y, "Rendu monnaie")
        c.drawRightString(width - 4 * mm, y, fmt(change, company))
    if sale.balance > 0:
        y -= 4 * mm
        c.setFont("Helvetica-Bold", 8)
        c.drawString(4 * mm, y, "Reste à payer")
        c.drawRightString(width - 4 * mm, y, fmt(sale.balance, company))
    y -= 8 * mm
    c.setFont("Helvetica-Oblique", 7.5)
    c.drawCentredString(width / 2, y, str(company.setting("receipt_footer") or ""))
    c.showPage()
    c.save()
    pdf = buf.getvalue()
    return pdf, hashlib.sha256(pdf).hexdigest()
