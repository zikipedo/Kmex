import { useQueryClient } from '@tanstack/react-query'
import { Check, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { confirm } from '@/components/confirm'
import { useWarehouses } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { ProductSearch } from '@/components/pickers'
import { DataTable, FilterChips } from '@/components/table'
import { Button, Field, Input, Modal, Select, StatusBadge } from '@/components/ui'
import { post } from '@/lib/api'
import { date, money, qty } from '@/lib/format'
import { showError, useList } from '@/lib/hooks'
import { useAuth, useCan } from '@/store/auth'

export default function Adjustments() {
  const can = useCan()
  const qc = useQueryClient()
  const me = useAuth((s) => s.me)!
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<any>(null)
  const { data, isLoading } = useList<any>('adjustments', '/stock/adjustments', { status, page })
  const refresh = () => qc.invalidateQueries({ queryKey: ['adjustments'] })
  const act = async (a: any, action: 'approve' | 'reject') => {
    let reason = ''
    if (action === 'reject') {
      const r = await confirm({ title: 'Rejeter cet ajustement ?', requireReason: true, danger: true, confirmLabel: 'Rejeter' })
      if (!r.ok) return
      reason = r.reason
    }
    try {
      await post(`/stock/adjustments/${a.id}/${action}`, { reason })
      toast.success(action === 'approve' ? 'Ajustement approuvé et appliqué' : 'Ajustement rejeté')
      setDetail(null)
      refresh()
    } catch (e) {
      showError(e)
    }
  }
  return (
    <Page>
      <PageHeader
        title="Ajustements"
        accent="de stock"
        subtitle={`Corrections motivées ; au-delà de ${money(me.company.settings.adjustment_approval_threshold)} de valeur, une double validation par un autre responsable est exigée.`}
        actions={can('stock.adjust') && <Button variant="gradient" icon={<Plus size={16} />} onClick={() => setOpen(true)}>Nouvel ajustement</Button>}
      />
      <DataTable
        loading={isLoading}
        rows={data?.data}
        toolbar={<FilterChips value={status} onChange={setStatus} options={[{ value: '', label: 'Tous' }, { value: 'pending', label: 'En attente' }, { value: 'applied', label: 'Appliqués' }, { value: 'rejected', label: 'Rejetés' }]} />}
        onRowClick={setDetail}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <span className="font-semibold">{r.number}</span> },
          { key: 'date', header: 'Date', render: (r) => date(r.created_at, true) },
          { key: 'wh', header: 'Dépôt', hideOnMobile: true, render: (r) => r.warehouse_name },
          { key: 'reason', header: 'Motif', render: (r) => <span className="text-muted">{r.reason}</span> },
          { key: 'by', header: 'Demandé par', hideOnMobile: true, render: (r) => r.created_by_name },
          { key: 'value', header: 'Valeur', align: 'right', render: (r) => (r.total_value !== undefined ? <span className="num">{money(r.total_value)}</span> : '—') },
          { key: 'status', header: 'Statut', render: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.number}
        subtitle={detail && `${detail.warehouse_name} · ${detail.reason}`}
        icon={<SlidersHorizontal size={18} />}
        footer={
          detail?.status === 'pending' && can('stock.adjust.approve') ? (
            <>
              <Button variant="ghost" className="text-danger" icon={<X size={16} />} onClick={() => act(detail, 'reject')}>Rejeter</Button>
              <Button variant="gradient" icon={<Check size={16} />} onClick={() => act(detail, 'approve')}>Approuver et appliquer</Button>
            </>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-2 pb-2">
            {detail.items.map((i: any) => (
              <div key={i.id} className="flex items-center justify-between rounded-2xl border hairline px-4 py-3 text-[13.5px]">
                <span>{i.product_name}</span>
                <span className={`num font-semibold ${Number(i.qty_diff) > 0 ? 'text-mint' : 'text-rose'}`}>{Number(i.qty_diff) > 0 ? '+' : ''}{qty(i.qty_diff)}</span>
              </div>
            ))}
            <div className="pt-2 text-[12.5px] text-muted">
              Demandé par {detail.created_by_name} le {date(detail.created_at, true)}
              {detail.approved_by_name && ` · approuvé par ${detail.approved_by_name}`}
            </div>
          </div>
        )}
      </Modal>
      {open && <AdjustmentForm onClose={() => setOpen(false)} onDone={refresh} />}
    </Page>
  )
}

function AdjustmentForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const wh = useAuth((s) => s.warehouseId)
  const { data: warehouses } = useWarehouses()
  const [warehouse, setWarehouse] = useState(wh || '')
  const [reason, setReason] = useState('')
  const [lines, setLines] = useState<{ product: any; qty_diff: string }[]>([])
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    setLoading(true)
    try {
      const a = await post('/stock/adjustments', { warehouse_id: warehouse, reason, items: lines.map((l) => ({ product_id: l.product.id, qty_diff: l.qty_diff })) })
      toast.success(a.status === 'pending' ? 'Ajustement soumis à approbation' : 'Ajustement appliqué')
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
      size="lg"
      title="Nouvel ajustement"
      subtitle="Quantités signées : +5 pour ajouter, −3 pour retirer."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={loading} disabled={!lines.length || reason.trim().length < 3} onClick={submit}>Soumettre</Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dépôt">
            <Select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
              {(warehouses || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Motif" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. casse, erreur de saisie…" />
          </Field>
        </div>
        <ProductSearch warehouse={warehouse} onPick={(p) => !lines.find((l) => l.product.id === p.id) && setLines([...lines, { product: p, qty_diff: '' }])} />
        {lines.map((l, i) => (
          <div key={l.product.id} className="flex items-center gap-3 rounded-2xl border hairline p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{l.product.name}</div>
              <div className="text-[12px] text-muted">Stock actuel {qty(l.product.stock)}</div>
            </div>
            <Input className="w-28" inputMode="decimal" placeholder="±Qté" value={l.qty_diff} onChange={(e) => setLines(lines.map((x, idx) => (idx === i ? { ...x, qty_diff: e.target.value } : x)))} />
            <button onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="text-muted hover:text-danger"><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
