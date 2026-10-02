import { useQueryClient } from '@tanstack/react-query'
import { HandCoins } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PaymentForm } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { DataTable, FilterChips } from '@/components/table'
import { Badge, Button, StatusBadge } from '@/components/ui'
import { newIdempotencyKey, post } from '@/lib/api'
import { date, money } from '@/lib/format'
import { showError, useDebounced, useList } from '@/lib/hooks'
import { useCan } from '@/store/auth'

export default function PurchaseInvoices() {
  const can = useCan()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pay, setPay] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const { data, isLoading } = useList<any>('purchase-invoices', '/purchase-invoices', { search: useDebounced(search), status, page })
  return (
    <Page>
      <PageHeader title="Factures" accent="fournisseurs" subtitle="Dettes créées à la validation de la facture, échéancier et paiements partiels ou groupés." />
      <DataTable
        loading={isLoading}
        rows={data?.data}
        search={search}
        onSearch={setSearch}
        toolbar={<FilterChips value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: '', label: 'Toutes' }, { value: 'unpaid', label: 'Impayées' }, { value: 'partial', label: 'Partielles' }, { value: 'paid', label: 'Payées' }]} />}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <div><div className="font-semibold">{r.number}</div><div className="text-[11.5px] text-muted">{r.supplier_ref}</div></div> },
          { key: 'supplier', header: 'Fournisseur', render: (r) => r.supplier_name },
          { key: 'due', header: 'Échéance', render: (r) => (r.is_overdue ? <Badge tone="red">Échue {date(r.due_date)}</Badge> : <span className="text-muted">{date(r.due_date)}</span>) },
          { key: 'status', header: 'Statut', render: (r) => <StatusBadge status={r.status} label={r.status_label} /> },
          { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="num">{money(r.total)}</span> },
          { key: 'balance', header: 'Reste dû', align: 'right', render: (r) => <span className="num font-semibold">{Number(r.balance) > 0 ? money(r.balance) : '—'}</span> },
          { key: 'disc', header: '', hideOnMobile: true, render: (r) => r.discrepancy ? <Badge tone="amber">Écart</Badge> : null },
          { key: 'act', header: '', align: 'right', render: (r) => can('purchase.pay') && Number(r.balance) > 0 && <Button size="sm" variant="soft" icon={<HandCoins size={14} />} onClick={(e) => { e.stopPropagation(); setPay(r) }}>Payer</Button> },
        ]}
      />
      <PaymentForm
        open={!!pay}
        onClose={() => setPay(null)}
        title="Paiement fournisseur"
        subtitle={pay && `${pay.number} · ${pay.supplier_name}`}
        max={pay ? Number(pay.balance) : undefined}
        loading={loading}
        onSubmit={async (v) => {
          setLoading(true)
          try {
            await post(`/purchase-invoices/${pay.id}/pay`, v, newIdempotencyKey())
            toast.success('Paiement enregistré')
            setPay(null)
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
