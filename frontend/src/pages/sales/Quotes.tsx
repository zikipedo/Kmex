import { useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, CalendarPlus, FilePlus2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/page'
import { DataTable, FilterChips } from '@/components/table'
import { Badge, Button, StatusBadge } from '@/components/ui'
import { post } from '@/lib/api'
import { date, money, todayISO } from '@/lib/format'
import { showError, useDebounced, useList } from '@/lib/hooks'

export default function Quotes() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading } = useList<any>('quotes', '/quotes', { search: useDebounced(search), status, page })
  const act = async (fn: () => Promise<any>, msg: string) => {
    try {
      const r = await fn()
      toast.success(msg)
      qc.invalidateQueries({ queryKey: ['quotes'] })
      return r
    } catch (e) {
      showError(e)
    }
  }
  return (
    <Page>
      <PageHeader
        title="Devis"
        accent="& offres"
        subtitle="Propositions chiffrées avec validité ; conversion en facture en un clic."
        actions={<Button variant="gradient" icon={<FilePlus2 size={16} />} onClick={() => navigate('/quotes/new')}>Nouveau devis</Button>}
      />
      <DataTable
        loading={isLoading}
        rows={data?.data}
        search={search}
        onSearch={setSearch}
        toolbar={<FilterChips value={status} onChange={setStatus} options={[{ value: '', label: 'Tous' }, { value: 'sent', label: 'Envoyés' }, { value: 'accepted', label: 'Acceptés' }, { value: 'converted', label: 'Convertis' }, { value: 'refused', label: 'Refusés' }]} />}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <span className="font-semibold">{r.number}</span> },
          { key: 'customer', header: 'Client', render: (r) => r.customer_name },
          { key: 'date', header: 'Émis le', hideOnMobile: true, render: (r) => date(r.issue_date) },
          { key: 'valid', header: 'Validité', render: (r) => (r.is_expired ? <Badge tone="gray">Expiré le {date(r.valid_until)}</Badge> : <span className="text-muted">{date(r.valid_until)}</span>) },
          { key: 'status', header: 'Statut', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="num font-semibold">{money(r.total)}</span> },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (r) =>
              r.status === 'converted' ? (
                <Button size="sm" variant="ghost" onClick={() => navigate(`/sales/${r.converted_sale}`)}>
                  {r.converted_sale_number}
                </Button>
              ) : r.status !== 'refused' ? (
                r.is_expired ? (
                  <Button size="sm" variant="soft" icon={<CalendarPlus size={14} />} onClick={() => act(() => post(`/quotes/${r.id}/extend`, { valid_until: todayISO(15) }), 'Devis prolongé de 15 jours')}>
                    Prolonger
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    icon={<ArrowRightLeft size={14} />}
                    onClick={async () => {
                      const s = await act(() => post(`/quotes/${r.id}/convert`, {}), 'Devis converti en facture')
                      if (s) navigate(`/sales/${s.id}`)
                    }}
                  >
                    Convertir
                  </Button>
                )
              ) : null,
          },
        ]}
      />
    </Page>
  )
}
