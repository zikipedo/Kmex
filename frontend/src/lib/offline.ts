/**
 * Mode hors-ligne « limité au comptoir » (§24) :
 *  - cache local des données de référence (catalogue, clients, moyens de paiement) ;
 *  - ventes enregistrées dans une file IndexedDB avec numéro provisoire OFF-{appareil}-{n} ;
 *  - synchronisation idempotente (appareil, op_id) dès le retour du réseau ;
 *  - durée maximale hors-ligne au-delà de laquelle le POS se verrouille.
 */
import { create } from 'zustand'
import { api, ApiError, get, netEvents, timeoutSignal } from './api'
import { kv, ops, type OfflineOp } from './idb'
import { useAuth, type Me } from '@/store/auth'

export const MAX_OFFLINE_HOURS = 72
const DONE_RETENTION_DAYS = 7

type SyncState = {
  online: boolean
  syncing: boolean
  pending: number
  conflicts: number
  lastSync: string | null
  lastError: string | null
  queue: OfflineOp[]
  setOnline: (v: boolean) => void
}

export const useSync = create<SyncState>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  conflicts: 0,
  lastSync: null,
  lastError: null,
  queue: [],
  setOnline: (online) => set({ online }),
}))

/* ------------------------------------------------------------------ Appareil */
export async function deviceId(): Promise<string> {
  let id = await kv.get<string>('device_id')
  if (!id) {
    id = (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/-/g, '').slice(0, 24)
    await kv.set('device_id', id)
  }
  return id
}

export function deviceName() {
  const ua = navigator.userAgent
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : 'Linux'
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur'
  return `${br} · ${os}`
}

async function nextProvisional(): Promise<string> {
  const id = await deviceId()
  const n = ((await kv.get<number>('provisional_seq')) || 0) + 1
  await kv.set('provisional_seq', n)
  return `OFF-${id.slice(0, 4).toUpperCase()}-${String(n).padStart(4, '0')}`
}

/* ------------------------------------------------------------------ Session utilisateur en cache */
/** Clé du cache de référence : cloisonnée par utilisateur (les champs masqués, ex. prix d'achat, diffèrent selon les droits). */
const refKey = (warehouse: string) => `ref:${useAuth.getState().me?.user.id || 'anon'}:${warehouse}`

export async function cacheMe(me: Me | null) {
  if (!me) return
  await kv.set('me', { me, at: Date.now() })
  // Purge des caches de référence d'autres utilisateurs de l'appareil (aucune donnée sensible héritée).
  for (const k of await kv.keys()) {
    const key = String(k)
    if (key.startsWith('ref:') && !key.startsWith(`ref:${me.user.id}:`)) await kv.del(key)
  }
}

/** Session en cache valable au plus MAX_OFFLINE_HOURS ; effacée à la déconnexion volontaire. */
export async function cachedMe(): Promise<Me | null> {
  const c = await kv.get<{ me: Me; at: number }>('me')
  if (!c?.me || Date.now() - c.at > MAX_OFFLINE_HOURS * 3600_000) return null
  return c.me
}

export async function forgetMe() {
  await kv.del('me')
  for (const k of await kv.keys()) if (String(k).startsWith('ref:')) await kv.del(String(k))
}

export async function serverReachable(): Promise<boolean> {
  return probe()
}

/* ------------------------------------------------------------------ Données de référence */
export type RefData = { products: any[]; customers: any[]; payment_methods: any[]; categories: any[]; server_time: string; warehouse: string }

export async function refreshReferenceData(warehouse: string | null): Promise<RefData | null> {
  if (!warehouse) return null
  const key = refKey(warehouse)
  const prev = await kv.get<RefData>(key)
  const r = await get('/sync/pull', { warehouse, since: prev?.server_time })
  let data: RefData
  if (r.full || !prev) {
    data = { ...r, products: r.products.filter((p: any) => p.status === 'active') }
  } else {
    const merge = (base: any[], upd: any[], keep = (x: any) => x.status !== 'archived') => {
      const m = new Map(base.map((x) => [x.id, x]))
      upd.forEach((x) => (keep(x) ? m.set(x.id, x) : m.delete(x.id)))
      return [...m.values()]
    }
    data = {
      ...r,
      products: merge(prev.products, r.products, (x) => x.status === 'active'),
      customers: merge(prev.customers, r.customers),
    }
  }
  await kv.set(key, data)
  return data
}

