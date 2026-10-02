import { FilePlus2, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DateRange } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { DataTable, FilterChips } from '@/components/table'
import { Badge, Button, StatusBadge } from '@/components/ui'
import { date, money } from '@/lib/format'
import { useDebounced, useList } from '@/lib/hooks'
import { useCan } from '@/store/auth'

export default function Sales() {
  const navigate = useNavigate()
  const can = useCan()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const [page, setPage] = useState(1)
  const dq = useDebounced(search)
  const { data, isLoading } = useList<any>('sales', '/sales', { search: dq, status: status === 'open' ? '' : status, open: status === 'open' ? 1 : '', type, page, date_from: range.from, date_to: range.to })

  return (
    <Page>
      <PageHeader
        title="Ventes &"
        accent="factures"
        subtitle="Tickets de caisse et factures, paiements, avoirs et réimpressions."
        actions={
          <>
            {can('sales.create') && (
              <Button variant="soft" icon={<FilePlus2 size={16} />} onClick={() => navigate('/sales/new')}>
                Nouvelle facture
              </Button>
            )}
            {can('sales.create') && (
              <Button variant="gradient" icon={<ScanLine size={16} />} onClick={() => navigate('/pos')}>
                Point de vente
              </Button>
            )}
          </>
        }
      />
      <DataTable
        loading={isLoading}
        rows={data?.data}
        search={search}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        searchPlaceholder="N° de facture, client, téléphone…"
        toolbar={
          <>
            <FilterChips value={type} onChange={setType} options={[{ value: '', label: 'Tous' }, { value: 'pos', label: 'Tickets' }, { value: 'invoice', label: 'Factures' }]} />
            <FilterChips
              value={status}
              onChange={(v) => {
                setStatus(v)
                setPage(1)
              }}
              options={[
                { value: '', label: 'Tous statuts' },
                { value: 'open', label: 'À encaisser' },
                { value: 'paid', label: 'Payées' },
                { value: 'cancelled', label: 'Annulées' },
              ]}
            />
            <DateRange from={range.from} to={range.to} onChange={(f, t) => setRange({ from: f, to: t })} />
          </>
        }
        onRowClick={(r) => navigate(`/sales/${r.id}`)}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <span className="font-semibold">{r.number}</span> },
          { key: 'type', header: 'Type', hideOnMobile: true, render: (r) => <Badge tone={r.type === 'pos' ? 'violet' : 'sky'}>{r.type === 'pos' ? 'Ticket' : 'Facture'}</Badge> },
          { key: 'date', header: 'Date', hideOnMobile: true, render: (r) => <span className="text-muted">{date(r.created_at, true)}</span> },
          { key: 'customer', header: 'Client', render: (r) => r.customer_name },
          { key: 'seller', header: 'Vendeur', hideOnMobile: true, render: (r) => <span className="text-muted">{r.seller_name}</span> },
          { key: 'status', header: 'Statut', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="num font-semibold">{money(r.total)}</span> },
          { key: 'balance', header: 'Reste dû', align: 'right', hideOnMobile: true, render: (r) => <span className={Number(r.balance) > 0 ? 'num font-semibold text-warn' : 'num text-muted'}>{Number(r.balance) > 0 ? money(r.balance) : '—'}</span> },
        ]}
      />
    </Page>
  )
}
