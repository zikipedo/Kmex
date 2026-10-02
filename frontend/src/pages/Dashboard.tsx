import { motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, Banknote, Boxes, CircleDollarSign, Clock, CreditCard, HandCoins, PackageX, Percent,
  Receipt, ScanLine, ShoppingBag, Sparkles, TrendingUp, Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarList, ChartTooltip, CountUp, Kpi } from '@/components/charts'
import { Page, stagger } from '@/components/page'
import { Badge, Button, Card, CardHeader, cx, EmptyState, Skeleton, StatusBadge, Tabs } from '@/components/ui'
import { money, num, relative, time } from '@/lib/format'
import { useApi } from '@/lib/hooks'
import { useAuth, useCan } from '@/store/auth'

type Period = 'today' | 'week' | 'month' | '30d' | 'year'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Bonjour' : h < 18 ? 'Bel après-midi' : 'Bonsoir'
}

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>('30d')
  const me = useAuth((s) => s.me)!
  const wh = useAuth((s) => s.warehouseId)
  const can = useCan()
  const navigate = useNavigate()
  const { data, isLoading } = useApi<any>(['dashboard'], '/dashboard', { period, warehouse: wh }, { refetchInterval: 60_000 })
  const k = data?.kpis || {}
  const first = me.user.full_name.split(' ')[0]
  const series = (data?.series || []).map((s: any) => ({ ...s, revenue: num(s.revenue), previous: num(s.previous), label: new Date(s.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) }))
  const pendingTotal = Object.values(data?.pending || {}).reduce((a: number, b: any) => a + Number(b), 0)

  return (
    <Page>
      {/* Hero */}
      <div className="mb-8 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4 inline-flex items-center gap-2 rounded-full border hairline bg-line/[0.04] px-3 py-1 text-[12px] text-fg/75">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
            </span>
            {me.company.name} · données en temps réel
          </motion.div>
          <h1 className="display text-[clamp(2.4rem,5vw,4.4rem)]">
            {greeting()}, <span className="accent-serif text-gradient">{first}</span>
          </h1>
          <p className="mt-3 text-[15px] text-muted">
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} — voici le pouls de votre activité.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={period}
            onChange={setPeriod}
            tabs={[
              { key: 'today', label: "Aujourd'hui" },
              { key: 'week', label: 'Semaine' },
              { key: 'month', label: 'Mois' },
              { key: '30d', label: '30 j' },
              { key: 'year', label: 'Année' },
            ]}
          />
          {can('sales.create') && (
            <Button variant="gradient" icon={<ScanLine size={16} />} onClick={() => navigate('/pos')}>
              Ouvrir le POS
            </Button>
          )}
        </div>
      </div>

      {/* Session caisse / approbations */}
      {(data?.session || pendingTotal > 0) && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {data?.session && (
            <Card glow className="relative overflow-hidden p-5">
              <div className="pointer-events-none absolute -left-10 -top-16 h-40 w-40 rounded-full bg-mint/30 blur-3xl" />
              <div className="relative flex items-center justify-between gap-4">
                <div>
                  <div className="label text-[10px]">Ma caisse · {data.session.register}</div>
                  <div className="mt-1 text-[13px] text-muted">Ouverte {relative(data.session.opened_at)}</div>
                </div>
                <Button size="sm" variant="soft" onClick={() => navigate(`/cash/sessions/${data.session.id}`)} iconRight={<ArrowRight size={14} />}>
                  Détails
                </Button>
              </div>
              <div className="relative mt-4 grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[11.5px] text-muted">Ventes</div>
                  <div className="num font-display text-2xl font-bold">{data.session.sales_count}</div>
                </div>
                <div>
                  <div className="text-[11.5px] text-muted">Total encaissé</div>
                  <div className="num font-display text-2xl font-bold">{money(data.session.sales_total, { compact: true, symbol: false })}</div>
                </div>
                <div>
                  <div className="text-[11.5px] text-muted">Espèces théoriques</div>
                  <div className="num font-display text-2xl font-bold text-mint">{money(data.session.expected?.cash || 0, { compact: true, symbol: false })}</div>
                </div>
              </div>
            </Card>
          )}
          {pendingTotal > 0 && (
            <Card className="relative overflow-hidden p-5">
              <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-warn/25 blur-3xl" />
              <div className="relative flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-warn/15 text-warn">
                  <Clock size={18} />
                </div>
                <div>
                  <div className="font-semibold">{pendingTotal} élément{pendingTotal > 1 ? 's' : ''} à valider</div>
                  <div className="text-[12.5px] text-muted">Vos validations débloquent l'équipe.</div>
                </div>
              </div>
              <div className="relative mt-4 flex flex-wrap gap-2">
                {data.pending.expenses > 0 && <Button size="sm" variant="soft" onClick={() => navigate('/expenses?status=pending')}>{data.pending.expenses} dépense(s)</Button>}
                {data.pending.adjustments > 0 && <Button size="sm" variant="soft" onClick={() => navigate('/stock/adjustments')}>{data.pending.adjustments} ajustement(s)</Button>}
                {data.pending.sessions > 0 && <Button size="sm" variant="soft" onClick={() => navigate('/cash')}>{data.pending.sessions} clôture(s) de caisse</Button>}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* KPI */}
      <motion.div variants={stagger.container} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading && !data
          ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[150px] rounded-3xl" />)
          : [
              <Kpi key="ca" label="Chiffre d'affaires" value={num(k.revenue)} delta={k.revenue_change} icon={<TrendingUp size={17} />} tint="#f472b6" sub={<span>TTC</span>} onClick={() => navigate('/reports/sales-by-day')} />,
              <Kpi key="n" label="Ventes" value={num(k.sales_count)} delta={k.sales_count_change} icon={<ShoppingBag size={17} />} tint="#a78bfa" format={(v) => Math.round(v).toLocaleString('fr-FR')} onClick={() => navigate('/sales')} />,
              <Kpi key="pm" label="Panier moyen" value={num(k.avg_basket)} delta={k.avg_basket_change} icon={<Receipt size={17} />} tint="#7dd3fc" />,
              k.net_profit !== undefined ? (
                <Kpi key="np" label="Bénéfice net estimé" value={num(k.net_profit)} icon={<Sparkles size={17} />} tint="#fdba8c" sub={<span>Marge {money(k.gross_margin, { compact: true })} − dépenses</span>} onClick={() => navigate('/reports/profit')} />
              ) : (
                <Kpi key="ex" label="Dépenses" value={num(k.expenses)} icon={<Wallet size={17} />} tint="#fdba8c" />
              ),
              k.gross_margin !== undefined && <Kpi key="gm" label="Marge brute" value={num(k.gross_margin)} delta={k.gross_margin_change} icon={<Percent size={17} />} tint="#6ee7b7" sub={<span>{k.margin_rate ?? '—'} % du CA HT</span>} />,
              k.stock_value !== undefined && <Kpi key="sv" label="Valeur du stock" value={num(k.stock_value)} icon={<Boxes size={17} />} tint="#818cf8" sub={<span>{k.products_active} produits actifs</span>} onClick={() => navigate('/reports/stock-valuation')} />,
              k.receivables !== undefined && <Kpi key="rc" label="Créances clients" value={num(k.receivables)} icon={<HandCoins size={17} />} tint="#fb7185" sub={<span className={cx(num(k.receivables_overdue) > 0 && 'text-danger')}>dont {money(k.receivables_overdue, { compact: true })} échus</span>} onClick={() => navigate('/reports/receivables')} />,
              <Kpi key="oos" label="Ruptures / stock faible" value={num(k.out_of_stock)} icon={<PackageX size={17} />} tint="#fbbf24" format={(v) => Math.round(v).toString()} sub={<span>+ {k.low_stock} sous le minimum</span>} onClick={() => navigate('/stock?state=low')} />,
            ]
              .filter(Boolean)
              .map((el, i) => (
                <motion.div key={i} variants={stagger.item}>
                  {el}
                </motion.div>
              ))}
      </motion.div>

      {/* Graphiques */}
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Évolution du chiffre d'affaires"
            subtitle="Période courante comparée à la précédente"
            action={
              <div className="flex items-center gap-4 text-[12px] text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose" /> Actuel
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-line/30" /> Précédent
                </span>
              </div>
            }
          />
          <div className="h-[300px] px-2 pb-4 pt-4">
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ left: 0, right: 12, top: 8 }}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f472b6" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gLine" x1="0" x2="1">
                    <stop offset="0%" stopColor="#fdba8c" />
                    <stop offset="50%" stopColor="#f472b6" />
                    <stop offset="100%" stopColor="#a78bfa" />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgb(var(--line) / 0.06)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={56} tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }} tickFormatter={(v) => money(v, { compact: true, symbol: false })} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgb(var(--line) / 0.15)' }} />
                <Area type="monotone" dataKey="previous" name="Période précédente" stroke="rgb(var(--line) / 0.25)" strokeDasharray="4 4" fill="transparent" strokeWidth={1.5} />
                <Area type="monotone" dataKey="revenue" name="Chiffre d'affaires" stroke="url(#gLine)" fill="url(#gRev)" strokeWidth={3} animationDuration={1400} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Ventes par catégorie" subtitle="Répartition du CA TTC" />
          <div className="relative h-[220px]">
            {data?.by_category?.length ? (
              <>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={data.by_category.map((c: any) => ({ ...c, value: num(c.value) }))} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3} stroke="none" animationDuration={1200}>
                      {data.by_category.map((c: any) => (
                        <Cell key={c.name} fill={c.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                  <div>
                    <div className="label text-[9.5px]">Total</div>
                    <CountUp value={num(k.revenue)} format={(v) => money(v, { compact: true, symbol: false })} className="font-display text-xl font-bold" />
                  </div>
                </div>
              </>
            ) : (
              <EmptyState title="Pas encore de ventes" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-6 pb-6">
            {data?.by_category?.slice(0, 6).map((c: any) => (
              <div key={c.name} className="flex items-center gap-2 text-[12px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                <span className="truncate text-fg/80">{c.name}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader title="Top produits" subtitle="Par chiffre d'affaires" icon={<Sparkles size={16} />} />
          <div className="p-6 pt-5">
            <BarList items={(data?.top_products || []).slice(0, 7).map((p: any) => ({ name: p.name, value: num(p.value), id: p.id }))} onClick={(i) => navigate(`/products/${i.id}`)} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Moyens de paiement" subtitle="Encaissements de la période" icon={<CreditCard size={16} />} />
          <div className="p-6 pt-5">
            <BarList items={(data?.payment_methods || []).map((p: any) => ({ name: `${p.name} · ${p.count}`, value: num(p.value), color: p.color }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Dépenses" subtitle={`${money(k.expenses)} sur la période`} icon={<Banknote size={16} />} action={<Button size="sm" variant="ghost" onClick={() => navigate('/expenses')}>Voir</Button>} />
          <div className="p-6 pt-5">
            {data?.expenses_by_category?.length ? <BarList items={data.expenses_by_category.map((e: any) => ({ name: e.name, value: num(e.value), color: e.color }))} /> : <div className="py-8 text-center text-[13px] text-muted">Aucune dépense payée.</div>}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Dernières ventes" action={<Button size="sm" variant="ghost" onClick={() => navigate('/sales')} iconRight={<ArrowRight size={14} />}>Tout voir</Button>} />
          <div className="divide-y divide-[var(--glass-border)] px-3 pb-3 pt-2">
            {(data?.recent_sales || []).map((s: any) => (
              <button key={s.id} onClick={() => navigate(`/sales/${s.id}`)} className="flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-left transition hover:bg-line/[0.04]">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-line/[0.06]">
                  <Receipt size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{s.number}</div>
                  <div className="truncate text-[12px] text-muted">
                    {s.customer__name} · {time(s.created_at)}
                  </div>
                </div>
                <StatusBadge status={s.status} />
                <div className="num w-32 text-right font-semibold">{money(s.total)}</div>
              </button>
            ))}
            {!data?.recent_sales?.length && <div className="py-10 text-center text-[13px] text-muted">Aucune vente sur la période.</div>}
          </div>
        </Card>
        <div className="space-y-4">
          {data?.treasury?.length > 0 && (
            <Card>
              <CardHeader title="Trésorerie" subtitle="Soldes en temps réel" icon={<CircleDollarSign size={16} />} />
              <div className="space-y-1 p-4 pt-3">
                {data.treasury.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between rounded-2xl px-3 py-2 text-[13px] hover:bg-line/[0.04]">
                    <span className="text-fg/80">{t.name}</span>
                    <span className="num font-semibold">{money(t.balance)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {data?.aging && (
            <Card>
              <CardHeader title="Âge des créances" icon={<AlertTriangle size={16} />} />
              <div className="grid grid-cols-4 gap-2 p-5 pt-4">
                {[
                  ['0-30 j', data.aging['0_30'], '#6ee7b7'],
                  ['31-60', data.aging['31_60'], '#fbbf24'],
                  ['61-90', data.aging['61_90'], '#fb923c'],
                  ['+90', data.aging['90_plus'], '#fb7185'],
                ].map(([l, v, c]) => (
                  <div key={l as string} className="rounded-2xl border hairline p-2.5 text-center">
                    <div className="mx-auto mb-1.5 h-1 w-6 rounded-full" style={{ background: c as string }} />
                    <div className="num text-[13px] font-semibold">{money(v, { compact: true, symbol: false })}</div>
                    <div className="text-[10.5px] text-muted">{l}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
      {data?.updated_at && <p className="mt-6 text-center text-[11.5px] text-muted/70">Dernière mise à jour {relative(data.updated_at)}</p>}
      {k.discounts && num(k.discounts) > 0 && (
        <div className="mt-2 text-center">
          <Badge tone="gray">Remises accordées sur la période : {money(k.discounts)}</Badge>
        </div>
      )}
    </Page>
  )
}
