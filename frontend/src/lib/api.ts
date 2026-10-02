import { useAuth } from '@/store/auth'

export type Problem = {
  status: number
  title: string
  detail: string
  code: string
  request_id?: string
  errors?: { field: string; message: string }[]
  [k: string]: unknown
}

export class ApiError extends Error {
  problem: Problem
  constructor(p: Problem) {
    super(p.detail || p.title)
    this.problem = p
  }
  get code() {
    return this.problem.code
  }
  get status() {
    return this.problem.status
  }
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const e of this.problem.errors || []) out[e.field] = e.message
    return out
  }
}

const BASE = '/api/v1'

/** Branché par le moteur hors-ligne : une erreur réseau fait basculer l'application en mode hors-ligne. */
export const netEvents = { onNetworkError: () => {} }
let refreshing: Promise<boolean> | null = null

export function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) return AbortSignal.timeout(ms)
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

async function tryRefresh(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include', signal: timeoutSignal(6_000) })
    if (!r.ok) return false
    const data = await r.json()
    useAuth.getState().setAccess(data.access)
    return true
  } catch {
    return false
  }
}

/** Rafraîchissement « single-flight » ; une seconde tentative couvre la rotation faite par un autre onglet. */
export function refreshAccess(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      if (await tryRefresh()) return true
      await new Promise((r) => setTimeout(r, 450))
      return tryRefresh()
    })().finally(() => {
      setTimeout(() => (refreshing = null), 50)
    })
  }
  return refreshing
}

export function newIdempotencyKey() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

type Opts = {
  method?: string
  body?: unknown
  params?: Record<string, unknown>
  idempotencyKey?: string
  raw?: boolean
  form?: FormData
}

export function qs(params?: Record<string, unknown>) {
  if (!params) return ''
  const u = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return
    u.set(k, String(v))
  })
  const s = u.toString()
  return s ? `?${s}` : ''
}

export async function api<T = any>(path: string, opts: Opts = {}, retry = true): Promise<T> {
  const token = useAuth.getState().access
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  let res: Response
  try {
    res = await fetch(`${BASE}${path}${qs(opts.params)}`, {
      method: opts.method || (body ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'include',
      // Un serveur injoignable ne doit jamais bloquer l'interface (bascule hors-ligne).
      signal: timeoutSignal(opts.form ? 120_000 : 15_000),
    })
  } catch {
    netEvents.onNetworkError()
    throw new ApiError({ status: 0, title: 'Réseau indisponible', detail: 'Connexion au serveur impossible. Vérifiez votre réseau.', code: 'NETWORK' })
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    // Passerelle sans serveur derrière : équivalent d'une coupure réseau pour le mode hors-ligne.
    netEvents.onNetworkError()
    throw new ApiError({ status: 0, title: 'Serveur injoignable', detail: 'Le serveur ne répond pas. Les ventes au comptoir continuent hors-ligne.', code: 'NETWORK' })
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const ok = await refreshAccess()
    if (ok) return api<T>(path, opts, false)
    useAuth.getState().logoutLocal()
  }
  if (opts.raw) {
    if (!res.ok) throw new ApiError({ status: res.status, title: 'Erreur', detail: 'Téléchargement impossible.', code: 'DOWNLOAD' })
    return res as unknown as T
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError({
      status: res.status,
      title: data.title || 'Erreur',
      detail: data.detail || 'Une erreur est survenue.',
      code: data.code || 'ERROR',
      ...data,
    })
  }
  return data as T
}

export const get = <T = any>(path: string, params?: Record<string, unknown>) => api<T>(path, { params })
export const post = <T = any>(path: string, body?: unknown, idempotencyKey?: string) =>
  api<T>(path, { method: 'POST', body: body ?? {}, idempotencyKey })
export const put = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body })
export const patch = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body })
export const del = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body })
export const upload = <T = any>(path: string, files: File[] | File, field = 'files') => {
  const form = new FormData()
  ;(Array.isArray(files) ? files : [files]).forEach((f) => form.append(field, f))
  return api<T>(path, { method: 'POST', form })
}

/** Ouvre un PDF authentifié : la fenêtre est créée pendant le clic (pas de blocage de popup). */
export async function openPdf(path: string) {
  const win = window.open('', '_blank')
  if (win) win.document.write('<title>StockPro</title><body style="background:#05050a;color:#aaa;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0">Génération du document…</body>')
  try {
    const res = await api<Response>(path, { raw: true })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    if (win) win.location.href = url
    else {
      const a = document.createElement('a')
      a.href = url
      a.download = path.split('/').slice(-2, -1)[0] + '.pdf'
      a.click()
    }
    setTimeout(() => URL.revokeObjectURL(url), 120_000)
  } catch (e) {
    win?.close()
    throw e
  }
}

export async function download(path: string, params: Record<string, unknown>, fallbackName: string) {
  const res = await api<Response>(path, { raw: true, params })
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
}

export type Paginated<T> = { data: T[]; meta: { page: number; pages: number; total: number; limit: number; unread?: number } }
