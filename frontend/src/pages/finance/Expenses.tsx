import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Camera, Paperclip, Plus, Receipt, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { usePaymentMethods, useWarehouses } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { DataTable, FilterChips } from '@/components/table'
import { Badge, Button, Card, cx, DynIcon, Field, Input, Modal, Select, StatusBadge } from '@/components/ui'
import { newIdempotencyKey, post, upload } from '@/lib/api'
import { date, money, num, todayISO } from '@/lib/format'
import { showError, useApi, useDebounced, useList } from '@/lib/hooks'
import { useAuth, useCan } from '@/store/auth'

export function ExpenseForm({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (e: any) => void }) {
  const can = useCan()
  const me = useAuth((s) => s.me)!
  const wh = useAuth((s) => s.warehouseId)
  const { data: cats } = useApi<any[]>(['expense-categories'], '/expense-categories')
  const { data: methods } = usePaymentMethods()
  const { data: warehouses } = useWarehouses()
  const [f, setF] = useState({ category: '', amount: '', description: '', payee_name: '', expense_date: todayISO(), warehouse: wh || '', type: 'simple' })
  const [method, setMethod] = useState('')
  const [ref, setRef] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cat = cats?.find((c) => c.id === f.category)
  const needsReceipt = cat?.receipt_required_above && num(f.amount) >= num(cat.receipt_required_above)
  const limit = me.user.is_owner ? null : undefined
  const canPay = can('expense.pay')
  const allowedMethods = (methods || []).filter((m) => m.is_active && (can('expense.approve') || m.type === 'cash'))
  const submit = async (pay: boolean) => {
    setLoading(true)
    try {
      const e = await post('/expenses', { ...f, warehouse: f.warehouse || null }, newIdempotencyKey())
      if (files.length) {
        const r = await upload(`/expenses/${e.id}/attachments`, files)
        r.warnings?.forEach((w: string) => toast.warning(w))
      }
      const done = await post(`/expenses/${e.id}/submit`, pay && method ? { method_id: method, reference: ref } : {})
      toast.success(done.status === 'paid' ? `Dépense ${done.number} payée` : done.status === 'pending' ? `Dépense ${done.number} envoyée pour approbation` : `Dépense ${done.number} approuvée`)
      onDone(done)
      onClose()
      setF({ ...f, amount: '', description: '', payee_name: '' })
      setFiles([])
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
      title="Nouvelle dépense"
      subtitle="Saisie rapide : catégorie, montant, motif, photo du reçu."
      icon={<Receipt size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="soft" loading={loading} disabled={!f.category || !(num(f.amount) > 0) || f.description.trim().length < 5} onClick={() => submit(false)}>Soumettre sans payer</Button>
          {canPay && <Button variant="gradient" loading={loading} disabled={!f.category || !(num(f.amount) > 0) || f.description.trim().length < 5 || !method} onClick={() => submit(true)}>Enregistrer & payer</Button>}
        </>
      }
    >
      <div className="space-y-5 pb-2">
        <div>
          <div className="label mb-2 text-[10px]">Catégorie</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {(cats || []).filter((c) => c.is_active).map((c) => (
              <button key={c.id} onClick={() => setF({ ...f, category: c.id })} className={cx('flex items-center gap-2.5 rounded-2xl border p-2.5 text-left text-[12.5px] font-medium transition', f.category === c.id ? 'border-transparent ring-2' : 'hairline hover:bg-line/5')} style={f.category === c.id ? ({ background: `${c.color}1c`, '--tw-ring-color': c.color } as any) : undefined}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background: `${c.color}22`, color: c.color }}><DynIcon name={c.icon} size={15} /></span>
                <span className="line-clamp-2 leading-tight">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Montant" required><Input autoFocus inputMode="numeric" className="num text-lg font-semibold" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
          <Field label="Date"><Input type="date" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
          <Field label="Dépôt / centre de coût">
            <Select value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}>
              <option value="">Siège</option>
              {(warehouses || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Motif" required className="sm:col-span-2" hint="5 caractères minimum"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex. taxi livraison client Kalaban" /></Field>
          <Field label="Bénéficiaire"><Input value={f.payee_name} onChange={(e) => setF({ ...f, payee_name: e.target.value })} /></Field>
        </div>
        <div className="rounded-2xl border border-dashed hairline p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="soft" icon={<Camera size={15} />} onClick={() => fileRef.current?.click()}>Photo du reçu / PDF</Button>
            {needsReceipt && files.length === 0 && <Badge tone="amber">Justificatif obligatoire au-delà de {money(cat.receipt_required_above)}</Badge>}
            {files.map((file, i) => (
              <span key={i} className="chip text-fg/80"><Paperclip size={12} /> {file.name.slice(0, 22)} <button onClick={() => setFiles(files.filter((_, idx) => idx !== i))}><X size={12} /></button></span>
            ))}
          </div>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files || [])])} />
        </div>
        {canPay && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payer avec" hint={!can('expense.approve') ? 'Caissier : espèces de votre session uniquement' : undefined}>
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">— Ne pas payer maintenant —</option>
                {allowedMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
            {methods?.find((m) => m.id === method)?.requires_reference && <Field label="Référence" required><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>}
          </div>
        )}
        {limit === undefined && <p className="text-[12px] text-muted">Au-delà de votre plafond d'approbation, la dépense sera envoyée à un gérant avant tout décaissement.</p>}
      </div>
    </Modal>
  )
}

