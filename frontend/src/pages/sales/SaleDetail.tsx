import { useQueryClient } from '@tanstack/react-query'
import { Ban, FileText, HandCoins, Printer, ShieldCheck, Undo2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { confirm } from '@/components/confirm'
import { PaymentForm, usePaymentMethods } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { Badge, Button, Card, CardHeader, Field, InfoRow, Input, Modal, Select, Skeleton, StatusBadge } from '@/components/ui'
import { newIdempotencyKey, openPdf, post } from '@/lib/api'
import { date, money, qty } from '@/lib/format'
import { showError, useApi } from '@/lib/hooks'
import { useCan } from '@/store/auth'

export default function SaleDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const can = useCan()
  const { data: s, isLoading } = useApi<any>(['sale', id], `/sales/${id}`)
  const [payOpen, setPayOpen] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sale', id] })
    qc.invalidateQueries({ queryKey: ['sales'] })
  }

  if (isLoading || !s) return <Page><Skeleton className="h-96 rounded-3xl" /></Page>

  const pay = async (v: any) => {
    setLoading(true)
    try {
      await post(`/sales/${id}/pay`, v, newIdempotencyKey())
      toast.success('Paiement enregistré')
      setPayOpen(false)
      refresh()
    } catch (e) {
      showError(e)
    } finally {
      setLoading(false)
    }
  }

  const cancel = async () => {
    const r = await confirm({
      title: `Annuler ${s.number} ?`,
      message: (
        <div className="space-y-2">
          <p>Un avoir total sera créé ; la facture sera marquée « annulée » en conservant son numéro.</p>
          <p className="text-muted">Les articles réintégrables seront remis en stock et les paiements remboursés (sortie de caisse).</p>
        </div>
      ),
      danger: true,
      requireReason: true,
      confirmLabel: 'Annuler la facture',
    })
    if (!r.ok) return
    try {
      await post(`/sales/${id}/cancel`, { reason: r.reason, restock: true, settlement: 'refund' })
      toast.success('Facture annulée par avoir')
      refresh()
    } catch (e) {
      showError(e)
    }
  }

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: 'Ventes', to: '/sales' }, { label: s.number }]}
        title={s.type === 'pos' ? 'Ticket' : 'Facture'}
        accent={s.number}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} /> {date(s.created_at, true)} · {s.warehouse_name} · vendu par {s.seller_name}
          </span>
        }
        actions={
          <>
            <Button variant="soft" icon={<Printer size={16} />} onClick={() => openPdf(`/sales/${id}/pdf?paper=ticket`).then(refresh)}>
              Ticket
            </Button>
            <Button variant="soft" icon={<FileText size={16} />} onClick={() => openPdf(`/sales/${id}/pdf`).then(refresh)}>
              PDF A4
            </Button>
            {can('sales.cancel') && s.status !== 'cancelled' && (
              <>
                <Button variant="soft" icon={<Undo2 size={16} />} onClick={() => setCreditOpen(true)}>
                  Retour / avoir
                </Button>
                <Button variant="ghost" className="text-danger" icon={<Ban size={16} />} onClick={cancel}>
                  Annuler
                </Button>
              </>
            )}
            {can('sales.payment') && Number(s.balance) > 0 && s.status !== 'cancelled' && (
              <Button variant="gradient" icon={<HandCoins size={16} />} onClick={() => setPayOpen(true)}>
                Encaisser {money(s.balance)}
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card className="overflow-hidden">
            <CardHeader title="Lignes" subtitle={`${s.items.length} article(s)`} />
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[600px] text-[13.5px]">
                <thead>
                  <tr className="border-y hairline">
                    {['Désignation', 'Qté', 'P.U.', 'Remise', 'TVA', 'Total'].map((h, i) => (
                      <th key={h} className={`label px-5 py-2.5 ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.items.map((it: any) => (
                    <tr key={it.id} className="border-b hairline last:border-0">
                      <td className="px-5 py-3">
                        <div className="font-medium">{it.description}</div>
                        <div className="text-[11.5px] text-muted">
                          {it.product_sku}
                          {Number(it.returned_qty) > 0 && <span className="ml-2 text-rose">· {qty(it.returned_qty)} retourné(s)</span>}
                        </div>
                      </td>
                      <td className="num px-5 text-right">{qty(it.quantity)} {it.unit}</td>
                      <td className="num px-5 text-right">{money(it.unit_price)}</td>
                      <td className="num px-5 text-right text-rose">{Number(it.discount_amount) ? `−${money(it.discount_amount)}` : '—'}</td>
                      <td className="num px-5 text-right text-muted">{Number(it.tax_rate)} %</td>
                      <td className="num px-5 text-right font-semibold">{money(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {s.credit_notes.length > 0 && (
            <Card>
              <CardHeader title="Avoirs liés" icon={<Undo2 size={16} />} />
              <div className="space-y-2 p-5">
                {s.credit_notes.map((n: any) => (
                  <div key={n.id} className="rounded-2xl border hairline p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold">{n.number}</div>
                      <div className="num font-semibold text-rose">−{money(n.total)}</div>
                    </div>
                    <div className="mt-1 text-[12.5px] text-muted">
                      {date(n.created_at, true)} · {n.created_by_name} · {n.reason}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone="violet">{n.settlement === 'refund' ? `Remboursé ${money(n.refunded_amount)}` : n.settlement === 'credit' ? 'Crédit client' : 'Imputé sur la facture'}</Badge>
                      {n.items.map((i: any) => (
                        <Badge key={i.id} tone={i.condition === 'resellable' ? 'green' : 'red'}>
                          {qty(i.quantity)} × {i.description} · {i.condition === 'resellable' ? 'réintégré' : 'démarque'}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card glow className="p-6">
            <div className="label">Total TTC</div>
            <div className="num mt-1 font-display text-4xl font-extrabold">{money(s.total)}</div>
            <div className="mt-5 divide-y divide-[var(--glass-border)]">
              <InfoRow label="Total HT" value={money(s.subtotal)} />
              <InfoRow label="Remises" value={Number(s.discount_total) ? `−${money(s.discount_total)}` : '—'} />
              <InfoRow label="TVA" value={money(s.tax_total)} />
              {s.margin !== undefined && <InfoRow label="Marge" value={<span className="text-mint">{money(s.margin)}</span>} />}
              <InfoRow label="Payé" value={money(s.paid_amount)} />
              {Number(s.credited_amount) > 0 && <InfoRow label="Avoirs" value={`−${money(s.credited_amount)}`} />}
              <InfoRow label="Reste à payer" strong value={<span className={Number(s.balance) > 0 ? 'text-warn' : ''}>{money(s.balance)}</span>} />
            </div>
            {s.discount_authorized_by_name && (
              <div className="mt-4 flex items-center gap-2 rounded-2xl bg-warn/10 px-3 py-2 text-[12px] text-warn">
                <ShieldCheck size={14} /> Remise autorisée par {s.discount_authorized_by_name}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Client" />
            <div className="p-6 pt-3">
              <button onClick={() => !s.customer_is_walkin && navigate(`/customers/${s.customer}`)} className="text-left">
                <div className="font-semibold hover:underline">{s.customer_name}</div>
                <div className="text-[12.5px] text-muted">{s.customer_phone || (s.customer_is_walkin ? 'Vente comptoir' : '')}</div>
              </button>
              {s.due_date && <div className="mt-2 text-[12.5px] text-muted">Échéance : {date(s.due_date)}</div>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Paiements" icon={<Wallet size={16} />} />
            <div className="space-y-2 p-5 pt-3">
              {s.payments.length === 0 && <div className="py-4 text-center text-[13px] text-muted">Aucun paiement.</div>}
              {s.payments.map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between rounded-2xl border hairline px-4 py-3 text-[13px]">
                  <div>
                    <div className="font-medium">{p.method}</div>
                    <div className="text-[11.5px] text-muted">
                      {p.number} · {date(p.paid_at, true)}
                      {p.reference && ` · ${p.reference}`}
                    </div>
                  </div>
                  <div className={`num font-semibold ${Number(p.amount) < 0 ? 'text-rose' : ''}`}>{money(p.amount)}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <PaymentForm open={payOpen} onClose={() => setPayOpen(false)} title="Encaisser un paiement" subtitle={s.number} max={Number(s.balance)} loading={loading} onSubmit={pay} />
      <CreditNoteModal open={creditOpen} onClose={() => setCreditOpen(false)} sale={s} onDone={refresh} />
    </Page>
  )
}

function CreditNoteModal({ open, onClose, sale, onDone }: { open: boolean; onClose: () => void; sale: any; onDone: () => void }) {
  const [lines, setLines] = useState<Record<string, { quantity: string; condition: string }>>({})
  const [reason, setReason] = useState('')
  const [settlement, setSettlement] = useState('refund')
  const [method, setMethod] = useState('')
  const [loading, setLoading] = useState(false)
  const { data: methods } = usePaymentMethods()
  const total = sale.items.reduce((a: number, it: any) => a + (Number(lines[it.id]?.quantity || 0) / Number(it.quantity)) * Number(it.line_total), 0)
  const submit = async () => {
    setLoading(true)
    try {
      await post(`/sales/${sale.id}/credit-notes`, {
        reason,
        settlement,
        method_id: method || undefined,
        items: Object.entries(lines).filter(([, v]) => Number(v.quantity) > 0).map(([k, v]) => ({ sale_item_id: k, quantity: v.quantity, condition: v.condition })),
      })
      toast.success('Avoir créé')
      onDone()
      onClose()
      setLines({})
      setReason('')
    } catch (e) {
      showError(e)
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Retour client / avoir"
      subtitle="Montants et taxes calculés au prix d'origine."
      footer={
        <>
          <span className="mr-auto text-[13px] text-muted">
            Montant de l'avoir : <span className="num font-semibold text-fg">{money(total)}</span>
          </span>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button loading={loading} disabled={total <= 0 || reason.trim().length < 3} onClick={submit}>
            Valider l'avoir
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        {sale.items.map((it: any) => {
          const left = Number(it.quantity) - Number(it.returned_qty)
          return (
            <div key={it.id} className="grid items-center gap-3 rounded-2xl border hairline p-3 sm:grid-cols-[1fr_110px_170px]">
              <div>
                <div className="text-[13.5px] font-medium">{it.description}</div>
                <div className="text-[12px] text-muted">
                  Vendu {qty(it.quantity)} · retournable {qty(left)}
                </div>
              </div>
              <Input inputMode="decimal" placeholder="Qté" disabled={left <= 0} value={lines[it.id]?.quantity || ''} onChange={(e) => setLines({ ...lines, [it.id]: { condition: lines[it.id]?.condition || 'resellable', quantity: e.target.value } })} />
              <Select disabled={left <= 0} value={lines[it.id]?.condition || 'resellable'} onChange={(e) => setLines({ ...lines, [it.id]: { quantity: lines[it.id]?.quantity || '', condition: e.target.value } })}>
                <option value="resellable">Réintégrable</option>
                <option value="defective">Défectueux</option>
                <option value="destroyed">Détruit</option>
              </Select>
            </div>
          )
        })}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Règlement de l'avoir">
            <Select value={settlement} onChange={(e) => setSettlement(e.target.value)}>
              <option value="refund">Remboursement</option>
              <option value="credit" disabled={sale.customer_is_walkin}>Crédit sur le compte client</option>
            </Select>
          </Field>
          {settlement === 'refund' && (
            <Field label="Rembourser via">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Espèces (caisse ouverte)</option>
                {(methods || []).filter((m) => m.type !== 'cash').map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Motif" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. article défectueux, erreur de taille…" />
        </Field>
        <p className="text-[12px] text-muted">Si la facture n'est pas soldée, l'avoir est d'abord imputé sur le reste dû.</p>
      </div>
    </Modal>
  )
}
