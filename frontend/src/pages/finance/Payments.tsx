import { useQueryClient } from '@tanstack/react-query'
import { Undo } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { confirm } from '@/components/confirm'
import { DateRange } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { DataTable, FilterChips } from '@/components/table'
import { Badge, Button, StatusBadge } from '@/components/ui'
import { post } from '@/lib/api'
import { date, money } from '@/lib/format'
import { showError, useDebounced, useList } from '@/lib/hooks'
import { useCan } from '@/store/auth'

export default function Payments() {
  const can = useCan()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const [page, setPage] = useState(1)
  const { data, isLoading } = useList<any>('payments', '/payments', { search: useDebounced(search), direction, page, date_from: range.from, date_to: range.to })
  const reverse = async (p: any) => {
    const r = await confirm({ title: `Extourner ${p.number} ?`, message: 'Un mouvement inverse sera créé et la créance/dette ré-ouverte. Le paiement reste visible, marqué « extourné ».', requireReason: true, danger: true, confirmLabel: 'Extourner' })
    if (!r.ok) return
    try {
      await post(`/payments/${p.id}/reverse`, { reason: r.reason })
      toast.success('Paiement extourné')
      qc.invalidateQueries({ queryKey: ['payments'] })
    } catch (e) {
      showError(e)
    }
  }
  return (
    <Page>
      <PageHeader title="Paiements" accent="encaissés & décaissés" subtitle="Tous les règlements clients et fournisseurs, leurs affectations et références Mobile Money." />
      <DataTable
        loading={isLoading}
        rows={data?.data}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="N°, référence, client, fournisseur…"
        toolbar={
          <>
            <FilterChips value={direction} onChange={(v) => { setDirection(v); setPage(1) }} options={[{ value: '', label: 'Tous' }, { value: 'in', label: 'Encaissements' }, { value: 'out', label: 'Décaissements' }]} />
            <DateRange from={range.from} to={range.to} onChange={(f, t) => setRange({ from: f, to: t })} />
          </>
        }
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'number', header: 'N°', render: (p) => <span className="font-semibold">{p.number}</span> },
          { key: 'date', header: 'Date', hideOnMobile: true, render: (p) => <span className="text-muted">{date(p.paid_at, true)}</span> },
          { key: 'party', header: 'Tiers', render: (p) => p.party_name },
          { key: 'method', header: 'Moyen', render: (p) => <div>{p.method_name}{p.reference && <div className="text-[11.5px] text-muted">{p.reference}</div>}</div> },
          { key: 'alloc', header: 'Affecté à', hideOnMobile: true, render: (p) => <span className="text-[12.5px] text-muted">{p.allocations.map((a: any) => a.document).join(', ') || (Number(p.unallocated) > 0 ? 'Acompte' : '—')}</span> },
          { key: 'amount', header: 'Montant', align: 'right', render: (p) => <span className={`num font-semibold ${p.direction === 'in' ? 'text-mint' : 'text-rose'}`}>{p.direction === 'in' ? '+' : '−'}{money(p.amount)}</span> },
          { key: 'status', header: '', render: (p) => (p.status === 'reversed' ? <StatusBadge status="reversed" /> : Number(p.unallocated) > 0 ? <Badge tone="sky">Crédit {money(p.unallocated, { compact: true })}</Badge> : null) },
          { key: 'act', header: '', align: 'right', render: (p) => can('cash.session.validate') && p.status === 'valid' && <Button size="sm" variant="ghost" icon={<Undo size={14} />} onClick={() => reverse(p)}>Extourner</Button> },
        ]}
      />
    </Page>
  )
}
