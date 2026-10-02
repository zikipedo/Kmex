import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Apple, Baby, Beef, Book, Box, Car, Coffee, CupSoda, Flower2, Gem, Gift, Hammer, HardHat, Home, Landmark, Loader2,
  Megaphone, Milk, Monitor, Package, Pill, Plug, Receipt, Scale, Shapes, Shirt, ShoppingBag, Smartphone, Sofa, Sparkles,
  SprayCan, Tag, Truck, Users, Wheat, Wifi, Wrench, X, Zap, type LucideIcon,
} from 'lucide-react'
import React, { forwardRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export const cx = clsx

/* ------------------------------------------------------------------ Icon par nom */
export const ICONS: Record<string, LucideIcon> = {
  'cup-soda': CupSoda, wheat: Wheat, milk: Milk, sparkles: Sparkles, 'spray-can': SprayCan, smartphone: Smartphone,
  shirt: Shirt, wrench: Wrench, package: Package, home: Home, zap: Zap, wifi: Wifi, truck: Truck, users: Users,
  hammer: Hammer, megaphone: Megaphone, landmark: Landmark, scale: Scale, monitor: Monitor, shapes: Shapes,
  receipt: Receipt, 'shopping-bag': ShoppingBag, pill: Pill, car: Car, book: Book, baby: Baby, apple: Apple, beef: Beef,
  coffee: Coffee, gift: Gift, tag: Tag, box: Box, 'hard-hat': HardHat, plug: Plug, sofa: Sofa, gem: Gem, flower: Flower2,
}

export function DynIcon({ name, className, size = 18 }: { name?: string; className?: string; size?: number }) {
  const C = ICONS[name || 'package'] || Package
  return <C size={size} className={className} />
}

/* ------------------------------------------------------------------ Bouton */
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'gradient' | 'ghost' | 'soft' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  loading?: boolean
  icon?: React.ReactNode
  iconRight?: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, iconRight, className, children, disabled, ...rest },
  ref,
) {
  const sizes = {
    sm: 'h-8 px-3.5 text-[12.5px] gap-1.5',
    md: 'h-10 px-5 text-[13.5px] gap-2',
    lg: 'h-12 px-6 text-[15px] gap-2.5',
    xl: 'h-16 px-8 text-lg gap-3',
  }
  const variants = {
    primary:
      'bg-fg text-bg shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_8px_30px_-6px_rgba(167,139,250,0.55)] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.2),0_10px_40px_-4px_rgba(244,114,182,0.65)] hover:-translate-y-px',
    gradient: 'bg-gradient-brand text-[#14101f] shadow-[0_10px_40px_-8px_rgba(244,114,182,0.7)] hover:brightness-110 hover:-translate-y-px',
    ghost: 'text-fg/80 hover:text-fg hover:bg-line/[0.06]',
    soft: 'bg-line/[0.06] text-fg hover:bg-line/[0.1] border hairline',
    outline: 'border hairline text-fg hover:bg-line/[0.05]',
    danger: 'bg-danger/90 text-white hover:bg-danger shadow-[0_8px_30px_-8px_rgb(var(--danger)/0.7)]',
  }
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-semibold transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        sizes[size],
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" size={16} /> : icon}
      {children}
      {iconRight}
    </button>
  )
})

