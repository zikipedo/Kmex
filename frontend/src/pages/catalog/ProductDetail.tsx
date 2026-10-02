import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Archive, ArrowDownToLine, ArrowUpFromLine, Camera, ImagePlus, Pencil, RotateCcw, Star, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { confirm } from '@/components/confirm'
import { Page, PageHeader } from '@/components/page'
import { Badge, Button, Card, CardHeader, cx, EmptyState, InfoRow, ProductThumb, Skeleton, Spinner, StatusBadge, Tabs } from '@/components/ui'
import { del, post, upload } from '@/lib/api'
import { date, money, pct, qty } from '@/lib/format'
import { showError, useApi } from '@/lib/hooks'
import { useCan } from '@/store/auth'
import { StockMoveModal } from '../stock/StockLevels'
import { ProductForm } from './ProductForm'

/** Compression côté navigateur avant envoi (§4.5) : max 2000 px, JPEG ~0,82. */
async function compress(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/heic' || file.type === 'image/heif') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.82))
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export default function ProductDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const can = useCan()
  const [tab, setTab] = useState<'overview' | 'movements' | 'prices'>('overview')
  const [edit, setEdit] = useState(false)
  const [move, setMove] = useState<'entries' | 'exits' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [activeImg, setActiveImg] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const { data: p } = useApi<any>(['product', id], `/products/${id}`)
  const { data: images } = useApi<any[]>(['product-images', id], `/products/${id}/images`)
  const { data: stock } = useApi<any[]>(['product-stock', id], `/products/${id}/stock`)
  const { data: movements } = useApi<any[]>(['product-movements', id], tab === 'movements' ? `/products/${id}/movements` : null)
  const { data: prices } = useApi<any[]>(['product-prices', id], tab === 'prices' ? `/products/${id}/price-history` : null)

  const refresh = () => {
    ;['product', 'product-images', 'product-stock', 'product-movements', 'product-prices'].forEach((k) => qc.invalidateQueries({ queryKey: [k, id] }))
    qc.invalidateQueries({ queryKey: ['products'] })
    qc.invalidateQueries({ queryKey: ['pos-products'] })
  }

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      const prepared = await Promise.all([...files].map(compress))
      await upload(`/products/${id}/images/upload`, prepared)
      toast.success(`${files.length} photo(s) ajoutée(s)`, { description: 'Optimisées en WebP, métadonnées GPS supprimées.' })
      refresh()
    } catch (e) {
      showError(e)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!p) return <Page><Skeleton className="h-[520px] rounded-3xl" /></Page>
  const gallery = images || []
  const current = gallery[activeImg] || gallery.find((g) => g.is_primary)

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: 'Produits', to: '/products' }, { label: p.name }]}
        title={p.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={p.status} /> {p.sku} · {p.category_name}{p.brand_name ? ` · ${p.brand_name}` : ''}</span>}
        actions={
          <>
            {can('stock.move') && p.track_stock && (
              <>
                <Button variant="soft" icon={<ArrowDownToLine size={16} />} onClick={() => setMove('entries')}>Entrée</Button>
                <Button variant="soft" icon={<ArrowUpFromLine size={16} />} onClick={() => setMove('exits')}>Sortie</Button>
              </>
            )}
            {can('catalog.archive') && p.status !== 'archived' && (
              <Button
                variant="ghost"
                icon={<Archive size={16} />}
                onClick={async () => {
                  const r = await confirm({ title: 'Archiver ce produit ?', message: "Il ne sera plus proposé à la vente mais reste visible dans l'historique. La suppression physique est impossible.", requireReason: true, confirmLabel: 'Archiver' })
                  if (!r.ok) return
                  try {
                    await del(`/products/${id}`, { reason: r.reason })
                    toast.success('Produit archivé')
                    refresh()
                  } catch (e) {
                    showError(e)
                  }
                }}
              >
                Archiver
              </Button>
            )}
            {p.status === 'archived' && can('catalog.archive') && (
              <Button variant="soft" icon={<RotateCcw size={16} />} onClick={() => post(`/products/${id}/restore`).then(refresh).catch(showError)}>Restaurer</Button>
            )}
            {can('catalog.manage') && <Button variant="gradient" icon={<Pencil size={16} />} onClick={() => setEdit(true)}>Modifier</Button>}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,460px)_1fr]">
        {/* Galerie */}
        <Card className="p-3">
          <div className="relative aspect-square overflow-hidden rounded-[22px]">
            <AnimatePresence mode="wait">
              <motion.div key={current?.id || 'none'} initial={{ opacity: 0, scale: 1.03 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="h-full w-full">
                {current ? (
                  <img src={current.thumbs['1200'] || current.url} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <ProductThumb icon={p.category_icon} color={p.category_color} size={800} className="!h-full !w-full" rounded="rounded-[22px]" />
                )}
              </motion.div>
            </AnimatePresence>
            {uploading && (
              <div className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-sm">
                <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-[13px] text-white"><Spinner className="text-white" /> Traitement…</div>
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {gallery.map((g, i) => (
              <div key={g.id} className="group relative shrink-0">
                <button onClick={() => setActiveImg(i)} className={cx('overflow-hidden rounded-2xl ring-2 transition', current?.id === g.id ? 'ring-accent' : 'ring-transparent')}>
                  <img src={g.thumbs['200']} alt="" className="h-16 w-16 object-cover" />
                </button>
                {g.is_primary && <Star size={13} className="absolute left-1.5 top-1.5 fill-peach text-peach drop-shadow" />}
                {can('catalog.image.upload') && (
                  <div className="absolute inset-x-0 bottom-0 hidden justify-center gap-1 pb-1 group-hover:flex">
                    {!g.is_primary && (
                      <button title="Définir comme principale" onClick={() => post(`/products/${id}/images/${g.id}/primary`).then(refresh).catch(showError)} className="grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white">
                        <Star size={11} />
                      </button>
                    )}
                    <button
                      title="Supprimer"
                      onClick={async () => {
                        const r = await confirm({ title: 'Supprimer cette photo ?', message: 'La suppression est journalisée.', danger: true, confirmLabel: 'Supprimer' })
                        if (r.ok) del(`/products/${id}/images/${g.id}`).then(() => { setActiveImg(0); refresh() }).catch(showError)
                      }}
                      className="grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {can('catalog.image.upload') && (
              <>
                <button onClick={() => fileRef.current?.click()} className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-dashed hairline text-muted transition hover:bg-line/5 hover:text-fg" title="Ajouter des photos">
                  <ImagePlus size={20} />
                </button>
                <button onClick={() => camRef.current?.click()} className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-dashed hairline text-muted transition hover:bg-line/5 hover:text-fg sm:hidden" title="Appareil photo">
                  <Camera size={20} />
                </button>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={(e) => onFiles(e.target.files)} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target.files)} />
          {can('catalog.image.upload') && gallery.length === 0 && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                onFiles(e.dataTransfer.files)
              }}
              onClick={() => fileRef.current?.click()}
              className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed hairline p-4 text-[12.5px] text-muted hover:bg-line/5"
            >
              <Upload size={15} /> Glissez des photos ici (JPEG, PNG, WebP, HEIC · 10 Mo max)
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card glow className="p-5">
              <div className="label text-[10px]">Prix de vente</div>
              <div className="num mt-2 font-display text-3xl font-bold">{money(p.price_retail)}</div>
              {p.promo_price && <Badge tone="pink" className="mt-2">Promo {money(p.promo_price)}</Badge>}
              {p.price_wholesale && <div className="mt-1 text-[12px] text-muted">Gros : {money(p.price_wholesale)} dès {qty(p.wholesale_min_qty)}</div>}
            </Card>
            <Card className="p-5">
              <div className="label text-[10px]">Stock total</div>
              <div className="num mt-2 font-display text-3xl font-bold">{p.track_stock ? qty(p.stock) : '∞'}</div>
              <div className="mt-1 text-[12px] text-muted">{p.track_stock ? `Minimum ${qty(p.min_stock)} ${p.unit_code}` : 'Service — non stocké'}</div>
            </Card>
            <Card className="p-5">
              <div className="label text-[10px]">{p.cost_avg !== undefined ? 'Coût moyen (CMUP)' : 'Unité'}</div>
              <div className="num mt-2 font-display text-3xl font-bold">{p.cost_avg !== undefined ? money(p.cost_avg) : p.unit_code}</div>
              {p.margin_pct !== undefined && <div className="mt-1 text-[12px] text-mint">Marge {pct(p.margin_pct)}</div>}
            </Card>
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Vue d’ensemble' }, { key: 'movements', label: 'Mouvements' }, { key: 'prices', label: 'Historique des prix' }]} />
          {tab === 'overview' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Stock par dépôt" />
                <div className="space-y-2 p-5">
                  {(stock || []).length === 0 && <div className="text-[13px] text-muted">Aucun stock enregistré.</div>}
                  {(stock || []).map((s) => (
                    <div key={s.warehouse_id} className="flex items-center justify-between rounded-2xl border hairline px-4 py-3">
                      <span className="text-[13.5px] font-medium">{s.warehouse}</span>
                      <span className="text-right">
                        <span className="num block font-semibold">{qty(s.on_hand)} {p.unit_code}</span>
                        {s.avg_cost && <span className="num text-[11.5px] text-muted">CMUP {money(s.avg_cost)}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHeader title="Fiche" />
                <div className="divide-y divide-[var(--glass-border)] px-6 pb-4 pt-2">
                  <InfoRow label="Référence" value={p.internal_ref} />
                  <InfoRow label="SKU" value={p.sku} />
                  <InfoRow label="Code-barres" value={p.barcode || '—'} />
                  <InfoRow label="Unité" value={p.unit_code} />
                  <InfoRow label="TVA" value={`${Number(p.tax_rate)} %`} />
                  {p.cost_last !== undefined && <InfoRow label="Dernier prix d'achat" value={money(p.cost_last)} />}
                  <InfoRow label="Créé le" value={date(p.created_at)} />
                </div>
                {p.description && <p className="px-6 pb-5 text-[13px] text-muted">{p.description}</p>}
              </Card>
            </div>
          )}
          {tab === 'movements' && (
            <Card className="overflow-hidden">
              {!movements ? (
                <div className="p-6"><Skeleton className="h-40" /></div>
              ) : movements.length === 0 ? (
                <EmptyState title="Aucun mouvement" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-[13px]">
                    <thead>
                      <tr className="border-b hairline">
                        {['Date', 'Type', 'Dépôt', 'Qté', 'Avant → Après', 'Document', 'Par'].map((h) => <th key={h} className="label px-4 py-3 text-left">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map((m) => (
                        <tr key={m.id} className="table-row border-b hairline last:border-0">
                          <td className="px-4 py-2.5 text-muted">{date(m.created_at, true)}</td>
                          <td className="px-4">{m.type_label}</td>
                          <td className="px-4 text-muted">{m.warehouse_name}</td>
                          <td className={cx('num px-4 font-semibold', Number(m.quantity) > 0 ? 'text-mint' : 'text-rose')}>{Number(m.quantity) > 0 ? '+' : ''}{qty(m.quantity)}</td>
                          <td className="num px-4 text-muted">{qty(m.qty_before)} → {qty(m.qty_after)}</td>
                          <td className="px-4">{m.document_number || m.reason || '—'}</td>
                          <td className="px-4 text-muted">{m.user_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
          {tab === 'prices' && (
            <Card className="p-5">
              {!prices?.length ? (
                <EmptyState title="Prix inchangé depuis la création" />
              ) : (
                <div className="space-y-2">
                  {prices.map((h) => (
                    <div key={h.id} className="flex items-center justify-between rounded-2xl border hairline px-4 py-3 text-[13px]">
                      <div>
                        <div className="font-medium">{h.price_type === 'price_retail' ? 'Prix de vente' : h.price_type === 'price_wholesale' ? 'Prix de gros' : 'Prix promo'}</div>
                        <div className="text-[12px] text-muted">{date(h.created_at, true)} · {h.changed_by} {h.reason && `· ${h.reason}`}</div>
                      </div>
                      <div className="num"><span className="text-muted line-through">{money(h.old_price)}</span> → <span className="font-semibold">{money(h.new_price)}</span></div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
      <ProductForm open={edit} onClose={() => setEdit(false)} initial={p} onSaved={refresh} />
      {move && <StockMoveModal direction={move} product={p} onClose={() => setMove(null)} onDone={refresh} />}
      {p.status === 'archived' && <div className="mt-4"><Badge tone="gray">Produit archivé — non proposé à la vente</Badge></div>}
      <button className="hidden" onClick={() => navigate(-1)} />
    </Page>
  )
}
