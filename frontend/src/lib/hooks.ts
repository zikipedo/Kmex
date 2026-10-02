import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, get, type Paginated } from './api'

export function useApi<T = any>(key: unknown[], path: string | null, params?: Record<string, unknown>, opts?: Partial<UseQueryOptions<T>>) {
  return useQuery<T>({
    queryKey: [...key, params],
    queryFn: () => get<T>(path as string, params),
    enabled: !!path,
    ...opts,
  })
}

export function useList<T = any>(key: string, path: string, params?: Record<string, unknown>) {
  return useApi<Paginated<T>>([key], path, params, { placeholderData: (prev) => prev })
}

export function useDebounced<T>(value: T, delay = 280) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

export function showError(e: unknown) {
  if (e instanceof ApiError) {
    toast.error(e.message, { description: e.problem.request_id ? `${e.problem.title} · réf. ${e.problem.request_id}` : e.problem.title })
  } else {
    toast.error('Une erreur inattendue est survenue.')
  }
}

/** Mutation avec toasts et invalidation automatique. */
export function useAction<TVars = any, TRes = any>(fn: (v: TVars) => Promise<TRes>, opts: { success?: string | ((r: TRes) => string); invalidate?: string[]; onSuccess?: (r: TRes) => void } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success)
      ;(opts.invalidate || []).forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      opts.onSuccess?.(r)
    },
    onError: showError,
  })
}

export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, deps: unknown[] = []) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const parts = combo.toLowerCase().split('+')
      const key = parts.pop()
      const needCtrl = parts.includes('ctrl') || parts.includes('mod')
      if (needCtrl && !(e.ctrlKey || e.metaKey)) return
      if (!needCtrl && (e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() === key) handler(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
