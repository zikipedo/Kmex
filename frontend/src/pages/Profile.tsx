import { KeyRound, Lock, Moon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/page'
import { Avatar, Badge, Button, Card, CardHeader, Field, Input } from '@/components/ui'
import { toggleTheme } from '@/layout/AppLayout'
import { post } from '@/lib/api'
import { showError } from '@/lib/hooks'
import { useAuth } from '@/store/auth'

export default function Profile() {
  const me = useAuth((s) => s.me)!
  const [pwd, setPwd] = useState({ current_password: '', new_password: '', confirm: '' })
  const [pin, setPin] = useState('')
  return (
    <Page>
      <PageHeader title="Mon" accent="profil" subtitle="Sécurité du compte, PIN de caisse et préférences." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card glow className="p-6">
          <div className="flex flex-col items-center text-center">
            <Avatar name={me.user.full_name} size={84} />
            <div className="mt-4 text-lg font-semibold">{me.user.full_name}</div>
            <div className="text-[13px] text-muted">{me.user.email}</div>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">{me.user.role_names.map((r) => <Badge key={r} tone="violet">{r}</Badge>)}</div>
            <div className="mt-4 text-[12.5px] text-muted">{me.permissions.length} permissions · {me.warehouses.length} dépôt(s)</div>
            <Button className="mt-5" variant="soft" icon={<Moon size={15} />} onClick={toggleTheme}>Basculer clair / sombre</Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="Mot de passe" subtitle="10 caractères minimum ; vos autres sessions seront déconnectées." icon={<Lock size={16} />} />
          <div className="space-y-4 p-6">
            <Field label="Mot de passe actuel"><Input type="password" value={pwd.current_password} onChange={(e) => setPwd({ ...pwd, current_password: e.target.value })} /></Field>
            <Field label="Nouveau mot de passe"><Input type="password" value={pwd.new_password} onChange={(e) => setPwd({ ...pwd, new_password: e.target.value })} /></Field>
            <Field label="Confirmation" error={pwd.confirm && pwd.confirm !== pwd.new_password ? 'Les mots de passe diffèrent' : undefined}><Input type="password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} /></Field>
            <Button className="w-full" disabled={pwd.new_password.length < 10 || pwd.new_password !== pwd.confirm} onClick={async () => { try { const r = await post('/auth/change-password', pwd); useAuth.getState().setAccess(r.access); toast.success('Mot de passe modifié'); setPwd({ current_password: '', new_password: '', confirm: '' }) } catch (e) { showError(e) } }}>Changer le mot de passe</Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="PIN" subtitle="Reconnexion rapide en caisse et autorisations gérant (remises, crédit)." icon={<KeyRound size={16} />} />
          <div className="space-y-4 p-6">
            <Field label={me.user.has_pin ? 'Nouveau PIN' : 'Définir un PIN'} hint="4 à 6 chiffres"><Input inputMode="numeric" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} /></Field>
            <Button className="w-full" disabled={pin.length < 4} onClick={async () => { try { await post('/auth/pin', { pin }); toast.success('PIN enregistré'); setPin('') } catch (e) { showError(e) } }}>Enregistrer le PIN</Button>
          </div>
        </Card>
      </div>
    </Page>
  )
}
