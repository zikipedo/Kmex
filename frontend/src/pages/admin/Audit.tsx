import { Fingerprint, ShieldCheck, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { DateRange } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { DataTable } from '@/components/table'
import { Badge, Button, Modal, Select, Tabs } from '@/components/ui'
import { get } from '@/lib/api'
import { date, relative } from '@/lib/format'
import { showError, useDebounced, useList } from '@/lib/hooks'

const ACTIONS: Record<string, string> = {
  LOGIN: 'sky', VALIDATE: 'green', CANCEL: 'red', CREATE: 'violet', UPDATE: 'gray', PAYMENT: 'green', PERMISSION_CHANGE: 'amber', LOCKOUT: 'red',
  STOCK_MOVE: 'sky', APPROVE: 'green', REJECT: 'red', EXPORT: 'amber', REPRINT: 'gray', DISCOUNT_OVERRIDE: 'amber', CREDIT_OVERRIDE: 'amber',
  OPEN: 'sky', CLOSE: 'violet', PAY: 'green', ARCHIVE: 'gray', SETTING_CHANGE: 'amber', REVERSE: 'red',
}

export default function Audit() {
  const [tab, setTab] = useState<'logs' | 'logins'>('logs')
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<any>(null)
  const [verify, setVerify] = useState<any>(null)
  const dq = useDebounced(search)
  const { data, isLoading } = useList<any>(`audit-${tab}`, tab === 'logs' ? '/audit-logs' : '/login-history', { search: dq, action, page, date_from: range.from, date_to: range.to })
  return (
    <Page>
      <PageHeader
        title="Journal"
        accent="d'audit"
        subtitle="Append-only et chaîné par SHA-256 : toute altération est détectable. Aucune modification possible, même par un administrateur."
        actions={<Button variant="gradient" icon={<Fingerprint size={16} />} onClick={async () => { try { setVerify(await get('/audit-logs/verify')) } catch (e) { showError(e) } }}>Vérifier l'intégrité</Button>}
      />
      {verify && (
        <div className="mb-4">
          {verify.intact ? (
            <Badge tone="green"><ShieldCheck size={13} /> Chaîne intacte — {verify.entries} entrées vérifiées</Badge>
          ) : (
            <Badge tone="red"><ShieldAlert size={13} /> Rupture de chaîne détectée à l'entrée #{verify.broken_at}</Badge>
          )}
        </div>
      )}
      <Tabs className="mb-4" value={tab} onChange={(t) => { setTab(t); setPage(1) }} tabs={[{ key: 'logs', label: 'Actions' }, { key: 'logins', label: 'Connexions' }]} />
      {tab === 'logs' ? (
        <DataTable
          loading={isLoading}
          rows={data?.data}
          search={search}
          onSearch={setSearch}
          toolbar={
            <>
              <Select value={action} onChange={(e) => setAction(e.target.value)} className="h-9 w-[190px] py-1 text-[12.5px]">
                <option value="">Toutes les actions</option>
                {Object.keys(ACTIONS).map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
              <DateRange from={range.from} to={range.to} onChange={(f, t) => setRange({ from: f, to: t })} />
            </>
          }
          onRowClick={setDetail}
          page={data?.meta.page}
          pages={data?.meta.pages}
          total={data?.meta.total}
          onPage={setPage}
          dense
          columns={[
            { key: 'date', header: 'Date', render: (l) => <span className="text-muted" title={date(l.created_at, true)}>{relative(l.created_at)}</span> },
            { key: 'user', header: 'Utilisateur', render: (l) => <div><div className="font-medium">{l.user_name}</div><div className="text-[11px] text-muted">{l.user_roles}</div></div> },
            { key: 'action', header: 'Action', render: (l) => <Badge tone={ACTIONS[l.action] || 'gray'}>{l.action}</Badge> },
            { key: 'entity', header: 'Objet', render: (l) => <span><span className="text-muted">{l.entity_type}</span> {l.entity_label}</span> },
            { key: 'reason', header: 'Motif', hideOnMobile: true, render: (l) => <span className="text-muted">{l.reason || '—'}</span> },
            { key: 'ip', header: 'IP', hideOnMobile: true, render: (l) => <span className="font-mono text-[11.5px] text-muted">{l.ip || '—'}</span> },
          ]}
        />
      ) : (
        <DataTable
          loading={isLoading}
          rows={data?.data}
          search={search}
          onSearch={setSearch}
          page={data?.meta.page}
          pages={data?.meta.pages}
          total={data?.meta.total}
          onPage={setPage}
          dense
          columns={[
            { key: 'date', header: 'Date', render: (l) => <span className="text-muted">{date(l.created_at, true)}</span> },
            { key: 'id', header: 'Identifiant', render: (l) => l.identifier },
            { key: 'user', header: 'Utilisateur', render: (l) => l.user_name || '—' },
            { key: 'ok', header: 'Résultat', render: (l) => (l.success ? <Badge tone="green">Succès</Badge> : <Badge tone="red">{l.failure_reason || 'Échec'}</Badge>) },
            { key: 'ip', header: 'IP', render: (l) => <span className="font-mono text-[11.5px] text-muted">{l.ip}</span> },
            { key: 'ua', header: 'Appareil', hideOnMobile: true, render: (l) => <span className="line-clamp-1 max-w-xs text-[12px] text-muted">{l.user_agent}</span> },
          ]}
        />
      )}
      <Modal open={!!detail} onClose={() => setDetail(null)} size="lg" title={detail && `${detail.action} · ${detail.entity_label}`} subtitle={detail && `${detail.user_name} · ${date(detail.created_at, true)} · requête ${detail.request_id}`}>
        {detail && (
          <div className="grid gap-4 pb-2 md:grid-cols-2">
            {[['Avant', detail.old_values], ['Après', detail.new_values]].map(([label, v]) => (
              <div key={label as string}>
                <div className="label mb-2">{label as string}</div>
                <pre className="max-h-72 overflow-auto rounded-2xl bg-line/[0.05] p-4 font-mono text-[11.5px] leading-relaxed">{v ? JSON.stringify(v, null, 2) : '—'}</pre>
              </div>
            ))}
            <div className="md:col-span-2">
              <div className="label mb-1">Empreinte</div>
              <code className="break-all font-mono text-[11px] text-muted">{detail.hash}</code>
            </div>
          </div>
        )}
      </Modal>
    </Page>
  )
}
