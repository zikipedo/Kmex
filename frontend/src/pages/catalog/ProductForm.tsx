import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, Field, Input, Modal, Select, Switch, Textarea } from '@/components/ui'
import { api, get, post } from '@/lib/api'
import { showError } from '@/lib/hooks'
import { useCan } from '@/store/auth'

const EMPTY = {
  name: '', sku: '', barcode: '', type: 'simple', category: '', brand: '', unit: '', tax: '', description: '', price_retail: '',
  price_wholesale: '', wholesale_min_qty: '', promo_price: '', promo_start: '', promo_end: '', min_stock: '0', max_stock: '',
  is_favorite: false, status: 'active', tags: '', price_reason: '',
}

export function useRefs() {
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => get<any[]>('/categories') })
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => get<any[]>('/brands') })
  const units = useQuery({ queryKey: ['units'], queryFn: () => get<any[]>('/units') })
  const taxes = useQuery({ queryKey: ['taxes'], queryFn: () => get<any[]>('/taxes') })
  return { categories: categories.data || [], brands: brands.data || [], units: units.data || [], taxes: taxes.data || [] }
}

export function ProductForm({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial?: any; onSaved: (p: any) => void }) {
  const refs = useRefs()
  const can = useCan()
  const [f, setF] = useState<any>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!open) return
    setErrors({})
    if (initial) {
      const v: any = { ...EMPTY }
      Object.keys(EMPTY).forEach((k) => (v[k] = initial[k] ?? (EMPTY as any)[k]))
      ;['brand', 'tax'].forEach((k) => (v[k] = initial[k] || ''))
      setF({ ...v, price_reason: '' })
    } else {
      setF({ ...EMPTY, unit: refs.units[0]?.id || '', tax: refs.taxes.find((t: any) => t.is_default)?.id || '' })
    }
  }, [open, initial]) // eslint-disable-line
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const priceChanged = initial && ['price_retail', 'price_wholesale', 'promo_price'].some((k) => String(initial[k] ?? '') !== String(f[k] ?? ''))
  const save = async () => {
    setLoading(true)
    const body: any = { ...f }
    ;['price_wholesale', 'wholesale_min_qty', 'promo_price', 'max_stock', 'promo_start', 'promo_end', 'brand', 'tax'].forEach((k) => {
      if (body[k] === '') body[k] = null
    })
    if (!body.sku) delete body.sku
    try {
      const p = initial ? await api(`/products/${initial.id}`, { method: 'PATCH', body }) : await post('/products', body)
      toast.success(initial ? 'Produit mis à jour' : 'Produit créé')
      onSaved(p)
      onClose()
    } catch (e: any) {
      setErrors(e.fieldErrors?.() || {})
      showError(e)
    } finally {
      setLoading(false)
    }
  }
  const canPrice = !initial || can('catalog.price.edit')
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={initial ? 'Modifier le produit' : 'Nouveau produit'}
      subtitle="Le stock ne se saisit jamais ici : il évolue uniquement par mouvements tracés."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={loading} disabled={f.name.trim().length < 3 || !f.category || !f.unit} onClick={save}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-x-4 gap-y-4 pb-2 md:grid-cols-3">
        <Field label="Nom du produit" required error={errors.name} className="md:col-span-2">
          <Input autoFocus value={f.name} onChange={set('name')} placeholder="Ex. Riz parfumé 25 kg" />
        </Field>
        <Field label="Type">
          <Select value={f.type} onChange={set('type')}>
            <option value="simple">Produit stocké</option>
            <option value="service">Service (sans stock)</option>
          </Select>
        </Field>
        <Field label="Catégorie" required error={errors.category}>
          <Select value={f.category} onChange={set('category')}>
            <option value="">Choisir…</option>
            {refs.categories.filter((c: any) => c.is_active).map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.parent_name ? `${c.parent_name} › ` : ''}
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Marque">
          <Select value={f.brand} onChange={set('brand')}>
            <option value="">—</option>
            {refs.brands.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unité de base" required error={errors.unit}>
          <Select value={f.unit} onChange={set('unit')}>
            {refs.units.map((u: any) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.code})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="SKU" error={errors.sku} hint="Généré automatiquement si vide">
          <Input value={f.sku} onChange={set('sku')} />
        </Field>
        <Field label="Code-barres (EAN-13, Code128…)" error={errors.barcode}>
          <Input value={f.barcode} onChange={set('barcode')} placeholder="Scannez ou saisissez" />
        </Field>
        <Field label="Taxe">
          <Select value={f.tax} onChange={set('tax')}>
            <option value="">Héritée de la catégorie</option>
            {refs.taxes.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name} ({Number(t.rate)} %)
              </option>
            ))}
          </Select>
        </Field>
        <div className="md:col-span-3">
          <div className="label mb-3 mt-2">Prix de vente {!canPrice && '· lecture seule'}</div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Prix de vente TTC" required error={errors.price_retail}>
              <Input disabled={!canPrice} inputMode="numeric" value={f.price_retail} onChange={set('price_retail')} />
            </Field>
            <Field label="Prix de gros" hint="Appliqué dès la quantité minimale ou aux grossistes">
              <Input disabled={!canPrice} inputMode="numeric" value={f.price_wholesale ?? ''} onChange={set('price_wholesale')} />
            </Field>
            <Field label="Quantité min. gros">
              <Input disabled={!canPrice} inputMode="numeric" value={f.wholesale_min_qty ?? ''} onChange={set('wholesale_min_qty')} />
            </Field>
            <Field label="Prix promotionnel">
              <Input disabled={!canPrice} inputMode="numeric" value={f.promo_price ?? ''} onChange={set('promo_price')} />
            </Field>
            <Field label="Début promo">
              <Input disabled={!canPrice} type="date" value={f.promo_start ?? ''} onChange={set('promo_start')} />
            </Field>
            <Field label="Fin promo">
              <Input disabled={!canPrice} type="date" value={f.promo_end ?? ''} onChange={set('promo_end')} />
            </Field>
            {priceChanged && (
              <Field label="Motif du changement de prix" className="md:col-span-3" hint="Historisé avec l'ancien et le nouveau prix">
                <Input value={f.price_reason} onChange={set('price_reason')} placeholder="Ex. hausse fournisseur" />
              </Field>
            )}
          </div>
        </div>
        <Field label="Stock minimum (alerte)">
          <Input inputMode="numeric" value={f.min_stock} onChange={set('min_stock')} />
        </Field>
        <Field label="Stock maximum (surstock)">
          <Input inputMode="numeric" value={f.max_stock ?? ''} onChange={set('max_stock')} />
        </Field>
        <Field label="Statut">
          <Select value={f.status} onChange={set('status')}>
            <option value="active">Actif</option>
            <option value="inactive">Inactif (non vendable)</option>
          </Select>
        </Field>
        <Field label="Description" className="md:col-span-2">
          <Textarea value={f.description} onChange={set('description')} />
        </Field>
        <div className="space-y-4">
          <Field label="Étiquettes">
            <Input value={f.tags} onChange={set('tags')} placeholder="bio, local…" />
          </Field>
          <Switch checked={!!f.is_favorite} onChange={(v) => setF({ ...f, is_favorite: v })} label="Favori au point de vente" />
        </div>
      </div>
    </Modal>
  )
}
