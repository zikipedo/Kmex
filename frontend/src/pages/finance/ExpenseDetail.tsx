import { useQueryClient } from '@tanstack/react-query'
import { Ban, Check, FileText, HandCoins, Paperclip, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { confirm } from '@/components/confirm'
import { usePaymentMethods } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { Badge, Button, Card, CardHeader, DynIcon, Field, InfoRow, Input, Modal, Select, Skeleton, StatusBadge } from '@/components/ui'
import { post, upload } from '@/lib/api'
import { date, money } from '@/lib/format'
import { showError, useApi } from '@/lib/hooks'
import { useAuth, useCan } from '@/store/auth'

export default function ExpenseDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const can = useCan()
  const me = useAuth((s) => s.me)!
  const { data: e } = useApi<any>(['expense', id], `/expenses/${id}`)
  const { data: methods } = usePaymentMethods()
  const [pay, setPay] = useState(false)
  const [method, setMethod] = useState('')
  const [ref, setRef] = useState('')
  const [viewer, setViewer] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  if (!e) return <Page><Skeleton className="h-96 rounded-3xl" /></Page>
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['expense', id] })
    qc.invalidateQueries({ queryKey: ['expenses'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }
  const run = async (fn: () => Promise<any>, msg: string) => {
    try {
      await fn()
      toast.success(msg)
      refresh()
      return true
    } catch (err) {
      showError(err)
      return false
    }
  }
  const mine = e.created_by === me.user.id
  return (
    <Page>
      <PageHeader
        crumbs={[{ label: 'Dépenses', to: '/expenses' }, { label: e.number || 'Brouillon' }]}
        title="Dépense"
        accent={e.number || 'brouillon'}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={e.status} label={e.status_label} /> {e.category_name} · {date(e.expense_date)}</span>}
        actions={
          <>
            {e.status === 'draft' && (mine || can('expense.edit')) && <Button variant="gradient" onClick={() => run(() => post(`/expenses/${id}/submit`), 'Dépense soumise')}>Soumettre</Button>}
            {e.status === 'pending' && can('expense.approve') && !mine && (
              <>
                <Button variant="ghost" className="text-danger" icon={<X size={16} />} onClick={async () => { const r = await confirm({ title: 'Rejeter la dépense ?', requireReason: true, danger: true, confirmLabel: 'Rejeter' }); if (r.ok) run(() => post(`/expenses/${id}/reject`, { reason: r.reason }), 'Dépense rejetée') }}>Rejeter</Button>
                <Button variant="gradient" icon={<Check size={16} />} onClick={() => run(() => post(`/expenses/${id}/approve`), 'Dépense approuvée')}>Approuver</Button>
              </>
            )}
            {e.status === 'approved' && can('expense.pay') && <Button variant="gradient" icon={<HandCoins size={16} />} onClick={() => setPay(true)}>Payer</Button>}
            {['paid', 'approved', 'pending'].includes(e.status) && can('expense.cancel') && (
              <Button variant="ghost" className="text-danger" icon={<Ban size={16} />} onClick={async () => { const r = await confirm({ title: 'Annuler cette dépense ?', message: e.status === 'paid' ? `Une extourne de ${money(e.amount)} sera créée et la caisse / le compte restauré. La dépense reste consultable.` : 'La dépense sera marquée annulée.', requireReason: true, danger: true, confirmLabel: 'Annuler la dépense' }); if (r.ok) run(() => post(`/expenses/${id}/cancel`, { reason: r.reason }), 'Dépense annulée par extourne') }}>Annuler</Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card glow className="p-6">
            <div className="flex items-start gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl" style={{ background: `${e.category_color}22`, color: e.category_color }}><DynIcon name={e.category_icon} size={24} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold">{e.description}</div>
                <div className="text-[13px] text-muted">{e.payee_name || 'Bénéficiaire non précisé'} · {e.warehouse_name || 'Siège'}</div>
              </div>
              <div className="num font-display text-3xl font-extrabold">{money(e.amount)}</div>
            </div>
            {e.reject_reason && <div className="mt-4 rounded-2xl bg-danger/10 px-4 py-3 text-[13px] text-danger">Rejetée : {e.reject_reason}</div>}
            {e.cancel_reason && <div className="mt-4 rounded-2xl bg-line/5 px-4 py-3 text-[13px] text-muted">Annulée par {e.cancelled_by_name} : {e.cancel_reason}</div>}
          </Card>
          <Card>
            <CardHeader title="Justificatifs" subtitle="Empreinte SHA-256 : un justificatif réutilisé déclenche une alerte" icon={<Paperclip size={16} />} action={!['cancelled', 'rejected'].includes(e.status) && can('expense.create') && <Button size="sm" variant="soft" onClick={() => fileRef.current?.click()}>Ajouter</Button>} />
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
              {e.attachments.length === 0 && <div className="col-span-full py-6 text-center text-[13px] text-muted">{e.receipt_required ? <Badge tone="red">Justificatif requis pour ce montant</Badge> : 'Aucun justificatif.'}</div>}
              {e.attachments.map((a: any) => (
                <button key={a.id} onClick={() => (a.mime === 'application/pdf' ? window.open(a.url, '_blank') : setViewer(a.url))} className="group relative overflow-hidden rounded-2xl border hairline">
                  {a.thumb_url ? <img src={a.thumb_url} className="aspect-square w-full object-cover transition group-hover:scale-105" alt="" /> : <div className="grid aspect-square place-items-center"><FileText size={28} className="text-muted" /></div>}
                  {a.duplicate_of && <span className="absolute inset-x-1 bottom-1"><Badge tone="red">Doublon : {a.duplicate_of}</Badge></span>}
                </button>
              ))}
            </div>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={async (ev) => { const files = Array.from(ev.target.files || []); if (!files.length) return; try { const r = await upload(`/expenses/${id}/attachments`, files); r.warnings?.forEach((w: string) => toast.warning(w)); toast.success('Justificatif ajouté'); refresh() } catch (err) { showError(err) } }} />
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="p-6">
            <div className="label mb-2 text-[10px]">Circuit</div>
            <div className="divide-y divide-[var(--glass-border)]">
              <InfoRow label="Saisie" value={<span>{e.created_by_name}<br /><span className="text-[11.5px] text-muted">{date(e.created_at, true)}</span></span>} />
              <InfoRow label="Approbation" value={e.approved_by_name ? <span>{e.approved_by_name}<br /><span className="text-[11.5px] text-muted">{date(e.approved_at, true)}</span></span> : '—'} />
              <InfoRow label="Paiement" value={e.paid_by_name ? <span>{e.paid_by_name} · {e.method_name}<br /><span className="text-[11.5px] text-muted">{date(e.paid_at, true)} {e.payment_reference}</span></span> : '—'} />
            </div>
          </Card>
          {e.approvals.length > 0 && (
            <Card className="p-6">
              <div className="label mb-2 text-[10px]">Historique d'approbation</div>
              {e.approvals.map((a: any, i: number) => (
                <div key={i} className="py-1.5 text-[13px]"><Badge tone={a.decision === 'approved' ? 'green' : 'red'}>{a.decision === 'approved' ? 'Approuvée' : 'Rejetée'}</Badge> par {a.approver} {a.comment && <span className="text-muted">· {a.comment}</span>}</div>
              ))}
            </Card>
          )}
        </div>
      </div>
      <Modal open={pay} onClose={() => setPay(false)} size="sm" title="Payer la dépense" subtitle={money(e.amount)} footer={<><Button variant="ghost" onClick={() => setPay(false)}>Annuler</Button><Button disabled={!method} onClick={async () => { if (await run(() => post(`/expenses/${id}/pay`, { method_id: method, reference: ref }), 'Dépense payée')) setPay(false) }}>Décaisser</Button></>}>
        <div className="space-y-4 pb-2">
          <Field label="Moyen de paiement"><Select value={method} onChange={(ev) => setMethod(ev.target.value)}><option value="">Choisir…</option>{(methods || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          {methods?.find((m) => m.id === method)?.requires_reference && <Field label="Référence" required><Input value={ref} onChange={(ev) => setRef(ev.target.value)} /></Field>}
        </div>
      </Modal>
      <Modal open={!!viewer} onClose={() => setViewer(null)} size="lg" title="Justificatif">
        {viewer && <img src={viewer} alt="" className="mx-auto max-h-[70vh] rounded-2xl" />}
      </Modal>
    </Page>
  )
}