export default function Expenses() {
  const navigate = useNavigate()
  const can = useCan()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [status, setStatus] = useState(params.get('status') || '')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const { data: cats } = useApi<any[]>(['expense-categories'], '/expense-categories')
  const { data, isLoading } = useList<any>('expenses', '/expenses', { status, category, search: useDebounced(search), page })
  const monthTotal = (cats || []).reduce((a, c) => a + num(c.spent_month), 0)
  return (
    <Page>
      <PageHeader
        title="Dépenses"
        accent="de fonctionnement"
        subtitle="Loyer, énergie, transport, salaires… avec justificatifs photo, approbation par seuil et extourne — pour un bénéfice net réel."
        actions={can('expense.create') && <Button variant="gradient" icon={<Plus size={16} />} onClick={() => setOpen(true)}>Nouvelle dépense</Button>}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card glow className="p-5">
          <div className="label text-[10px]">Payé ce mois</div>
          <div className="num mt-2 font-display text-3xl font-bold">{money(monthTotal, { compact: true })}</div>
        </Card>
        {(cats || []).filter((c) => num(c.monthly_budget) > 0).sort((a, b) => num(b.spent_month) / num(b.monthly_budget) - num(a.spent_month) / num(a.monthly_budget)).slice(0, 3).map((c, i) => {
          const pctUsed = Math.min(100, (num(c.spent_month) / num(c.monthly_budget)) * 100)
          return (
            <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Card className="h-full p-5">
                <div className="flex items-center gap-2 text-[12.5px] font-medium"><span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `${c.color}22`, color: c.color }}><DynIcon name={c.icon} size={14} /></span>{c.name}</div>
                <div className="mt-3 flex justify-between text-[12px] text-muted"><span className="num">{money(c.spent_month, { compact: true })}</span><span className="num">/ {money(c.monthly_budget, { compact: true })}</span></div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line/10"><div className={cx('h-full rounded-full', pctUsed >= 100 ? 'bg-danger' : pctUsed >= 80 ? 'bg-warn' : 'bg-gradient-brand')} style={{ width: `${pctUsed}%` }} /></div>
              </Card>
            </motion.div>
          )
        })}
      </div>
      <DataTable
        loading={isLoading}
        rows={data?.data}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="N°, motif, bénéficiaire…"
        toolbar={
          <>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 w-[200px] py-1 text-[12.5px]">
              <option value="">Toutes catégories</option>
              {(cats || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <FilterChips value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: '', label: 'Toutes' }, { value: 'pending', label: 'À approuver' }, { value: 'approved', label: 'À payer' }, { value: 'paid', label: 'Payées' }, { value: 'draft', label: 'Brouillons' }, { value: 'cancelled', label: 'Annulées' }]} />
          </>
        }
        onRowClick={(r) => navigate(`/expenses/${r.id}`)}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'cat', header: 'Dépense', render: (r) => <div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `${r.category_color}22`, color: r.category_color }}><DynIcon name={r.category_icon} size={16} /></span><div className="min-w-0"><div className="truncate font-medium">{r.description}</div><div className="text-[12px] text-muted">{r.number || 'Brouillon'} · {r.category_name}</div></div></div> },
          { key: 'date', header: 'Date', hideOnMobile: true, render: (r) => <span className="text-muted">{date(r.expense_date)}</span> },
          { key: 'payee', header: 'Bénéficiaire', hideOnMobile: true, render: (r) => <span className="text-muted">{r.payee_name || '—'}</span> },
          { key: 'by', header: 'Saisi par', hideOnMobile: true, render: (r) => <span className="text-muted">{r.created_by_name}</span> },
          { key: 'att', header: '', hideOnMobile: true, render: (r) => (r.attachments_count ? <Paperclip size={14} className="text-muted" /> : r.receipt_required ? <Badge tone="red">Justif. manquant</Badge> : null) },
          { key: 'status', header: 'Statut', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'amount', header: 'Montant', align: 'right', render: (r) => <span className="num font-semibold">{money(r.amount)}</span> },
        ]}
      />
      <ExpenseForm open={open} onClose={() => setOpen(false)} onDone={() => { qc.invalidateQueries({ queryKey: ['expenses'] }); qc.invalidateQueries({ queryKey: ['expense-categories'] }) }} />
    </Page>
  )
}
