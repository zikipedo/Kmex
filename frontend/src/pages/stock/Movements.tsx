import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DateRange } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { DataTable, FilterChips } from '@/components/table'
import { cx } from '@/components/ui'
import { date, qty } from '@/lib/format'
import { useDebounced, useList } from '@/lib/hooks'
import { useAuth } from '@/store/auth'

export default function Movements() {
  const navigate = useNavigate()
  const wh = useAuth((s) => s.warehouseId)
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const [page, setPage] = useState(1)
  const { data, isLoading } = useList<any>('stock-movements', '/stock/movements', { search: useDebounced(search), direction, page, warehouse: wh, date_from: range.from, date_to: range.to })
  const docLink = (m: any) => (m.document_type === 'sale' ? `/sales/${m.document_id}` : m.document_type === 'purchase_receipt' ? null : null)
  return (
    <Page>
      <PageHeader title="Mouvements" accent="de stock" subtitle="Registre immuable : chaque entrée et sortie, avec quantité avant/après, utilisateur, motif et document d'origine." />
      <DataTable
        loading={isLoading}
        rows={data?.data}
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1) }}
        searchPlaceholder="Produit, n° de document, motif…"
        toolbar={
          <>
            <FilterChips value={direction} onChange={(v) => { setDirection(v); setPage(1) }} options={[{ value: '', label: 'Tous' }, { value: 'in', label: 'Entrées' }, { value: 'out', label: 'Sorties' }]} />
            <DateRange from={range.from} to={range.to} onChange={(f, t) => setRange({ from: f, to: t })} />
          </>
        }
        onRowClick={(m) => { const l = docLink(m); navigate(l || `/products/${m.product}`) }}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        dense
        columns={[
          { key: 'date', header: 'Date', render: (m) => <span className="text-muted">{date(m.created_at, true)}</span> },
          { key: 'product', header: 'Produit', render: (m) => <span className="font-medium">{m.product_name}</span> },
          { key: 'type', header: 'Type', render: (m) => m.type_label },
          { key: 'qty', header: 'Qté', align: 'right', render: (m) => <span className={cx('num font-semibold', Number(m.quantity) > 0 ? 'text-mint' : 'text-rose')}>{Number(m.quantity) > 0 ? '+' : ''}{qty(m.quantity)}</span> },
          { key: 'ba', header: 'Avant → après', align: 'right', hideOnMobile: true, render: (m) => <span className="num text-muted">{qty(m.qty_before)} → {qty(m.qty_after)}</span> },
          { key: 'wh', header: 'Dépôt', hideOnMobile: true, render: (m) => <span className="text-muted">{m.warehouse_name}</span> },
          { key: 'doc', header: 'Document / motif', render: (m) => m.document_number || <span className="text-muted">{m.reason}</span> },
          { key: 'user', header: 'Par', hideOnMobile: true, render: (m) => <span className="text-muted">{m.user_name}</span> },
        ]}
      />
    </Page>
  )
}
