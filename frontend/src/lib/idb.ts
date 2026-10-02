/** Mini-wrapper IndexedDB : magasin clé/valeur (cache de référence) + file d'opérations hors-ligne. */
const DB_NAME = 'stockpro-offline'
const VERSION = 1
let dbp: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        const d = req.result
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv')
        if (!d.objectStoreNames.contains('ops')) {
          const s = d.createObjectStore('ops', { keyPath: 'op_id' })
          s.createIndex('status', 'status')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbp
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode)
        const r = fn(t.objectStore(store))
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      }),
  )
}

export const kv = {
  get: <T = any>(key: string) => tx<T>('kv', 'readonly', (s) => s.get(key)).catch(() => undefined as T),
  set: (key: string, value: unknown) => tx('kv', 'readwrite', (s) => s.put(value, key)).catch(() => undefined),
  del: (key: string) => tx('kv', 'readwrite', (s) => s.delete(key)).catch(() => undefined),
  keys: () => tx<IDBValidKey[]>('kv', 'readonly', (s) => s.getAllKeys()).catch(() => [] as IDBValidKey[]),
}

export type OfflineOp = {
  op_id: string
  type: 'sale'
  user_id: string
  created_at_local: string
  status: 'pending' | 'syncing' | 'done' | 'conflict' | 'rejected'
  payload: any
  preview: { provisional_number: string; total: number; items: number; customer: string; change: number; lines: any[]; payments: any[] }
  result?: any
  conflict_reason?: string
  warnings?: string[]
  synced_at?: string
}

export const ops = {
  all: () => tx<OfflineOp[]>('ops', 'readonly', (s) => s.getAll()).catch(() => [] as OfflineOp[]),
  put: (op: OfflineOp) => tx('ops', 'readwrite', (s) => s.put(op)),
  del: (id: string) => tx('ops', 'readwrite', (s) => s.delete(id)),
}
