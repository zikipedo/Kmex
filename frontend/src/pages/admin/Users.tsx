import { useQueryClient } from '@tanstack/react-query'
import { Copy, Lock, Plus, ShieldCheck, UserCheck, UserX } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { confirm } from '@/components/confirm'
import { useWarehouses } from '@/components/forms'
import { Page, PageHeader } from '@/components/page'
import { DataTable } from '@/components/table'
import { Avatar, Badge, Button, Card, cx, Field, Input, Modal, Tabs } from '@/components/ui'
import { api, post } from '@/lib/api'
import { relative } from '@/lib/format'
import { showError, useApi, useList } from '@/lib/hooks'

export default function Users() {
  const [tab, setTab] = useState<'users' | 'roles'>('users')
  return (
    <Page>
      <PageHeader title="Utilisateurs" accent="& rôles" subtitle="RBAC : permissions atomiques vérifiées côté serveur, périmètres par dépôt, anti-escalade de privilèges." />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ key: 'users', label: 'Utilisateurs' }, { key: 'roles', label: 'Rôles & permissions' }]} />
      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </Page>
  )
}

function UsersTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [edit, setEdit] = useState<any>(null)
  const { data, isLoading } = useList<any>('users', '/users', { search })
  const { data: roles } = useApi<any[]>(['roles'], '/roles')
  const { data: warehouses } = useApi<any[]>(['warehouses-all'], '/warehouses', { all: 1 })
  const save = async () => {
    try {
      const body = { ...edit }
      if (!body.password) delete body.password
      if (!body.pin) delete body.pin
      if (edit.id) await api(`/users/${edit.id}`, { method: 'PATCH', body })
      else await post('/users', body)
      toast.success('Utilisateur enregistré')
      qc.invalidateQueries({ queryKey: ['users'] })
      setEdit(null)
    } catch (e) {
      showError(e)
    }
  }
  const toggle = async (u: any) => {
    const r = await confirm({ title: u.is_active ? `Désactiver ${u.full_name} ?` : `Réactiver ${u.full_name} ?`, message: u.is_active ? 'Ses sessions seront révoquées immédiatement ; son historique est conservé.' : undefined, requireReason: u.is_active, danger: u.is_active })
    if (!r.ok) return
    try {
      await post(`/users/${u.id}/${u.is_active ? 'deactivate' : 'reactivate'}`, { reason: r.reason })
      qc.invalidateQueries({ queryKey: ['users'] })
    } catch (e) {
      showError(e)
    }
  }
  return (
    <>
      <DataTable
        loading={isLoading}
        rows={data?.data}
        search={search}
        onSearch={setSearch}
        toolbar={<Button variant="gradient" icon={<Plus size={16} />} onClick={() => setEdit({ full_name: '', email: '', phone: '', job_title: '', password: '', pin: '', roles: [], warehouses: [] })}>Nouvel utilisateur</Button>}
        onRowClick={(u) => setEdit({ ...u, password: '', pin: '' })}
        columns={[
          { key: 'name', header: 'Utilisateur', render: (u) => <div className="flex items-center gap-3"><Avatar name={u.full_name} size={36} /><div><div className="font-medium">{u.full_name}</div><div className="text-[12px] text-muted">{u.email}</div></div></div> },
          { key: 'roles', header: 'Rôles', render: (u) => <div className="flex flex-wrap gap-1">{u.role_names.map((r: string) => <Badge key={r} tone={u.is_owner ? 'pink' : 'violet'}>{r}</Badge>)}</div> },
          { key: 'last', header: 'Dernière connexion', hideOnMobile: true, render: (u) => <span className="text-muted">{u.last_login ? relative(u.last_login) : 'Jamais'}</span> },
          { key: 'pin', header: 'PIN', hideOnMobile: true, render: (u) => (u.has_pin ? <Lock size={14} className="text-mint" /> : '—') },
          { key: 'status', header: 'Statut', render: (u) => (!u.is_active ? <Badge tone="gray">Désactivé</Badge> : u.locked_until && new Date(u.locked_until) > new Date() ? <Badge tone="red">Verrouillé</Badge> : <Badge tone="green" dot>Actif</Badge>) },
          { key: 'act', header: '', align: 'right', render: (u) => !u.is_owner && <Button size="sm" variant="ghost" icon={u.is_active ? <UserX size={14} /> : <UserCheck size={14} />} onClick={(e) => { e.stopPropagation(); toggle(u) }}>{u.is_active ? 'Désactiver' : 'Réactiver'}</Button> },
        ]}
      />
      <Modal open={!!edit} onClose={() => setEdit(null)} size="lg" title={edit?.id ? edit.full_name : 'Nouvel utilisateur'} subtitle="Un compte = une personne. Mot de passe de 10 caractères minimum." footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Annuler</Button><Button onClick={save}>Enregistrer</Button></>}>
        {edit && (
          <div className="grid gap-4 pb-2 sm:grid-cols-2">
            <Field label="Nom complet" required><Input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            <Field label="Email" required><Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Téléphone"><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Fonction"><Input value={edit.job_title} onChange={(e) => setEdit({ ...edit, job_title: e.target.value })} /></Field>
            <Field label={edit.id ? 'Nouveau mot de passe (optionnel)' : 'Mot de passe temporaire'} hint="À changer à la première connexion"><Input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
            <Field label="PIN caisse / autorisation (4-6 chiffres)"><Input inputMode="numeric" value={edit.pin} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></Field>
            {!edit.is_owner && (
              <Field label="Rôles" className="sm:col-span-2">
                <div className="flex flex-wrap gap-2">
                  {(roles || []).map((r) => {
                    const on = edit.roles.includes(r.id)
                    return <button key={r.id} onClick={() => setEdit({ ...edit, roles: on ? edit.roles.filter((x: string) => x !== r.id) : [...edit.roles, r.id] })} className={cx('chip', on ? 'border-transparent bg-fg text-bg' : 'text-muted hover:text-fg')}>{r.name}</button>
                  })}
                </div>
              </Field>
            )}
            <Field label="Dépôts autorisés" className="sm:col-span-2">
              <div className="flex flex-wrap gap-2">
                {(warehouses || []).map((w) => {
                  const on = edit.warehouses.includes(w.id)
                  return <button key={w.id} onClick={() => setEdit({ ...edit, warehouses: on ? edit.warehouses.filter((x: string) => x !== w.id) : [...edit.warehouses, w.id] })} className={cx('chip', on ? 'border-transparent bg-fg text-bg' : 'text-muted hover:text-fg')}>{w.name}</button>
                })}
              </div>
            </Field>
          </div>
        )}
      </Modal>
    </>
  )
}

