import { useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/page'
import { DataTable, FilterChips } from '@/components/table'
import { Avatar, Badge, Button, Field, Input, Modal, Select, StatusBadge, Textarea } from '@/components/ui'
import { api, post } from '@/lib/api'
import { date, money } from '@/lib/format'
import { showError, useDebounced, useList } from '@/lib/hooks'
import { useCan } from '@/store/auth'

const EMPTY = { name: '', type: 'individual', phone: '', whatsapp: '', email: '', address: '', city: 'Bamako', tax_id: '', credit_limit: '0', payment_terms_days: 0, status: 'active', notes: '' }

export function CustomerForm({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial?: any; onSaved: (c: any) => void }) {
  const [f, setF] = useState<any>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (open) {
      setF(initial ? { ...EMPTY, ...initial } : EMPTY)
      setErrors({})
    }
  }, [open, initial])
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    setLoading(true)
    try {
      const body = { ...f, credit_limit: f.credit_limit || 0 }
      const c = initial?.id ? await api(`/customers/${initial.id}`, { method: 'PATCH', body }) : await post('/customers', body)
      toast.success(initial?.id ? 'Client mis à jour' : 'Client créé')
      onSaved(c)
      onClose()
    } catch (e: any) {
      setErrors(e.fieldErrors?.() || {})
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
      title={initial?.id ? 'Modifier le client' : 'Nouveau client'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={loading} disabled={f.name.trim().length < 2} onClick={save}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-4 pb-2 sm:grid-cols-2">
        <Field label="Nom / raison sociale" required error={errors.name} className="sm:col-span-2">
          <Input autoFocus value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Type">
          <Select value={f.type} onChange={set('type')}>
            <option value="individual">Particulier</option>
            <option value="company">Entreprise</option>
            <option value="wholesaler">Revendeur / grossiste</option>
            <option value="administration">Administration</option>
          </Select>
        </Field>
        <Field label="Statut">
          <Select value={f.status} onChange={set('status')}>
            <option value="active">Actif</option>
            <option value="blocked">Bloqué (pas de crédit)</option>
          </Select>
        </Field>
        <Field label="Téléphone" error={errors.phone}>
          <Input value={f.phone} onChange={set('phone')} placeholder="+223 …" />
        </Field>
        <Field label="WhatsApp">
          <Input value={f.whatsapp} onChange={set('whatsapp')} />
        </Field>
        <Field label="Email" error={errors.email}>
          <Input type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Identifiant fiscal (NIF)">
          <Input value={f.tax_id} onChange={set('tax_id')} />
        </Field>
        <Field label="Adresse" className="sm:col-span-2">
          <Input value={f.address} onChange={set('address')} />
        </Field>
        <Field label="Limite de crédit" hint="0 = pas de vente à crédit">
          <Input inputMode="numeric" value={f.credit_limit} onChange={set('credit_limit')} />
        </Field>
        <Field label="Délai de paiement (jours)">
          <Input inputMode="numeric" value={f.payment_terms_days} onChange={set('payment_terms_days')} />
        </Field>
        <Field label="Notes internes" className="sm:col-span-2">
          <Textarea value={f.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Modal>
  )
}

export default function Customers() {
  const navigate = useNavigate()
  const can = useCan()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useList<any>('customers', '/customers', { search: useDebounced(search), page, with_balance: filter === 'debt' ? 1 : '', status: filter === 'blocked' ? 'blocked' : '', hide_walkin: 1 })
  return (
    <Page>
      <PageHeader
        title="Clients"
        accent="& comptes"
        subtitle="Fiches, encours, limites de crédit, relevés et balance âgée."
        actions={can('customer.manage') && <Button variant="gradient" icon={<UserPlus size={16} />} onClick={() => setOpen(true)}>Nouveau client</Button>}
      />
      <DataTable
        loading={isLoading}
        rows={data?.data}
        search={search}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        searchPlaceholder="Nom, téléphone, code…"
        toolbar={<FilterChips value={filter} onChange={setFilter} options={[{ value: '', label: 'Tous' }, { value: 'debt', label: 'Avec encours' }, { value: 'blocked', label: 'Bloqués' }]} />}
        onRowClick={(r) => navigate(`/customers/${r.id}`)}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          {
            key: 'name',
            header: 'Client',
            render: (r) => (
              <div className="flex items-center gap-3">
                <Avatar name={r.name} size={34} />
                <div>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-[12px] text-muted">{r.code} · {r.type_label}</div>
                </div>
              </div>
            ),
          },
          { key: 'phone', header: 'Téléphone', hideOnMobile: true, render: (r) => <span className="text-muted">{r.phone || '—'}</span> },
          { key: 'sales', header: 'Achats', hideOnMobile: true, align: 'right', render: (r) => <span className="num">{money(r.total_sales, { compact: true })}</span> },
          { key: 'last', header: 'Dernier achat', hideOnMobile: true, render: (r) => <span className="text-muted">{r.last_purchase ? date(r.last_purchase) : '—'}</span> },
          { key: 'limit', header: 'Limite', hideOnMobile: true, align: 'right', render: (r) => <span className="num text-muted">{Number(r.credit_limit) ? money(r.credit_limit, { compact: true }) : '—'}</span> },
          {
            key: 'balance',
            header: 'Encours',
            align: 'right',
            render: (r) =>
              Number(r.balance) > 0 ? <Badge tone="amber">{money(r.balance)}</Badge> : Number(r.balance) < 0 ? <Badge tone="green">Crédit {money(-r.balance)}</Badge> : <span className="text-muted">—</span>,
          },
          { key: 'status', header: 'Statut', render: (r) => <StatusBadge status={r.status} /> },
        ]}
      />
      <CustomerForm open={open} onClose={() => setOpen(false)} onSaved={(c) => { qc.invalidateQueries({ queryKey: ['customers'] }); navigate(`/customers/${c.id}`) }} />
    </Page>
  )
}
