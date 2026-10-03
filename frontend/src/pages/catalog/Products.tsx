import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { LayoutGrid, List, PackagePlus, Star } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Page, PageHeader } from '@/components/page'
import { DataTable, FilterChips } from '@/components/table'
import { Badge, Button, Card, cx, EmptyState, Input, ProductThumb, Select, Skeleton } from '@/components/ui'
import { money, pct, qty } from '@/lib/format'
import { useDebounced, useList } from '@/lib/hooks'
import { useAuth, useCan } from '@/store/auth'
import { ProductForm, useRefs } from './ProductForm'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'

function StockPill({ p }: { p: any }) {
  if (!p.track_stock) return <Badge tone="sky">Service</Badge>
  const s = Number(p.stock)
  if (s <= 0) return <Badge tone="red" dot>Rupture</Badge>
  if (s <= Number(p.min_stock)) return <Badge tone="amber" dot>{qty(s)} · faible</Badge>
  return <Badge tone="green" dot>{qty(s)} {p.unit_code}</Badge>
}

export default function Products() {
  const navigate = useNavigate()
  const can = useCan()
  const qc = useQueryClient()
  const wh = useAuth((s) => s.warehouseId)
  const [params] = useSearchParams()
  const [view, setView] = useState<'grid' | 'table'>(() => (localStorage.getItem('sp-products-view') as any) || 'grid')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [stockState, setStockState] = useState(params.get('state') || '')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const refs = useRefs()
  const { data, isLoading } = useList<any>('products', '/products', { q: useDebounced(search), category, stock_state: stockState, page, limit: view === 'grid' ? 24 : 25, warehouse: wh, status: stockState === 'archived' ? 'archived' : '' })
  const showCost = can('catalog.cost.view')
  const switchView = (v: 'grid' | 'table') => {
    setView(v)
    localStorage.setItem('sp-products-view', v)
  }

  const toolbar = (
    <>
      <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }} className="h-9 w-[190px] py-1 text-[12.5px]">
        <option value="">Toutes catégories</option>
        {refs.categories.map((c: any) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <FilterChips value={stockState} onChange={(v) => { setStockState(v); setPage(1) }} options={[{ value: '', label: 'Tous' }, { value: 'low', label: 'Stock faible' }, { value: 'out', label: 'Rupture' }, { value: 'archived', label: 'Archivés' }]} />
      <div className="flex rounded-full border hairline p-0.5">
        {(['grid', 'table'] as const).map((v) => (
          <button key={v} onClick={() => switchView(v)} className={cx('grid h-8 w-8 place-items-center rounded-full transition', view === v ? 'bg-fg text-bg' : 'text-muted')}>
            {v === 'grid' ? <LayoutGrid size={15} /> : <List size={15} />}
          </button>
        ))}
      </div>
    </>
  )

  return (
    <Page>
      <PageHeader
        title="Produits"
        accent="& catalogue"
        subtitle={`${data?.meta.total ?? '…'} références · photos, prix, codes-barres et stock par dépôt.`}
        actions={can('catalog.manage') && <Button variant="gradient" icon={<PackagePlus size={16} />} onClick={() => setOpen(true)}>Nouveau produit</Button>}
      />
      {view === 'table' ? (
        <DataTable
          loading={isLoading}
          rows={data?.data}
          search={search}
          onSearch={(v) => { setSearch(v); setPage(1) }}
          searchPlaceholder="Nom, SKU, code-barres, marque…"
          toolbar={toolbar}
          onRowClick={(r) => navigate(`/products/${r.id}`)}
          page={data?.meta.page}
          pages={data?.meta.pages}
          total={data?.meta.total}
          onPage={setPage}
          columns={[
            {
              key: 'name',
              header: 'Produit',
              render: (p) => (
                <div className="flex items-center gap-3">
                  <ProductThumb image={p.image} icon={p.category_icon} color={p.category_color} size={42} rounded="rounded-xl" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium">
                      {p.name} {p.is_favorite && <Star size={12} className="fill-peach text-peach" />}
                    </div>
                    <div className="text-[12px] text-muted">{p.sku} · {p.brand_name || 'Sans marque'}</div>
                  </div>
                </div>
              ),
            },
            { key: 'cat', header: 'Catégorie', hideOnMobile: true, render: (p) => <span className="text-muted">{p.category_name}</span> },
            ...(showCost ? [{ key: 'cost_last', header: "Prix d'achat", align: 'right' as const, render: (p: any) => <span className="num">{Number(p.cost_last) ? money(p.cost_last) : <span className="text-muted">—</span>}</span> }] : []),
            { key: 'price', header: 'Prix de vente', align: 'right', render: (p) => <span className="num font-semibold">{money(p.price_retail)}</span> },
            ...(showCost ? [{ key: 'cost', header: 'CMUP', align: 'right' as const, hideOnMobile: true, render: (p: any) => <span className="num text-muted">{money(p.cost_avg)}</span> }] : []),
            ...(can('profit.view') ? [{ key: 'margin', header: 'Marge', align: 'right' as const, hideOnMobile: true, render: (p: any) => <span className="num text-mint">{pct(p.margin_pct)}</span> }] : []),
            { key: 'stock', header: 'Stock', align: 'right', render: (p) => <StockPill p={p} /> },
          ]}
        />
      ) : (
        <>
          <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:max-w-xs">
              <Input icon={<Search size={16} />} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Nom, SKU, code-barres, marque…" />
            </div>
            <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
          </Card>
          {isLoading && !data ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
              {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-3xl" />)}
            </div>
          ) : data?.data.length === 0 ? (
            <Card><EmptyState title="Aucun produit" text="Ajoutez votre premier produit pour commencer à vendre." action={can('catalog.manage') && <Button onClick={() => setOpen(true)}>Ajouter un produit</Button>} /></Card>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
              {data?.data.map((p, i) => (
                <motion.button
                  key={p.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.025, 0.4) }}
                  whileHover={{ y: -4 }}
                  onClick={() => navigate(`/products/${p.id}`)}
                  className="card group overflow-hidden p-2.5 text-left"
                >
                  <div className="relative overflow-hidden rounded-2xl">
                    <ProductThumb image={p.image} icon={p.category_icon} color={p.category_color} size={600} className="!h-40 !w-full transition duration-700 group-hover:scale-105" rounded="rounded-2xl" />
                    <div className="absolute left-2 top-2"><StockPill p={p} /></div>
                    {p.is_favorite && <Star size={15} className="absolute right-2.5 top-2.5 fill-peach text-peach drop-shadow" />}
                  </div>
                  <div className="px-1.5 pb-1 pt-3">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{p.category_name}</div>
                    <div className="mt-0.5 line-clamp-2 min-h-[38px] text-[13.5px] font-semibold leading-snug">{p.name}</div>
                    <div className="mt-2 flex items-end justify-between">
                      <span className="num font-display text-[17px] font-bold">{money(p.price_retail)}</span>
                      {can('profit.view') && p.margin_pct !== null && p.margin_pct !== undefined && <span className="num text-[11.5px] text-mint">{pct(p.margin_pct, 0)}</span>}
                    </div>
                    {showCost && (
                      <div className="mt-1 flex items-center justify-between text-[11.5px] text-muted">
                        <span>Achat</span>
                        <span className="num">{Number(p.cost_last) ? money(p.cost_last) : '—'}</span>
                      </div>
                    )}
                  </div>
                </motion.button>
              ))}
            </div>
          )}
          {data && data.meta.pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3 text-[13px] text-muted">
              <Button size="sm" variant="soft" disabled={page <= 1} onClick={() => setPage(page - 1)} icon={<ChevronLeft size={14} />}>Précédent</Button>
              <span className="num">{page} / {data.meta.pages}</span>
              <Button size="sm" variant="soft" disabled={page >= data.meta.pages} onClick={() => setPage(page + 1)} iconRight={<ChevronRight size={14} />}>Suivant</Button>
            </div>
          )}
        </>
      )}
      <ProductForm open={open} onClose={() => setOpen(false)} onSaved={(p) => { qc.invalidateQueries({ queryKey: ['products'] }); navigate(`/products/${p.id}`) }} />
    </Page>
  )
}
