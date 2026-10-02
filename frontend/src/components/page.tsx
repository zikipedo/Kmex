import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import React from 'react'
import { Link } from 'react-router-dom'

export function Page({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, filter: 'blur(3px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={`mx-auto w-full max-w-[1500px] px-4 pb-24 pt-6 sm:px-6 lg:px-10 ${className}`}
    >
      {children}
    </motion.div>
  )
}

/** En-tête de page : titre display en capitales + mot d'accent en serif italique dégradé. */
export function PageHeader({
  title,
  accent,
  subtitle,
  actions,
  crumbs,
}: {
  title: string
  accent?: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  crumbs?: { label: string; to?: string }[]
}) {
  return (
    <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {crumbs && (
          <nav className="mb-3 flex flex-wrap items-center gap-1 text-[12px] text-muted">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {c.to ? (
                  <Link to={c.to} className="transition hover:text-fg">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-fg/70">{c.label}</span>
                )}
                {i < crumbs.length - 1 && <ChevronRight size={12} />}
              </span>
            ))}
          </nav>
        )}
        <h1 className="display text-[clamp(2rem,4.2vw,3.6rem)]">
          {title}
          {accent && (
            <>
              {' '}
              <span className="accent-serif text-gradient pr-2">{accent}</span>
            </>
          )}
        </h1>
        {subtitle && <p className="mt-3 max-w-2xl text-[14.5px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export const stagger = {
  container: { hidden: {}, show: { transition: { staggerChildren: 0.06 } } },
  item: { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } } },
}
