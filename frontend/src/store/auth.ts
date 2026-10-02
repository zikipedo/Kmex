import { create } from 'zustand'

export type Company = {
  id: string
  name: string
  legal_name: string
  address: string
  city: string
  country: string
  phone: string
  email: string
  website: string
  legal_ids: Record<string, string>
  currency: string
  currency_symbol: string
  currency_decimals: number
  timezone: string
  logo_url: string | null
  settings: Record<string, any>
}

export type Me = {
  user: {
    id: string
    email: string
    full_name: string
    job_title: string
    is_owner: boolean
    role_names: string[]
    has_pin: boolean
    default_warehouse: string | null
    must_change_password: boolean
  }
  permissions: string[]
  max_discount_pct: string
  company: Company
  warehouses: { id: string; code: string; name: string }[]
  open_session: { id: string; register: string; register_id: string; warehouse_id: string } | null
}

type State = {
  access: string | null
  me: Me | null
  warehouseId: string | null
  booting: boolean
  setAccess: (t: string | null) => void
  setMe: (m: Me | null) => void
  setWarehouse: (id: string) => void
  setBooting: (b: boolean) => void
  logoutLocal: () => void
}

const storedWh = (() => {
  try {
    return localStorage.getItem('sp-warehouse')
  } catch {
    return null
  }
})()

export const useAuth = create<State>((set) => ({
  access: null,
  me: null,
  warehouseId: storedWh,
  booting: true,
  setAccess: (access) => set({ access }),
  setMe: (me) =>
    set((s) => {
      let wh = s.warehouseId
      const ids = me?.warehouses.map((w) => w.id) || []
      if (me?.open_session) wh = me.open_session.warehouse_id
      if (!wh || !ids.includes(wh)) wh = me?.user.default_warehouse && ids.includes(me.user.default_warehouse) ? me.user.default_warehouse : ids[0] || null
      return { me, warehouseId: wh }
    }),
  setWarehouse: (id) => {
    try {
      localStorage.setItem('sp-warehouse', id)
    } catch {}
    set({ warehouseId: id })
  },
  setBooting: (booting) => set({ booting }),
  logoutLocal: () => set({ access: null, me: null }),
}))

export function useCan() {
  const perms = useAuth((s) => s.me?.permissions)
  return (code: string | string[]) => {
    if (!perms) return false
    const codes = Array.isArray(code) ? code : [code]
    return codes.some((c) => perms.includes(c))
  }
}

export function useCompany() {
  return useAuth((s) => s.me?.company)
}

/** Page d'accueil selon le profil (§29.6) : le caissier arrive directement au POS. */
export function homeFor(me: Me | null) {
  if (!me) return '/login'
  return me.permissions.includes('cash.session') && !me.permissions.includes('reports.view') ? '/pos' : '/dashboard'
}