export async function referenceData(warehouse: string | null): Promise<RefData | null> {
  if (!warehouse) return null
  return (await kv.get<RefData>(refKey(warehouse))) || null
}

/** Décrémente le stock du cache local après une vente hors-ligne (stock indicatif, corrigé à la synchro). */
async function decrementLocalStock(warehouse: string, lines: { product_id: string; quantity: number }[]) {
  const data = await referenceData(warehouse)
  if (!data) return
  const byId = new Map(lines.map((l) => [l.product_id, l.quantity]))
  data.products = data.products.map((p) => (byId.has(p.id) ? { ...p, stock: String(Number(p.stock) - (byId.get(p.id) || 0)) } : p))
  await kv.set(refKey(warehouse), data)
}

/* ------------------------------------------------------------------ File d'opérations */
export async function loadQueue() {
  const me = useAuth.getState().me
  const all = (await ops.all()).sort((a, b) => b.created_at_local.localeCompare(a.created_at_local))
  // Purge des opérations synchronisées anciennes
  const limit = Date.now() - DONE_RETENTION_DAYS * 86400_000
  for (const o of all) if (o.status === 'done' && o.synced_at && new Date(o.synced_at).getTime() < limit) await ops.del(o.op_id)
  const mine = all.filter((o) => !me || o.user_id === me.user.id)
  useSync.setState({
    queue: mine,
    pending: mine.filter((o) => o.status === 'pending' || o.status === 'syncing').length,
    conflicts: mine.filter((o) => o.status === 'conflict').length,
    lastSync: (await kv.get<string>('last_sync')) || useSync.getState().lastSync,
  })
}

export function offlineLocked(): boolean {
  const { pending, lastSync } = useSync.getState()
  if (!pending || !lastSync) return false
  return Date.now() - new Date(lastSync).getTime() > MAX_OFFLINE_HOURS * 3600_000
}

export async function queueSale(input: {
  payload: any
  preview: Omit<OfflineOp['preview'], 'provisional_number'>
  warehouse: string
}): Promise<OfflineOp> {
  const me = useAuth.getState().me!
  const provisional = await nextProvisional()
  const op: OfflineOp = {
    op_id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    type: 'sale',
    user_id: me.user.id,
    created_at_local: new Date().toISOString(),
    status: 'pending',
    payload: { ...input.payload, user_id: me.user.id, provisional_number: provisional, register_session_id: me.open_session?.id || null },
    preview: { ...input.preview, provisional_number: provisional },
  }
  await ops.put(op)
  await decrementLocalStock(input.warehouse, input.payload.items)
  if (!(await kv.get('last_sync'))) await kv.set('last_sync', new Date().toISOString())
  await loadQueue()
  if (useSync.getState().online) void syncNow()
  return op
}

let inflight: Promise<void> | null = null

/** Envoie la file au serveur ; rejouer la même file ne crée jamais de doublon (idempotence serveur). */
export function syncNow(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    const me = useAuth.getState().me
    if (!me) return
    const pendings = (await ops.all()).filter((o) => o.user_id === me.user.id && (o.status === 'pending' || o.status === 'syncing'))
    if (!pendings.length) {
      await loadQueue()
      return
    }
    useSync.setState({ syncing: true, lastError: null })
    try {
      for (let i = 0; i < pendings.length; i += 50) {
        const batch = pendings.slice(i, i + 50)
        for (const o of batch) await ops.put({ ...o, status: 'syncing' })
        const r = await api('/sync/push', {
          method: 'POST',
          body: {
            device_id: await deviceId(),
            device_name: deviceName(),
            device_time: new Date().toISOString(),
            operations: batch.map((o) => ({ op_id: o.op_id, type: o.type, created_at_local: o.created_at_local, payload: o.payload })),
          },
        })
        const now = new Date().toISOString()
        for (const res of r.results) {
          const o = batch.find((x) => x.op_id === res.op_id)
          if (!o) continue
          await ops.put({ ...o, status: res.status, result: res.result, conflict_reason: res.conflict_reason, warnings: res.warnings, synced_at: now })
        }
      }
      const now = new Date().toISOString()
      await kv.set('last_sync', now)
      useSync.setState({ online: true, lastSync: now })
    } catch (e) {
      // Remet en attente ce qui n'a pas été confirmé
      for (const o of await ops.all()) if (o.status === 'syncing') await ops.put({ ...o, status: 'pending' })
      const offline = e instanceof ApiError && e.status === 0
      useSync.setState({ lastError: offline ? null : e instanceof ApiError ? e.message : 'Synchronisation impossible', online: offline ? false : useSync.getState().online })
    } finally {
      useSync.setState({ syncing: false })
      await loadQueue()
      inflight = null
    }
  })()
  return inflight
}

