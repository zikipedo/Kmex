import { useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, Store, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/page'
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Select, Switch, Tabs, Textarea } from '@/components/ui'
import { api, get, post, upload } from '@/lib/api'
import { showError, useApi } from '@/lib/hooks'
import { useAuth, useCan, type Me } from '@/store/auth'

export default function Settings() {
  const can = useCan()
  const [tab, setTab] = useState<'company' | 'rules' | 'sites' | 'payments'>(can('settings.manage') ? 'company' : 'sites')
  return (
    <Page>
      <PageHeader title="Paramètres" accent="de l'entreprise" subtitle="Configuration plutôt que code : identité, fiscalité, règles métier, dépôts, caisses et moyens de paiement. Chaque modification est auditée." />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[...(can('settings.manage') ? [{ key: 'company' as const, label: 'Entreprise' }, { key: 'rules' as const, label: 'Règles métier' }] : []), { key: 'sites', label: 'Dépôts & caisses' }, ...(can('settings.manage') ? [{ key: 'payments' as const, label: 'Moyens de paiement' }] : [])]} />
      {tab === 'company' && <CompanyTab />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'sites' && <SitesTab />}
      {tab === 'payments' && <PaymentsTab />}
    </Page>
  )
}

async function reloadMe() {
  useAuth.getState().setMe(await get<Me>('/me'))
}

function CompanyTab() {
  const company = useAuth((s) => s.me?.company)!
  const [f, setF] = useState<any>(company)
  const [ids, setIds] = useState<string>(Object.entries(company.legal_ids || {}).map(([k, v]) => `${k}=${v}`).join('\n'))
  const logoRef = useRef<HTMLInputElement>(null)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    try {
      const legal_ids = Object.fromEntries(ids.split('\n').map((l) => l.split('=').map((s) => s.trim())).filter((p) => p[0] && p[1]))
      const { settings, logo_url, id, ...rest } = f
      await api('/company', { method: 'PATCH', body: { ...rest, legal_ids } })
      await reloadMe()
      toast.success('Paramètres enregistrés')
    } catch (e) {
      showError(e)
    }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Card className="p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom commercial"><Input value={f.name} onChange={set('name')} /></Field>
          <Field label="Raison sociale"><Input value={f.legal_name} onChange={set('legal_name')} /></Field>
          <Field label="Adresse"><Input value={f.address} onChange={set('address')} /></Field>
          <Field label="Ville"><Input value={f.city} onChange={set('city')} /></Field>
          <Field label="Pays"><Input value={f.country} onChange={set('country')} /></Field>
          <Field label="Téléphone"><Input value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><Input value={f.email} onChange={set('email')} /></Field>
          <Field label="Site web"><Input value={f.website} onChange={set('website')} /></Field>
          <Field label="Devise (ISO)"><Input value={f.currency} onChange={set('currency')} /></Field>
          <Field label="Symbole"><Input value={f.currency_symbol} onChange={set('currency_symbol')} /></Field>
          <Field label="Décimales" hint="XOF : 0"><Input inputMode="numeric" value={f.currency_decimals} onChange={set('currency_decimals')} /></Field>
          <Field label="Fuseau horaire"><Input value={f.timezone} onChange={set('timezone')} /></Field>
          <Field label="Identifiants légaux (un par ligne : NIF=…)" className="sm:col-span-2"><Textarea value={ids} onChange={(e) => setIds(e.target.value)} /></Field>
        </div>
        <div className="mt-6 flex justify-end"><Button variant="gradient" onClick={save}>Enregistrer</Button></div>
      </Card>
      <Card className="h-fit p-6">
        <div className="label mb-3">Logo (documents PDF)</div>
        <div className="grid aspect-video place-items-center rounded-2xl border border-dashed hairline">
          {company.logo_url ? <img src={company.logo_url} alt="" className="max-h-28" /> : <Building2 size={32} className="text-muted" />}
        </div>
        <Button className="mt-3 w-full" variant="soft" icon={<Upload size={15} />} onClick={() => logoRef.current?.click()}>Changer le logo</Button>
        <input ref={logoRef} type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { await upload('/company/logo', file, 'file'); await reloadMe(); toast.success('Logo mis à jour') } catch (err) { showError(err) } }} />
      </Card>
    </div>
  )
}

