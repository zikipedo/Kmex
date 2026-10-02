import { CloudOff, CloudUpload, RefreshCw, TriangleAlert, Wifi } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useSync } from '@/lib/offline'
import { cx } from './ui'

/** Indicateur réseau + file de synchronisation (barre supérieure, §29.2). */
export function SyncPill({ compact = false }: { compact?: boolean }) {
  const { online, pending, conflicts, syncing } = useSync()
  const navigate = useNavigate()
  const tone = !online ? 'bg-danger/12 text-danger' : conflicts ? 'bg-warn/12 text-warn' : pending ? 'bg-sky/12 text-sky' : 'text-mint'
  const label = !online ? 'Hors ligne' : syncing ? 'Synchronisation…' : conflicts ? `${conflicts} conflit(s)` : pending ? `${pending} en attente` : 'En ligne'
  const Icon = !online ? CloudOff : syncing ? RefreshCw : conflicts ? TriangleAlert : pending ? CloudUpload : Wifi
  return (
    <button
      onClick={() => navigate('/sync')}
      title={`${label} — état de synchronisation`}
      className={cx('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition hover:brightness-110', tone)}
    >
      <Icon size={14} className={syncing ? 'animate-spin' : ''} />
      {(!compact || pending > 0 || !online) && <span className={compact ? '' : 'hidden xl:inline'}>{label}</span>}
    </button>
  )
}
