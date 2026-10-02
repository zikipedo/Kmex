import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Box, CornerDownLeft, FileText, Search, ShoppingCart, Truck, User } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Kbd } from '@/components/ui'
import { get } from '@/lib/api'
import { useDebounced } from '@/lib/hooks'
import { useCan } from '@/store/auth'
import { NAV } from './nav'

type Result = { type: string; id: string; title: string; subtitle?: string; link: string }

const TYPE_ICON: Record<string, any> = { product: Box, customer: User, sale: FileText, supplier: Truck, purchase_order: ShoppingCart }
const TYPE_LABEL: Record<string, string> = { product: 'Produit', customer: 'Client', sale: 'Vente', supplier: 'Fournisseur', purchase_order: 'Commande', page: 'Page' }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [active, setActive] = useState(0)
  const dq = useDebounced(q, 180)
  const navigate = useNavigate()
  const can = useCan()
  const inputRef = useRef<HTMLInputElement>(null)

  const pages: Result[] = useMemo(
    () =>
      NAV.flatMap((g) => g.items)
        .filter((i) => !i.perm || can(i.perm))
        .map((i) => ({ type: 'page', id: i.to, title: i.label, link: i.to })),
    [can],
  )

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    let cancel = false
    if (dq.trim().length < 2) {
      setResults([])
      return
    }
    get<{ results: Result[] }>('/search', { q: dq }).then((r) => !cancel && setResults(r.results)).catch(() => null)
    return () => {
      cancel = true
    }
  }, [dq])

  const filteredPages = pages.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 4 : 8)
  const all = [...results, ...filteredPages]

  const go = (r?: Result) => {
    if (!r) return
    navigate(r.link)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] flex items-start justify-center px-3 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-md" onClick={onClose} />
          <motion.div initial={{ opacity: 0, y: -20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ type: 'spring', damping: 26, stiffness: 320 }} className="glass-strong glow-ring relative w-full max-w-2xl overflow-hidden rounded-[28px]">
            <div className="flex items-center gap-3 border-b hairline px-5">
              <Search size={19} className="text-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setActive(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onClose()
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActive((a) => Math.min(a + 1, all.length - 1))
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActive((a) => Math.max(a - 1, 0))
                  }
                  if (e.key === 'Enter') go(all[active])
                }}
                placeholder="Produit, code-barres, client, n° de facture, page…"
                className="h-16 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted/70"
              />
              <Kbd>Échap</Kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {all.length === 0 && <div className="px-4 py-10 text-center text-[13.5px] text-muted">{q.length >= 2 ? 'Aucun résultat.' : 'Tapez au moins 2 caractères.'}</div>}
              {all.map((r, i) => {
                const Icon = TYPE_ICON[r.type] || ArrowRight
                return (
                  <button key={`${r.type}-${r.id}`} onMouseEnter={() => setActive(i)} onClick={() => go(r)} className={cx('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition', active === i ? 'bg-line/[0.07]' : '')}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-line/[0.06]">
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{r.title}</span>
                      {r.subtitle && <span className="block truncate text-[12px] text-muted">{r.subtitle}</span>}
                    </span>
                    <span className="label text-[10px]">{TYPE_LABEL[r.type]}</span>
                    {active === i && <CornerDownLeft size={14} className="text-muted" />}
                  </button>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
