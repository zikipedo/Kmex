import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell, Check, ChevronsLeft, ChevronsRight, CircleUser, KeyRound, LogOut, Menu, Moon, Search, Sun, Warehouse, Wifi, WifiOff, X,
} from 'lucide-react'
import { Suspense, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Aurora } from '@/components/aurora'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Avatar, Badge, cx, IconButton, Kbd } from '@/components/ui'
import { get, post, type Paginated } from '@/lib/api'
import { relative } from '@/lib/format'
import { useHotkey } from '@/lib/hooks'
import { forgetMe, useSync } from '@/lib/offline'
import { SyncPill } from '@/components/SyncStatus'
import { useAuth, useCan } from '@/store/auth'
import { CommandPalette } from './CommandPalette'
import { NAV } from './nav'

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link to="/dashboard" className="group flex items-center gap-2.5">
      <div className="relative grid h-9 w-9 place-items-center">
        <div className="absolute inset-0 animate-spin-slow rounded-[12px] bg-gradient-brand opacity-90 blur-[2px]" />
        <div className="relative grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-bg">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none">
            <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z" stroke="url(#lg)" strokeWidth="2" strokeLinejoin="round" />
            <path d="M4 8.5 12 13l8-4.5M12 13v7" stroke="url(#lg)" strokeWidth="2" strokeLinejoin="round" />
            <defs>
              <linearGradient id="lg" x1="0" y1="0" x2="24" y2="24">
                <stop stopColor="#fdba8c" />
                <stop offset=".5" stopColor="#f472b6" />
                <stop offset="1" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>
      {!collapsed && (
        <span className="font-display text-[19px] font-extrabold tracking-tight">
          Stock<span className="accent-serif text-gradient text-[21px]">Pro</span>
        </span>
      )}
    </Link>
  )
}

function PageLoading() {
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 pt-8 sm:px-6 lg:px-10">
      <div className="skeleton h-12 w-72 rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-28 rounded-3xl" />
        ))}
      </div>
      <div className="skeleton h-80 rounded-3xl" />
    </div>
  )
}

export function toggleTheme() {
  const dark = document.documentElement.classList.toggle('dark')
  try {
    localStorage.setItem('sp-theme', dark ? 'dark' : 'light')
  } catch {}
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#05050a' : '#f7f6fb')
}

