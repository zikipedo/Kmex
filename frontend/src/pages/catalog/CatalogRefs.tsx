import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/page'
import { Badge, Button, Card, cx, DynIcon, Field, ICONS, Input, Modal, Select, Switch, Tabs } from '@/components/ui'
import { api, post } from '@/lib/api'
import { showError, useApi } from '@/lib/hooks'
import { useCan } from '@/store/auth'

type Tab = 'categories' | 'brands' | 'units' | 'taxes'
const COLORS = ['#38bdf8', '#f59e0b', '#a5b4fc', '#f472b6', '#34d399', '#a78bfa', '#fb7185', '#fbbf24', '#2dd4bf', '#fdba8c', '#818cf8', '#94a3b8']

export default function CatalogRefs() {
  const [tab, setTab] = useState<Tab>('categories')
  const can = useCan()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<any>(null)
  const { data } = useApi<any[]>([tab], `/${tab}`)
  const { data: taxes } = useApi<any[]>(['taxes'], '/taxes')
  const { data: categories } = useApi<any[]>(['categories'], '/categories')
  const canEdit = tab === 'taxes' ? can('settings.manage') : can('catalog.manage')

  const save = async () => {
    try {
      const { id, ...body } = editing
      ;['parent', 'default_tax'].forEach((k) => body[k] === '' && (body[k] = null))
      if (id) await api(`/${tab}/${id}`, { method: 'PATCH', body })
      else await post(`/${tab}`, body)
      toast.success('Enregistré')
      qc.invalidateQueries({ queryKey: [tab] })
      setEditing(null)
    } catch (e) {
      showError(e)
    }
  }

  const blank: Record<Tab, any> = {
    categories: { name: '', parent: '', icon: 'package', color: '#a78bfa', default_tax: taxes?.find((t) => t.is_default)?.id || '', is_active: true },
    brands: { name: '' },
    units: { code: '', name: '', is_decimal: false },
    taxes: { name: '', rate: '0', is_active: true, is_default: false },
  }

  return (
    <Page>
      <PageHeader
        title="Référentiels"
        accent="du catalogue"
        subtitle="Catégories (avec TVA par défaut héritée), marques, unités et taxes configurables — aucune règle fiscale codée en dur."
        actions={canEdit && <Button variant="gradient" icon={<Plus size={16} />} onClick={() => setEditing(blank[tab])}>Ajouter</Button>}
      />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ key: 'categories', label: 'Catégories' }, { key: 'brands', label: 'Marques' }, { key: 'units', label: 'Unités' }, { key: 'taxes', label: 'Taxes' }]} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {(data || []).map((r) => (
          <Card key={r.id} className={cx('group flex items-center gap-4 p-4', r.is_active === false && 'opacity-50')}>
            {tab === 'categories' ? (
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ background: `${r.color}22`, color: r.color }}>
                <DynIcon name={r.icon} size={20} />
              </div>
            ) : (
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-line/[0.06] font-display text-[15px] font-bold">{tab === 'taxes' ? `${Number(r.rate)}%` : tab === 'units' ? r.code : r.name[0]}</div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{r.name}</div>
              <div className="text-[12px] text-muted">
                {tab === 'categories' && `${r.products_count} produit(s)${r.parent_name ? ` · dans ${r.parent_name}` : ''}`}
                {tab === 'brands' && `${r.products_count} produit(s)`}
                {tab === 'units' && (r.is_decimal ? 'Quantités décimales' : 'Quantités entières')}
                {tab === 'taxes' && (r.is_default ? 'Taxe par défaut' : r.is_active ? 'Active' : 'Inactive')}
              </div>
            </div>
            {r.is_active === false && <Badge>Archivée</Badge>}
            {canEdit && (
              <button onClick={() => setEditing({ ...r, parent: r.parent || '', default_tax: r.default_tax || '' })} className="text-muted opacity-0 transition hover:text-fg group-hover:opacity-100">
                <Pencil size={15} />
              </button>
            )}
          </Card>
        ))}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Modifier' : 'Ajouter'}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Annuler</Button>
            <Button onClick={save}>Enregistrer</Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4 pb-2">
            {tab === 'units' && (
              <Field label="Code">
                <Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} placeholder="kg, pce, L…" />
              </Field>
            )}
            <Field label="Nom" required>
              <Input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            {tab === 'categories' && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Catégorie parente">
                    <Select value={editing.parent} onChange={(e) => setEditing({ ...editing, parent: e.target.value })}>
                      <option value="">Aucune (racine)</option>
                      {(categories || []).filter((c) => c.id !== editing.id && !c.parent).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Taxe par défaut">
                    <Select value={editing.default_tax} onChange={(e) => setEditing({ ...editing, default_tax: e.target.value })}>
                      <option value="">—</option>
                      {(taxes || []).map((t) => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate)} %)</option>)}
                    </Select>
                  </Field>
                </div>
                <Field label="Icône">
                  <div className="flex flex-wrap gap-1.5">
                    {Object.keys(ICONS).map((k) => (
                      <button key={k} onClick={() => setEditing({ ...editing, icon: k })} className={cx('grid h-10 w-10 place-items-center rounded-xl border transition', editing.icon === k ? 'border-transparent bg-fg text-bg' : 'hairline hover:bg-line/5')}>
                        <DynIcon name={k} size={17} />
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Couleur">
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map((c) => (
                      <button key={c} onClick={() => setEditing({ ...editing, color: c })} className={cx('h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-bg transition', editing.color === c ? 'ring-fg' : 'ring-transparent')} style={{ background: c }} />
                    ))}
                  </div>
                </Field>
              </>
            )}
            {tab === 'units' && <Switch checked={editing.is_decimal} onChange={(v) => setEditing({ ...editing, is_decimal: v })} label="Autoriser les quantités décimales (vente au poids)" />}
            {tab === 'taxes' && (
              <>
                <Field label="Taux (%)">
                  <Input inputMode="decimal" value={editing.rate} onChange={(e) => setEditing({ ...editing, rate: e.target.value })} />
                </Field>
                <Switch checked={editing.is_active} onChange={(v) => setEditing({ ...editing, is_active: v })} label="Active" />
              </>
            )}
            {tab === 'categories' && editing.id && <Switch checked={editing.is_active} onChange={(v) => setEditing({ ...editing, is_active: v })} label="Active" />}
          </div>
        )}
      </Modal>
    </Page>
  )
}
