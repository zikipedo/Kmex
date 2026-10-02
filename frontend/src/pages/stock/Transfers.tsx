import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, ArrowRight, PackageCheck, Trash2, Truck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useWarehouses } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { ProductSearch } from '@/components/pickers'
import { DataTable } from '@/components/table'
import { Button, Field, Input, Modal, Select, StatusBadge, Textarea } from '@/components/ui'
import { api, post } from '@/lib/api'
import { date, qty } from '@/lib/format'
import { showError, useList } from '@/lib/hooks'
import { useAuth, useCan } from '@/store/auth'

export default function Transfers() {
  const can = useCan()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<any>(null)
  const [recv, setRecv] = useState<Record<string, string>>({})
  const { data, isLoading } = useList<any>('transfers', '/transfers', { page })
  const refresh = () => qc.invalidateQueries({ queryKey: ['transfers'] })
  const act = async (action: 'ship' | 'receive' | 'cancel') => {
    try {
      const items = action === 'receive' ? detail.items.map((i: any) => ({ item_id: i.id, quantity: recv[i.id] ?? i.qty_shipped })) : undefined
      const t = await api(`/transfers/${detail.id}/${action}`, { method: 'POST', body: { items } })
      toast.success(action === 'ship' ? 'Expédié : stock sorti du dépôt source' : action === 'receive' ? 'Réceptionné : stock entré au dépôt destination' : 'Transfert annulé')
      setDetail(t)
      refresh()
    } catch (e) {
      showError(e)
    }
  }
  return (
    <Page>
      <PageHeader
        title="Transferts"
        accent="inter-dépôts"
        subtitle="Demande → expédition (sortie du dépôt A) → réception (entrée au dépôt B) avec écarts tracés et coût d'origine conservé."
        actions={can('stock.transfer.request') && <Button variant="gradient" icon={<ArrowLeftRight size={16} />} onClick={() => setOpen(true)}>Nouveau transfert</Button>}
      />
      <DataTable
        loading={isLoading}
        rows={data?.data}
        onRowClick={(r) => { setDetail(r); setRecv({}) }}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <span className="font-semibold">{r.number}</span> },
          { key: 'route', header: 'Trajet', render: (r) => <span className="flex items-center gap-2">{r.from_name} <ArrowRight size={13} className="text-muted" /> {r.to_name}</span> },
          { key: 'items', header: 'Articles', hideOnMobile: true, render: (r) => `${r.items.length} produit(s)` },
          { key: 'by', header: 'Demandé par', hideOnMobile: true, render: (r) => r.created_by_name },
          { key: 'date', header: 'Date', hideOnMobile: true, render: (r) => date(r.created_at, true) },
          { key: 'status', header: 'Statut', render: (r) => <StatusBadge status={r.status} label={r.status_label} /> },
        ]}
      />
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        size="lg"
        title={detail?.number}
        subtitle={detail && `${detail.from_name} → ${detail.to_name}`}
        footer={
          detail && can('stock.transfer.manage') ? (
            <>
              {detail.status === 'requested' && <Button variant="ghost" className="text-danger" onClick={() => act('cancel')}>Annuler</Button>}
              {detail.status === 'requested' && <Button variant="gradient" icon={<Truck size={16} />} onClick={() => act('ship')}>Expédier</Button>}
              {detail.status === 'in_transit' && <Button variant="gradient" icon={<PackageCheck size={16} />} onClick={() => act('receive')}>Réceptionner</Button>}
            </>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-2 pb-2">
            {detail.items.map((i: any) => (
              <div key={i.id} className="grid items-center gap-3 rounded-2xl border hairline px-4 py-3 text-[13.5px] sm:grid-cols-[1fr_auto_auto]">
                <span className="font-medium">{i.product_name}</span>
                <span className="num text-muted">demandé {qty(i.qty_requested)} · expédié {qty(i.qty_shipped)} · reçu {qty(i.qty_received)}</span>
                {detail.status === 'in_transit' && <Input className="w-24" inputMode="decimal" placeholder={qty(i.qty_shipped)} value={recv[i.id] ?? ''} onChange={(e) => setRecv({ ...recv, [i.id]: e.target.value })} />}
              </div>
            ))}
            {detail.note && <p className="pt-2 text-[13px] text-muted">{detail.note}</p>}
          </div>
        )}
      </Modal>
      {open && <TransferForm onClose={() => setOpen(false)} onDone={refresh} />}
    </Page>
  )
}

function TransferForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const wh = useAuth((s) => s.warehouseId)
  const { data: all } = useWarehouses()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(wh || '')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<{ product: any; quantity: string }[]>([])
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    setLoading(true)
    try {
      await post('/transfers', { from_warehouse_id: from, to_warehouse_id: to, note, items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity })) })
      toast.success('Demande de transfert créée')
      onDone()
      onClose()
    } catch (e) {
      showError(e)
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Nouveau transfert" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button loading={loading} disabled={!from || !to || from === to || !lines.length} onClick={submit}>Créer la demande</Button></>}>
      <div className="space-y-4 pb-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Depuis (dépôt source)">
            <Select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Choisir…</option>
              {(all || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Vers (dépôt destination)">
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              {(all || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
        </div>
        <ProductSearch warehouse={from || undefined} onPick={(p) => !lines.find((l) => l.product.id === p.id) && setLines([...lines, { product: p, quantity: '1' }])} />
        {lines.map((l, i) => (
          <div key={l.product.id} className="flex items-center gap-3 rounded-2xl border hairline p-3">
            <div className="min-w-0 flex-1 truncate font-medium">{l.product.name}</div>
            <Input className="w-24" inputMode="decimal" value={l.quantity} onChange={(e) => setLines(lines.map((x, idx) => (idx === i ? { ...x, quantity: e.target.value } : x)))} />
            <button onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="text-muted hover:text-danger"><Trash2 size={16} /></button>
          </div>
        ))}
        <Field label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
