import { useQueryClient } from '@tanstack/react-query'
import { FileCheck2, PackageCheck, Send, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { confirm } from '@/components/confirm'
import { Page, PageHeader } from '@/components/page'
import { Badge, Button, Card, CardHeader, Field, InfoRow, Input, Modal, Select, Skeleton, StatusBadge } from '@/components/ui'
import { post } from '@/lib/api'
import { date, money, qty } from '@/lib/format'
import { showError, useApi, useList } from '@/lib/hooks'
import { useCan } from '@/store/auth'

export default function PurchaseOrderDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const can = useCan()
  const { data: o } = useApi<any>(['purchase-order', id], `/purchase-orders/${id}`)
  const { data: receipts } = useList<any>('purchase-receipts', '/purchase-receipts', { order: id })
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [rec, setRec] = useState<Record<string, { quantity: string; condition: string }>>({})
  const [invoice, setInvoice] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  if (!o) return <Page><Skeleton className="h-96 rounded-3xl" /></Page>
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['purchase-order', id] })
    qc.invalidateQueries({ queryKey: ['purchase-receipts'] })
    qc.invalidateQueries({ queryKey: ['purchase-orders'] })
  }
  const run = async (fn: () => Promise<any>, msg: string) => {
    setLoading(true)
    try {
      await fn()
      toast.success(msg)
      refresh()
      return true
    } catch (e) {
      showError(e)
      return false
    } finally {
      setLoading(false)
    }
  }
  const receive = async () => {
    const ok = await run(() => post(`/purchase-orders/${id}/receive`, { items: o.items.map((i: any) => ({ order_item_id: i.id, quantity: rec[i.id]?.quantity ?? i.qty_remaining, condition: rec[i.id]?.condition || 'good' })) }), 'Réception validée : stock et CMUP mis à jour')
    if (ok) setReceiveOpen(false)
  }
  return (
    <Page>
      <PageHeader
        crumbs={[{ label: 'Commandes', to: '/purchases/orders' }, { label: o.number || 'Brouillon' }]}
        title="Commande"
        accent={o.number || 'brouillon'}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={o.status} label={o.status_label} /> {o.supplier_name} → {o.warehouse_name}</span>}
        actions={
          <>
            {o.status === 'draft' && can('purchase.order') && <Button variant="gradient" icon={<Send size={16} />} loading={loading} onClick={() => run(() => post(`/purchase-orders/${id}/send`), 'Commande validée et numérotée')}>Valider & envoyer</Button>}
            {['sent', 'partial'].includes(o.status) && can('purchase.receive') && <Button variant="gradient" icon={<PackageCheck size={16} />} onClick={() => { setRec({}); setReceiveOpen(true) }}>Réceptionner</Button>}
            {['sent', 'partial'].includes(o.status) && can('purchase.order') && (
              <Button variant="ghost" icon={<XCircle size={16} />} onClick={async () => { const r = await confirm({ title: o.status === 'partial' ? 'Solder le reliquat ?' : 'Annuler la commande ?', requireReason: true }); if (r.ok) run(() => post(`/purchase-orders/${id}/close`, { reason: r.reason }), 'Commande clôturée') }}>
                {o.status === 'partial' ? 'Solder' : 'Annuler'}
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader title="Lignes de commande" />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-[13.5px]">
              <thead><tr className="border-y hairline">{['Produit', 'Commandé', 'Reçu', 'Reliquat', 'Coût', 'Total'].map((h, i) => <th key={h} className={`label px-5 py-2.5 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
              <tbody>
                {o.items.map((i: any) => (
                  <tr key={i.id} className="border-b hairline last:border-0">
                    <td className="px-5 py-3 font-medium">{i.product_name}</td>
                    <td className="num px-5 text-right">{qty(i.qty_ordered)}</td>
                    <td className="num px-5 text-right text-mint">{qty(i.qty_received)}</td>
                    <td className="num px-5 text-right">{Number(i.qty_remaining) > 0 ? <Badge tone="amber">{qty(i.qty_remaining)}</Badge> : '—'}</td>
                    <td className="num px-5 text-right">{money(i.unit_price)}</td>
                    <td className="num px-5 text-right font-semibold">{money(i.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-4">
          <Card glow className="p-6">
            <div className="label">Total TTC</div>
            <div className="num mt-1 font-display text-4xl font-extrabold">{money(o.total)}</div>
            <div className="mt-4 divide-y divide-[var(--glass-border)]">
              <InfoRow label="HT" value={money(o.subtotal)} />
              <InfoRow label="Taxes" value={money(o.tax_total)} />
              <InfoRow label="Date" value={date(o.order_date)} />
              <InfoRow label="Livraison prévue" value={o.expected_date ? date(o.expected_date) : '—'} />
              <InfoRow label="Créée par" value={o.created_by_name} />
            </div>
            {o.close_reason && <p className="mt-3 text-[12.5px] text-muted">Motif : {o.close_reason}</p>}
          </Card>
          <Card>
            <CardHeader title="Réceptions" />
            <div className="space-y-2 p-5 pt-3">
              {!receipts?.data.length && <div className="py-4 text-center text-[13px] text-muted">Aucune réception.</div>}
              {receipts?.data.map((r: any) => (
                <div key={r.id} className="rounded-2xl border hairline p-3 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{r.number}</span>
                    <span className="num">{money(r.total)}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">{date(r.received_at, true)} · {r.received_by}</div>
                  <div className="mt-2">
                    {r.is_invoiced ? <Badge tone="green">Facturée</Badge> : can('purchase.invoice') && <Button size="sm" variant="soft" icon={<FileCheck2 size={14} />} onClick={() => setInvoice({ receipt: r, supplier_ref: '', total: '' })}>Saisir la facture</Button>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Modal open={receiveOpen} onClose={() => setReceiveOpen(false)} size="lg" title="Réception de marchandises" subtitle="Saisissez les quantités réellement reçues ; les articles abîmés n'entrent pas en stock." footer={<><Button variant="ghost" onClick={() => setReceiveOpen(false)}>Annuler</Button><Button loading={loading} onClick={receive}>Valider la réception</Button></>}>
        <div className="space-y-2 pb-2">
          {o.items.filter((i: any) => Number(i.qty_remaining) > 0).map((i: any) => (
            <div key={i.id} className="grid items-center gap-3 rounded-2xl border hairline p-3 sm:grid-cols-[1fr_110px_140px]">
              <div>
                <div className="font-medium">{i.product_name}</div>
                <div className="text-[12px] text-muted">Reliquat {qty(i.qty_remaining)}</div>
              </div>
              <Input inputMode="decimal" placeholder={qty(i.qty_remaining)} value={rec[i.id]?.quantity ?? ''} onChange={(e) => setRec({ ...rec, [i.id]: { condition: rec[i.id]?.condition || 'good', quantity: e.target.value } })} />
              <Select value={rec[i.id]?.condition || 'good'} onChange={(e) => setRec({ ...rec, [i.id]: { quantity: rec[i.id]?.quantity ?? String(i.qty_remaining), condition: e.target.value } })}>
                <option value="good">Bon état</option>
                <option value="damaged">Abîmé</option>
              </Select>
            </div>
          ))}
        </div>
      </Modal>

      <Modal open={!!invoice} onClose={() => setInvoice(null)} size="sm" title="Facture fournisseur" subtitle={`Rapprochement avec ${invoice?.receipt?.number} (${money(invoice?.receipt?.total)})`} footer={<><Button variant="ghost" onClick={() => setInvoice(null)}>Annuler</Button><Button loading={loading} onClick={async () => { const ok = await run(() => post('/purchase-invoices', { receipt_id: invoice.receipt.id, supplier_ref: invoice.supplier_ref, total: invoice.total || undefined }), 'Facture enregistrée — dette créée'); if (ok) setInvoice(null) }}>Enregistrer</Button></>}>
        {invoice && (
          <div className="space-y-4 pb-2">
            <Field label="N° de facture du fournisseur"><Input value={invoice.supplier_ref} onChange={(e) => setInvoice({ ...invoice, supplier_ref: e.target.value })} /></Field>
            <Field label="Montant facturé TTC" hint="Laisser vide pour reprendre le montant de la réception ; tout écart sera signalé.">
              <Input inputMode="numeric" value={invoice.total} onChange={(e) => setInvoice({ ...invoice, total: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </Page>
  )
}
