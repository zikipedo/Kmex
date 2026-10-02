import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowRight, LockOpen, ScanLine, Store } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/page'
import { DataTable, FilterChips } from '@/components/table'
import { Badge, Button, Card, Field, Input, Modal, StatusBadge } from '@/components/ui'
import { get, post } from '@/lib/api'
import { date, money, relative } from '@/lib/format'
import { showError, useList } from '@/lib/hooks'
import { useAuth, useCan, type Me } from '@/store/auth'

export default function Cash() {
  const navigate = useNavigate()
  const can = useCan()
  const qc = useQueryClient()
  const me = useAuth((s) => s.me)!
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [opening, setOpening] = useState<any>(null)
  const [amount, setAmount] = useState('')
  const { data: registers } = useQuery({ queryKey: ['registers'], queryFn: () => get<any[]>('/cash-registers') })
  const { data, isLoading } = useList<any>('sessions', '/register-sessions', { status, page })

  const open = async () => {
    try {
      await post(`/cash-registers/${opening.id}/open`, { opening_float: amount })
      useAuth.getState().setMe(await get<Me>('/me'))
      toast.success(`${opening.name} ouverte`)
      setOpening(null)
      qc.invalidateQueries({ queryKey: ['registers'] })
      qc.invalidateQueries({ queryKey: ['sessions'] })
    } catch (e) {
      showError(e)
    }
  }

  return (
    <Page>
      <PageHeader
        title="Caisse"
        accent="& sessions"
        subtitle="Ouverture avec fond de caisse, encaissements multi-moyens, clôture Z avec comptage et écart justifié, validation par le gérant."
        actions={me.open_session && <Button variant="gradient" icon={<ScanLine size={16} />} onClick={() => navigate('/pos')}>Aller au POS</Button>}
      />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(registers || []).map((r, i) => (
          <motion.div key={r.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card glow={!!r.open_session} className="relative overflow-hidden p-5">
              <div className={`pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full blur-2xl ${r.open_session ? 'bg-mint/30' : 'bg-line/10'}`} />
              <div className="relative flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-line/[0.06]"><Store size={19} /></div>
                <div>
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-[12px] text-muted">{r.warehouse_name}</div>
                </div>
              </div>
              <div className="relative mt-5">
                {r.open_session ? (
                  <>
                    <Badge tone="green" dot>Ouverte · {r.open_session.opened_by}</Badge>
                    <div className="mt-2 text-[12px] text-muted">depuis {relative(r.open_session.opened_at)}</div>
                    <Button className="mt-4 w-full" size="sm" variant="soft" iconRight={<ArrowRight size={14} />} onClick={() => navigate(`/cash/sessions/${r.open_session.id}`)}>Voir / clôturer</Button>
                  </>
                ) : (
                  <>
                    <Badge tone="gray" dot>Fermée</Badge>
                    {can('cash.session') && !me.open_session && (
                      <Button className="mt-4 w-full" size="sm" icon={<LockOpen size={14} />} onClick={() => { setOpening(r); setAmount(String(me.company.settings.default_opening_float ?? 25000)) }}>Ouvrir</Button>
                    )}
                  </>
                )}
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
      <DataTable
        loading={isLoading}
        rows={data?.data}
        toolbar={<FilterChips value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={[{ value: '', label: 'Toutes' }, { value: 'open', label: 'Ouvertes' }, { value: 'closed', label: 'À valider' }, { value: 'validated', label: 'Validées' }]} />}
        onRowClick={(r) => navigate(`/cash/sessions/${r.id}`)}
        page={data?.meta.page}
        pages={data?.meta.pages}
        total={data?.meta.total}
        onPage={setPage}
        columns={[
          { key: 'z', header: 'Rapport Z', render: (r) => <span className="font-semibold">{r.z_number || '—'}</span> },
          { key: 'reg', header: 'Caisse', render: (r) => r.register_name },
          { key: 'cashier', header: 'Caissier', render: (r) => r.opened_by_name },
          { key: 'opened', header: 'Ouverture', hideOnMobile: true, render: (r) => <span className="text-muted">{date(r.opened_at, true)}</span> },
          { key: 'sales', header: 'Ventes', align: 'right', hideOnMobile: true, render: (r) => <span className="num">{r.sales_count} · {money(r.sales_total, { compact: true })}</span> },
          { key: 'diff', header: 'Écart', align: 'right', render: (r) => (r.status === 'open' ? '—' : <span className={`num font-semibold ${Number(r.difference) < 0 ? 'text-danger' : Number(r.difference) > 0 ? 'text-mint' : ''}`}>{money(r.difference)}</span>) },
          { key: 'status', header: 'Statut', render: (r) => <StatusBadge status={r.status} label={r.status === 'closed' ? 'À valider' : undefined} /> },
        ]}
      />
      <Modal open={!!opening} onClose={() => setOpening(null)} size="sm" title={`Ouvrir ${opening?.name}`} subtitle="Comptez le fond de caisse en espèces." footer={<><Button variant="ghost" onClick={() => setOpening(null)}>Annuler</Button><Button onClick={open}>Ouvrir la session</Button></>}>
        <Field label="Fond de caisse"><Input autoFocus inputMode="numeric" className="num text-lg" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} /></Field>
      </Modal>
    </Page>
  )
}
