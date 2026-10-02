import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, Barcode, ChevronDown, Clock, Minus, PauseCircle, Percent, Play, Plus, ScanLine, Search, ShoppingCart, Store, Trash2, User, X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Aurora } from '@/components/aurora'
import { CustomerPicker } from '@/components/pickers'
import { Avatar, Badge, Button, cx, EmptyState, Field, IconButton, Input, Kbd, Modal, ProductThumb, Select } from '@/components/ui'
import { Logo, toggleTheme } from '@/layout/AppLayout'
import { ApiError, get, post } from '@/lib/api'
import { computeDocument } from '@/lib/calc'
import { money, qty, relative } from '@/lib/format'
import { showError, useHotkey } from '@/lib/hooks'
import { useAuth, useCan, type Me } from '@/store/auth'
import { SyncPill } from '@/components/SyncStatus'
import { offlineLocked, printProvisionalTicket, queueSale, referenceData, refreshReferenceData, useSync, MAX_OFFLINE_HOURS } from '@/lib/offline'
import { useCart } from './cart'
import { PaymentModal } from './PaymentModal'

function beep(ok = true) {
  try {
    const ctx = new AudioContext()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = ok ? 1320 : 220
    g.gain.value = 0.05
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + (ok ? 0.07 : 0.2))
  } catch {}
}

