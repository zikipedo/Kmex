import { AnimatePresence, motion } from 'framer-motion'
import { Banknote, Check, CreditCard, FileText, Landmark, Plus, Printer, Smartphone, Trash2, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { PinPrompt } from '@/components/pickers'
import { Badge, Button, cx, Input, Modal } from '@/components/ui'
import { ApiError, newIdempotencyKey, openPdf, post } from '@/lib/api'
import { money } from '@/lib/format'
import { showError } from '@/lib/hooks'
import type { OfflineOp } from '@/lib/idb'

type Method = { id: string; code: string; name: string; type: string; requires_reference: boolean; color: string }
type Pay = { method: Method; amount: string; reference: string }

const METHOD_ICON: Record<string, any> = { cash: Banknote, mobile_money: Smartphone, card: CreditCard, transfer: Landmark, cheque: FileText, other: Wallet }

export function PaymentModal({
  open,
  onClose,
  total,
  methods,
  buildPayload,
  customerIsWalkin,
  onDone,
  offline = false,
  queueOffline,
  onPrintProvisional,
}: {
  open: boolean
  onClose: () => void
  total: number
  methods: Method[]
  buildPayload: () => any
  customerIsWalkin: boolean
  onDone: () => void
  offline?: boolean
  queueOffline?: (payments: { method_id: string; amount: string; reference: string; name: string }[], change: number, key: string) => Promise<OfflineOp>
  onPrintProvisional?: (op: OfflineOp) => void
}) {
  // Hors-ligne : espèces et Mobile Money uniquement, sans crédit (§24.1).
  const usable = offline ? methods.filter((m) => m.type === 'cash' || m.type === 'mobile_money') : methods
  const [pays, setPays] = useState<Pay[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [pin, setPin] = useState<{ kind: 'discount' | 'credit'; message: string } | null>(null)
  const [overrides, setOverrides] = useState<{ override_pin?: string; credit_override_pin?: string }>({})
  const [key, setKey] = useState(newIdempotencyKey())

  useEffect(() => {
    if (open) {
      const cash = usable.find((m) => m.type === 'cash') || usable[0]
      setPays(cash ? [{ method: cash, amount: String(total), reference: '' }] : [])
      setResult(null)
      setOverrides({})
      setKey(newIdempotencyKey())
    }
    // Réinitialisation uniquement à l'ouverture : un passage hors-ligne pendant l'encaissement ne doit rien effacer.
  }, [open]) // eslint-disable-line

  const paid = pays.reduce((a, p) => a + (Number(p.amount) || 0), 0)
  const cashPaid = pays.filter((p) => p.method.type === 'cash').reduce((a, p) => a + (Number(p.amount) || 0), 0)
  const change = Math.max(0, Math.min(paid - total, cashPaid))
  const remaining = Math.max(0, total - paid)
  const quick = useMemo(() => {
    const steps = [500, 1000, 2000, 5000, 10000]
    const s = new Set<number>([total])
    steps.forEach((st) => s.add(Math.ceil(total / st) * st))
    return [...s].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5)
  }, [total])

  const setPay = (i: number, patch: Partial<Pay>) => setPays((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))

  const submit = async (extra = overrides) => {
    const missingRef = pays.find((p) => p.method.requires_reference && Number(p.amount) > 0 && !p.reference.trim())
    if (missingRef) {
      showError(new ApiError({ status: 422, title: 'Référence requise', detail: `Saisissez la référence de transaction ${missingRef.method.name}.`, code: 'REFERENCE_REQUIRED' }))
      return
    }
    const goOffline = async () => {
      if (!queueOffline) throw new ApiError({ status: 0, title: 'Hors-ligne', detail: 'Vente impossible sans connexion.', code: 'NETWORK' })
      if (remaining > 0) throw new ApiError({ status: 422, title: 'Hors-ligne', detail: 'Hors-ligne, le paiement complet est obligatoire (pas de vente à crédit).', code: 'OFFLINE_FULL_PAYMENT' })
      const bad = pays.find((p) => Number(p.amount) > 0 && p.method.type !== 'cash' && p.method.type !== 'mobile_money')
      if (bad) throw new ApiError({ status: 422, title: 'Hors-ligne', detail: `« ${bad.method.name} » indisponible hors-ligne : utilisez les espèces ou le Mobile Money.`, code: 'OFFLINE_METHOD' })
      const op = await queueOffline(
        pays.filter((p) => Number(p.amount) > 0).map((p) => ({ method_id: p.method.id, amount: p.amount, reference: p.reference, name: p.method.name })),
        change,
        key,
      )
      setResult({ offline: true, op, number: op.preview.provisional_number, change: String(change) })
    }
    setLoading(true)
    try {
      if (offline) {
        await goOffline()
        return
      }
      const payload = {
        ...buildPayload(),
        ...extra,
        payments: pays.filter((p) => Number(p.amount) > 0).map((p) => ({ method_id: p.method.id, amount: p.amount, reference: p.reference })),
      }
      try {
        const r = await post('/sales', payload, key)
        setResult(r)
      } catch (e) {
        // Coupure pendant l'envoi : la vente part dans la file locale avec la même clé (aucun doublon possible).
        if (e instanceof ApiError && e.status === 0 && queueOffline) await goOffline()
        else throw e
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DISCOUNT_AUTH_REQUIRED') setPin({ kind: 'discount', message: e.message })
      else if (e instanceof ApiError && e.code === 'CREDIT_LIMIT_EXCEEDED') setPin({ kind: 'credit', message: e.message })
      else showError(e)
    } finally {
      setLoading(false)
    }
  }

  const finish = () => {
    onDone()
    onClose()
  }

  return (
    <>
      <Modal open={open} onClose={result ? finish : onClose} size="lg" title={result ? undefined : 'Encaissement'} subtitle={result ? undefined : 'Un ou plusieurs moyens de paiement'}>
        <AnimatePresence mode="wait">
          {result ? (
            <motion.div key="ok" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center py-8 text-center">
              <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', damping: 12, stiffness: 200 }} className="relative mb-6">
                <div className="absolute inset-0 rounded-full bg-gradient-brand opacity-50 blur-2xl" />
                <div className="relative grid h-24 w-24 place-items-center rounded-full bg-gradient-brand text-[#14101f]">
                  <Check size={46} strokeWidth={3} />
                </div>
              </motion.div>
              <div className="label">{result.offline ? 'Vente enregistrée hors-ligne' : 'Vente validée'}</div>
              <div className="mt-1 font-display text-2xl font-bold">{result.number}</div>
              {result.offline && (
                <div className="mt-3 max-w-sm">
                  <Badge tone="sky">Numéro provisoire — le numéro légal sera attribué à la synchronisation</Badge>
                </div>
              )}
              {Number(result.change) > 0 && (
                <div className="mt-6 rounded-3xl border hairline bg-mint/10 px-8 py-4">
                  <div className="text-[12px] font-semibold uppercase tracking-widest text-mint">Monnaie à rendre</div>
                  <div className="num mt-1 font-display text-5xl font-extrabold text-mint">{money(result.change)}</div>
                </div>
              )}
              {Number(result.balance) > 0 && (
                <div className="mt-4">
                  <Badge tone="amber">Reste dû sur compte client : {money(result.balance)}</Badge>
                </div>
              )}
              {result.warnings?.map((w: string) => (
                <div key={w} className="mt-2">
                  <Badge tone="amber">{w}</Badge>
                </div>
              ))}
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {result.offline ? (
                  <Button variant="soft" icon={<Printer size={16} />} onClick={() => onPrintProvisional?.(result.op)}>
                    Ticket provisoire
                  </Button>
                ) : (
                  <>
                    <Button variant="soft" icon={<Printer size={16} />} onClick={() => openPdf(`/sales/${result.id}/pdf?paper=ticket`)}>
                      Ticket 80 mm
                    </Button>
                    <Button variant="soft" icon={<FileText size={16} />} onClick={() => openPdf(`/sales/${result.id}/pdf`)}>
                      Facture A4
                    </Button>
                  </>
                )}
                <Button size="lg" variant="gradient" autoFocus onClick={finish}>
                  Nouvelle vente
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="form" className="grid gap-6 pb-2 md:grid-cols-[1fr_260px]">
              <div className="space-y-4">
                {offline && (
                  <div className="rounded-2xl border border-sky/30 bg-sky/10 px-4 py-2.5 text-[12.5px] text-sky">
                    Hors-ligne : espèces et Mobile Money uniquement, paiement complet obligatoire. La vente sera synchronisée automatiquement.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {usable.map((m) => {
                    const Icon = METHOD_ICON[m.type] || Wallet
                    const activeIdx = pays.findIndex((p) => p.method.id === m.id)
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          if (activeIdx >= 0) return
                          const rest = Math.max(0, total - pays.reduce((a, p) => a + (Number(p.amount) || 0), 0))
                          if (pays.length === 1 && Number(pays[0].amount) === total) setPays([{ method: m, amount: String(total), reference: '' }])
                          else setPays([...pays, { method: m, amount: String(rest), reference: '' }])
                        }}
                        className={cx('flex flex-col items-start gap-2 rounded-2xl border p-3 text-left transition', activeIdx >= 0 ? 'border-transparent ring-2' : 'hairline hover:bg-line/5')}
                        style={activeIdx >= 0 ? ({ background: `${m.color}1f`, '--tw-ring-color': m.color } as any) : undefined}
                      >
                        <Icon size={18} style={{ color: m.color }} />
                        <span className="text-[12.5px] font-semibold leading-tight">{m.name}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="space-y-2">
                  {pays.map((p, i) => (
                    <motion.div layout key={p.method.id} className="rounded-2xl border hairline p-3">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.method.color }} />
                        <span className="flex-1 text-[13px] font-semibold">{p.method.name}</span>
                        {pays.length > 1 && (
                          <button onClick={() => setPays(pays.filter((_, idx) => idx !== i))} className="text-muted hover:text-danger">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <Input inputMode="numeric" className="num text-lg font-semibold" value={p.amount} onChange={(e) => setPay(i, { amount: e.target.value.replace(/[^\d.]/g, '') })} />
                        {p.method.requires_reference && <Input placeholder="Référence transaction *" value={p.reference} onChange={(e) => setPay(i, { reference: e.target.value })} />}
                      </div>
                      {p.method.type === 'cash' && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {quick.map((v) => (
                            <button key={v} onClick={() => setPay(i, { amount: String(v) })} className="chip num text-fg/80 hover:bg-line/5">
                              {money(v, { symbol: false })}
                            </button>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ))}
                  {pays.length === 0 && (
                    <Button variant="soft" icon={<Plus size={15} />} onClick={() => usable[0] && setPays([{ method: usable[0], amount: String(total), reference: '' }])}>
                      Ajouter un paiement
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex flex-col rounded-3xl border hairline bg-line/[0.03] p-5">
                <div className="label text-[10px]">Total à payer</div>
                <div className="num mt-1 font-display text-4xl font-extrabold">{money(total, { symbol: false })}</div>
                <div className="mt-5 space-y-2 text-[13.5px]">
                  <div className="flex justify-between">
                    <span className="text-muted">Payé</span>
                    <span className="num font-semibold">{money(paid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Monnaie</span>
                    <span className="num font-semibold text-mint">{money(change)}</span>
                  </div>
                  {remaining > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted">Reste (crédit)</span>
                      <span className="num font-semibold text-warn">{money(remaining)}</span>
                    </div>
                  )}
                </div>
                {remaining > 0 && (customerIsWalkin || offline) && <p className="mt-3 text-[12px] text-danger">{offline ? 'Hors-ligne : paiement complet obligatoire.' : 'Client comptoir : paiement complet obligatoire.'}</p>}
                <Button className="mt-auto w-full" size="lg" variant="gradient" loading={loading} disabled={remaining > 0 && (customerIsWalkin || offline)} onClick={() => submit()} icon={<Check size={18} />}>
                  Valider la vente
                </Button>
                <p className="mt-2 text-center text-[11px] text-muted">Entrée pour valider · Échap pour revenir</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Modal>
      <PinPrompt
        open={!!pin}
        title={pin?.kind === 'credit' ? 'Dérogation de crédit' : 'Autorisation de remise'}
        message={pin?.message}
        onClose={() => setPin(null)}
        onSubmit={(code) => {
          const extra = { ...overrides, ...(pin?.kind === 'credit' ? { credit_override_pin: code } : { override_pin: code }) }
          setOverrides(extra)
          setPin(null)
          submit(extra)
        }}
      />
    </>
  )
}
