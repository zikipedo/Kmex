import { useQueryClient } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowUpFromLine, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useWarehouses } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { ProductSearch } from '@/components/pickers'
import { DataTable, FilterChips } from '@/components/table'
import { Badge, Button, Field, Input, Modal, ProductThumb, Select } from '@/components/ui'
import { get, post } from '@/lib/api'
import { money, qty } from '@/lib/format'
import { showError, useApi, useDebounced, useList } from '@/lib/hooks'
import { useAuth, useCan } from '@/store/auth'

const IN = [['manual_in', 'Entrée manuelle'], ['initial', 'Stock initial'], ['adjustment_in', 'Ajustement positif']]
const OUT = [['manual_out', 'Sortie manuelle'], ['damaged', 'Produit endommagé'], ['expired', 'Produit périmé'], ['loss', 'Perte / vol'], ['internal_use', 'Consommation interne']]

export function StockMoveModal({ direction, product: initial, onClose, onDone }: { direction: 'entries' | 'exits'; product?: any; onClose: () => void; onDone: () => void }) {
  const wh = useAuth((s) => s.warehouseId)
  const { data: warehouses } = useWarehouses()
  const can = useCan()
  const [product, setProduct] = useState<any>(initial || null)
  const [f, setF] = useState({ warehouse_id: wh || '', quantity: '', movement_type: direction === 'entries' ? 'manual_in' : 'manual_out', reason: '', unit_cost: '', note: '' })
  const [loading, setLoading] = useState(false)
  const types = direction === 'entries' ? IN : OUT
  const submit = async () => {
    setLoading(true)
    try {
      const m = await post(`/stock/${direction}`, { ...f, product_id: product.id })
      toast.success(`Stock ${direction === 'entries' ? 'augmenté' : 'diminué'} : ${qty(m.qty_before)} → ${qty(m.qty_after)}`)
      onDone()
      onClose()
    } catch (e) {
      showError(e)
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={direction === 'entries' ? 'Entrée de stock' : 'Sortie de stock'}
      subtitle="Chaque variation crée un mouvement immuable : qui, quand, pourquoi, avant/après."
      icon={direction === 'entries' ? <ArrowDownToLine size={18} className="text-mint" /> : <ArrowUpFromLine size={18} className="text-rose" />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={loading} disabled={!product || !(Number(f.quantity) > 0) || f.reason.trim().length < 3} onClick={submit}>Valider le mouvement</Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        {product ? (
          <div className="flex items-center gap-3 rounded-2xl border hairline p-3">
            <ProductThumb image={product.image} icon={product.category_icon} color={product.category_color} size={44} rounded="rounded-xl" />
            <div className="flex-1">
              <div className="font-medium">{product.name}</div>
              <div className="text-[12px] text-muted">{product.sku} · stock {qty(product.stock)}</div>
            </div>
            {!initial && <Button size="sm" variant="ghost" onClick={() => setProduct(null)}>Changer</Button>}
          </div>
        ) : (
          <ProductSearch onPick={setProduct} warehouse={f.warehouse_id} />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dépôt">
            <Select value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
              {(warehouses || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={f.movement_type} onChange={(e) => setF({ ...f, movement_type: e.target.value })}>
              {types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Quantité" required>
            <Input autoFocus inputMode="decimal" className="num text-lg" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
          </Field>
          {direction === 'entries' && f.movement_type === 'initial' && can('catalog.cost.view') && (
            <Field label="Coût unitaire" hint="Alimente le CMUP">
              <Input inputMode="decimal" value={f.unit_cost} onChange={(e) => setF({ ...f, unit_cost: e.target.value })} />
            </Field>
          )}
        </div>
        <Field label="Motif" required>
          <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Ex. casse lors du déchargement" />
        </Field>
      </div>
    </Modal>
  )
}

export default function StockLevels() {
  const navigate = useNavigate()
  const can = useCan()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const wh = useAuth((s) => s.warehouseId)
  const [search, setSearch] = useState('')
  const [state, setState] = useState(params.get('state') || '')
  const [page, setPage] = useState(1)
  const [move, setMove] = useState<'entries' | 'exits' | null>(null)
  const [integrity, setIntegrity] = useState<any>(null)
  const { data, isLoading } = useList<any>('stock-levels', '/stock/levels', { search: useDebounced(search), state, page, warehouse: wh })
  const showCost = can('catalog.cost.view')
  return (
    <Page>
      <PageHeader
        title="Niveaux"
        accent="de stock"
        subtitle="Stock physique, réservé et disponible par dépôt — dérivé des mouvements, jamais saisi directement."
        actions={
          <>
            {can('stock.adjust.approve') && (
              <Button
                variant="soft"
                icon={<ShieldCheck size={16} />}
                onClick={async () => {
                  try {
                    const r = await get('/stock/integrity')
                    setIntegrity(r)
                  } catch (e) {
                    showError(e)
                  }
                }}
              >
                Contrôle d'intégrité
              </Button>
            )}
            {can('stock.move') && (
              <>
                <Button variant="soft" icon={<ArrowUpFromLine size={16} />} onClick={() => setMove('exits')}>Sortie</Button>
                <Button variant="gradient" icon={<ArrowDownToLine size={16} />} onClick={() => setMove('entries')}>Entrée</Button>
              </>
            )}
          </>
        }
      />
      {integrity && (
        <div className="mb-4">
          {integrity.anomalies.length === 0 ? (
            <Badge tone="green">✓ Intégrité vérifiée : chaque niveau de stock égale la somme de ses mouvements.</Badge>
          ) : (
            <Badge tone="red">{integrity.anomalies.length} anomalie(s) détectée(s) entre niveaux et mouvements.</Badge>
          )}
        </div>
      )}
      <DataTable
        loading={isLoading}
        rows={data?.data}
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1) }}
        searchPlaceholder="Produit, SKU, code-barres…"
        toolbar={<FilterChips value={state} onChange={(v) => { setState(v); setPage(1) }} options={[{ value: '', label: 'Tous' }, { value: 'low', label: 'Stock faible' }, { value: 'out', label: 'Ruptures' }]} />}
        onRowClick={(r) => navigate(`/products/${r.product}`)}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'product', header: 'Produit', render: (r) => <div><div className="font-medium">{r.product_name}</div><div className="text-[12px] text-muted">{r.product_sku} · {r.category_name}</div></div> },
          { key: 'wh', header: 'Dépôt', hideOnMobile: true, render: (r) => <span className="text-muted">{r.warehouse_name}</span> },
          { key: 'on_hand', header: 'Physique', align: 'right', render: (r) => <span className="num font-semibold">{qty(r.on_hand)} <span className="text-muted">{r.unit}</span></span> },
          { key: 'reserved', header: 'Réservé', align: 'right', hideOnMobile: true, render: (r) => <span className="num text-muted">{qty(r.reserved)}</span> },
          { key: 'min', header: 'Minimum', align: 'right', hideOnMobile: true, render: (r) => <span className="num text-muted">{qty(r.min_stock)}</span> },
          ...(showCost ? [
            { key: 'cmup', header: 'CMUP', align: 'right' as const, hideOnMobile: true, render: (r: any) => <span className="num text-muted">{money(r.avg_cost)}</span> },
            { key: 'value', header: 'Valeur', align: 'right' as const, render: (r: any) => <span className="num">{money(r.value)}</span> },
          ] : []),
          { key: 'state', header: 'État', render: (r) => r.state === 'out' ? <Badge tone="red" dot>Rupture</Badge> : r.state === 'low' ? <Badge tone="amber" dot>Faible</Badge> : r.state === 'over' ? <Badge tone="sky" dot>Surstock</Badge> : <Badge tone="green" dot>OK</Badge> },
        ]}
      />
      {move && <StockMoveModal direction={move} onClose={() => setMove(null)} onDone={() => { qc.invalidateQueries({ queryKey: ['stock-levels'] }); qc.invalidateQueries({ queryKey: ['products'] }) }} />}
    </Page>
  )
}
