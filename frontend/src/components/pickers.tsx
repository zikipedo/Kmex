import { KeyRound, Plus, Search, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { get, post } from '@/lib/api'
import { money } from '@/lib/format'
import { showError, useDebounced } from '@/lib/hooks'
import { referenceData, useSync } from '@/lib/offline'
import { useAuth } from '@/store/auth'
import { Avatar, Badge, Button, cx, Field, Input, Modal, ProductThumb } from './ui'

export type CustomerLite = { id: string; name: string; phone?: string; code?: string; balance?: string; credit_limit?: string; is_walkin?: boolean; status?: string; type?: string }

export function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: CustomerLite | null) => void }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [rows, setRows] = useState<CustomerLite[]>([])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '' })
  const online = useSync((s) => s.online)
  useEffect(() => {
    if (!open) return
    const fromCache = async () => {
      const ref = await referenceData(useAuth.getState().warehouseId)
      const t = dq.trim().toLowerCase()
      setRows((ref?.customers || []).filter((c: any) => !c.is_walkin && (!t || c.name.toLowerCase().includes(t) || (c.phone || '').includes(t))).slice(0, 12))
    }
    if (!online) {
      void fromCache()
      return
    }
    get('/customers', { search: dq, limit: 12, hide_walkin: 1 }).then((r) => setRows(r.data)).catch(() => fromCache())
  }, [dq, open, online])
  const create = async () => {
    try {
      const c = await post('/customers', { name: form.name, phone: form.phone, whatsapp: form.phone })
      onPick(c)
      setCreating(false)
      setForm({ name: '', phone: '' })
    } catch (e) {
      showError(e)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Choisir un client" subtitle="Recherche par nom, téléphone ou code" size="md">
      {!creating ? (
        <div className="space-y-3 pb-2">
          <Input autoFocus icon={<Search size={16} />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, téléphone…" />
          <button onClick={() => onPick(null)} className="flex w-full items-center gap-3 rounded-2xl border border-dashed hairline px-4 py-3 text-left text-[13.5px] transition hover:bg-line/5">
            <Avatar name="Client comptoir" size={34} />
            <span>
              <span className="block font-medium">Client comptoir</span>
              <span className="text-[12px] text-muted">Vente anonyme · paiement complet obligatoire</span>
            </span>
          </button>
          <div className="max-h-[340px] space-y-1 overflow-y-auto">
            {rows.map((c) => (
              <button key={c.id} onClick={() => onPick(c)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-line/[0.06]">
                <Avatar name={c.name} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{c.name}</span>
                  <span className="text-[12px] text-muted">{c.phone || c.code}</span>
                </span>
                {Number(c.balance) > 0 && <Badge tone="amber">Doit {money(c.balance, { compact: true })}</Badge>}
                {c.status === 'blocked' && <Badge tone="red">Bloqué</Badge>}
              </button>
            ))}
          </div>
          {online ? (
            <Button variant="soft" className="w-full" icon={<UserPlus size={16} />} onClick={() => setCreating(true)}>
              Nouveau client
            </Button>
          ) : (
            <p className="text-center text-[12px] text-muted">Hors-ligne : création de client indisponible (clients en cache uniquement).</p>
          )}
        </div>
      ) : (
        <div className="space-y-4 pb-2">
          <Field label="Nom" required>
            <Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Téléphone / WhatsApp">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+223 …" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Retour
            </Button>
            <Button disabled={form.name.trim().length < 2} onClick={create} icon={<Plus size={16} />}>
              Créer et sélectionner
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export function ProductSearch({ onPick, placeholder = 'Ajouter un produit (nom, SKU, code-barres)…', warehouse }: { onPick: (p: any) => void; placeholder?: string; warehouse?: string | null }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 200)
  const [rows, setRows] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (dq.trim().length < 1) {
      setRows([])
      return
    }
    get('/products', { q: dq, limit: 8, warehouse }).then((r) => setRows(r.data)).catch(() => null)
  }, [dq, warehouse])
  return (
    <div className="relative">
      <Input
        icon={<Search size={16} />}
        value={q}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && rows[0]) {
            e.preventDefault()
            onPick(rows[0])
            setQ('')
          }
        }}
        placeholder={placeholder}
      />
      {open && rows.length > 0 && (
        <div className="glass-strong absolute left-0 right-0 top-12 z-30 max-h-80 overflow-y-auto rounded-2xl p-1.5">
          {rows.map((p) => (
            <button
              key={p.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(p)
                setQ('')
              }}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-line/[0.07]"
            >
              <ProductThumb image={p.image} icon={p.category_icon} color={p.category_color} size={36} rounded="rounded-xl" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{p.name}</span>
                <span className="text-[11.5px] text-muted">
                  {p.sku} · stock {Number(p.stock).toLocaleString('fr-FR')}
                </span>
              </span>
              <span className="num text-[13px] font-semibold">{money(p.price_retail)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Saisie du PIN d'un gérant pour autoriser une dérogation (remise, crédit). */
export function PinPrompt({ open, title, message, onClose, onSubmit }: { open: boolean; title: string; message?: string; onClose: () => void; onSubmit: (pin: string) => void }) {
  const [pin, setPin] = useState('')
  useEffect(() => setPin(''), [open])
  const press = (d: string) => setPin((p) => (p.length < 6 ? p + d : p))
  return (
    <Modal open={open} onClose={onClose} size="sm" title={title} subtitle={message} icon={<KeyRound size={18} className="text-warn" />}>
      <div className="pb-3">
        <div className="mb-5 flex justify-center gap-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className={cx('h-3.5 w-3.5 rounded-full border transition', i < pin.length ? 'border-transparent bg-gradient-brand scale-110' : 'hairline')} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
            <button
              key={k}
              onClick={() => (k === 'C' ? setPin('') : k === '⌫' ? setPin((p) => p.slice(0, -1)) : press(k))}
              className="h-14 rounded-2xl border hairline text-xl font-semibold transition hover:bg-line/[0.07] active:scale-95"
            >
              {k}
            </button>
          ))}
        </div>
        <Button className="mt-4 w-full" size="lg" disabled={pin.length < 4} onClick={() => onSubmit(pin)}>
          Autoriser
        </Button>
      </div>
    </Modal>
  )
}