function Sidebar({ collapsed, onToggle, mobile, onClose }: { collapsed: boolean; onToggle?: () => void; mobile?: boolean; onClose?: () => void }) {
  const can = useCan()
  const me = useAuth((s) => s.me)
  return (
    <aside className={cx('glass-strong flex h-full flex-col rounded-[28px]', mobile ? 'w-[290px]' : collapsed ? 'w-[78px]' : 'w-[264px]', 'transition-[width] duration-300')}>
      <div className={cx('flex items-center px-5 pt-5', collapsed && !mobile ? 'justify-center px-0' : 'justify-between')}>
        <Logo collapsed={collapsed && !mobile} />
        {mobile && (
          <IconButton label="Fermer" onClick={onClose}>
            <X size={18} />
          </IconButton>
        )}
      </div>
      <nav className="mt-6 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.perm || can(i.perm))
          if (!items.length) return null
          return (
            <div key={g.label}>
              {!(collapsed && !mobile) && <div className="label mb-1.5 px-3 text-[10px]">{g.label}</div>}
              <div className="space-y-0.5">
                {items.map((i) => (
                  <NavLink
                    key={i.to}
                    to={i.to}
                    end={i.to === '/stock'}
                    onClick={onClose}
                    title={i.label}
                    className={({ isActive }) =>
                      cx(
                        'group relative flex items-center gap-3 rounded-2xl px-3 py-2 text-[13.5px] font-medium transition',
                        collapsed && !mobile && 'justify-center px-0',
                        isActive ? 'text-fg' : 'text-muted hover:bg-line/[0.05] hover:text-fg',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <motion.span layoutId="nav-active" className="absolute inset-0 rounded-2xl border hairline bg-line/[0.07]" transition={{ type: 'spring', damping: 30, stiffness: 350 }}>
                            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-gradient-brand" />
                          </motion.span>
                        )}
                        <i.icon size={18} className={cx('relative shrink-0 transition', isActive && 'text-accent')} />
                        {!(collapsed && !mobile) && <span className="relative truncate">{i.label}</span>}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>
      {!mobile && (
        <div className="border-t hairline p-3">
          <button onClick={onToggle} className={cx('flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-[12.5px] text-muted transition hover:bg-line/5 hover:text-fg', collapsed && 'justify-center')}>
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            {!collapsed && <span>Réduire le menu</span>}
          </button>
          {!collapsed && me && <div className="mt-2 truncate px-3 text-[11px] text-muted/70">{me.company.name}</div>}
        </div>
      )}
    </aside>
  )
}

function NotificationsMenu() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => get<Paginated<any>>('/notifications', { limit: 12 }),
    refetchInterval: 30_000,
  })
  const unread = data?.meta.unread || 0
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])
  const tone: Record<string, string> = { danger: 'bg-danger', warning: 'bg-warn', success: 'bg-mint', info: 'bg-sky' }
  return (
    <div className="relative" ref={ref}>
      <IconButton label="Notifications" onClick={() => setOpen((o) => !o)} className="relative">
        <Bell size={18} />
        {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-gradient-brand px-1 text-[9.5px] font-bold text-[#14101f]">{unread > 9 ? '9+' : unread}</span>}
      </IconButton>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} className="glass-strong absolute right-0 top-12 z-50 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-3xl">
            <div className="flex items-center justify-between border-b hairline px-5 py-3.5">
              <span className="font-semibold">Notifications</span>
              {unread > 0 && (
                <button
                  className="flex items-center gap-1 text-[12px] text-muted hover:text-fg"
                  onClick={async () => {
                    await post('/notifications/read-all')
                    qc.invalidateQueries({ queryKey: ['notifications'] })
                  }}
                >
                  <Check size={13} /> Tout marquer lu
                </button>
              )}
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {!data?.data.length && <div className="px-5 py-10 text-center text-[13px] text-muted">Aucune notification pour l’instant ✨</div>}
              {data?.data.map((n) => (
                <button
                  key={n.id}
                  onClick={async () => {
                    await post(`/notifications/${n.id}/read`)
                    qc.invalidateQueries({ queryKey: ['notifications'] })
                    setOpen(false)
                    if (n.link) navigate(n.link)
                  }}
                  className={cx('flex w-full gap-3 border-b hairline px-5 py-3.5 text-left transition last:border-0 hover:bg-line/[0.04]', n.read_at && 'opacity-55')}
                >
                  <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', tone[n.level] || 'bg-sky')} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium">{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-[12.5px] text-muted">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-muted/70">{relative(n.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function UserMenu() {
  const me = useAuth((s) => s.me)!
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])
  const logout = async () => {
    await post('/auth/logout').catch(() => null)
    await forgetMe()
    useAuth.getState().logoutLocal()
    qc.clear()
    navigate('/login')
  }
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-full border hairline py-1 pl-1 pr-3 transition hover:bg-line/5">
        <Avatar name={me.user.full_name} size={30} />
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-[12.5px] font-semibold">{me.user.full_name}</span>
          <span className="block text-[11px] text-muted">{me.user.role_names[0]}</span>
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="glass-strong absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-3xl p-2">
            <div className="px-3 py-2.5">
              <div className="text-[13.5px] font-semibold">{me.user.full_name}</div>
              <div className="truncate text-[12px] text-muted">{me.user.email}</div>
            </div>
            <div className="my-1 border-t hairline" />
            {[
              { icon: CircleUser, label: 'Mon profil', on: () => navigate('/profile') },
              { icon: KeyRound, label: 'Mot de passe & PIN', on: () => navigate('/profile') },
              { icon: document.documentElement.classList.contains('dark') ? Sun : Moon, label: 'Changer de thème', on: toggleTheme },
            ].map((i) => (
              <button key={i.label} onClick={() => { i.on(); setOpen(false) }} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-[13.5px] transition hover:bg-line/5">
                <i.icon size={16} className="text-muted" /> {i.label}
              </button>
            ))}
            <div className="my-1 border-t hairline" />
            <button onClick={logout} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-[13.5px] text-danger transition hover:bg-danger/10">
              <LogOut size={16} /> Déconnexion
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function WarehouseSwitch() {
  const me = useAuth((s) => s.me)!
  const wh = useAuth((s) => s.warehouseId)
  const setWh = useAuth((s) => s.setWarehouse)
  if (me.warehouses.length <= 1) {
    return (
      <span className="hidden items-center gap-2 rounded-full border hairline px-3 py-1.5 text-[12.5px] text-muted lg:flex">
        <Warehouse size={14} /> {me.warehouses[0]?.name}
      </span>
    )
  }
  return (
    <label className="relative hidden items-center lg:flex">
      <Warehouse size={14} className="pointer-events-none absolute left-3 text-muted" />
      <select value={wh || ''} onChange={(e) => setWh(e.target.value)} className="input h-9 rounded-full py-0 pl-8 text-[12.5px]" disabled={!!me.open_session}>
        {me.warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sp-collapsed') === '1')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [palette, setPalette] = useState(false)
  const online = useSync((s) => s.online)
  const loc = useLocation()
  useHotkey('ctrl+k', (e) => {
    e.preventDefault()
    setPalette(true)
  })
  useEffect(() => setMobileOpen(false), [loc.pathname])
  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('sp-collapsed', c ? '0' : '1')
      return !c
    })
  }
  return (
    <div className="relative min-h-screen">
      <Aurora />
      <div className="relative z-10 flex">
        <div className="sticky top-0 hidden h-screen shrink-0 p-3 pr-0 lg:block">
          <Sidebar collapsed={collapsed} onToggle={toggle} />
        </div>
        <AnimatePresence>
          {mobileOpen && (
            <motion.div className="fixed inset-0 z-[70] lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
              <motion.div initial={{ x: -320 }} animate={{ x: 0 }} exit={{ x: -320 }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute bottom-3 left-3 top-3">
                <Sidebar collapsed={false} mobile onClose={() => setMobileOpen(false)} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4 lg:px-6">
            <div className="glass-strong flex h-14 items-center gap-2 rounded-full pl-2 pr-2 sm:pl-3">
              <IconButton label="Menu" className="lg:hidden" onClick={() => setMobileOpen(true)}>
                <Menu size={19} />
              </IconButton>
              <button onClick={() => setPalette(true)} className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full px-3 text-left text-[13.5px] text-muted transition hover:bg-line/[0.04] sm:max-w-md">
                <Search size={17} />
                <span className="truncate">Rechercher un produit, client, facture…</span>
                <span className="ml-auto hidden sm:block">
                  <Kbd>Ctrl K</Kbd>
                </span>
              </button>
              <div className="ml-auto flex items-center gap-1.5">
                <WarehouseSwitch />
                <SyncPill />

                <IconButton label="Thème" onClick={toggleTheme}>
                  <Sun size={17} className="hidden dark:block" />
                  <Moon size={17} className="dark:hidden" />
                </IconButton>
                <NotificationsMenu />
                <UserMenu />
              </div>
            </div>
          </header>
          {!online && (
            <div className="mx-4 mt-3 lg:mx-6">
              <Badge tone="red">Mode hors-ligne — seule la vente au comptoir (POS) reste disponible ; les ventes seront synchronisées au retour du réseau.</Badge>
            </div>
          )}
          <main>
            <ErrorBoundary resetKey={loc.pathname}>
              {/* Chargement discret dans la page : le menu et la barre restent affichés (pas d'écran logo). */}
              <Suspense fallback={<PageLoading />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  )
}