export function IconButton({ className, label, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx('grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-line/[0.07] hover:text-fg active:scale-95', className)}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ Cartes */
export function Card({ className, children, glow, ...rest }: React.HTMLAttributes<HTMLDivElement> & { glow?: boolean }) {
  return (
    <div className={cx('card', glow && 'glow-ring', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action, icon }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-6 pt-5">
      <div className="flex items-center gap-3">
        {icon && <div className="grid h-9 w-9 place-items-center rounded-2xl bg-line/[0.06] text-fg/80">{icon}</div>}
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[12.5px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ Badges */
const TONES: Record<string, string> = {
  green: 'bg-mint/12 text-mint ring-mint/25',
  red: 'bg-danger/12 text-danger ring-danger/25',
  amber: 'bg-warn/12 text-warn ring-warn/25',
  violet: 'bg-accent/12 text-accent ring-accent/25',
  pink: 'bg-rose/12 text-rose ring-rose/25',
  sky: 'bg-sky/12 text-sky ring-sky/25',
  gray: 'bg-line/[0.06] text-muted ring-line/10',
}

export function Badge({ tone = 'gray', children, dot, className }: { tone?: keyof typeof TONES | string; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset', TONES[tone] || TONES.gray, className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

const STATUS: Record<string, [string, string]> = {
  paid: ['green', 'Payée'],
  partial: ['amber', 'Partielle'],
  issued: ['pink', 'Impayée'],
  unpaid: ['pink', 'Impayée'],
  cancelled: ['gray', 'Annulée'],
  draft: ['gray', 'Brouillon'],
  sent: ['sky', 'Envoyée'],
  received: ['green', 'Reçue'],
  closed: ['violet', 'Clôturée'],
  open: ['green', 'Ouverte'],
  validated: ['violet', 'Validée'],
  pending: ['amber', 'En attente'],
  approved: ['sky', 'Approuvée'],
  rejected: ['red', 'Rejetée'],
  applied: ['green', 'Appliqué'],
  counting: ['sky', 'Comptage'],
  requested: ['amber', 'Demandé'],
  in_transit: ['sky', 'En transit'],
  partially_received: ['amber', 'Reçu avec écart'],
  active: ['green', 'Actif'],
  inactive: ['gray', 'Inactif'],
  archived: ['gray', 'Archivé'],
  blocked: ['red', 'Bloqué'],
  accepted: ['green', 'Accepté'],
  refused: ['red', 'Refusé'],
  expired: ['gray', 'Expiré'],
  converted: ['violet', 'Converti'],
  valid: ['green', 'Valide'],
  reversed: ['gray', 'Extourné'],
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const [tone, text] = STATUS[status] || ['gray', status]
  return (
    <Badge tone={tone} dot>
      {label || text}
    </Badge>
  )
}

/* ------------------------------------------------------------------ Champs */
export function Field({ label, error, hint, children, className, required }: { label?: React.ReactNode; error?: string; hint?: React.ReactNode; children: React.ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cx('block', className)}>
      {label && (
        <span className="mb-1.5 block text-[12.5px] font-medium text-fg/75">
          {label}
          {required && <span className="ml-0.5 text-rose">*</span>}
        </span>
      )}
      {children}
      {error ? <span className="mt-1 block text-[12px] text-danger">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-muted">{hint}</span> : null}
    </label>
  )
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode }>(function Input({ className, icon, ...rest }, ref) {
  if (icon)
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">{icon}</span>
        <input ref={ref} className={cx('input pl-10', className)} {...rest} />
      </div>
    )
  return <input ref={ref} className={cx('input', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx('input', className)} {...rest}>
      {children}
    </select>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('input min-h-[88px] resize-y', className)} {...rest} />
})

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="inline-flex items-center gap-3 text-[13.5px]">
      <span className={cx('relative h-6 w-11 rounded-full transition', checked ? 'bg-gradient-brand' : 'bg-line/15')}>
        <motion.span layout className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
      {label}
    </button>
  )
}

/* ------------------------------------------------------------------ Modale */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  icon,
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  icon?: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-black/55 backdrop-blur-md" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.98 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className={cx('glass-strong relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]', widths[size])}
          >
            <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-2/3 -translate-x-1/2 rounded-full bg-gradient-brand opacity-20 blur-3xl" />
            {(title || subtitle) && (
              <div className="relative flex items-start justify-between gap-4 px-6 pb-2 pt-6 sm:px-7">
                <div className="flex items-start gap-3">
                  {icon && <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-line/[0.07]">{icon}</div>}
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
                    {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
                  </div>
                </div>
                <IconButton label="Fermer" onClick={onClose}>
                  <X size={18} />
                </IconButton>
              </div>
            )}
            <div className="relative overflow-y-auto px-6 py-4 sm:px-7">{children}</div>
            {footer && <div className="relative flex flex-wrap items-center justify-end gap-2 border-t hairline px-6 py-4 sm:px-7">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/* ------------------------------------------------------------------ Tabs */
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { key: T; label: React.ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx('inline-flex flex-wrap gap-1 rounded-full border hairline bg-line/[0.03] p-1', className)}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} className={cx('relative rounded-full px-4 py-1.5 text-[13px] font-medium transition', value === t.key ? 'text-bg' : 'text-muted hover:text-fg')}>
          {value === t.key && <motion.span layoutId={`tab-${tabs.map((x) => x.key).join()}`} className="absolute inset-0 rounded-full bg-fg" transition={{ type: 'spring', damping: 28, stiffness: 380 }} />}
          <span className="relative flex items-center gap-1.5">
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className={cx('rounded-full px-1.5 text-[10.5px]', value === t.key ? 'bg-bg/15' : 'bg-line/10')}>{t.count}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ États */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-muted', className)} size={20} />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />
}

export function EmptyState({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="relative mb-5">
        <div className="absolute inset-0 rounded-full bg-gradient-brand opacity-30 blur-2xl" />
        <div className="relative grid h-16 w-16 place-items-center rounded-3xl border hairline bg-line/[0.04] text-fg/80">{icon || <Sparkles size={26} />}</div>
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-[13.5px] text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  return (
    <div
      className={cx('grid shrink-0 place-items-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${hue} 80% 70%), hsl(${(hue + 60) % 360} 75% 55%))` }}
    >
      {name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase()}
    </div>
  )
}

/* ------------------------------------------------------------------ Image produit */
export function ProductThumb({ image, icon, color, name, size = 44, className, rounded = 'rounded-2xl' }: { image?: Record<string, string> | null; icon?: string; color?: string; name?: string; size?: number; className?: string; rounded?: string }) {
  const src = image ? (size > 120 ? image['600'] : image['200'] || image['64']) : null
  const [err, setErr] = useState(false)
  if (src && !err)
    return <img src={src} alt={name || ''} loading="lazy" onError={() => setErr(true)} className={cx('shrink-0 object-cover', rounded, className)} style={{ width: size, height: size }} />
  return (
    <div className={cx('relative grid shrink-0 place-items-center overflow-hidden', rounded, className)} style={{ width: size, height: size, background: `linear-gradient(140deg, ${color || '#a78bfa'}40, ${color || '#a78bfa'}0d 70%)` }}>
      <div className="absolute -right-4 -top-4 h-2/3 w-2/3 rounded-full opacity-50 blur-2xl" style={{ background: color || '#a78bfa' }} />
      {size > 80 && (
        <>
          <div className="absolute h-[78%] w-[78%] max-h-40 max-w-40 rounded-full border border-white/10" />
          <div className="absolute h-[52%] w-[52%] max-h-28 max-w-28 rounded-full border border-white/10" />
        </>
      )}
      <span className="relative" style={{ color: color || '#a78bfa', filter: 'drop-shadow(0 4px 14px rgba(0,0,0,.35))' }}>
        <DynIcon name={icon} size={Math.min(44, Math.max(16, size * 0.42))} />
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ Divers */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border hairline bg-line/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{children}</kbd>
}

export function Section({ title, children, className, action }: { title?: React.ReactNode; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={cx('space-y-3', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between">
          {title && <h3 className="label">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function InfoRow({ label, value, strong }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-[13.5px]">
      <span className="text-muted">{label}</span>
      <span className={cx('num text-right', strong && 'text-base font-semibold')}>{value}</span>
    </div>
  )
}
