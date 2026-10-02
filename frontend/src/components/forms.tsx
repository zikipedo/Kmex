import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { get } from '@/lib/api'
import { money } from '@/lib/format'
import { Button, Field, Input, Modal, Select } from './ui'

export function usePaymentMethods() {
  return useQuery({ queryKey: ['payment-methods'], queryFn: () => get<any[]>('/payment-methods'), staleTime: 300_000 })
}

export function useWarehouses() {
  return useQuery({ queryKey: ['warehouses'], queryFn: () => get<any[]>('/warehouses'), staleTime: 300_000 })
}

/** Modale générique d'enregistrement d'un paiement (client ou fournisseur). */
export function PaymentForm({
  open,
  onClose,
  title,
  max,
  onSubmit,
  loading,
  subtitle,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  max?: number
  loading?: boolean
  onSubmit: (v: { method_id: string; amount: string; reference: string }) => void
}) {
  const { data: methods } = usePaymentMethods()
  const [method, setMethod] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  useEffect(() => {
    if (open) {
      setAmount(max ? String(Math.round(max)) : '')
      setReference('')
      setMethod((methods || []).find((m) => m.type === 'cash')?.id || methods?.[0]?.id || '')
    }
  }, [open, max, methods])
  const m = methods?.find((x) => x.id === method)
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      subtitle={subtitle}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={loading} disabled={!method || !(Number(amount) > 0) || (m?.requires_reference && !reference.trim())} onClick={() => onSubmit({ method_id: method, amount, reference })}>
            Enregistrer le paiement
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Moyen de paiement">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {(methods || []).filter((x) => x.is_active).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Montant" hint={max ? `Reste dû : ${money(max)}` : undefined}>
          <Input inputMode="numeric" className="num text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>
        {m?.requires_reference && (
          <Field label="Référence de transaction" required>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex. OM2610…" />
          </Field>
        )}
        {m?.type === 'cash' && <p className="text-[12px] text-muted">Les espèces exigent une session de caisse ouverte.</p>}
      </div>
    </Modal>
  )
}

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} className="h-9 w-[150px] py-1 text-[12.5px]" />
      <span className="text-muted">→</span>
      <Input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} className="h-9 w-[150px] py-1 text-[12.5px]" />
    </div>
  )
}