function RolesTab() {
  const qc = useQueryClient()
  const { data: roles } = useApi<any[]>(['roles'], '/roles')
  const { data: perms } = useApi<any[]>(['permissions'], '/permissions')
  const [sel, setSel] = useState<string | null>(null)
  const [draft, setDraft] = useState<any>(null)
  useEffect(() => {
    if (roles?.length && !sel) setSel(roles[0].id)
  }, [roles, sel])
  useEffect(() => {
    const r = roles?.find((x) => x.id === sel)
    if (r) setDraft({ ...r })
  }, [sel, roles])
  const modules = useMemo(() => {
    const m: Record<string, any[]> = {}
    ;(perms || []).forEach((p) => (m[p.module] = [...(m[p.module] || []), p]))
    return m
  }, [perms])
  const save = async () => {
    try {
      if (draft.id) await api(`/roles/${draft.id}`, { method: 'PATCH', body: { name: draft.name, description: draft.description, permissions: draft.permissions, max_discount_pct: draft.max_discount_pct, expense_approval_limit: draft.expense_approval_limit === '' ? null : draft.expense_approval_limit } })
      else {
        const r = await post('/roles', { name: draft.name, description: draft.description, permissions: draft.permissions, max_discount_pct: draft.max_discount_pct || 0 })
        setSel(r.id)
      }
      toast.success('Rôle enregistré — effet immédiat')
      qc.invalidateQueries({ queryKey: ['roles'] })
    } catch (e) {
      showError(e)
    }
  }
  if (!draft) return null
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="h-fit p-2">
        {(roles || []).map((r) => (
          <button key={r.id} onClick={() => setSel(r.id)} className={cx('flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-[13.5px] transition', sel === r.id ? 'bg-line/[0.08]' : 'hover:bg-line/[0.04]')}>
            <span>
              <span className="block font-medium">{r.name}</span>
              <span className="text-[11.5px] text-muted">{r.permissions.length} permissions · {r.users_count} utilisateur(s)</span>
            </span>
            {r.is_system && <ShieldCheck size={14} className="text-muted" />}
          </button>
        ))}
        <Button className="mt-2 w-full" variant="soft" icon={<Copy size={14} />} onClick={() => { setSel(null); setDraft({ name: `${draft.name} (copie)`, description: draft.description, permissions: [...draft.permissions], max_discount_pct: draft.max_discount_pct }) }}>Dupliquer ce rôle</Button>
      </Card>
      <Card className="p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom du rôle"><Input value={draft.name} disabled={draft.is_system} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Description"><Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          <Field label="Plafond de remise (%)"><Input inputMode="decimal" value={draft.max_discount_pct} onChange={(e) => setDraft({ ...draft, max_discount_pct: e.target.value })} /></Field>
          <Field label="Plafond d'approbation des dépenses" hint="Vide = illimité · 0 = toujours soumis"><Input inputMode="numeric" value={draft.expense_approval_limit ?? ''} onChange={(e) => setDraft({ ...draft, expense_approval_limit: e.target.value })} /></Field>
        </div>
        <div className="mt-6 space-y-5">
          {Object.entries(modules).map(([mod, list]) => (
            <div key={mod}>
              <div className="label mb-2">{mod}</div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((p) => {
                  const on = draft.permissions.includes(p.code)
                  return (
                    <button key={p.code} onClick={() => setDraft({ ...draft, permissions: on ? draft.permissions.filter((x: string) => x !== p.code) : [...draft.permissions, p.code] })} className={cx('flex items-start gap-3 rounded-2xl border p-3 text-left transition', on ? 'border-accent/40 bg-accent/10' : 'hairline hover:bg-line/[0.04]')}>
                      <span className={cx('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-md border', on ? 'border-transparent bg-gradient-brand' : 'hairline')}>{on && <span className="h-1.5 w-1.5 rounded-full bg-[#14101f]" />}</span>
                      <span><span className="block text-[13px] font-medium">{p.label}</span><span className="font-mono text-[10.5px] text-muted">{p.code}</span></span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end"><Button variant="gradient" onClick={save}>Enregistrer le rôle</Button></div>
      </Card>
    </div>
  )
}
