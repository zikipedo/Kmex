import { useQueryClient } from '@tanstack/react-query'
import { HandCoins, Pencil, ShoppingCart } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PaymentForm } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { Avatar, Badge, Button, Card, CardHeader, Skeleton } from '@/components/ui'
import { newIdempotencyKey, post } from '@/lib/api'
import { date, money, num } from '@/lib/format'
import { showError, useApi, useList } from '@/lib/hooks'
import { useCan } from '@/store/auth'
import { SupplierForm } from './Suppliers'

export default function SupplierDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const can = useCan()
  const [edit, setEdit] = useState(false)
  const [pay, setPay] = useState(false)
  const [loading, setLoading] = useState(false)
  const { data: s } = useApi<any>(['supplier', id], `/suppliers/${id}`)
  const { data: st } = useApi<any[]>(['supplier-statement', id], `/suppliers/${id}/statement`)
  const { data: inv } = useList<any>('purchase-invoices', '/purchase-invoices', { supplier: id, limit: 50 })
  if (!s) return <Page><Skeleton className="h-80 rounded-3xl" /></Page>
  const refresh = () => ['supplier', 'supplier-statement'].forEach((k) => qc.invalidateQueries({ queryKey: [k, id] }))
  return (
    <Page>
      <PageHeader
        crumbs={[{ label: 'Fournisseurs', to: '/suppliers' }, { label: s.name }]}
        title={s.name}
        subtitle={`${s.code} · ${s.contact_name || ''} ${s.phone || ''}`}
        actions={
          <>
            {can('supplier.manage') && <Button variant="soft" icon={<Pencil size={16} />} onClick={() => setEdit(true)}>Modifier</Button>}
            {can('purchase.order') && <Button variant="soft" icon={<ShoppingCart size={16} />} onClick={() => navigate('/purchases/orders/new')}>Commander</Button>}
            {can('purchase.pay') && num(s.balance) > 0 && <Button variant="gradient" icon={<HandCoins size={16} />} onClick={() => setPay(true)}>Payer</Button>}
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Card glow className="flex items-center gap-4 p-6">
          <Avatar name={s.name} size={52} />
          <div>
            <div className="font-semibold">{s.name}</div>
            <div className="text-[12.5px] text-muted">Paiement à {s.payment_terms_days} j · livraison {s.lead_time_days} j</div>
          </div>
        </Card>
        <Card className="p-6"><div className="label text-[10px]">Dette en cours</div><div className={`num mt-2 font-display text-3xl font-bold ${num(s.balance) > 0 ? 'text-warn' : ''}`}>{money(s.balance)}</div></Card>
        <Card className="p-6"><div className="label text-[10px]">Total acheté</div><div className="num mt-2 font-display text-3xl font-bold">{money(s.total_purchased)}</div></Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Factures" />
          <div className="space-y-2 p-5 pt-3">
            {(inv?.data || []).map((i: any) => (
              <div key={i.id} className="flex items-center justify-between rounded-2xl border hairline px-4 py-3 text-[13px]">
                <div>
                  <div className="font-semibold">{i.number} <span className="font-normal text-muted">{i.supplier_ref}</span></div>
                  <div className="text-[12px] text-muted">Échéance {date(i.due_date)}</div>
                </div>
                <div className="text-right">
                  <div className="num font-semibold">{money(i.total)}</div>
                  {num(i.balance) > 0 ? <Badge tone={i.is_overdue ? 'red' : 'amber'}>Reste {money(i.balance)}</Badge> : <Badge tone="green">Payée</Badge>}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Relevé du compte fournisseur" />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="border-y hairline">{['Date', 'Opération', 'Débit', 'Crédit', 'Solde'].map((h, i) => <th key={h} className={`label px-4 py-2.5 ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
              <tbody>
                {(st || []).slice().reverse().map((r, i) => (
                  <tr key={i} className="border-b hairline last:border-0">
                    <td className="px-4 py-2.5 text-muted">{date(r.date)}</td>
                    <td className="px-4">{r.type} <span className="text-muted">{r.number}</span></td>
                    <td className="num px-4 text-right text-mint">{num(r.debit) ? money(r.debit) : ''}</td>
                    <td className="num px-4 text-right">{num(r.credit) ? money(r.credit) : ''}</td>
                    <td className="num px-4 text-right font-semibold">{money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <SupplierForm open={edit} onClose={() => setEdit(false)} initial={s} onSaved={refresh} />
      <PaymentForm
        open={pay}
        onClose={() => setPay(false)}
        title="Paiement fournisseur"
        subtitle="Affecté aux factures par ordre d'échéance."
        max={num(s.balance)}
        loading={loading}
        onSubmit={async (v) => {
          setLoading(true)
          try {
            await post(`/suppliers/${id}/pay`, v, newIdempotencyKey())
            toast.success('Paiement enregistré')
            setPay(false)
            refresh()
            qc.invalidateQueries({ queryKey: ['purchase-invoices'] })
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
