import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/page'
import { DataTable } from '@/components/table'
import { Avatar, Badge, Button, Field, Input, Modal, Textarea } from '@/components/ui'
import { api, post } from '@/lib/api'
import { money } from '@/lib/format'
import { showError, useDebounced, useList } from '@/lib/hooks'
import { useCan } from '@/store/auth'

const EMPTY = { name: '', contact_name: '', phone: '', email: '', address: '', country: 'Mali', tax_id: '', payment_terms_days: 30, lead_time_days: 7, notes: '' }

export function SupplierForm({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial?: any; onSaved: (s: any) => void }) {
  const [f, setF] = useState<any>(EMPTY)
  const [loading, setLoading] = useState(false)
  useEffect(() => { if (open) setF(initial ? { ...EMPTY, ...initial } : EMPTY) }, [open, initial])
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    setLoading(true)
    try {
      const s = initial ? await api(`/suppliers/${initial.id}`, { method: 'PATCH', body: f }) : await post('/suppliers', f)
      toast.success('Fournisseur enregistré')
      onSaved(s)
      onClose()
    } catch (e) {
      showError(e)
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} size="lg" title={initial ? 'Modifier le fournisseur' : 'Nouveau fournisseur'} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button loading={loading} disabled={f.name.trim().length < 2} onClick={save}>Enregistrer</Button></>}>
      <div className="grid gap-4 pb-2 sm:grid-cols-2">
        <Field label="Raison sociale" required className="sm:col-span-2"><Input autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label="Contact"><Input value={f.contact_name} onChange={set('contact_name')} /></Field>
        <Field label="Téléphone"><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><Input value={f.email} onChange={set('email')} /></Field>
        <Field label="NIF"><Input value={f.tax_id} onChange={set('tax_id')} /></Field>
        <Field label="Adresse" className="sm:col-span-2"><Input value={f.address} onChange={set('address')} /></Field>
        <Field label="Délai de paiement (jours)"><Input inputMode="numeric" value={f.payment_terms_days} onChange={set('payment_terms_days')} /></Field>
        <Field label="Délai de livraison (jours)"><Input inputMode="numeric" value={f.lead_time_days} onChange={set('lead_time_days')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  )
}

export default function Suppliers() {
  const navigate = useNavigate()
  const can = useCan()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useList<any>('suppliers', '/suppliers', { search: useDebounced(search), page })
  return (
    <Page>
      <PageHeader title="Fournisseurs" accent="& dettes" subtitle="Coordonnées, conditions, historique d'achat et échéancier des dettes." actions={can('supplier.manage') && <Button variant="gradient" icon={<Plus size={16} />} onClick={() => setOpen(true)}>Nouveau fournisseur</Button>} />
      <DataTable
        loading={isLoading}
        rows={data?.data}
        search={search}
        onSearch={setSearch}
        onRowClick={(r) => navigate(`/suppliers/${r.id}`)}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'name', header: 'Fournisseur', render: (r) => <div className="flex items-center gap-3"><Avatar name={r.name} size={34} /><div><div className="font-medium">{r.name}</div><div className="text-[12px] text-muted">{r.code} · {r.contact_name}</div></div></div> },
          { key: 'phone', header: 'Téléphone', hideOnMobile: true, render: (r) => <span className="text-muted">{r.phone}</span> },
          { key: 'terms', header: 'Conditions', hideOnMobile: true, render: (r) => <span className="text-muted">{r.payment_terms_days} j · livraison {r.lead_time_days} j</span> },
          { key: 'total', header: 'Achats', align: 'right', hideOnMobile: true, render: (r) => <span className="num">{money(r.total_purchased, { compact: true })}</span> },
          { key: 'balance', header: 'Dette', align: 'right', render: (r) => (Number(r.balance) > 0 ? <Badge tone="amber">{money(r.balance)}</Badge> : <span className="text-muted">—</span>) },
        ]}
      />
      <SupplierForm open={open} onClose={() => setOpen(false)} onSaved={() => qc.invalidateQueries({ queryKey: ['suppliers'] })} />
    </Page>
  )
}
