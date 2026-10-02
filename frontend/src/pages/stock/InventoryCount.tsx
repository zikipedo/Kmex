import { useQueryClient } from '@tanstack/react-query'
import { CheckCheck, ScanLine, XCircle } from 'lucide-react'
import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { confirm } from '@/components/confirm'
import { Page, PageHeader } from '@/components/page'
import { FilterChips } from '@/components/table'
import { Badge, Button, Card, cx, Input, Skeleton, StatusBadge } from '@/components/ui'
import { post } from '@/lib/api'
import { money, qty } from '@/lib/format'
import { showError, useApi } from '@/lib/hooks'
import { useCan } from '@/store/auth'

export default function InventoryCount() {
  const { id } = useParams()
  const qc = useQueryClient()
  const can = useCan()
  const [only, setOnly] = useState('')
  const [scan, setScan] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const scanRef = useRef<HTMLInputElement>(null)
  const { data: inv } = useApi<any>(['inventory', id], `/inventories/${id}`)
  const { data: items } = useApi<any[]>(['inventory-items', id], `/inventories/${id}/items`, { only })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['inventory', id] })
    qc.invalidateQueries({ queryKey: ['inventory-items', id] })
  }
  if (!inv) return <Page><Skeleton className="h-96 rounded-3xl" /></Page>
  const locked = inv.status !== 'counting'

  const save = async (product_id: string, payload: any) => {
    try {
      await post(`/inventories/${id}/count`, { counts: [{ product_id, ...payload }] })
      refresh()
    } catch (e) {
      showError(e)
    }
  }

  const onScan = async () => {
    const code = scan.trim()
    if (!code) return
    const item = (items || []).find((i) => i.barcode === code || i.product_sku.toLowerCase() === code.toLowerCase())
    if (!item) {
      toast.error('Produit hors inventaire', { description: code })
    } else {
      await save(item.product, { increment: 1 })
      toast.success(`+1 ${item.product_name}`)
    }
    setScan('')
    scanRef.current?.focus()
  }

  const validate = async () => {
    const r = await confirm({
      title: `Valider ${inv.number} ?`,
      message: `${inv.stats.with_gap} écart(s) seront transformés en ajustements de stock liés à l'inventaire. L'inventaire sera ensuite verrouillé.`,
      confirmLabel: 'Valider et ajuster',
    })
    if (!r.ok) return
    try {
      await post(`/inventories/${id}/validate`)
      toast.success('Inventaire validé — stock ajusté')
      refresh()
    } catch (e) {
      showError(e)
    }
  }

  const pctDone = inv.stats.total ? Math.round((inv.stats.counted / inv.stats.total) * 100) : 0
  return (
    <Page>
      <PageHeader
        crumbs={[{ label: 'Inventaires', to: '/inventories' }, { label: inv.number }]}
        title="Comptage"
        accent={inv.number}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={inv.status} label={inv.status_label} /> {inv.warehouse_name} · {inv.category_name || 'inventaire complet'} {inv.blind_mode && <Badge tone="violet">Mode aveugle</Badge>}</span>}
        actions={
          !locked &&
          can('stock.adjust.approve') && (
            <>
              <Button variant="ghost" icon={<XCircle size={16} />} onClick={async () => { const r = await confirm({ title: 'Annuler cet inventaire ?', requireReason: true, danger: true }); if (r.ok) post(`/inventories/${id}/cancel`, { reason: r.reason }).then(refresh).catch(showError) }}>Annuler</Button>
              <Button variant="gradient" icon={<CheckCheck size={16} />} onClick={validate}>Valider l'inventaire</Button>
            </>
          )
        }
      />
      <div className="mb-4 grid gap-4 md:grid-cols-[1fr_320px]">
        {!locked ? (
          <Card glow className="p-4">
            <div className="relative">
              <ScanLine size={19} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-accent" />
              <input ref={scanRef} autoFocus value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onScan()} placeholder="Scannez un code-barres : chaque scan compte +1" className="h-14 w-full rounded-2xl bg-line/[0.05] pl-12 text-[15px] outline-none ring-accent/40 focus:ring-2" />
            </div>
          </Card>
        ) : (
          <Card className="p-5 text-[13.5px] text-muted">Inventaire verrouillé — toute correction passe désormais par un nouvel ajustement.</Card>
        )}
        <Card className="p-5">
          <div className="flex justify-between text-[12.5px] text-muted">
            <span>Progression</span>
            <span className="num">{inv.stats.counted} / {inv.stats.total}</span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-line/10">
            <div className="h-full rounded-full bg-gradient-brand transition-all duration-700" style={{ width: `${pctDone}%` }} />
          </div>
          <div className="mt-2 text-[12.5px]">{inv.stats.with_gap} écart(s) détecté(s)</div>
        </Card>
      </div>
      <div className="mb-3">
        <FilterChips value={only} onChange={setOnly} options={[{ value: '', label: 'Tous' }, { value: 'uncounted', label: 'Non comptés' }, { value: 'gaps', label: 'Écarts' }]} />
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-[13.5px]">
            <thead>
              <tr className="border-b hairline">
                {['Produit', 'Théorique', 'Compté', 'Écart', 'Valeur écart', 'Compté par'].map((h, i) => <th key={h} className={`label px-5 py-3 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {(items || []).map((it) => {
                const diff = it.diff === null ? null : Number(it.diff)
                return (
                  <tr key={it.id} className="table-row border-b hairline last:border-0">
                    <td className="px-5 py-2.5">
                      <div className="font-medium">{it.product_name}</div>
                      <div className="text-[11.5px] text-muted">{it.product_sku} · {it.barcode}</div>
                    </td>
                    <td className="num px-5 text-right text-muted">{it.qty_theoretical === null ? '•••' : qty(it.qty_theoretical)}</td>
                    <td className="px-5 text-right">
                      <Input
                        disabled={locked}
                        inputMode="decimal"
                        className="ml-auto h-9 w-24 py-1 text-right"
                        value={drafts[it.id] ?? (it.qty_counted === null ? '' : String(Number(it.qty_counted)))}
                        onChange={(e) => setDrafts({ ...drafts, [it.id]: e.target.value })}
                        onBlur={() => {
                          const v = drafts[it.id]
                          if (v === undefined) return
                          save(it.product, { qty_counted: v === '' ? null : v.replace(',', '.') })
                          setDrafts((d) => { const n = { ...d }; delete n[it.id]; return n })
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                    </td>
                    <td className={cx('num px-5 text-right font-semibold', diff === null ? 'text-muted' : diff > 0 ? 'text-mint' : diff < 0 ? 'text-rose' : '')}>{diff === null ? '—' : `${diff > 0 ? '+' : ''}${qty(diff)}`}</td>
                    <td className="num px-5 text-right text-muted">{it.diff_value ? money(it.diff_value) : '—'}</td>
                    <td className="px-5 text-right text-[12px] text-muted">{it.counted_by_name || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  )
}
