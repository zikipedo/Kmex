import { Check, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { usePaymentMethods, useWarehouses } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { ProductSearch } from '@/components/pickers'
import { Button, Card, CardHeader, EmptyState, Field, InfoRow, Input, ProductThumb, Select, Textarea } from '@/components/ui'
import { get, newIdempotencyKey, post } from '@/lib/api'
import { money, todayISO } from '@/lib/format'
import { showError, useApi } from '@/lib/hooks'
import { useAuth } from '@/store/auth'

type Line = { product: any; quantity: string; unit_cost: string; tax_rate: string }

export default function PurchaseOrderForm({ direct = false }: { direct?: boolean }) {
  const navigate = useNavigate()
  const wh = useAuth((s) => s.warehouseId)
  const { data: suppliers } = useApi<any>(['suppliers-all'], '/suppliers', { limit: 100 })
  const { data: warehouses } = useWarehouses()
  const { data: methods } = usePaymentMethods()
  const [supplier, setSupplier] = useState('')
  const [warehouse, setWarehouse] = useState(wh || '')
  const [expected, setExpected] = useState(todayISO(7))
  const [ref, setRef] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [payMethod, setPayMethod] = useState('')
  const [payRef, setPayRef] = useState('')
  const [loading, setLoading] = useState(false)

  const totals = useMemo(() => {
    const sub = lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0)
    const tax = lines.reduce((a, l) => a + (Number(l.quantity || 0) * Number(l.unit_cost || 0) * Number(l.tax_rate || 0)) / 100, 0)
    return { sub, tax, total: sub + tax }
  }, [lines])

  const add = (p: any) => {
    if (lines.find((l) => l.product.id === p.id)) return
    setLines([...lines, { product: p, quantity: String(Math.max(Number(p.min_stock) * 2, 1)), unit_cost: String(Math.round(Number(p.cost_last ?? p.cost_avg ?? 0))), tax_rate: '0' }])
  }
  const suggest = async () => {
    try {
      const rows = await get<any[]>('/purchase-orders/suggestions', { warehouse })
      const filtered = rows.filter((r) => !supplier || r.supplier_id === supplier)
      if (!filtered.length) return toast('Aucun produit sous le seuil pour ce fournisseur.')
      const prods = await get('/products', { all: 1, warehouse })
      const map = new Map(prods.data.map((p: any) => [p.id, p]))
      setLines(filtered.map((r) => ({ product: map.get(r.product_id) || { id: r.product_id, name: r.name }, quantity: String(Math.ceil(Number(r.suggested))), unit_cost: String(Math.round(Number(r.cost))), tax_rate: '0' })))
      if (!supplier && filtered[0]?.supplier_id) setSupplier(filtered[0].supplier_id)
      toast.success(`${filtered.length} produit(s) à réapprovisionner ajoutés`)
    } catch (e) {
      showError(e)
    }
  }

  const submit = async () => {
    setLoading(true)
    try {
      if (direct) {
        const inv = await post('/purchase-orders/direct', {
          supplier_id: supplier, warehouse_id: warehouse, supplier_ref: ref, notes,
          items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity, unit_cost: l.unit_cost, tax_rate: l.tax_rate })),
          payment: payMethod ? { method_id: payMethod, amount: Math.round(totals.total), reference: payRef } : null,
        }, newIdempotencyKey())
        toast.success(`Achat enregistré : stock entré, facture ${inv.number} créée`)
        navigate('/purchases/invoices')
      } else {
        const o = await post('/purchase-orders', {
          supplier, warehouse, order_date: todayISO(), expected_date: expected, notes,
          items: lines.map((l) => ({ product: l.product.id, qty_ordered: l.quantity, unit_price: l.unit_cost, tax_rate: l.tax_rate })),
        })
        toast.success('Commande créée en brouillon')
        navigate(`/purchases/orders/${o.id}`)
      }
    } catch (e) {
      showError(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: 'Commandes', to: '/purchases/orders' }, { label: direct ? 'Achat direct' : 'Nouvelle commande' }]}
        title={direct ? 'Achat' : 'Nouvelle'}
        accent={direct ? 'direct' : 'commande'}
        subtitle={direct ? 'Petit commerce : réception + facture (+ paiement) en un seul écran.' : 'La commande augmente le stock attendu ; le stock entre à la réception.'}
        actions={<Button variant="soft" icon={<Sparkles size={16} />} onClick={suggest}>Suggestions de réappro</Button>}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label="Fournisseur" required>
              <Select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">Choisir…</option>
                {(suppliers?.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Dépôt de livraison">
              <Select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                {(warehouses || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
            {direct ? (
              <Field label="N° facture fournisseur">
                <Input value={ref} onChange={(e) => setRef(e.target.value)} />
              </Field>
            ) : (
              <Field label="Livraison prévue">
                <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
              </Field>
            )}
          </Card>
          <Card>
            <CardHeader title="Lignes" subtitle="Quantités et coûts d'achat HT" />
            <div className="p-5"><ProductSearch onPick={add} warehouse={warehouse} /></div>
            {lines.length === 0 ? (
              <EmptyState title="Aucune ligne" text="Ajoutez des produits ou utilisez les suggestions de réapprovisionnement." />
            ) : (
              <div className="divide-y divide-[var(--glass-border)] px-3 pb-3">
                <div className="label hidden grid-cols-[1fr_100px_130px_80px_120px_30px] gap-3 px-2 pb-2 md:grid">
                  <span>Produit</span><span>Qté</span><span>Coût unitaire</span><span>TVA %</span><span className="text-right">Total</span><span />
                </div>
                {lines.map((l, i) => (
                  <div key={l.product.id} className="grid items-center gap-3 px-2 py-3 md:grid-cols-[1fr_100px_130px_80px_120px_30px]">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductThumb image={l.product.image} icon={l.product.category_icon} color={l.product.category_color} size={38} rounded="rounded-xl" />
                      <span className="truncate text-[13.5px] font-medium">{l.product.name}</span>
                    </div>
                    <Input inputMode="decimal" value={l.quantity} onChange={(e) => setLines(lines.map((x, idx) => (idx === i ? { ...x, quantity: e.target.value } : x)))} />
                    <Input inputMode="decimal" value={l.unit_cost} onChange={(e) => setLines(lines.map((x, idx) => (idx === i ? { ...x, unit_cost: e.target.value } : x)))} />
                    <Input inputMode="decimal" value={l.tax_rate} onChange={(e) => setLines(lines.map((x, idx) => (idx === i ? { ...x, tax_rate: e.target.value } : x)))} />
                    <span className="num text-right font-semibold">{money(Number(l.quantity) * Number(l.unit_cost))}</span>
                    <button onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="text-muted hover:text-danger"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-5">
            <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </Card>
        </div>
        <Card glow className="h-fit p-6 xl:sticky xl:top-24">
          <div className="label">Total TTC</div>
          <div className="num mt-1 font-display text-4xl font-extrabold">{money(totals.total)}</div>
          <div className="mt-4 divide-y divide-[var(--glass-border)]">
            <InfoRow label="Total HT" value={money(totals.sub)} />
            <InfoRow label="Taxes" value={money(totals.tax)} />
          </div>
          {direct && (
            <div className="mt-4 space-y-3 rounded-2xl border hairline p-4">
              <div className="label text-[10px]">Paiement immédiat (optionnel)</div>
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="">Non — créer une dette fournisseur</option>
                {(methods || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
              {methods?.find((m) => m.id === payMethod)?.requires_reference && <Input placeholder="Référence *" value={payRef} onChange={(e) => setPayRef(e.target.value)} />}
            </div>
          )}
          <Button className="mt-5 w-full" size="lg" variant="gradient" icon={<Check size={18} />} loading={loading} disabled={!supplier || !warehouse || !lines.length} onClick={submit}>
            {direct ? "Enregistrer l'achat" : 'Créer la commande'}
          </Button>
        </Card>
      </div>
    </Page>
  )
}
