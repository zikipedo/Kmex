import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Calculator, Lock, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/page'
import { Badge, Button, Card, CardHeader, cx, Field, InfoRow, Input, Skeleton, StatusBadge, Textarea } from '@/components/ui'
import { get, post } from '@/lib/api'
import { date, money, time } from '@/lib/format'
import { showError, useApi } from '@/lib/hooks'
import { useAuth, useCan, type Me } from '@/store/auth'

const DENOMS = [10000, 5000, 2000, 1000, 500, 250, 200, 100, 50, 25, 10, 5]

export default function SessionDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const can = useCan()
  const me = useAuth((s) => s.me)!
  const { data } = useApi<any>(['session-summary', id], `/register-sessions/${id}/summary`)
  const [counted, setCounted] = useState<Record<string, string>>({})
  const [denoms, setDenoms] = useState<Record<number, string>>({})
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const cashFromDenoms = useMemo(() => DENOMS.reduce((a, d) => a + d * (Number(denoms[d]) || 0), 0), [denoms])
  if (!data) return <Page><Skeleton className="h-[500px] rounded-3xl" /></Page>
  const s = data.session
  const isOpen = s.status === 'open'
  const tolerance = Number(me.company.settings.cash_tolerance || 0)
  const countedValue = (code: string) => (code === 'cash' && cashFromDenoms > 0 && counted.cash === undefined ? cashFromDenoms : Number(counted[code] ?? 0))
  const diff = data.expected.reduce((a: number, e: any) => a + (countedValue(e.code) - Number(e.amount)), 0)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['session-summary', id] })
    qc.invalidateQueries({ queryKey: ['sessions'] })
    qc.invalidateQueries({ queryKey: ['registers'] })
  }

  const close = async () => {
    setLoading(true)
    try {
      const payload: Record<string, number> = {}
      data.expected.forEach((e: any) => (payload[e.code] = countedValue(e.code)))
      await post(`/register-sessions/${id}/close`, { counted: payload, reason, denominations: denoms })
      useAuth.getState().setMe(await get<Me>('/me'))
      toast.success('Caisse clôturée — rapport Z généré')
      refresh()
    } catch (e) {
      showError(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: 'Caisse', to: '/cash' }, { label: s.z_number || s.register_name }]}
        title={isOpen ? 'Clôture de' : 'Rapport'}
        accent={isOpen ? 'caisse' : s.z_number}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={s.status} /> {s.register_name} · {s.opened_by_name} · ouverte le {date(s.opened_at, true)}{s.closed_at && ` · clôturée ${date(s.closed_at, true)}`}</span>}
        actions={
          <>
            <Button variant="soft" icon={<Printer size={16} />} onClick={() => window.print()}>Imprimer</Button>
            {s.status === 'closed' && can('cash.session.validate') && (
              <Button variant="gradient" icon={<BadgeCheck size={16} />} onClick={() => post(`/register-sessions/${id}/validate`).then(() => { toast.success('Session validée et verrouillée'); refresh() }).catch(showError)}>Valider la clôture</Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-5"><div className="label text-[10px]">Ventes</div><div className="num mt-2 font-display text-3xl font-bold">{data.sales.count}</div><div className="text-[12px] text-muted">{data.sales.cancelled} annulée(s)</div></Card>
            <Card className="p-5"><div className="label text-[10px]">Chiffre encaissé</div><div className="num mt-2 font-display text-3xl font-bold">{money(data.sales.total, { compact: true, symbol: false })}</div><div className="text-[12px] text-muted">Remises {money(data.sales.discounts)}</div></Card>
            <Card className="p-5"><div className="label text-[10px]">Fond de caisse</div><div className="num mt-2 font-display text-3xl font-bold">{money(s.opening_float, { symbol: false })}</div></Card>
          </div>
          <Card className="overflow-hidden">
            <CardHeader title="Théorique vs compté par moyen de paiement" icon={<Calculator size={16} />} />
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead><tr className="border-y hairline">{['Moyen', 'Théorique', 'Compté', 'Écart'].map((h, i) => <th key={h} className={`label px-5 py-2.5 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.expected.map((e: any) => {
                    const c = isOpen ? countedValue(e.code) : Number(s.counted[e.code] ?? 0)
                    const d = c - Number(e.amount)
                    return (
                      <tr key={e.code} className="border-b hairline last:border-0">
                        <td className="px-5 py-3 font-medium">{e.name}</td>
                        <td className="num px-5 text-right">{money(e.amount)}</td>
                        <td className="px-5 text-right">
                          {isOpen ? (
                            <Input inputMode="numeric" className="ml-auto h-9 w-36 py-1 text-right" placeholder={e.code === 'cash' && cashFromDenoms ? String(cashFromDenoms) : '0'} value={counted[e.code] ?? ''} onChange={(ev) => setCounted({ ...counted, [e.code]: ev.target.value.replace(/[^\d.]/g, '') })} />
                          ) : (
                            <span className="num">{money(c)}</span>
                          )}
                        </td>
                        <td className={cx('num px-5 text-right font-semibold', d < 0 ? 'text-danger' : d > 0 ? 'text-mint' : 'text-muted')}>{d === 0 ? '—' : money(d)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Journal de la session" subtitle="Encaissements, remboursements, dépenses et régularisations" />
            <div className="mt-3 max-h-[420px] overflow-y-auto">
              {data.movements.map((m: any) => (
                <div key={m.id} className="flex items-center gap-3 border-b hairline px-5 py-2.5 text-[13px] last:border-0">
                  <span className="num w-12 text-muted">{time(m.occurred_at)}</span>
                  <span className="min-w-0 flex-1 truncate">{m.label || m.category_label}</span>
                  <Badge tone="gray">{m.method_name || '—'}</Badge>
                  <span className={cx('num w-32 text-right font-semibold', m.direction === 'in' ? 'text-mint' : 'text-rose')}>{m.direction === 'in' ? '+' : '−'}{money(m.amount, { symbol: false })}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          {isOpen ? (
            <>
              <Card className="p-5">
                <div className="label mb-3 text-[10px]">Comptage des espèces par coupure</div>
                <div className="grid grid-cols-2 gap-2">
                  {DENOMS.map((d) => (
                    <label key={d} className="flex items-center gap-2 rounded-xl border hairline px-2.5 py-1.5">
                      <span className="num w-14 text-[12px] text-muted">{d.toLocaleString('fr-FR')}</span>
                      <input inputMode="numeric" value={denoms[d] ?? ''} onChange={(e) => setDenoms({ ...denoms, [d]: e.target.value.replace(/\D/g, '') })} className="num w-full bg-transparent text-right text-[13px] outline-none" placeholder="0" />
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex justify-between text-[13px]"><span className="text-muted">Total compté</span><span className="num font-semibold">{money(cashFromDenoms)}</span></div>
              </Card>
              <Card glow className="p-5">
                <div className="label text-[10px]">Écart total</div>
                <div className={cx('num mt-1 font-display text-4xl font-extrabold', diff < 0 ? 'text-danger' : diff > 0 ? 'text-mint' : '')}>{money(diff)}</div>
                {Math.abs(diff) > tolerance && <div className="mt-2 text-[12px] text-warn">Au-delà de la tolérance ({money(tolerance)}) : justification obligatoire.</div>}
                <Field label="Justification" className="mt-4"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. erreur de rendu monnaie" /></Field>
                <Button className="mt-4 w-full" size="lg" variant="gradient" icon={<Lock size={17} />} loading={loading} onClick={close}>Clôturer la caisse</Button>
                <Button className="mt-2 w-full" variant="ghost" onClick={() => navigate('/pos')}>Retour au POS</Button>
              </Card>
            </>
          ) : (
            <Card glow className="p-6">
              <div className="label text-[10px]">Écart constaté</div>
              <div className={cx('num mt-1 font-display text-4xl font-extrabold', Number(s.difference) < 0 ? 'text-danger' : Number(s.difference) > 0 ? 'text-mint' : '')}>{money(s.difference)}</div>
              {s.difference_reason && <p className="mt-3 text-[13px] text-muted">« {s.difference_reason} »</p>}
              <div className="mt-4 divide-y divide-[var(--glass-border)]">
                <InfoRow label="Clôturée par" value={s.closed_by_name} />
                <InfoRow label="Validée par" value={s.validated_by_name || <Badge tone="amber">En attente</Badge>} />
              </div>
            </Card>
          )}
          <Card className="p-5">
            <div className="label mb-2 text-[10px]">Synthèse par catégorie</div>
            {data.by_category.map((c: any) => (
              <div key={c.category + c.direction} className="flex justify-between py-1.5 text-[13px]">
                <span className="text-muted">{c.category} <span className="text-[11px]">×{c.count}</span></span>
                <span className={cx('num', c.direction === 'in' ? 'text-mint' : 'text-rose')}>{c.direction === 'in' ? '+' : '−'}{money(c.total, { symbol: false })}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </Page>
  )
}