/* ------------------------------------------------------------------ Surveillance du réseau */
let started = false

async function probe() {
  try {
    const r = await fetch('/api/v1/health', { cache: 'no-store', signal: timeoutSignal(3_000) })
    return r.ok
  } catch {
    return false
  }
}

export function startOfflineEngine() {
  if (started) return
  started = true
  netEvents.onNetworkError = () => {
    if (useSync.getState().online) useSync.getState().setOnline(false)
  }
  const goOnline = async () => {
    if (await probe()) {
      useSync.getState().setOnline(true)
      void syncNow()
      const wh = useAuth.getState().warehouseId
      void refreshReferenceData(wh).catch(() => null)
    }
  }
  window.addEventListener('online', goOnline)
  window.addEventListener('offline', () => useSync.getState().setOnline(false))
  setInterval(async () => {
    const s = useSync.getState()
    if (!s.online) return goOnline()
    // Sonde légère : détecte la perte du serveur même sans action de l'utilisateur.
    if (!(await probe())) return useSync.getState().setOnline(false)
    if (s.pending > 0) void syncNow()
  }, 15_000)
  void loadQueue()
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ESC[ch])

/** Ticket provisoire imprimable sans serveur (mention « provisoire », §24.2). Toutes les valeurs sont échappées. */
export function printProvisionalTicket(op: OfflineOp, company: Me['company'], cashier: string) {
  const w = window.open('', '_blank', 'width=380,height=640')
  if (!w) return
  const fmt = (v: number) => esc(`${Math.round(v).toLocaleString('fr-FR').replace(/ | /g, ' ')} ${company.currency_symbol}`)
  const rows = op.preview.lines
    .map((l: any) => `<tr><td>${esc(l.name)}<br><small>${esc(l.quantity)} x ${fmt(l.unit_price)}</small></td><td class="r">${fmt(l.line_total)}</td></tr>`)
    .join('')
  const pays = op.preview.payments.map((p: any) => `<tr><td>${esc(p.name)}${p.reference ? ` (${esc(p.reference)})` : ''}</td><td class="r">${fmt(p.amount)}</td></tr>`).join('')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(op.preview.provisional_number)}</title>
<style>body{font-family:ui-monospace,monospace;width:72mm;margin:0 auto;padding:8px;font-size:12px;color:#000}
h1{font-size:15px;text-align:center;margin:4px 0}.c{text-align:center}.r{text-align:right;white-space:nowrap}
table{width:100%;border-collapse:collapse}td{padding:3px 0;vertical-align:top}hr{border:0;border-top:1px dashed #000}
.tot{font-size:16px;font-weight:bold}.warn{border:1px solid #000;padding:4px;text-align:center;font-weight:bold;margin:6px 0}</style></head>
<body><h1>${esc(company.name)}</h1><div class="c">${esc(company.address)}<br>${esc(company.phone)}</div><hr>
<div class="warn">TICKET PROVISOIRE — HORS-LIGNE<br>${esc(op.preview.provisional_number)}</div>
<div class="c">${new Date(op.created_at_local).toLocaleString('fr-FR')} · ${esc(cashier)}</div><hr>
<table>${rows}</table><hr><table><tr class="tot"><td>TOTAL</td><td class="r">${fmt(op.preview.total)}</td></tr>${pays}
${op.preview.change > 0 ? `<tr><td>Rendu monnaie</td><td class="r">${fmt(op.preview.change)}</td></tr>` : ''}</table><hr>
<div class="c"><small>Le numéro légal définitif sera attribué à la synchronisation.</small><br>${esc(company.settings?.receipt_footer)}</div>
<script>window.onload=()=>{window.print()}</script></body></html>`)
  w.document.close()
}