function OpenSessionModal({ onOpened }: { onOpened: () => void }) {
  const wh = useAuth((s) => s.warehouseId)
  const me = useAuth((s) => s.me)!
  const { data: registers } = useQuery({ queryKey: ['registers'], queryFn: () => get<any[]>('/cash-registers') })
  const regs = (registers || []).filter((r) => r.warehouse === wh && r.is_active)
  const [reg, setReg] = useState('')
  const [amount, setAmount] = useState(String(me.company.settings.default_opening_float ?? '25000'))
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  useEffect(() => {
    const free = regs.find((r) => !r.open_session)
    if (free && !reg) setReg(free.id)
  }, [regs, reg])
  const open = async () => {
    setLoading(true)
    try {
      await post(`/cash-registers/${reg}/open`, { opening_float: amount })
      const m = await get<Me>('/me')
      useAuth.getState().setMe(m)
      toast.success('Caisse ouverte. Bonnes ventes !')
      onOpened()
    } catch (e) {
      showError(e)
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal open onClose={() => navigate('/dashboard')} size="sm" title="Ouvrir la caisse" subtitle="Comptez votre fond de caisse avant de commencer." icon={<Store size={18} />}>
      <div className="space-y-4 pb-2">
        <Field label="Caisse">
          <Select value={reg} onChange={(e) => setReg(e.target.value)}>
            <option value="">Choisir…</option>
            {regs.map((r) => (
              <option key={r.id} value={r.id} disabled={!!r.open_session}>
                {r.name} {r.open_session ? `— occupée (${r.open_session.opened_by})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fond de caisse (espèces)">
          <Input inputMode="numeric" className="num text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Button className="w-full" size="lg" variant="gradient" disabled={!reg} loading={loading} onClick={open}>
          Ouvrir la session
        </Button>
      </div>
    </Modal>
  )
}

export default function POS() {
  const me = useAuth((s) => s.me)!
  const wh = useAuth((s) => s.warehouseId)
  const can = useCan()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const cart = useCart()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('fav')
  const [picker, setPicker] = useState(false)
  const [pay, setPay] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [mobileCart, setMobileCart] = useState(false)
  const [clock, setClock] = useState(new Date())
  const searchRef = useRef<HTMLInputElement>(null)
  const session = me.open_session
  const company = me.company

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const online = useSync((s) => s.online)
  const pendingOps = useSync((s) => s.pending)
  // Catalogue : réseau d'abord, cache local (IndexedDB) si hors-ligne (§24.1).
  const { data: ref, isLoading } = useQuery({
    queryKey: ['pos-products', wh, online],
    queryFn: async () => {
      if (online) {
        try {
          return await refreshReferenceData(wh)
        } catch {
          /* bascule sur le cache */
        }
      }
      return referenceData(wh)
    },
    staleTime: 60_000,
    enabled: !!wh,
  })
  const products: any[] = ref?.products || []
  const categories: any[] = ref?.categories || []
  const activeMethods = (ref?.payment_methods || []).filter((m: any) => m.is_active)
  const locked = !online && offlineLocked()

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    let list = products
    if (term) {
      const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
      const t = norm(term)
      list = list.filter((p) => norm(p.name).includes(t) || p.sku.toLowerCase().includes(t) || (p.barcode || '').includes(term))
    } else if (cat === 'fav') list = list.filter((p) => p.is_favorite)
    else if (cat !== 'all') list = list.filter((p) => p.category === cat)
    return list.slice(0, 120)
  }, [products, q, cat])

  const prices_ttc = !!company.settings.prices_include_tax
  const doc = useMemo(
    () => computeDocument(cart.lines.map((l) => ({ quantity: l.quantity, unit_price: l.unit_price, discount_type: l.discount_type, discount_value: l.discount_value, tax_rate: l.tax_rate })), cart.globalType, cart.globalValue, prices_ttc, company.currency_decimals),
    [cart.lines, cart.globalType, cart.globalValue, prices_ttc, company.currency_decimals],
  )

  const addProduct = (p: any, n = 1) => {
    const inCart = cart.lines.find((l) => l.product_id === p.id)?.quantity || 0
    if (p.track_stock && Number(p.stock) < inCart + n) {
      toast.warning(`Stock insuffisant : ${qty(p.stock)} disponible(s) pour « ${p.name} ».`, { description: 'Réduisez la quantité ou demandez un transfert.' })
      beep(false)
      return
    }
    cart.add(p, n)
    beep(true)
  }

  const scan = async (code: string) => {
    const local = products.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase())
    if (local) {
      addProduct(local)
      setQ('')
      return
    }
    if (!online) {
      beep(false)
      toast.error('Produit introuvable', { description: `Aucun produit en cache pour le code ${code}.` })
      return
    }
    try {
      const p = await get(`/products/by-barcode/${encodeURIComponent(code)}`, { warehouse: wh })
      addProduct(p, Number(p.scan_quantity || 1))
      setQ('')
    } catch (e) {
      beep(false)
      if (e instanceof ApiError && e.status === 404) toast.error('Produit introuvable', { description: `Aucun produit pour le code ${code}.` })
      else showError(e)
    }
  }

  useHotkey('f2', (e) => {
    e.preventDefault()
    searchRef.current?.focus()
  })
  useHotkey('f4', (e) => {
    e.preventDefault()
    if (cart.lines.length && session) setPay(true)
  }, [cart.lines.length, session])
  useHotkey('f8', (e) => {
    e.preventDefault()
    cart.hold()
    toast('Ticket mis en attente')
  })

  const maxDiscount = Number(me.max_discount_pct)
  const buildPayload = () => ({
    type: 'pos',
    warehouse_id: wh,
    customer_id: cart.customer?.id || null,
    global_discount_type: cart.globalType,
    global_discount_value: cart.globalValue,
    items: cart.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, discount_type: l.discount_type, discount_value: l.discount_value })),
  })

  const catList = [{ id: 'fav', name: 'Favoris', color: '#fdba8c' }, { id: 'all', name: 'Tout', color: '#a78bfa' }, ...(categories || []).filter((c) => c.is_active && c.products_count > 0)]

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden">
      <Aurora />
      {!session && can('cash.session') && online && <OpenSessionModal onOpened={() => qc.invalidateQueries()} />}

      {/* Barre supérieure */}
      <header className="relative z-20 flex items-center gap-3 px-3 pt-3 sm:px-4">
        <div className="glass-strong flex h-14 flex-1 items-center gap-3 rounded-full px-3">
          <IconButton label="Retour" onClick={() => navigate('/dashboard')}>
            <ArrowLeft size={18} />
          </IconButton>
          <div className="hidden sm:block">
            <Logo />
          </div>
          <div className="mx-2 hidden h-6 w-px bg-line/10 sm:block" />
          {session ? (
            <span className="flex items-center gap-2 rounded-full bg-mint/10 px-3 py-1 text-[12.5px] font-medium text-mint">
              <span className="h-2 w-2 animate-pulse rounded-full bg-mint" /> {session.register}
            </span>
          ) : (
            <Badge tone="red">Caisse fermée</Badge>
          )}
          <span className="hidden text-[12.5px] text-muted md:block">{me.warehouses.find((w) => w.id === wh)?.name}</span>
          <div className="ml-auto flex items-center gap-2">
            <SyncPill compact />
            <span className="num hidden items-center gap-1.5 text-[13px] text-muted md:flex">
              <Clock size={14} /> {clock.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <button onClick={() => setHeldOpen(true)} className="chip relative text-fg/80 hover:bg-line/5">
              <PauseCircle size={14} /> En attente
              {cart.held.length > 0 && <span className="rounded-full bg-gradient-brand px-1.5 text-[10px] font-bold text-[#14101f]">{cart.held.length}</span>}
            </button>
            {session && (
              <Button
                size="sm"
                variant="soft"
                disabled={!online || pendingOps > 0}
                title={pendingOps > 0 ? 'Synchronisez les ventes hors-ligne avant de clôturer' : !online ? 'Clôture impossible hors-ligne' : undefined}
                onClick={() => navigate(`/cash/sessions/${session.id}`)}
              >
                Clôturer
              </Button>
            )}
            <button onClick={toggleTheme} className="hidden sm:block">
              <Avatar name={me.user.full_name} size={34} />
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 gap-3 p-3 sm:gap-4 sm:p-4">
        {/* Catalogue */}
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          {!online && (
            <div className={cx('flex items-center gap-3 rounded-2xl border px-4 py-2.5 text-[13px]', locked ? 'border-danger/30 bg-danger/10 text-danger' : 'border-sky/30 bg-sky/10 text-sky')}>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-current" />
              </span>
              {locked
                ? `Caisse verrouillée : aucune synchronisation depuis plus de ${MAX_OFFLINE_HOURS} h. Reconnectez l'appareil pour reprendre les ventes.`
                : `Mode hors-ligne — les ventes sont enregistrées sur cet appareil${pendingOps ? ` (${pendingOps} en attente)` : ''} et seront synchronisées au retour du réseau. Stock affiché indicatif.`}
            </div>
          )}
          <div className="glass-strong flex items-center gap-3 rounded-3xl p-2.5">
            <div className="relative flex-1">
              <ScanLine size={19} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-accent" />
              <input
                ref={searchRef}
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && q.trim()) {
                    e.preventDefault()
                    if (/^\d{6,14}$/.test(q.trim()) || filtered.length !== 1) scan(q.trim())
                    else {
                      addProduct(filtered[0])
                      setQ('')
                    }
                  }
                  if (e.key === 'Escape') setQ('')
                }}
                placeholder="Scannez ou recherchez un produit…"
                className="h-12 w-full rounded-2xl bg-line/[0.04] pl-12 pr-24 text-[15px] outline-none ring-accent/40 transition focus:bg-line/[0.06] focus:ring-2"
              />
              <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {q ? (
                  <button onClick={() => setQ('')} className="text-muted hover:text-fg">
                    <X size={16} />
                  </button>
                ) : (
                  <Kbd>F2</Kbd>
                )}
              </span>
            </div>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {catList.map((c: any) => (
              <button
                key={c.id}
                onClick={() => {
                  setCat(c.id)
                  setQ('')
                }}
                className={cx('flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium transition', cat === c.id && !q ? 'border-transparent bg-fg text-bg' : 'hairline glass text-fg/75 hover:text-fg')}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {Array.from({ length: 15 }).map((_, i) => (
                  <div key={i} className="skeleton h-[188px] rounded-3xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState icon={<Search size={24} />} title="Aucun produit" text="Essayez un autre mot-clé ou scannez le code-barres." />
            ) : (
              <motion.div layout className="grid grid-cols-2 gap-3 pb-24 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 lg:pb-2">
                {filtered.map((p, i) => {
                  const stock = Number(p.stock)
                  const out = p.track_stock && stock <= 0
                  const inCart = cart.lines.find((l) => l.product_id === p.id)
                  return (
                    <motion.button
                      key={p.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.012, 0.3) }}
                      whileTap={{ scale: 0.96 }}
                      disabled={out}
                      onClick={() => addProduct(p)}
                      className={cx('glass group relative flex flex-col overflow-hidden rounded-3xl p-2.5 text-left transition hover:-translate-y-0.5', out && 'opacity-45', inCart && 'ring-2 ring-accent/60')}
                    >
                      <div className="relative">
                        <ProductThumb image={p.image} icon={p.category_icon} color={p.category_color} name={p.name} size={400} className="!h-[104px] !w-full" rounded="rounded-2xl" />
                        {inCart && <span className="absolute right-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-gradient-brand px-2 text-[12px] font-bold text-[#14101f] shadow-lg">{qty(inCart.quantity)}</span>}
                        {p.track_stock && (
                          <span className={cx('absolute bottom-2 left-2 rounded-full px-2 py-0.5 text-[10.5px] font-semibold backdrop-blur-md', out ? 'bg-danger/80 text-white' : stock <= Number(p.min_stock) ? 'bg-warn/85 text-[#1a1305]' : 'bg-black/45 text-white')}>
                            {out ? 'Rupture' : `${qty(stock)} ${p.unit_code}`}
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5 line-clamp-2 min-h-[36px] px-1 text-[13px] font-medium leading-snug">{p.name}</div>
                      <div className="num mt-1 px-1 font-display text-[16px] font-bold">{money(p.price_retail)}</div>
                    </motion.button>
                  )
                })}
              </motion.div>
            )}
          </div>
        </section>

        {/* Panier */}
        <aside className={cx('glass-strong flex w-full flex-col rounded-[28px] lg:static lg:w-[400px] xl:w-[440px]', mobileCart ? 'fixed inset-3 z-50' : 'hidden lg:flex')}>
          <div className="flex items-center gap-2 border-b hairline p-4">
            <button onClick={() => setPicker(true)} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-1.5 text-left transition hover:bg-line/5">
              <Avatar name={cart.customer?.name || 'Client comptoir'} size={38} />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold">{cart.customer?.name || 'Client comptoir'}</span>
                <span className="block truncate text-[12px] text-muted">{cart.customer ? cart.customer.phone || 'Client identifié' : 'Touchez pour choisir un client'}</span>
              </span>
              <ChevronDown size={16} className="ml-auto shrink-0 text-muted" />
            </button>
            {cart.customer && (
              <IconButton label="Retirer le client" onClick={() => cart.setCustomer(null)}>
                <X size={16} />
              </IconButton>
            )}
            {mobileCart && (
              <IconButton label="Fermer" onClick={() => setMobileCart(false)}>
                <X size={18} />
              </IconButton>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {cart.lines.length === 0 ? (
              <EmptyState icon={<Barcode size={26} />} title="Panier vide" text="Scannez un article ou touchez un produit pour commencer." />
            ) : (
              <AnimatePresence initial={false}>
                {cart.lines.map((l) => {
                  const line = doc.lines[cart.lines.indexOf(l)]
                  return (
                    <motion.div key={l.product_id} layout initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30, height: 0 }} className="group flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-line/[0.04]">
                      <ProductThumb image={l.image} icon={l.icon} color={l.color} size={46} rounded="rounded-xl" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">{l.name}</div>
                        <div className="num text-[12px] text-muted">
                          {money(l.unit_price)}
                          {l.discount_value > 0 && <span className="ml-1.5 text-rose">−{l.discount_type === 'percent' ? `${l.discount_value} %` : money(l.discount_value)}</span>}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <button onClick={() => cart.setQty(l.product_id, +(l.quantity - 1).toFixed(3))} className="grid h-7 w-7 place-items-center rounded-full border hairline hover:bg-line/5">
                            <Minus size={13} />
                          </button>
                          <input
                            value={l.quantity}
                            inputMode="decimal"
                            onChange={(e) => {
                              const v = Number(e.target.value.replace(',', '.'))
                              if (!Number.isNaN(v)) cart.setQty(l.product_id, l.is_decimal ? v : Math.round(v))
                            }}
                            className="num h-7 w-12 rounded-lg bg-line/[0.05] text-center text-[13px] font-semibold outline-none"
                          />
                          <button
                            onClick={() => {
                              if (l.track_stock && l.quantity + 1 > l.stock) return toast.warning(`Stock disponible : ${qty(l.stock)}`)
                              cart.setQty(l.product_id, +(l.quantity + 1).toFixed(3))
                            }}
                            className="grid h-7 w-7 place-items-center rounded-full border hairline hover:bg-line/5"
                          >
                            <Plus size={13} />
                          </button>
                          <button
                            onClick={() => {
                              const v = window.prompt('Remise sur la ligne (en %)', String(l.discount_type === 'percent' ? l.discount_value : 0))
                              if (v !== null) cart.setDiscount(l.product_id, 'percent', Math.max(0, Math.min(100, Number(v.replace(',', '.')) || 0)))
                            }}
                            className="ml-1 grid h-7 w-7 place-items-center rounded-full text-muted opacity-0 transition hover:bg-line/5 hover:text-fg group-hover:opacity-100"
                            title="Remise"
                          >
                            <Percent size={13} />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="num text-[14px] font-semibold">{money(line?.line_total ?? 0, { symbol: false })}</span>
                        <button onClick={() => cart.remove(l.product_id)} className="text-muted opacity-60 transition hover:text-danger hover:opacity-100">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            )}
          </div>

          <div className="space-y-3 border-t hairline p-4">
            <div className="space-y-1.5 text-[13px]">
              <div className="flex justify-between text-muted">
                <span>Sous-total HT</span>
                <span className="num">{money(doc.subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>TVA</span>
                <span className="num">{money(doc.tax)}</span>
              </div>
              <button onClick={() => setDiscountOpen(true)} className="flex w-full justify-between text-muted hover:text-fg">
                <span className="flex items-center gap-1.5">
                  <Percent size={13} /> Remise {cart.globalValue > 0 && `(${cart.globalType === 'percent' ? `${cart.globalValue} %` : money(cart.globalValue)})`}
                </span>
                <span className={cx('num', doc.discount > 0 && 'text-rose')}>{doc.discount > 0 ? `−${money(doc.discount)}` : 'Ajouter'}</span>
              </button>
              {doc.maxDiscountPct > maxDiscount + 0.001 && <div className="rounded-xl bg-warn/10 px-3 py-1.5 text-[11.5px] text-warn">Remise au-delà de votre plafond ({maxDiscount} %) : un PIN gérant sera demandé.</div>}
            </div>
            <div className="flex items-end justify-between">
              <span className="label">Total TTC</span>
              <motion.span key={doc.total} initial={{ scale: 1.08, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} className="num font-display text-[34px] font-extrabold leading-none">
                {money(doc.total, { symbol: false })}
                <span className="ml-1 text-[14px] font-semibold text-muted">{company.currency_symbol}</span>
              </motion.span>
            </div>
            <div className="grid grid-cols-[auto_auto_1fr] gap-2">
              <Button variant="soft" size="lg" className="!px-4" title="Mettre en attente (F8)" disabled={!cart.lines.length} onClick={() => { cart.hold(); toast('Ticket mis en attente') }}>
                <PauseCircle size={18} />
              </Button>
              <Button variant="soft" size="lg" className="!px-4" title="Vider" disabled={!cart.lines.length} onClick={() => cart.clear()}>
                <Trash2 size={18} />
              </Button>
              <Button variant="gradient" size="lg" disabled={!cart.lines.length || !session || locked} onClick={() => setPay(true)}>
                Encaisser <Kbd>F4</Kbd>
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {/* Bouton panier mobile */}
      {!mobileCart && (
        <div className="fixed inset-x-3 bottom-3 z-30 lg:hidden">
          <Button variant="gradient" size="xl" className="w-full justify-between" onClick={() => setMobileCart(true)}>
            <span className="flex items-center gap-2">
              <ShoppingCart size={20} /> {cart.lines.length} article(s)
            </span>
            <span className="num">{money(doc.total)}</span>
          </Button>
        </div>
      )}

      <CustomerPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(c) => {
          cart.setCustomer(c)
          setPicker(false)
        }}
      />

      <Modal open={discountOpen} onClose={() => setDiscountOpen(false)} size="sm" title="Remise globale" subtitle={`Votre plafond : ${maxDiscount} % — au-delà, autorisation gérant.`}>
        <DiscountForm
          type={cart.globalType}
          value={cart.globalValue}
          onApply={(t, v) => {
            cart.setGlobal(t, v)
            setDiscountOpen(false)
          }}
        />
      </Modal>

      <Modal open={heldOpen} onClose={() => setHeldOpen(false)} title="Tickets en attente" subtitle="Reprenez un panier suspendu">
        <div className="space-y-2 pb-2">
          {cart.held.length === 0 && <EmptyState title="Aucun ticket en attente" />}
          {cart.held.map((h) => (
            <div key={h.id} className="flex items-center gap-3 rounded-2xl border hairline p-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-line/[0.06]">
                <User size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{h.customer?.name || 'Client comptoir'} · {h.lines.length} article(s)</div>
                <div className="text-[12px] text-muted">{relative(h.at)}</div>
              </div>
              <Button size="sm" icon={<Play size={14} />} onClick={() => { cart.resume(h.id); setHeldOpen(false) }}>
                Reprendre
              </Button>
              <IconButton label="Supprimer" onClick={() => cart.dropHeld(h.id)}>
                <Trash2 size={15} />
              </IconButton>
            </div>
          ))}
        </div>
      </Modal>

      <PaymentModal
        open={pay}
        onClose={() => setPay(false)}
        total={doc.total}
        methods={activeMethods}
        buildPayload={buildPayload}
        customerIsWalkin={!cart.customer}
        offline={!online}
        queueOffline={async (payments, change, key) => {
          if (doc.maxDiscountPct > maxDiscount + 0.001) {
            throw new ApiError({ status: 403, title: 'Hors-ligne', detail: 'Remise au-delà de votre plafond : l’autorisation du gérant est indisponible hors-ligne.', code: 'OFFLINE_DISCOUNT' })
          }
          const payload = { ...buildPayload(), idempotency_key: key, expected_total: doc.total, items: buildPayload().items.map((i: any, idx: number) => ({ ...i, unit_price: cart.lines[idx].unit_price })), payments: payments.map(({ name, ...p }) => p) }
          return queueSale({
            payload,
            warehouse: wh!,
            preview: {
              total: doc.total,
              items: cart.lines.length,
              customer: cart.customer?.name || 'Client comptoir',
              change,
              lines: cart.lines.map((l, idx) => ({ name: l.name, quantity: l.quantity, unit_price: l.unit_price, line_total: doc.lines[idx]?.line_total ?? 0 })),
              payments: payments.map((p) => ({ name: p.name, amount: Number(p.amount), reference: p.reference })),
            },
          })
        }}
        onPrintProvisional={(op) => printProvisionalTicket(op, company, me.user.full_name)}
        onDone={() => {
          cart.clear()
          setMobileCart(false)
          qc.invalidateQueries({ queryKey: ['pos-products'] })
          qc.invalidateQueries({ queryKey: ['dashboard'] })
          setTimeout(() => searchRef.current?.focus(), 100)
        }}
      />
    </div>
  )
}

function DiscountForm({ type, value, onApply }: { type: 'percent' | 'amount'; value: number; onApply: (t: 'percent' | 'amount', v: number) => void }) {
  const [t, setT] = useState(type)
  const [v, setV] = useState(String(value || ''))
  return (
    <div className="space-y-4 pb-2">
      <div className="grid grid-cols-2 gap-2">
        {(['percent', 'amount'] as const).map((k) => (
          <button key={k} onClick={() => setT(k)} className={cx('rounded-2xl border p-3 text-[13.5px] font-medium transition', t === k ? 'border-transparent bg-fg text-bg' : 'hairline hover:bg-line/5')}>
            {k === 'percent' ? 'Pourcentage' : 'Montant fixe'}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(t === 'percent' ? [5, 10, 15, 20] : [500, 1000, 2000, 5000]).map((x) => (
          <button key={x} onClick={() => setV(String(x))} className="chip text-fg/80 hover:bg-line/5">
            {t === 'percent' ? `${x} %` : money(x)}
          </button>
        ))}
      </div>
      <Input autoFocus inputMode="decimal" className="num text-lg" value={v} onChange={(e) => setV(e.target.value)} />
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={() => onApply('percent', 0)}>
          Retirer
        </Button>
        <Button className="flex-1" onClick={() => onApply(t, Math.max(0, Number(v.replace(',', '.')) || 0))}>
          Appliquer
        </Button>
      </div>
    </div>
  )
}