function RulesTab() {
  const company = useAuth((s) => s.me?.company)!
  const [s, setS] = useState<any>(company.settings)
  const set = (k: string) => (e: any) => setS({ ...s, [k]: e.target.value })
  const save = async () => {
    try {
      await api('/company', { method: 'PATCH', body: { settings: s } })
      await reloadMe()
      toast.success('Règles mises à jour (appliquées aux nouveaux documents)')
    } catch (e) {
      showError(e)
    }
  }
  return (
    <Card className="p-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4">
          <div className="label">Ventes</div>
          <Switch checked={!!s.prices_include_tax} onChange={(v) => setS({ ...s, prices_include_tax: v })} label="Prix saisis TTC" />
          <Switch checked={!!s.allow_sale_below_cost} onChange={(v) => setS({ ...s, allow_sale_below_cost: v })} label="Autoriser la vente sous le coût sans avertissement" />
          <Field label="Délai maximal de retour (jours)"><Input inputMode="numeric" value={s.return_max_days} onChange={set('return_max_days')} /></Field>
          <Field label="Pied de ticket"><Input value={s.receipt_footer} onChange={set('receipt_footer')} /></Field>
          <Field label="Mentions de facture"><Textarea value={s.invoice_footer} onChange={set('invoice_footer')} /></Field>
          <Field label="Coordonnées Mobile Money (imprimées)"><Input value={s.mobile_money_info} onChange={set('mobile_money_info')} /></Field>
        </section>
        <section className="space-y-4">
          <div className="label">Stock, achats & caisse</div>
          <Field label="Seuil de double validation des ajustements (valeur)"><Input inputMode="numeric" value={s.adjustment_approval_threshold} onChange={set('adjustment_approval_threshold')} /></Field>
          <Field label="Tolérance de sur-livraison (%)"><Input inputMode="numeric" value={s.overdelivery_tolerance_pct} onChange={set('overdelivery_tolerance_pct')} /></Field>
          <Field label="Produits dormants après (jours)"><Input inputMode="numeric" value={s.dormant_days} onChange={set('dormant_days')} /></Field>
          <Field label="Tolérance d'écart de caisse"><Input inputMode="numeric" value={s.cash_tolerance} onChange={set('cash_tolerance')} /></Field>
          <Field label="Fond de caisse par défaut"><Input inputMode="numeric" value={s.default_opening_float} onChange={set('default_opening_float')} /></Field>
          <Field label="Photos max par produit"><Input inputMode="numeric" value={s.max_product_photos} onChange={set('max_product_photos')} /></Field>
        </section>
      </div>
      <div className="mt-6 flex justify-end"><Button variant="gradient" onClick={save}>Enregistrer les règles</Button></div>
    </Card>
  )
}

