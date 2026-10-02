import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeftRight, Banknote, Landmark, Plus, Smartphone, Wallet } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { CountUp } from '@/components/charts'
import { usePaymentMethods } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { DataTable } from '@/components/table'
import { Button, Card, cx, Field, Input, Modal, Select } from '@/components/ui'
import { newIdempotencyKey, post } from '@/lib/api'
import { date, money, num } from '@/lib/format'
import { showError, useApi, useList } from '@/lib/hooks'
import { useCan } from '@/store/auth'

const ICON: Record<string, any> = { cash: Banknote, bank: Landmark, mobile_money: Smartphone, cheque: Wallet }
const TINT: Record<string, string> = { cash: '#6ee7b7', bank: '#a78bfa', mobile_money: '#fdba8c', cheque: '#f472b6' }

export default function Treasury() {
  const can = useCan()
  const qc = useQueryClient()
  const [account, setAccount] = useState('')
  const [page, setPage] = useState(1)
  const [income, setIncome] = useState(false)
  const [transfer, setTransfer] = useState<any>(null)
  const [f, setF] = useState({ category: 'Divers', amount: '', description: '', method_id: '', reference: '' })
  const { data: accounts } = useApi<any[]>(['treasury-accounts'], '/treasury-accounts')
  const { data: methods } = usePaymentMethods()
  const { data, isLoading } = useList<any>('cash-movements', '/cash-movements', { account, page })
  const total = (accounts || []).reduce((a, x) => a + num(x.balance), 0)
  return (
    <Page>
      <PageHeader
        title="Trésorerie"
        accent="consolidée"
        subtitle="Soldes des caisses, banques et comptes Mobile Money, calculés à partir de mouvements immuables."
        actions={
          <>
            {can('cash.session.validate') && <Button variant="soft" icon={<ArrowLeftRight size={16} />} onClick={() => setTransfer({ from_account: '', to_account: '', amount: '', reference: '', note: '' })}>Transfert / dépôt banque</Button>}
            {can('income.manage') && <Button variant="gradient" icon={<Plus size={16} />} onClick={() => setIncome(true)}>Recette diverse</Button>}
          </>
        }
      />
      <Card glow className="mb-6 overflow-hidden p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-brand opacity-25 blur-3xl" />
        <div className="label">Trésorerie totale</div>
        <CountUp value={total} className="mt-2 block font-display text-5xl font-extrabold sm:text-6xl" />
      </Card>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(accounts || []).map((a, i) => {
          const Icon = ICON[a.type] || Wallet
          return (
            <motion.button key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} onClick={() => { setAccount(account === a.id ? '' : a.id); setPage(1) }} className={cx('card p-5 text-left transition', account === a.id && 'ring-2 ring-accent/60')}>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-2xl" style={{ background: `${TINT[a.type]}22`, color: TINT[a.type] }}><Icon size={18} /></span>
                <div><div className="text-[13.5px] font-semibold">{a.name}</div><div className="text-[11.5px] text-muted">{a.type_label}</div></div>
              </div>
              <div className={cx('num mt-4 font-display text-2xl font-bold', num(a.balance) < 0 && 'text-danger')}>{money(a.balance)}</div>
            </motion.button>
          )
        })}
      </div>
      <DataTable
        loading={isLoading}
        rows={data?.data}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        dense
        columns={[
          { key: 'date', header: 'Date', render: (m) => <span className="text-muted">{date(m.occurred_at, true)}</span> },
          { key: 'account', header: 'Compte', render: (m) => m.account_name },
          { key: 'cat', header: 'Catégorie', render: (m) => m.category_label },
          { key: 'label', header: 'Libellé', render: (m) => <span className="text-muted">{m.label}</span> },
          { key: 'doc', header: 'Document', hideOnMobile: true, render: (m) => m.source_number || '—' },
          { key: 'user', header: 'Par', hideOnMobile: true, render: (m) => <span className="text-muted">{m.user_name}</span> },
          { key: 'amount', header: 'Montant', align: 'right', render: (m) => <span className={cx('num font-semibold', m.direction === 'in' ? 'text-mint' : 'text-rose')}>{m.direction === 'in' ? '+' : '−'}{money(m.amount)}</span> },
        ]}
      />
      <Modal
        open={!!transfer}
        onClose={() => setTransfer(null)}
        size="sm"
        title="Transfert de fonds"
        subtitle="Dépôt d'espèces en banque, alimentation d'un compte Mobile Money… sans effet sur le résultat."
        footer={<><Button variant="ghost" onClick={() => setTransfer(null)}>Annuler</Button><Button disabled={!transfer?.from_account || !transfer?.to_account || !(num(transfer?.amount) > 0)} onClick={async () => { try { await post('/treasury-accounts/transfer', transfer); toast.success('Transfert enregistré'); setTransfer(null); qc.invalidateQueries({ queryKey: ['treasury-accounts'] }); qc.invalidateQueries({ queryKey: ['cash-movements'] }) } catch (e) { showError(e) } }}>Transférer</Button></>}
      >
        {transfer && (
          <div className="space-y-4 pb-2">
            <Field label="Depuis"><Select value={transfer.from_account} onChange={(e) => setTransfer({ ...transfer, from_account: e.target.value })}><option value="">Choisir…</option>{(accounts || []).map((a) => <option key={a.id} value={a.id}>{a.name} — {money(a.balance)}</option>)}</Select></Field>
            <Field label="Vers"><Select value={transfer.to_account} onChange={(e) => setTransfer({ ...transfer, to_account: e.target.value })}><option value="">Choisir…</option>{(accounts || []).filter((a) => a.id !== transfer.from_account).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
            <Field label="Montant"><Input inputMode="numeric" className="num text-lg" value={transfer.amount} onChange={(e) => setTransfer({ ...transfer, amount: e.target.value.replace(/[^\d]/g, '') })} /></Field>
            <Field label="Référence (bordereau de versement…)"><Input value={transfer.reference} onChange={(e) => setTransfer({ ...transfer, reference: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <Modal open={income} onClose={() => setIncome(false)} size="sm" title="Recette diverse" subtitle="Revenus non liés aux ventes (commission, apport, subvention…)" footer={<><Button variant="ghost" onClick={() => setIncome(false)}>Annuler</Button><Button disabled={!f.method_id || !(num(f.amount) > 0) || f.description.length < 3} onClick={async () => { try { await post('/incomes', f, newIdempotencyKey()); toast.success('Recette enregistrée'); setIncome(false); qc.invalidateQueries({ queryKey: ['treasury-accounts'] }); qc.invalidateQueries({ queryKey: ['cash-movements'] }) } catch (e) { showError(e) } }}>Enregistrer</Button></>}>
        <div className="space-y-4 pb-2">
          <Field label="Catégorie"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{['Divers', 'Commission', 'Apport du propriétaire', 'Subvention', 'Remboursement de dépense', 'Location'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Montant"><Input inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Moyen"><Select value={f.method_id} onChange={(e) => setF({ ...f, method_id: e.target.value })}><option value="">Choisir…</option>{(methods || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          {methods?.find((m) => m.id === f.method_id)?.requires_reference && <Field label="Référence"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>}
        </div>
      </Modal>
    </Page>
  )
}
