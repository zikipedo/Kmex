import { motion } from 'framer-motion'
import { ArrowRight, Boxes, Eye, EyeOff, Lock, Mail, Receipt, ShieldCheck, Sparkles, TrendingUp, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Aurora } from '@/components/aurora'
import { Button, cx, Input } from '@/components/ui'
import { ApiError, get, post } from '@/lib/api'
import { homeFor, useAuth, type Me } from '@/store/auth'
import { Logo } from '@/layout/AppLayout'

const DEMO = [
  { label: 'Propriétaire', email: 'admin@stockpro.ml' },
  { label: 'Gérante', email: 'gerant@stockpro.ml' },
  { label: 'Caissière', email: 'caissier@stockpro.ml' },
  { label: 'Stock', email: 'stock@stockpro.ml' },
  { label: 'Comptable', email: 'comptable@stockpro.ml' },
]

const FEATURES = ['Point de vente éclair', 'Stock traçable au mouvement près', 'Mobile Money natif', 'Clôture de caisse Z', 'Crédit client maîtrisé', 'Audit infalsifiable', 'Multi-dépôts', 'Dépenses & bénéfice net']

function FloatingCard({ className, delay, children }: { className: string; delay: number; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay, duration: 0.9, ease: [0.22, 1, 0.36, 1] }} className={cx('absolute', className)}>
      <div className="glass animate-float rounded-3xl p-4" style={{ animationDelay: `${delay}s` }}>
        {children}
      </div>
    </motion.div>
  )
}

export default function Login() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }

  const submit = async (e?: React.FormEvent, id = identifier, pwd = password) => {
    e?.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await post<{ access: string } & Me>('/auth/login', { identifier: id, password: pwd })
      useAuth.getState().setAccess(r.access)
      const me = await get<Me>('/me')
      useAuth.getState().setMe(me)
      const target = loc.state?.from && loc.state.from !== '/login' ? loc.state.from : homeFor(me)
      navigate(target, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion impossible.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <Aurora intense />
      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
        {/* ---------- Hero */}
        <div className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
          <Logo />
          <div className="relative">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-6 inline-flex items-center gap-2 rounded-full border hairline bg-line/[0.04] px-3.5 py-1.5 text-[12px] font-medium text-fg/80">
              <Sparkles size={13} className="text-peach" /> Gestion commerciale nouvelle génération
            </motion.div>
            <motion.h1 initial={{ opacity: 0, y: 30, filter: 'blur(10px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} className="display text-[clamp(3.2rem,6.4vw,6.6rem)]">
              Votre <span className="accent-serif text-gradient">commerce,</span>
              <br />
              en pleine <span className="accent-serif text-gradient">lumière</span>
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-6 max-w-lg text-[16px] leading-relaxed text-muted">
              Stock, achats, ventes, caisse et dépenses réunis dans un seul espace — rapide pour la caissière, rigoureux pour le gérant, limpide pour le comptable.
            </motion.p>

            <div className="pointer-events-none relative mt-10 h-[260px]">
              <FloatingCard className="left-0 top-0 w-[230px]" delay={0.5}>
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
                  <TrendingUp size={13} className="text-mint" /> Chiffre du jour
                </div>
                <div className="num mt-2 font-display text-3xl font-bold">1 284 500</div>
                <div className="mt-1 text-[12px] text-mint">+18,4 % vs hier</div>
                <svg viewBox="0 0 200 40" className="mt-3 h-10 w-full">
                  <defs>
                    <linearGradient id="sp" x1="0" x2="1">
                      <stop stopColor="#fdba8c" />
                      <stop offset="1" stopColor="#a78bfa" />
                    </linearGradient>
                  </defs>
                  <path d="M0 32 C 20 30, 30 18, 50 22 S 80 8, 100 14 S 140 30, 160 12 S 190 6, 200 4" fill="none" stroke="url(#sp)" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </FloatingCard>
              <FloatingCard className="left-[250px] top-[40px] w-[210px]" delay={0.7}>
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-brand text-[#14101f]">
                    <Receipt size={18} />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold">TCK-2026-004512</div>
                    <div className="text-[11.5px] text-muted">Orange Money · payé</div>
                  </div>
                </div>
              </FloatingCard>
              <FloatingCard className="left-[120px] top-[150px] w-[250px]" delay={0.9}>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-2 font-medium">
                    <Boxes size={14} className="text-sky" /> Riz parfumé 25 kg
                  </span>
                  <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10.5px] font-semibold text-warn">Stock faible</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line/10">
                  <div className="h-full w-[22%] rounded-full bg-gradient-brand" />
                </div>
              </FloatingCard>
              <FloatingCard className="left-[400px] top-[160px] w-[170px]" delay={1.1}>
                <div className="flex items-center gap-2 text-[12px] font-medium">
                  <ShieldCheck size={15} className="text-accent" /> Audit chaîné
                </div>
                <div className="mt-1 font-mono text-[10.5px] text-muted">sha256 · 9f2c…e41a ✓</div>
              </FloatingCard>
            </div>
          </div>
          <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_15%,#000_85%,transparent)]">
            <div className="flex w-max animate-marquee gap-3">
              {[...FEATURES, ...FEATURES].map((f, i) => (
                <span key={i} className="chip whitespace-nowrap bg-line/[0.03] text-[12.5px] text-fg/70">
                  <Sparkles size={11} className="text-rose" /> {f}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ---------- Formulaire */}
        <div className="flex items-center justify-center p-5 sm:p-10">
          <motion.div initial={{ opacity: 0, y: 30, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-[440px]">
            <div className="mb-8 lg:hidden">
              <Logo />
            </div>
            <div className="glass-strong glow-ring relative overflow-hidden rounded-[32px] p-7 sm:p-9">
              <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-gradient-brand opacity-25 blur-3xl" />
              <h2 className="display text-[2.4rem]">
                Bon <span className="accent-serif text-gradient">retour</span>
              </h2>
              <p className="mt-2 text-[14px] text-muted">Connectez-vous pour reprendre là où vous vous êtes arrêté.</p>

              <form onSubmit={submit} className="mt-8 space-y-4">
                <div>
                  <label className="mb-1.5 block text-[12.5px] font-medium text-fg/75">Email ou téléphone</label>
                  <Input icon={<Mail size={16} />} autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="vous@entreprise.ml" autoFocus required />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12.5px] font-medium text-fg/75">Mot de passe</label>
                  <div className="relative">
                    <Input icon={<Lock size={16} />} type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" required />
                    <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg" aria-label="Afficher le mot de passe">
                      {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                {error && (
                  <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
                    {error}
                  </motion.div>
                )}
                <Button type="submit" size="lg" className="mt-2 w-full" loading={loading} iconRight={!loading && <ArrowRight size={17} />}>
                  Se connecter
                </Button>
              </form>

              <div className="mt-8">
                <div className="label mb-3 flex items-center gap-2 text-[10px]">
                  <Wallet size={12} /> Comptes de démonstration
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DEMO.map((d) => (
                    <button
                      key={d.email}
                      type="button"
                      onClick={() => {
                        setIdentifier(d.email)
                        setPassword('Demo@2026!')
                        submit(undefined, d.email, 'Demo@2026!')
                      }}
                      className="chip text-fg/75 hover:border-accent/40 hover:bg-accent/10 hover:text-fg"
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[11.5px] text-muted/80">Mot de passe commun : Demo@2026! · PIN gérante : 1234</p>
              </div>
            </div>
            <p className="mt-6 text-center text-[12px] text-muted/70">© {new Date().getFullYear()} StockPro · Connexion chiffrée · Session sécurisée</p>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
