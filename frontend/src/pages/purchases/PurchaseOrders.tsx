import { ShoppingCart, Zap } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Page, PageHeader } from '@/components/page'
import { DataTable, FilterChips } from '@/components/table'
import { Button, StatusBadge } from '@/components/ui'
import { date, money } from '@/lib/format'
import { useDebounced, useList } from '@/lib/hooks'
import { useCan } from '@/store/auth'

export default function PurchaseOrders() {
  const navigate = useNavigate()
  const can = useCan()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading } = useList<any>('purchase-orders', '/purchase-orders', { search: useDebounced(search), status, page })
  return (
    <Page>
      <PageHeader
        title="Commandes"
        accent="fournisseurs"
        subtitle="Commande → réception (partielle) → facture → paiement, avec recalcul du coût moyen à chaque entrée."
        actions={
          can('purchase.order') && (
            <>
              <Button variant="soft" icon={<Zap size={16} />} onClick={() => navigate('/purchases/direct')}>Achat direct</Button>
              <Button variant="gradient" icon={<ShoppingCart size={16} />} onClick={() => navigate('/purchases/orders/new')}>Nouvelle commande</Button>
            </>
          )
        }
      />
      <DataTable
        loading={isLoading}
        rows={data?.data}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="N° de commande, fournisseur…"
        toolbar={<FilterChips value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: '', label: 'Toutes' }, { value: 'draft', label: 'Brouillons' }, { value: 'sent', label: 'Envoyées' }, { value: 'partial', label: 'Partielles' }, { value: 'received', label: 'Reçues' }]} />}
        onRowClick={(r) => navigate(`/purchases/orders/${r.id}`)}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <span className="font-semibold">{r.number || 'Brouillon'}</span> },
          { key: 'supplier', header: 'Fournisseur', render: (r) => r.supplier_name },
          { key: 'wh', header: 'Livraison', hideOnMobile: true, render: (r) => <span className="text-muted">{r.warehouse_name}</span> },
          { key: 'date', header: 'Date', hideOnMobile: true, render: (r) => date(r.order_date) },
          { key: 'expected', header: 'Prévue', hideOnMobile: true, render: (r) => (r.expected_date ? date(r.expected_date) : '—') },
          { key: 'status', header: 'Statut', render: (r) => <StatusBadge status={r.status} label={r.status_label} /> },
          { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="num font-semibold">{money(r.total)}</span> },
        ]}
      />
    </Page>
  )
}
