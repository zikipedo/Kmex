import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import React from 'react'
import { Card, cx, EmptyState, Input, Skeleton } from './ui'

export type Column<T> = {
  key: string
  header: React.ReactNode
  render?: (row: T) => React.ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
  hideOnMobile?: boolean
}

export function DataTable<T extends { id?: string | number }>({
  columns,
  rows,
  loading,
  onRowClick,
  empty,
  page,
  pages,
  total,
  onPage,
  toolbar,
  search,
  onSearch,
  searchPlaceholder = 'Rechercher…',
  footer,
  dense,
}: {
  columns: Column<T>[]
  rows?: T[]
  loading?: boolean
  onRowClick?: (row: T) => void
  empty?: React.ReactNode
  page?: number
  pages?: number
  total?: number
  onPage?: (p: number) => void
  toolbar?: React.ReactNode
  search?: string
  onSearch?: (v: string) => void
  searchPlaceholder?: string
  footer?: React.ReactNode
  dense?: boolean
}) {
  const align = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left')
  return (
    <Card className="overflow-hidden">
      {(onSearch || toolbar) && (
        <div className="flex flex-col gap-3 border-b hairline p-4 sm:flex-row sm:items-center sm:justify-between">
          {onSearch ? (
            <div className="w-full sm:max-w-xs">
              <Input icon={<Search size={16} />} value={search} onChange={(e) => onSearch(e.target.value)} placeholder={searchPlaceholder} />
            </div>
          ) : (
            <div />
          )}
          {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13.5px]">
          <thead>
            <tr className="border-b hairline">
              {columns.map((c) => (
                <th key={c.key} className={cx('label whitespace-nowrap px-5 py-3 font-semibold', align(c.align), c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !rows?.length
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b hairline last:border-0">
                    {columns.map((c) => (
                      <td key={c.key} className={cx('px-5', dense ? 'py-2.5' : 'py-4', c.hideOnMobile && 'hidden md:table-cell')}>
                        <Skeleton className="h-4 w-full max-w-[160px]" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows?.map((row, i) => (
                  <motion.tr
                    key={(row.id as string) ?? i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.015, 0.25) }}
                    onClick={() => onRowClick?.(row)}
                    className={cx('table-row border-b hairline last:border-0', onRowClick && 'cursor-pointer')}
                  >
                    {columns.map((c, ci) => (
                      <td key={c.key} className={cx('px-5', dense ? 'py-2.5' : 'py-3.5', align(c.align), (ci === 0 || c.align === 'right') && 'whitespace-nowrap', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                        {c.render ? c.render(row) : ((row as any)[c.key] ?? '—')}
                      </td>
                    ))}
                  </motion.tr>
                ))}
          </tbody>
        </table>
      </div>
      {!loading && rows && rows.length === 0 && (empty || <EmptyState title="Aucun résultat" text="Modifiez vos filtres ou votre recherche." />)}
      {footer}
      {pages !== undefined && pages > 1 && onPage && (
        <div className="flex items-center justify-between border-t hairline px-5 py-3 text-[12.5px] text-muted">
          <span className="num">
            Page {page} / {pages} · {total} éléments
          </span>
          <div className="flex gap-1">
            <button disabled={(page || 1) <= 1} onClick={() => onPage((page || 1) - 1)} className="grid h-8 w-8 place-items-center rounded-full border hairline transition hover:bg-line/5 disabled:opacity-30">
              <ChevronLeft size={15} />
            </button>
            <button disabled={(page || 1) >= pages} onClick={() => onPage((page || 1) + 1)} className="grid h-8 w-8 place-items-center rounded-full border hairline transition hover:bg-line/5 disabled:opacity-30">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

export function FilterChips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={cx('chip', value === o.value ? 'border-transparent bg-fg text-bg' : 'text-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
