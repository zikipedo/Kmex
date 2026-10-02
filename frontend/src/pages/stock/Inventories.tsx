import { useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useWarehouses } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { DataTable } from '@/components/table'
import { Button, Field, Modal, Select, StatusBadge, Switch } from '@/components/ui'
import { post } from '@/lib/api'
import { date } from '@/lib/format'
import { showError, useApi, useList } from '@/lib/hooks'
import { useAuth, useCan } from '@/store/auth'

export default function Inventories() {
  const navigate = useNavigate()
  const can = useCan()
  const qc = useQueryClient()
  const wh = useAuth((s) => s.warehouseId)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ warehouse_id: wh || '', category_id: '', blind_mode: true })
  const [loading, setLoading] = useState(false)
  const { data: warehouses } = useWarehouses()
  const { data: categories } = useApi<any[]>(['categories'], '/categories')
  const { data, isLoading } = useList<any>('inventories', '/inventories', { page })
  const start = async () => {
    setLoading(true)
    try {
      const inv = await post('/inventories', f)
      toast.success(`Inventaire ${inv.number} ouvert — quantités théoriques figées`)
      qc.invalidateQueries({ queryKey: ['inventories'] })
      navigate(`/inventories/${inv.id}`)
    } catch (e) {
      showError(e)
    } finally {
      setLoading(false)
    }
  }
  return (
    <Page>
      <PageHeader
        title="Inventaires"
        accent="physiques"
        subtitle="Instantané des quantités théoriques, comptage (scan ou saisie, mode aveugle), écarts valorisés puis ajustements liés."
        actions={can('stock.adjust') && <Button variant="gradient" icon={<ClipboardCheck size={16} />} onClick={() => setOpen(true)}>Lancer un inventaire</Button>}
      />
      <DataTable
        loading={isLoading}
        rows={data?.data}
        onRowClick={(r) => navigate(`/inventories/${r.id}`)}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <span className="font-semibold">{r.number}</span> },
          { key: 'wh', header: 'Dépôt', render: (r) => r.warehouse_name },
          { key: 'scope', header: 'Périmètre', hideOnMobile: true, render: (r) => r.category_name || 'Complet' },
          { key: 'date', header: 'Ouvert le', hideOnMobile: true, render: (r) => date(r.snapshot_at, true) },
          { key: 'progress', header: 'Progression', render: (r) => <span className="num text-muted">{r.stats.counted}/{r.stats.total} comptés · {r.stats.with_gap} écart(s)</span> },
          { key: 'status', header: 'Statut', render: (r) => <StatusBadge status={r.status} label={r.status_label} /> },
        ]}
      />
      <Modal open={open} onClose={() => setOpen(false)} title="Lancer un inventaire" size="sm" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button><Button loading={loading} onClick={start}>Ouvrir</Button></>}>
        <div className="space-y-4 pb-2">
          <Field label="Dépôt">
            <Select value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
              {(warehouses || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Périmètre" hint="Inventaire complet ou partiel (par catégorie)">
            <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
              <option value="">Complet — tous les produits</option>
              {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Switch checked={f.blind_mode} onChange={(v) => setF({ ...f, blind_mode: v })} label="Mode aveugle (le compteur ne voit pas le théorique)" />
        </div>
      </Modal>
    </Page>
  )
}
