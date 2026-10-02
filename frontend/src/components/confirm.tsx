import { AlertTriangle } from 'lucide-react'
import React, { useState } from 'react'
import { create } from 'zustand'
import { Button, Field, Modal, Textarea } from './ui'

type Req = {
  title: string
  message?: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  requireReason?: boolean
  resolve: (v: { ok: boolean; reason: string }) => void
}

const useConfirmStore = create<{ req: Req | null; set: (r: Req | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }))

/** Confirmation avec résumé des conséquences et motif obligatoire si demandé (§29.5). */
export function confirm(opts: Omit<Req, 'resolve'>) {
  return new Promise<{ ok: boolean; reason: string }>((resolve) => useConfirmStore.getState().set({ ...opts, resolve }))
}

export function ConfirmHost() {
  const { req, set } = useConfirmStore()
  const [reason, setReason] = useState('')
  const close = (ok: boolean) => {
    req?.resolve({ ok, reason })
    set(null)
    setReason('')
  }
  return (
    <Modal
      open={!!req}
      onClose={() => close(false)}
      size="sm"
      title={req?.title}
      icon={req?.danger ? <AlertTriangle size={18} className="text-danger" /> : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Annuler
          </Button>
          <Button variant={req?.danger ? 'danger' : 'primary'} disabled={req?.requireReason && reason.trim().length < 3} onClick={() => close(true)}>
            {req?.confirmLabel || 'Confirmer'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2 text-[14px] text-fg/80">
        {req?.message}
        {req?.requireReason && (
          <Field label="Motif" required>
            <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Expliquez la raison (obligatoire)" />
          </Field>
        )}
      </div>
    </Modal>
  )
}
