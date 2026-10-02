/* StockPro — Service Worker (PWA, §24.1 / §25.1)
 * - Pré-cache de toute l'application (y compris les écrans chargés à la demande) via le manifeste Vite.
 * - Navigation : réseau d'abord, repli sur l'application en cache (démarrage hors-ligne).
 * - Assets versionnés : cache d'abord. Miniatures produits : cache d'abord (POS hors-ligne).
 * - L'API n'est jamais mise en cache ici : les données hors-ligne vivent dans IndexedDB.
 */
const SHELL = 'stockpro-shell-v1'
const RUNTIME = 'stockpro-runtime-v1'
const MEDIA = 'stockpro-media-v1'
const KEEP = [SHELL, RUNTIME, MEDIA]

async function precache() {
  const cache = await caches.open(SHELL)
  const urls = new Set(['/', '/index.html', '/favicon.svg', '/manifest.webmanifest'])
  try {
    const res = await fetch('/.vite/manifest.json', { cache: 'no-store' })
    const manifest = await res.json()
    Object.values(manifest).forEach((e) => {
      urls.add('/' + e.file)
      ;(e.css || []).forEach((c) => urls.add('/' + c))
      ;(e.assets || []).forEach((a) => urls.add('/' + a))
    })
  } catch (_) {
    /* manifeste indisponible (dev) */
  }
  await Promise.all(
    [...urls].map(async (u) => {
      if (await cache.match(u)) return
      try {
        await cache.add(new Request(u, { cache: 'reload' }))
      } catch (_) {
        /* ignoré : sera mis en cache à la première visite */
      }
    }),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'precache') event.waitUntil(precache())
})

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) cache.put(request, res.clone())
  return res
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME)
  const hit = await cache.match(request)
  const network = fetch(request)
    .then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(request, res.clone())
      return res
    })
    .catch(() => hit)
  return hit || network
}

async function navigation(request) {
  try {
    const res = await fetch(request)
    const cache = await caches.open(SHELL)
    cache.put('/index.html', res.clone())
    return res
  } catch (_) {
    const cache = await caches.open(SHELL)
    return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return
    if (request.mode === 'navigate') return event.respondWith(navigation(request))
    if (url.pathname.startsWith('/assets/')) return event.respondWith(cacheFirst(request, SHELL))
    if (url.pathname.startsWith('/media/')) return event.respondWith(cacheFirst(request, MEDIA))
    if (url.pathname === '/favicon.svg' || url.pathname === '/manifest.webmanifest') return event.respondWith(cacheFirst(request, SHELL))
    return
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request))
  }
})
