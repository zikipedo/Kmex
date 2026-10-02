import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CloudOff, CloudUpload, MonitorSmartphone, RefreshCw, RotateCcw, ShieldOff, ShieldCheck, TriangleAlert, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { confirm } from '@/components/confirm'
import { Page, PageHeader } from '@/components/page'
import { DataTable, FilterChips } from '@/components/table'
import { Badge, Button, Card, cx, EmptyState, Tabs } from '@/components/ui'
import { get, post } from '@/lib/api'
import { date, money, relative } from '@/lib/format'
import { showError } from '@/lib/hooks'
import { deviceId, deviceName, loadQueue, MAX_OFFLINE_HOURS, syncNow, useSync } from '@/lib/offline'
import { useCan } from '@/store/auth'

const LOCAL_STATUS: Record<string, [string, string]> = {
  pending: ['sky', 'En attente'],
  syncing: ['violet', 'Envoi…'],
  done: ['green', 'Synchronisée'],
  conflict: ['amber', 'Conflit'],
  rejected: ['red', 'Rejetée'],
}

export default function Sync() {
  const can = useCan()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { online, pending, conflicts, syncing, lastSync, lastError, queue } = useSync()
  const [tab, setTab] = useState<'device' | 'server' | 'devices'>('device')
  const [status, setStatus] = useState('')
  const [dev, setDev] = useState({ id: '', name: '' })
  useEffect(() => {
    void loadQueue()
    deviceId().then((id) => setDev({ id, name: deviceName() }))
  }, [])
  const server = useQuery<any>({ queryKey: ['sync-ops', status], queryFn: () => get('/sync/operations', { status }), enabled: online && tab === 'server' })
  const devices = useQuery({ queryKey: ['sync-devices'], queryFn: () => get<any[]>('/sync/devices'), enabled: online && tab === 'devices' && can('users.manage') })

  const run = async () => {
    if (!online) return toast.error('Toujours hors-ligne', { description: 'La synchronisation reprendra automatiquement au retour du réseau.' })
    await syncNow()
    const s = useSync.getState()
    if (s.lastError) toast.error(s.lastError)
    else toast.success(s.conflicts ? `Synchronisé avec ${s.conflicts} conflit(s) à traiter` : 'Tout est synchronisé')
    qc.invalidateQueries({ queryKey: ['sync-ops'] })
  }

  const stats = [
    { label: 'Réseau', value: online ? 'En ligne' : 'Hors ligne', icon: online ? Wifi : CloudOff, tint: online ? '#6ee7b7' : '#fb7185' },
    { label: 'En attente', value: String(pending), icon: CloudUpload, tint: '#7dd3fc' },
    { label: 'Conflits', value: String(conflicts), icon: TriangleAlert, tint: '#fbbf24' },
    { label: 'Dernière synchro', value: lastSync ? relative(lastSync) : 'Jamais', icon: RefreshCw, tint: '#a78bfa' },
  ]

  return (
    <Page>
      <PageHeader
        title="Synchronisation"
        accent="hors-ligne"
        subtitle={`Ventes enregistrées sans réseau, rejouées une seule fois sur le serveur. Durée maximale hors-ligne : ${MAX_OFFLINE_HOURS} h, au-delà la caisse se verrouille.`}
        actions={<Button variant="gradient" loading={syncing} icon={<RefreshCw size={16} />} onClick={run}>Synchroniser maintenant</Button>}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="relative overflow-hidden p-5">
            <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-30 blur-2xl" style={{ background: s.tint }} />
            <div className="flex items-center justify-between">
              <span className="label text-[10px]">{s.label}</span>
              <s.icon size={17} style={{ color: s.tint }} />
            </div>
            <div className="mt-3 font-display text-2xl font-bold">{s.value}</div>
          </Card>
        ))}
      </div>
      {lastError && <div className="mb-4"><Badge tone="red">{lastError}</Badge></div>}
      <Card className="mb-5 flex flex-wrap items-center gap-3 p-4 text-[13px]">
        <MonitorSmartphone size={18} className="text-accent" />
        <span className="font-medium">Cet appareil :</span>
        <span className="text-muted">{dev.name}</span>
        <code className="rounded-lg bg-line/[0.06] px-2 py-0.5 font-mono text-[11.5px] text-muted">{dev.id}</code>
      </Card>

      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'device', label: 'File de cet appareil', count: pending + conflicts },
          { key: 'server', label: 'Opérations reçues' },
          ...(can('users.manage') ? [{ key: 'devices' as const, label: 'Appareils' }] : []),
        ]}
      />

      {tab === 'device' && (
        <DataTable
          rows={queue.map((o) => ({ id: o.op_id, ...o }))}
          empty={<EmptyState icon={<ShieldCheck size={24} />} title="Rien en attente" text="Toutes les ventes de cet appareil sont synchronisées." />}
          columns={[
            { key: 'num', header: 'N° provisoire', render: (o: any) => <span className="font-mono font-semibold">{o.preview.provisional_number}</span> },
            { key: 'date', header: 'Vendu le', render: (o: any) => <span className="text-muted">{date(o.created_at_local, true)}</span> },
            { key: 'cust', header: 'Client', hideOnMobile: true, render: (o: any) => o.preview.customer },
            { key: 'total', header: 'Total', align: 'right', render: (o: any) => <span className="num font-semibold">{money(o.preview.total)}</span> },
            { key: 'status', header: 'Statut', render: (o: any) => <Badge tone={LOCAL_STATUS[o.status][0]} dot>{LOCAL_STATUS[o.status][1]}</Badge> },
            {
              key: 'res',
              header: 'Résultat',
              render: (o: any) =>
                o.status === 'done' ? (
                  <button className="font-semibold text-accent hover:underline" onClick={() => navigate(`/sales/${o.result.sale_id}`)}>{o.result.number}</button>
                ) : o.conflict_reason ? (
                  <span className="text-[12.5px] text-warn">{o.conflict_reason}</span>
                ) : (
                  <span className="text-muted">—</span>
                ),
            },
            { key: 'warn', header: '', hideOnMobile: true, render: (o: any) => (o.warnings?.length ? <span title={o.warnings.join('\n')}><Badge tone="amber">{o.warnings.length} alerte(s)</Badge></span> : null) },
          ]}
        />
      )}

      {tab === 'server' &&
        (!online ? (
          <Card><EmptyState icon={<CloudOff size={24} />} title="Disponible une fois en ligne" /></Card>
        ) : (
          <DataTable
            loading={server.isLoading}
            rows={server.data?.data as any[] | undefined}
            toolbar={<FilterChips value={status} onChange={setStatus} options={[{ value: '', label: 'Toutes' }, { value: 'conflict', label: `Conflits (${server.data?.counts?.conflict ?? 0})` }, { value: 'done', label: 'Synchronisées' }]} />}
            columns={[
              { key: 'received', header: 'Reçue', render: (o) => <span className="text-muted">{relative(o.received_at)}</span> },
              { key: 'local', header: 'Vendue (heure appareil)', hideOnMobile: true, render: (o) => <span className="text-muted">{date(o.created_at_local, true)}</span> },
              { key: 'who', header: 'Caissier / appareil', render: (o) => <div><div className="font-medium">{o.user_name}</div><div className="text-[11.5px] text-muted">{o.device_name}</div></div> },
              { key: 'total', header: 'Montant', align: 'right', render: (o) => <span className="num">{money(o.total)}</span> },
              {
                key: 'status',
                header: 'Statut',
                render: (o) => (
                  <div>
                    <Badge tone={o.status === 'done' ? 'green' : o.status === 'conflict' ? 'amber' : 'red'} dot>{o.status === 'done' ? o.result?.number : o.status === 'conflict' ? 'Conflit' : 'Rejetée'}</Badge>
                    {o.conflict_reason && <div className="mt-1 text-[12px] text-warn">{o.conflict_reason}</div>}
                    {o.warnings?.map((w: string) => <div key={w} className="mt-1 text-[11.5px] text-muted">⚠ {w}</div>)}
                  </div>
                ),
              },
              {
                key: 'act',
                header: '',
                align: 'right',
                render: (o) =>
                  o.status === 'conflict' && (
                    <Button
                      size="sm"
                      variant="soft"
                      icon={<RotateCcw size={14} />}
                      onClick={async () => {
                        try {
                          const r = await post(`/sync/operations/${o.id}/retry`)
                          r.status === 'done' ? toast.success(`Vente ${r.result.number} créée`) : toast.warning(r.conflict_reason)
                          qc.invalidateQueries({ queryKey: ['sync-ops'] })
                        } catch (e) {
                          showError(e)
                        }
                      }}
                    >
                      Relancer
                    </Button>
                  ),
              },
            ]}
          />
        ))}

      {tab === 'devices' && (
        <DataTable
          loading={devices.isLoading}
          rows={devices.data as any[] | undefined}
          columns={[
            { key: 'name', header: 'Appareil', render: (d) => <div><div className="font-medium">{d.name}</div><div className="font-mono text-[11px] text-muted">{d.device_id}</div></div> },
            { key: 'user', header: 'Dernier utilisateur', render: (d) => d.user },
            { key: 'sync', header: 'Dernière synchro', render: (d) => <span className="text-muted">{d.last_sync_at ? relative(d.last_sync_at) : '—'}</span> },
            { key: 'ops', header: 'Opérations', align: 'right', render: (d) => <span className="num">{d.operations}{d.conflicts ? <span className="text-warn"> · {d.conflicts} conflit(s)</span> : ''}</span> },
            { key: 'state', header: 'État', render: (d) => (d.revoked_at ? <Badge tone="red">Révoqué</Badge> : <Badge tone="green" dot>Autorisé</Badge>) },
            {
              key: 'act',
              header: '',
              align: 'right',
              render: (d) => (
                <Button
                  size="sm"
                  variant="ghost"
                  className={cx(!d.revoked_at && 'text-danger')}
                  icon={d.revoked_at ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
                  onClick={async () => {
                    if (!d.revoked_at) {
                      const r = await confirm({ title: `Révoquer « ${d.name} » ?`, message: 'Cet appareil ne pourra plus synchroniser de ventes (appareil perdu ou volé).', danger: true, confirmLabel: 'Révoquer' })
                      if (!r.ok) return
                    }
                    try {
                      await post(`/sync/devices/${d.id}/revoke`)
                      qc.invalidateQueries({ queryKey: ['sync-devices'] })
                    } catch (e) {
                      showError(e)
                    }
                  }}
                >
                  {d.revoked_at ? 'Rétablir' : 'Révoquer'}
                </Button>
              ),
            },
          ]}
        />
      )}
    </Page>
  )
}
