import { motion } from 'framer-motion'
import { BarChart3, Boxes, FileSpreadsheet, FileText, Landmark, ShieldCheck, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DateRange } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { DataTable } from '@/components/table'
import { Button, Card, cx, Tabs } from '@/components/ui'
import { download } from '@/lib/api'
import { date, money, pct, qty } from '@/lib/format'
import { showError, useApi } from '@/lib/hooks'
import { useAuth, useCan } from '@/store/auth'

const GROUPS: { label: string; icon: any; keys: string[] }[] = [
  { label: 'Ventes', icon: BarChart3, keys: ['sales-by-day', 'sales-by-product', 'sales-by-category', 'sales-by-seller', 'sales-by-customer', 'sales-journal'] },
  { label: 'Stock', icon: Boxes, keys: ['stock-valuation', 'low-stock', 'movements', 'dormant'] },
  { label: 'Finances', icon: Landmark, keys: ['profit', 'payments', 'receivables', 'payables', 'cash-sessions', 'taxes'] },
  { label: 'Dépenses', icon: Wallet, keys: ['expenses-by-category', 'expenses-journal'] },
  { label: 'Utilisateurs', icon: ShieldCheck, keys: ['user-activity'] },
]

type Period = 'today' | 'week' | 'month' | '30d' | 'year' | 'custom'

function fmt(type: string, v: any) {
  if (v === null || v === undefined || v === '') return '—'
  if (type === 'money') return money(v)
  if (type === 'qty' || type === 'int') return qty(v)
  if (type === 'pct') return pct(v)
  if (type === 'date') return date(v)
  if (type === 'datetime') return date(v, true)
  return String(v)
}

export default function Reports() {
  const { name } = useParams()
  const navigate = useNavigate()
  const can = useCan()
  const wh = useAuth((s) => s.warehouseId)
  const [period, setPeriod] = useState<Period>('30d')
  const [range, setRange] = useState({ from: '', to: '' })
  const { data: list } = useApi<any[]>(['report-list'], '/reports')
  const available = new Set((list || []).map((r) => r.key))
  const titles = Object.fromEntries((list || []).map((r) => [r.key, r.title]))
  const params = period === 'custom' ? { date_from: range.from, date_to: range.to } : { period }
  const { data, isLoading } = useApi<any>(['report', name], name ? `/reports/${name}` : null, params)

  if (!name) {
    return (
      <Page>
        <PageHeader title="Rapports" accent="& analyses" subtitle="Filtrables, imprimables et exportables en Excel ou CSV. Les colonnes sensibles (coûts, marges) sont masquées selon vos droits." />
        <div className="space-y-8">
          {GROUPS.map((g) => {
            const keys = g.keys.filter((k) => available.has(k))
            if (!keys.length) return null
            return (
              <section key={g.label}>
                <div className="label mb-3 flex items-center gap-2"><g.icon size={14} /> {g.label}</div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {keys.map((k, i) => (
                    <motion.button key={k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} whileHover={{ y: -3 }} onClick={() => navigate(`/reports/${k}`)} className="card group relative overflow-hidden p-5 text-left">
                      <div className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-gradient-brand opacity-0 blur-2xl transition duration-500 group-hover:opacity-40" />
                      <FileText size={18} className="text-accent" />
                      <div className="mt-3 font-semibold">{titles[k]}</div>
                      <div className="mt-1 text-[12px] text-muted">Ouvrir le rapport →</div>
                    </motion.button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </Page>
    )
  }

  const exp = async (format: 'csv' | 'xlsx') => {
    try {
      await download(`/reports/${name}`, { ...params, warehouse: wh, export: format }, `rapport.${format}`)
    } catch (e) {
      showError(e)
    }
  }

  const cols = (data?.columns || []).map((c: any) => ({
    key: c.key,
    header: c.label,
    align: ['money', 'qty', 'int', 'pct'].includes(c.type) ? ('right' as const) : undefined,
    render: (r: any) => <span className={cx(['money', 'qty', 'int', 'pct'].includes(c.type) && 'num', c.key === 'label' && 'font-medium')}>{fmt(c.type, r[c.key])}</span>,
  }))
  const totals = data?.totals || {}
  const footer =
    data && Object.keys(totals).length > 0 && data.rows.length > 0 ? (
      <div className="flex flex-wrap gap-x-8 gap-y-2 border-t hairline bg-line/[0.03] px-5 py-3 text-[13px]">
        <span className="label">Totaux</span>
        {data.columns.filter((c: any) => totals[c.key] !== undefined).map((c: any) => (
          <span key={c.key}><span className="text-muted">{c.label} : </span><span className="num font-semibold">{fmt(c.type, totals[c.key])}</span></span>
        ))}
      </div>
    ) : null

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: 'Rapports', to: '/reports' }, { label: titles[name] || name }]}
        title={titles[name] || 'Rapport'}
        subtitle={data && `Du ${date(data.period.start)} au ${date(data.period.end)} · ${data.rows.length} ligne(s)`}
        actions={
          (can('export') || can('expense.export')) && (
            <>
              <Button variant="soft" icon={<FileText size={16} />} onClick={() => exp('csv')}>CSV</Button>
              <Button variant="gradient" icon={<FileSpreadsheet size={16} />} onClick={() => exp('xlsx')}>Excel</Button>
            </>
          )
        }
      />
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
        <Tabs value={period} onChange={setPeriod} tabs={[{ key: 'today', label: "Aujourd'hui" }, { key: 'week', label: 'Semaine' }, { key: 'month', label: 'Mois' }, { key: '30d', label: '30 j' }, { key: 'year', label: 'Année' }, { key: 'custom', label: 'Personnalisée' }]} />
        {period === 'custom' && <DateRange from={range.from} to={range.to} onChange={(f, t) => setRange({ from: f, to: t })} />}
      </Card>
      <DataTable loading={isLoading} rows={(data?.rows || []).map((r: any, i: number) => ({ id: i, ...r }))} columns={cols} footer={footer} dense />
    </Page>
  )
}
