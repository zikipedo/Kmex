import { useAuth } from '@/store/auth'

const nf = (d: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })

export function money(value: unknown, opts: { symbol?: boolean; compact?: boolean } = {}) {
  const c = useAuth.getState().me?.company
  const d = c?.currency_decimals ?? 0
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '—'
  let s: string
  if (opts.compact && Math.abs(n) >= 1_000_000) s = `${nf(1).format(n / 1_000_000)} M`
  else if (opts.compact && Math.abs(n) >= 10_000) s = `${nf(0).format(n / 1000)} k`
  else s = nf(d).format(n)
  s = s.replace(/ | /g, ' ')
  return opts.symbol === false ? s : `${s} ${c?.currency_symbol ?? 'F CFA'}`
}

export function qty(value: unknown) {
  const n = Number(value ?? 0)
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n).replace(/ | /g, ' ')
}

export function num(value: unknown) {
  return Number(value ?? 0)
}

export function date(value?: string | null, withTime = false) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('fr-FR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' })
}

export function time(value?: string | null) {
  if (!value) return ''
  return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function relative(value?: string | null) {
  if (!value) return ''
  const diff = (Date.now() - new Date(value).getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
  if (diff < 60) return 'à l’instant'
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute')
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour')
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day')
  return date(value)
}

export function pct(v: unknown, digits = 1) {
  if (v === null || v === undefined) return '—'
  return `${Number(v).toFixed(digits).replace('.', ',')} %`
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

export function todayISO(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}
