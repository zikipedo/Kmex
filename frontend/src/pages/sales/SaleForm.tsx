import { Check, Trash2, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { usePaymentMethods } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { CustomerPicker, PinPrompt, ProductSearch, type CustomerLite } from '@/components/pickers'
import { Avatar, Button, Card, CardHeader, EmptyState, Field, InfoRow, Input, ProductThumb, Select, Textarea } from '@/components/ui'
import { ApiError, newIdempotencyKey, post } from '@/lib/api'
import { computeDocument } from '@/lib/calc'
import { money, todayISO } from '@/lib/format'
import { showError } from '@/lib/hooks'
import { useAuth, useCan } from '@/store/auth'

type Line = { product: any; quantity: number; unit_price: number; discount_value: number }

export default function SaleForm({ mode = 'invoice' }: { mode?: 'invoice' | 'quote' }) {
  const navigate = useNavigate()
  const can = useCan()
  const me = useAuth((s) => s.me)!
  const wh = useAuth((s) => s.warehouseId)
  const [customer, setCustomer] = useState<CustomerLite | null>(null)
  const [picker, setPicker] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [globalValue, setGlobalValue] = useState(0)
  const [notes, setNotes] = useState('')
  const [validUntil, setValidUntil] = useState(todayISO(15))
  const [payMethod, setPayMethod] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payRef, setPayRef] = useState('')
  const [loading, setLoading] = useState(false)
  const [pin, setPin] = useState<{ kind: 'discount' | 'credit'; msg: string } | null>(null)
  const [key] = useState(newIdempotencyKey())
  const { data: methods } = usePaymentMethods()
  const canEditPrice = can('catalog.price.edit')
  const isQuote = mode === 'quote'

  const doc = useMemo(
    () => computeDocument(lines.map((l) => ({ quantity: l.quantity, unit_price: l.unit_price, discount_type: 'percent', discount_value: l.discount_value, tax_rate: Number(l.product.tax_rate || 0) })), 'percent', globalValue, !!me.company.settings.prices_include_tax, me.company.currency_decimals),
    [lines, globalValue, me.company],
  )

  const add = (p: any) => {
    setLines((ls) => (ls.find((l) => l.product.id === p.id) ? ls.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l)) : [...ls, { product: p, quantity: 1, unit_price: Number(p.price_retail), discount_value: 0 }]))
  }
  const upd = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const submit = async (extra: Record<string, string> = {}) => {
    if (!customer) return toast.error('Choisissez un client')
    setLoading(true)
    const items = lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity, unit_price: canEditPrice ? l.unit_price : undefined, discount_type: 'percent', discount_value: l.discount_value }))
    try {
      if (isQuote) {
        const q = await post('/quotes', { customer_id: customer.id, warehouse_id: wh, items, global_discount_type: 'percent', global_discount_value: globalValue, valid_until: validUntil, notes, send: true })
        toast.success(`Devis ${q.number} créé`)
        navigate('/quotes')
      } else {
        const payments = payMethod && Number(payAmount) > 0 ? [{ method_id: payMethod, amount: payAmount, reference: payRef }] : []
        const s = await post('/sales', { type: 'invoice', customer_id: customer.id, warehouse_id: wh, items, global_discount_type: 'percent', global_discount_value: globalValue, notes, payments, ...extra }, key)
        toast.success(`Facture ${s.number} validée`)
        navigate(`/sales/${s.id}`)
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DISCOUNT_AUTH_REQUIRED') setPin({ kind: 'discount', msg: e.message })
      else if (e instanceof ApiError && e.code === 'CREDIT_LIMIT_EXCEEDED') setPin({ kind: 'credit', msg: e.message })
      else showError(e)
    } finally {
      setLoading(false)
    }
  }

  const method = methods?.find((m) => m.id === payMethod)

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: isQuote ? 'Devis' : 'Ventes', to: isQuote ? '/quotes' : '/sales' }, { label: 'Nouveau' }]}
        title={isQuote ? 'Nouveau' : 'Nouvelle'}
        accent={isQuote ? 'devis' : 'facture'}
        subtitle={isQuote ? "Offre chiffrée sans impact sur le stock, convertible en facture tant qu'elle est valide." : 'Facture classique : client obligatoire, paiement total, partiel ou à crédit.'}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card className="p-5">
            <button onClick={() => setPicker(true)} className="flex w-full items-center gap-4 rounded-2xl border border-dashed hairline p-4 text-left transition hover:bg-line/[0.04]">
              {customer ? <Avatar name={customer.name} size={44} /> : <div className="grid h-11 w-11 place-items-center rounded-full bg-line/[0.06]"><UserRound size={18} /></div>}
              <div>
                <div className="font-semibold">{customer?.name || 'Sélectionner un client'}</div>
                <div className="text-[12.5px] text-muted">{customer ? `${customer.phone || customer.code} · limite de crédit ${money(customer.credit_limit || 0)}` : 'Obligatoire pour une facture ou un devis'}</div>
              </div>
            </button>
          </Card>
          <Card>
            <CardHeader title="Articles" subtitle="Recherchez ou scannez pour ajouter" />
            <div className="p-5">
              <ProductSearch onPick={add} warehouse={wh} />
            </div>
            {lines.length === 0 ? (
              <EmptyState title="Aucun article" text="Ajoutez des produits ou services à la facture." />
            ) : (
              <div className="divide-y divide-[var(--glass-border)] px-3 pb-3">
                {lines.map((l, i) => (
                  <div key={l.product.id} className="grid items-center gap-3 px-2 py-3 md:grid-cols-[1fr_90px_130px_90px_120px_36px]">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductThumb image={l.product.image} icon={l.product.category_icon} color={l.product.category_color} size={40} rounded="rounded-xl" />
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-medium">{l.product.name}</div>
                        <div className="text-[11.5px] text-muted">Stock {Number(l.product.stock)} · TVA {Number(l.product.tax_rate)} %</div>
                      </div>
                    </div>
                    <Input inputMode="decimal" value={l.quantity} onChange={(e) => upd(i, { quantity: Number(e.target.value.replace(',', '.')) || 0 })} />
                    <Input inputMode="decimal" disabled={!canEditPrice} value={l.unit_price} onChange={(e) => upd(i, { unit_price: Number(e.target.value) || 0 })} title={canEditPrice ? '' : 'Modification de prix non autorisée'} />
                    <Input inputMode="decimal" placeholder="Rem. %" value={l.discount_value || ''} onChange={(e) => upd(i, { discount_value: Number(e.target.value.replace(',', '.')) || 0 })} />
                    <div className="num text-right font-semibold">{money(doc.lines[i]?.line_total || 0)}</div>
                    <button onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="text-muted hover:text-danger">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-5">
            <Field label="Notes (imprimées sur le document)">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Conditions, référence client, livraison…" />
            </Field>
          </Card>
        </div>
        <div className="space-y-4">
          <Card glow className="sticky top-24 p-6">
            <div className="label">Total TTC</div>
            <div className="num mt-1 font-display text-4xl font-extrabold">{money(doc.total)}</div>
            <div className="mt-4 divide-y divide-[var(--glass-border)]">
              <InfoRow label="Total HT" value={money(doc.subtotal)} />
              <InfoRow label="TVA" value={money(doc.tax)} />
              <InfoRow label="Remises" value={doc.discount ? `−${money(doc.discount)}` : '—'} />
            </div>
            <Field label="Remise globale (%)" className="mt-4" hint={`Votre plafond : ${me.max_discount_pct} %`}>
              <Input inputMode="decimal" value={globalValue || ''} onChange={(e) => setGlobalValue(Number(e.target.value.replace(',', '.')) || 0)} />
            </Field>
            {isQuote ? (
              <Field label="Valable jusqu'au" className="mt-4">
                <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </Field>
            ) : (
              <div className="mt-4 space-y-3 rounded-2xl border hairline p-4">
                <div className="label text-[10px]">Paiement à la validation (optionnel)</div>
                <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="">Aucun — vente à crédit</option>
                  {(methods || []).filter((m) => m.is_active).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
                {payMethod && (
                  <>
                    <Input inputMode="numeric" placeholder="Montant" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^\d.]/g, ''))} />
                    <button className="text-[12px] text-accent" onClick={() => setPayAmount(String(doc.total))}>
                      Payer la totalité
                    </button>
                    {method?.requires_reference && <Input placeholder="Référence *" value={payRef} onChange={(e) => setPayRef(e.target.value)} />}
                  </>
                )}
              </div>
            )}
            <Button className="mt-5 w-full" size="lg" variant="gradient" loading={loading} disabled={!lines.length || !customer} icon={<Check size={18} />} onClick={() => submit()}>
              {isQuote ? 'Créer le devis' : 'Valider la facture'}
            </Button>
          </Card>
        </div>
      </div>
      <CustomerPicker open={picker} onClose={() => setPicker(false)} onPick={(c) => { if (c) setCustomer(c); setPicker(false) }} />
      <PinPrompt
        open={!!pin}
        title={pin?.kind === 'credit' ? 'Dérogation de crédit' : 'Autorisation de remise'}
        message={pin?.msg}
        onClose={() => setPin(null)}
        onSubmit={(code) => {
          const k = pin?.kind
          setPin(null)
          submit(k === 'credit' ? { credit_override_pin: code } : { override_pin: code })
        }}
      />
    </Page>
  )
}
