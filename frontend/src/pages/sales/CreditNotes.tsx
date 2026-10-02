import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Page, PageHeader } from '@/components/page'
import { DataTable } from '@/components/table'
import { Badge } from '@/components/ui'
import { date, money } from '@/lib/format'
import { useDebounced, useList } from '@/lib/hooks'

export default function CreditNotes() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading } = useList<any>('credit-notes', '/credit-notes', { search: useDebounced(search), page })
  return (
    <Page>
      <PageHeader title="Avoirs &" accent="retours" subtitle="Annulations et retours clients : jamais de suppression, toujours un document inverse tracé." />
      <DataTable
        loading={isLoading}
        rows={data?.data}
        search={search}
        onSearch={setSearch}
        onRowClick={(r) => navigate(`/sales/${r.sale}`)}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <span className="font-semibold">{r.number}</span> },
          { key: 'sale', header: 'Facture', render: (r) => r.sale_number },
          { key: 'customer', header: 'Client', render: (r) => r.customer_name },
          { key: 'date', header: 'Date', hideOnMobile: true, render: (r) => date(r.created_at, true) },
          { key: 'reason', header: 'Motif', hideOnMobile: true, render: (r) => <span className="text-muted">{r.reason}</span> },
          { key: 'type', header: 'Type', render: (r) => <Badge tone={r.is_full_cancellation ? 'red' : 'violet'}>{r.is_full_cancellation ? 'Annulation' : 'Retour partiel'}</Badge> },
          { key: 'total', header: 'Montant', align: 'right', render: (r) => <span className="num font-semibold text-rose">−{money(r.total)}</span> },
        ]}
      />
    </Page>
  )
}
