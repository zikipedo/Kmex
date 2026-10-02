import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CustomerLite } from '@/components/pickers'

export type CartLine = {
  product_id: string
  name: string
  sku: string
  unit_price: number
  tax_rate: number
  quantity: number
  discount_type: 'percent' | 'amount'
  discount_value: number
  stock: number
  track_stock: boolean
  image?: Record<string, string> | null
  icon?: string
  color?: string
  is_decimal?: boolean
}

export type HeldCart = { id: string; at: string; lines: CartLine[]; customer: CustomerLite | null; note: string }

type State = {
  lines: CartLine[]
  customer: CustomerLite | null
  globalType: 'percent' | 'amount'
  globalValue: number
  held: HeldCart[]
  add: (p: any, qty?: number) => void
  setQty: (id: string, q: number) => void
  setDiscount: (id: string, type: 'percent' | 'amount', value: number) => void
  remove: (id: string) => void
  clear: () => void
  setCustomer: (c: CustomerLite | null) => void
  setGlobal: (t: 'percent' | 'amount', v: number) => void
  hold: (note?: string) => void
  resume: (id: string) => void
  dropHeld: (id: string) => void
}

/** Panier persisté localement : survit à une coupure d'électricité ou de réseau (§19.2, §28). */
export const useCart = create<State>()(
  persist(
    (set, get) => ({
      lines: [],
      customer: null,
      globalType: 'percent',
      globalValue: 0,
      held: [],
      add: (p, qty = 1) =>
        set((s) => {
          const ex = s.lines.find((l) => l.product_id === p.id)
          if (ex) return { lines: s.lines.map((l) => (l.product_id === p.id ? { ...l, quantity: +(l.quantity + qty).toFixed(3) } : l)) }
          return {
            lines: [
              ...s.lines,
              {
                product_id: p.id,
                name: p.name,
                sku: p.sku,
                unit_price: Number(p.price_retail),
                tax_rate: Number(p.tax_rate || 0),
                quantity: qty,
                discount_type: 'percent',
                discount_value: 0,
                stock: Number(p.stock ?? 0),
                track_stock: p.track_stock !== false,
                image: p.image,
                icon: p.category_icon,
                color: p.category_color,
                is_decimal: p.unit_is_decimal,
              },
            ],
          }
        }),
      setQty: (id, q) => set((s) => ({ lines: q <= 0 ? s.lines.filter((l) => l.product_id !== id) : s.lines.map((l) => (l.product_id === id ? { ...l, quantity: q } : l)) })),
      setDiscount: (id, type, value) => set((s) => ({ lines: s.lines.map((l) => (l.product_id === id ? { ...l, discount_type: type, discount_value: value } : l)) })),
      remove: (id) => set((s) => ({ lines: s.lines.filter((l) => l.product_id !== id) })),
      clear: () => set({ lines: [], customer: null, globalType: 'percent', globalValue: 0 }),
      setCustomer: (customer) => set({ customer }),
      setGlobal: (globalType, globalValue) => set({ globalType, globalValue }),
      hold: (note = '') => {
        const s = get()
        if (!s.lines.length) return
        set({ held: [{ id: crypto.randomUUID?.() || String(Date.now()), at: new Date().toISOString(), lines: s.lines, customer: s.customer, note }, ...s.held].slice(0, 12), lines: [], customer: null, globalValue: 0 })
      },
      resume: (id) => {
        const s = get()
        const h = s.held.find((x) => x.id === id)
        if (!h) return
        const held = s.held.filter((x) => x.id !== id)
        if (s.lines.length) held.unshift({ id: crypto.randomUUID?.() || String(Date.now()), at: new Date().toISOString(), lines: s.lines, customer: s.customer, note: '' })
        set({ lines: h.lines, customer: h.customer, held })
      },
      dropHeld: (id) => set((s) => ({ held: s.held.filter((x) => x.id !== id) })),
    }),
    { name: 'sp-pos-cart' },
  ),
)
