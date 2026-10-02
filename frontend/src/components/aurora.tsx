import { motion, useMotionValue, useSpring } from 'framer-motion'
import { useEffect } from 'react'

/** Fond « paradis » : aurores pastel en mouvement lent, grille fine, grain et halo qui suit la souris. */
export function Aurora({ intense = false }: { intense?: boolean }) {
  const mx = useMotionValue(-400)
  const my = useMotionValue(-400)
  const x = useSpring(mx, { damping: 40, stiffness: 120 })
  const y = useSpring(my, { damping: 40, stiffness: 120 })

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      mx.set(e.clientX - 300)
      my.set(e.clientY - 300)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [mx, my])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="grid-bg absolute inset-0" />
      <div className="absolute inset-0" style={{ opacity: intense ? 0.85 : 'var(--aurora-opacity)' as any }}>
        <div className="animate-aurora absolute -left-[10%] -top-[20%] h-[60vmax] w-[60vmax] rounded-full bg-[radial-gradient(circle_at_center,rgba(167,139,250,0.55),transparent_60%)] blur-3xl" />
        <div className="animate-aurora-slow absolute -right-[15%] -top-[10%] h-[55vmax] w-[55vmax] rounded-full bg-[radial-gradient(circle_at_center,rgba(244,114,182,0.45),transparent_60%)] blur-3xl" />
        <div className="animate-aurora absolute -bottom-[30%] left-[20%] h-[60vmax] w-[60vmax] rounded-full bg-[radial-gradient(circle_at_center,rgba(253,186,140,0.35),transparent_60%)] blur-3xl [animation-delay:-8s]" />
        <div className="animate-aurora-slow absolute -bottom-[25%] -right-[10%] h-[45vmax] w-[45vmax] rounded-full bg-[radial-gradient(circle_at_center,rgba(125,211,252,0.3),transparent_60%)] blur-3xl [animation-delay:-14s]" />
      </div>
      <motion.div style={{ x, y }} className="absolute h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_60%)] dark:block" />
      <div className="noise" />
    </div>
  )
}