function SitesTab() {
  const qc = useQueryClient()
  const can = useCan()
  const { data: warehouses } = useApi<any[]>(['warehouses-all'], '/warehouses', { all: 1 })
  const [edit, setEdit] = useState<any>(null)
  const [reg, setReg] = useState<any>(null)
  const saveWh = async () => {
    try {
      if (edit.id) await api(`/warehouses/${edit.id}`, { method: 'PATCH', body: edit })
      else await post('/warehouses', edit)
      toast.success('Dépôt enregistré')
      qc.invalidateQueries({ queryKey: ['warehouses-all'] })
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      await reloadMe()
      setEdit(null)
    } catch (e) {
      showError(e)
    }
  }
  return (
    <>
      <div className="mb-4 flex justify-end gap-2">
        {can('warehouses.manage') && <Button variant="gradient" icon={<Plus size={16} />} onClick={() => setEdit({ code: '', name: '', type: 'store', address: '', phone: '', is_active: true, allow_negative_stock: false })}>Nouveau dépôt</Button>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(warehouses || []).map((w) => (
          <Card key={w.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-line/[0.06]"><Store size={18} /></div>
                <div>
                  <div className="font-semibold">{w.name} <span className="text-[12px] text-muted">({w.code})</span></div>
                  <div className="text-[12px] text-muted">{w.address} · responsable {w.manager_name || '—'}</div>
                </div>
              </div>
              {can('warehouses.manage') && <Button size="sm" variant="ghost" onClick={() => setEdit(w)}>Modifier</Button>}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!w.is_active && <Badge>Inactif</Badge>}
              {w.allow_negative_stock && <Badge tone="amber">Stock négatif autorisé</Badge>}
              {w.registers.map((r: any) => <Badge key={r.id} tone="violet">{r.name}</Badge>)}
              {can('warehouses.manage') && <button onClick={() => setReg({ warehouse: w.id, name: '' })} className="chip text-muted hover:text-fg"><Plus size={12} /> Caisse</button>}
            </div>
          </Card>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Modifier le dépôt' : 'Nouveau dépôt'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Annuler</Button><Button onClick={saveWh}>Enregistrer</Button></>}>
        {edit && (
          <div className="grid gap-4 pb-2 sm:grid-cols-2">
            <Field label="Code"><Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            <Field label="Nom"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Type"><Select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}><option value="store">Magasin</option><option value="warehouse">Entrepôt</option><option value="agency">Agence</option><option value="pos">Point de vente</option></Select></Field>
            <Field label="Téléphone"><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Adresse" className="sm:col-span-2"><Input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Switch checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Actif" />
            <Switch checked={edit.allow_negative_stock} onChange={(v) => setEdit({ ...edit, allow_negative_stock: v })} label="Autoriser le stock négatif" />
          </div>
        )}
      </Modal>
      <Modal open={!!reg} onClose={() => setReg(null)} size="sm" title="Nouvelle caisse" footer={<><Button variant="ghost" onClick={() => setReg(null)}>Annuler</Button><Button onClick={async () => { try { await post('/cash-registers', reg); toast.success('Caisse créée'); qc.invalidateQueries({ queryKey: ['warehouses-all'] }); qc.invalidateQueries({ queryKey: ['registers'] }); setReg(null) } catch (e) { showError(e) } }}>Créer</Button></>}>
        {reg && <Field label="Nom de la caisse"><Input autoFocus value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} placeholder="Caisse 3" /></Field>}
      </Modal>
    </>
  )
}

function PaymentsTab() {
  const qc = useQueryClient()
  const { data: methods } = useApi<any[]>(['payment-methods'], '/payment-methods')
  const { data: accounts } = useApi<any[]>(['treasury-accounts'], '/treasury-accounts')
  const [edit, setEdit] = useState<any>(null)
  useEffect(() => {}, [])
  const save = async () => {
    try {
      const body = { ...edit, account: edit.account || null }
      if (edit.id) await api(`/payment-methods/${edit.id}`, { method: 'PATCH', body })
      else await post('/payment-methods', body)
      toast.success('Moyen de paiement enregistré')
      qc.invalidateQueries({ queryKey: ['payment-methods'] })
      setEdit(null)
    } catch (e) {
      showError(e)
    }
  }
  return (
    <>
      <div className="mb-4 flex justify-end"><Button variant="gradient" icon={<Plus size={16} />} onClick={() => setEdit({ code: '', name: '', type: 'mobile_money', account: '', requires_reference: true, color: '#fdba8c', is_active: true, position: 10 })}>Ajouter</Button></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(methods || []).map((m) => (
          <Card key={m.id} className="flex items-center gap-3 p-4">
            <span className="h-10 w-10 rounded-2xl" style={{ background: `linear-gradient(135deg, ${m.color}, ${m.color}55)` }} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{m.name}</div>
              <div className="text-[12px] text-muted">{m.type} {m.requires_reference && '· référence obligatoire'}</div>
            </div>
            {!m.is_active && <Badge>Inactif</Badge>}
            <Button size="sm" variant="ghost" onClick={() => setEdit({ ...m, account: m.account || '' })}>Modifier</Button>
          </Card>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Moyen de paiement" footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Annuler</Button><Button onClick={save}>Enregistrer</Button></>}>
        {edit && (
          <div className="grid gap-4 pb-2 sm:grid-cols-2">
            <Field label="Code"><Input value={edit.code} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, code: e.target.value })} placeholder="mtn_momo" /></Field>
            <Field label="Nom"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Type"><Select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>{[['cash', 'Espèces'], ['mobile_money', 'Mobile Money'], ['card', 'Carte'], ['transfer', 'Virement'], ['cheque', 'Chèque'], ['other', 'Autre']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Field label="Compte de trésorerie"><Select value={edit.account} onChange={(e) => setEdit({ ...edit, account: e.target.value })}><option value="">— (espèces : caisse de la session)</option>{(accounts || []).filter((a) => a.type !== 'cash').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
            <Field label="Couleur"><Input type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} className="h-11 p-1" /></Field>
            <div className="space-y-3 pt-6">
              <Switch checked={edit.requires_reference} onChange={(v) => setEdit({ ...edit, requires_reference: v })} label="Référence obligatoire" />
              <Switch checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Actif" />
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
