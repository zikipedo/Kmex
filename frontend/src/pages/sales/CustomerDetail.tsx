import { useQueryClient } from '@tanstack/react-query'
import { HandCoins, MessageCircle, Pencil, Phone } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CountUp } from '@/components/charts'
import { PaymentForm } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { DataTable } from '@/components/table'
import { Avatar, Badge, Button, Card, CardHeader, Skeleton, StatusBadge, Tabs } from '@/components/ui'
import { newIdempotencyKey, post } from '@/lib/api'
import { date, money, num } from '@/lib/format'
import { showError, useApi, useList } from '@/lib/hooks'
import { useCan } from '@/store/auth'
import { CustomerForm } from './Customers'

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const can = useCan()
  const [tab, setTab] = useState<'statement' | 'sales'>('statement')
  const [edit, setEdit] = useState(false)
  const [pay, setPay] = useState(false)
  const [loading, setLoading] = useState(false)
  const { data: c } = useApi<any>(['customer', id], `/customers/${id}`)
  const { data: st } = useApi<any>(['customer-statement', id], `/customers/${id}/statement`)
  const { data: sales, isLoading: salesLoading } = useList<any>('sales', '/sales', { customer: id, limit: 50 })
  if (!c) return <Page><Skeleton className="h-80 rounded-3xl" /></Page>
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['customer', id] })
    qc.invalidateQueries({ queryKey: ['customer-statement', id] })
    qc.invalidateQueries({ queryKey: ['sales'] })
  }
  const outstanding = num(st?.outstanding)
  const used = num(c.credit_limit) ? Math.min(100, (Math.max(outstanding, 0) / num(c.credit_limit)) * 100) : 0
  return (
    <Page>
      <PageHeader
        crumbs={[{ label: 'Clients', to: '/customers' }, { label: c.name }]}
        title={c.name.split(' ')[0]}
        accent={c.name.split(' ').slice(1).join(' ') || undefined}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} /> {c.code} · {c.type_label}</span>}
        actions={
          <>
            {c.whatsapp && (
              <Button variant="soft" icon={<MessageCircle size={16} />} onClick={() => window.open(`https://wa.me/${c.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Bonjour ${c.name}, votre solde chez nous est de ${money(outstanding)}. Merci !`)}`, '_blank')}>
                Relance WhatsApp
              </Button>
            )}
            {can('customer.manage') && <Button variant="soft" icon={<Pencil size={16} />} onClick={() => setEdit(true)}>Modifier</Button>}
            {can('sales.payment') && outstanding > 0 && <Button variant="gradient" icon={<HandCoins size={16} />} onClick={() => setPay(true)}>Encaisser un règlement</Button>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card glow className="p-6 lg:col-span-2">
          <div className="flex items-center gap-4">
            <Avatar name={c.name} size={56} />
            <div className="min-w-0">
              <div className="text-lg font-semibold">{c.name}</div>
              <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
                {c.phone && <span className="flex items-center gap-1"><Phone size={13} /> {c.phone}</span>}
                {c.email && <span>{c.email}</span>}
                {c.address && <span>{c.address}</span>}
              </div>
            </div>
          </div>
          <div className="mt-6">
            <div className="flex justify-between text-[12.5px] text-muted">
              <span>Utilisation du crédit</span>
              <span className="num">{money(Math.max(outstanding, 0))} / {num(c.credit_limit) ? money(c.credit_limit) : 'aucun crédit'}</span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-line/10">
              <div className="h-full rounded-full bg-gradient-brand transition-all duration-700" style={{ width: `${used}%` }} />
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <div className="label text-[10px]">Encours</div>
          <CountUp value={Math.max(outstanding, 0)} className={`mt-2 block font-display text-3xl font-bold ${outstanding > 0 ? 'text-warn' : ''}`} />
          {num(st?.credit_available) > 0 && <Badge tone="green" className="mt-2">Crédit disponible {money(st.credit_available)}</Badge>}
        </Card>
        <Card className="p-6">
          <div className="label text-[10px]">Total des achats</div>
          <CountUp value={num(c.total_sales)} className="mt-2 block font-display text-3xl font-bold" />
          <div className="mt-1 text-[12.5px] text-muted">{c.sales_count} achat(s) · dernier {c.last_purchase ? date(c.last_purchase) : '—'}</div>
        </Card>
      </div>
      {st?.aging && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[['0 – 30 jours', st.aging['0_30']], ['31 – 60 jours', st.aging['31_60']], ['61 – 90 jours', st.aging['61_90']], ['+ 90 jours', st.aging['90_plus']]].map(([l, v]) => (
            <Card key={l} className="p-4">
              <div className="text-[12px] text-muted">{l}</div>
              <div className={`num mt-1 text-lg font-semibold ${num(v) > 0 ? 'text-fg' : 'text-muted'}`}>{money(v)}</div>
            </Card>
          ))}
        </div>
      )}
      <div className="mb-4 mt-8">
        <Tabs value={tab} onChange={setTab} tabs={[{ key: 'statement', label: 'Relevé de compte' }, { key: 'sales', label: 'Factures', count: sales?.meta.total }]} />
      </div>
      {tab === 'statement' ? (
        <Card className="overflow-hidden">
          <CardHeader title="Grand livre client" subtitle="Débits (factures), crédits (paiements, avoirs) et solde progressif" />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr className="border-y hairline">
                  {['Date', 'Opération', 'N°', 'Débit', 'Crédit', 'Solde'].map((h, i) => (
                    <th key={h} className={`label px-5 py-2.5 ${i >= 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(st?.rows || []).slice().reverse().map((r: any, i: number) => (
                  <tr key={i} onClick={() => r.link && navigate(r.link)} className={`table-row border-b hairline last:border-0 ${r.link ? 'cursor-pointer' : ''}`}>
                    <td className="px-5 py-3 text-muted">{date(r.date, true)}</td>
                    <td className="px-5">{r.type}</td>
                    <td className="px-5 font-medium">{r.number}</td>
                    <td className="num px-5 text-right">{num(r.debit) ? money(r.debit) : ''}</td>
                    <td className="num px-5 text-right text-mint">{num(r.credit) ? money(r.credit) : ''}</td>
                    <td className="num px-5 text-right font-semibold">{money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <DataTable
          loading={salesLoading}
          rows={sales?.data}
          onRowClick={(r) => navigate(`/sales/${r.id}`)}
          columns={[
            { key: 'number', header: 'N°', render: (r) => <span className="font-semibold">{r.number}</span> },
            { key: 'date', header: 'Date', render: (r) => date(r.issue_date) },
            { key: 'due', header: 'Échéance', render: (r) => (r.due_date ? date(r.due_date) : '—') },
            { key: 'status', header: 'Statut', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="num">{money(r.total)}</span> },
            { key: 'balance', header: 'Reste', align: 'right', render: (r) => <span className="num font-semibold">{num(r.balance) > 0 ? money(r.balance) : '—'}</span> },
          ]}
        />
      )}
      <CustomerForm open={edit} onClose={() => setEdit(false)} initial={c} onSaved={refresh} />
      <PaymentForm
        open={pay}
        onClose={() => setPay(false)}
        title="Règlement client"
        subtitle="Affecté automatiquement aux factures les plus anciennes (FIFO)."
        max={outstanding}
        loading={loading}
        onSubmit={async (v) => {
          setLoading(true)
          try {
            await post('/payments', { ...v, customer_id: id }, newIdempotencyKey())
            toast.success('Règlement enregistré')
            setPay(false)
            refresh()
          } catch (e) {
            showError(e)
          } finally {
            setLoading(false)
          }
        }}
      />
    </Page>
  )
}
