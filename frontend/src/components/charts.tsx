import { animate, motion, useInView, useMotionValue, useTransform } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import React, { useEffect, useRef } from 'react'
import { money } from '@/lib/format'
import { Card, cx } from './ui'

export function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-strong rounded-2xl px-3.5 py-2.5 text-[12.5px]">
      {label && <div className="mb-1 text-muted">{label}</div>}
      {payload.map((p: any) => (
        <div key={p.dataKey || p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.color || p.fill }} />
          <span className="text-fg/70">{p.name}</span>
          <span className="num ml-auto pl-4 font-semibold">{formatter ? formatter(p.value) : money(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

/** Nombre qui s'anime à l'apparition. */
export function CountUp({ value, format = (v: number) => money(v, { symbol: false }), className }: { value: number; format?: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => format(v))
  useEffect(() => {
    if (!inView) return
    const c = animate(mv, value, { duration: 1.2, ease: [0.22, 1, 0.36, 1] })
    return c.stop
  }, [inView, value, mv])
  return <motion.span ref={ref} className={cx('num', className)}>{text}</motion.span>
}

export function Delta({ value }: { value?: number | null }) {
  if (value === null || value === undefined) return <span className="text-[11.5px] text-muted">—</span>
  const up = value >= 0
  return (
    <span className={cx('inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold', up ? 'bg-mint/12 text-mint' : 'bg-danger/12 text-danger')}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {Math.abs(value).toFixed(1).replace('.', ',')} %
    </span>
  )
}

export function Kpi({
  label,
  value,
  sub,
  delta,
  icon,
  tint = '#a78bfa',
  onClick,
  format,
  suffix,
}: {
  label: string
  value: number
  sub?: React.ReactNode
  delta?: number | null
  icon: React.ReactNode
  tint?: string
  onClick?: () => void
  format?: (v: number) => string
  suffix?: string
}) {
  return (
    <motion.div whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
      <Card onClick={onClick} className={cx('group relative h-full overflow-hidden p-5', onClick && 'cursor-pointer')}>
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-25 blur-2xl transition-opacity duration-500 group-hover:opacity-50" style={{ background: tint }} />
        <div className="relative flex items-center justify-between">
          <span className="label text-[10.5px]">{label}</span>
          <span className="grid h-9 w-9 place-items-center rounded-2xl" style={{ background: `${tint}22`, color: tint }}>
            {icon}
          </span>
        </div>
        <div className="relative mt-4 flex items-baseline gap-1.5">
          <CountUp value={value} format={format} className="font-display text-[28px] font-bold tracking-tight" />
          {suffix && <span className="text-[13px] text-muted">{suffix}</span>}
        </div>
        <div className="relative mt-2 flex items-center gap-2 text-[12px] text-muted">
          {delta !== undefined && <Delta value={delta} />}
          {sub}
        </div>
      </Card>
    </motion.div>
  )
}

export function BarList({ items, format = (v: number) => money(v, { compact: true }), onClick }: { items: { name: string; value: number; color?: string; sub?: string; id?: string }[]; format?: (v: number) => string; onClick?: (i: any) => void }) {
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div className="space-y-3">
      {items.map((it, idx) => (
        <button key={it.name + idx} onClick={() => onClick?.(it)} className="group block w-full text-left">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
            <span className="truncate font-medium">{it.name}</span>
            <span className="num shrink-0 text-muted">{format(it.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line/[0.07]">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: `${(it.value / max) * 100}%` }}
              viewport={{ once: true }}
              transition={{ duration: 1, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
              className="h-full rounded-full"
              style={{ background: it.color ? `linear-gradient(90deg, ${it.color}aa, ${it.color})` : 'linear-gradient(90deg,#fdba8c,#f472b6,#a78bfa)' }}
            />
          </div>
        </button>
      ))}
    </div>
  )
}
