/** Aperçu client du moteur de calcul (miroir de apps/sales/calc.py — le serveur reste la référence). */
export type CalcLine = { quantity: number; unit_price: number; discount_type: 'percent' | 'amount'; discount_value: number; tax_rate: number }

const round = (v: number, d: number) => {
  const f = 10 ** d
  return Math.round((v + Number.EPSILON) * f) / f
}

function disc(base: number, type: string, value: number) {
  if (!value || value <= 0 || base <= 0) return 0
  return type === 'amount' ? Math.min(value, base) : Math.min((base * value) / 100, base)
}

export function computeDocument(lines: CalcLine[], gType: 'percent' | 'amount', gValue: number, ttc = true, decimals = 0) {
  const c = lines.map((l) => {
    const gross = l.quantity * l.unit_price
    const ld = disc(gross, l.discount_type, l.discount_value)
    return { ...l, gross, ld, net: gross - ld }
  })
  const base = c.reduce((a, x) => a + x.net, 0)
  const gd = disc(base, gType, gValue)
  let remaining = gd
  const out = c.map((x, i) => {
    let share = 0
    if (i === c.length - 1) share = remaining
    else {
      share = base ? (gd * x.net) / base : 0
      remaining -= share
    }
    const after = x.net - share
    let total: number, sub: number, tax: number
    if (ttc) {
      total = round(after, decimals)
      sub = x.tax_rate ? round(total / (1 + x.tax_rate / 100), decimals) : total
      tax = total - sub
    } else {
      sub = round(after, decimals)
      tax = round((sub * x.tax_rate) / 100, decimals)
      total = sub + tax
    }
    return { ...x, share, line_total: total, line_subtotal: sub, tax_amount: tax, discount_amount: x.ld + share }
  })
  const gross = out.reduce((a, x) => a + x.gross, 0)
  const discount = out.reduce((a, x) => a + x.discount_amount, 0)
  return {
    lines: out,
    gross,
    discount,
    subtotal: out.reduce((a, x) => a + x.line_subtotal, 0),
    tax: out.reduce((a, x) => a + x.tax_amount, 0),
    total: out.reduce((a, x) => a + x.line_total, 0),
    maxDiscountPct: Math.max(0, ...out.map((x) => (x.gross ? (x.discount_amount / x.gross) * 100 : 0)), gross ? (discount / gross) * 100 : 0),
  }
}
