import { useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export function ProfilePage({ username }: { username: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setError(''); setSuccess(false)
    if (values.get('new-password') !== values.get('confirm')) { setError('Die neuen Passwörter stimmen nicht überein.'); return }
    setBusy(true)
    try {
      const response = await fetch('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_password: values.get('current-password'), new_password: values.get('new-password') }) })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(typeof body?.detail === 'string' ? body.detail : 'Passwort konnte nicht geändert werden.')
      }
      setSuccess(true); form.reset()
    } catch (e) { setError(e instanceof Error ? e.message : 'Anfrage fehlgeschlagen.') }
    finally { setBusy(false) }
  }

  return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 lg:p-8"><h1 className="text-xl font-semibold">Profil</h1><Card className="w-full max-w-xl"><CardHeader><CardTitle>Passwort ändern</CardTitle><CardDescription>Angemeldet als {username}. Nach der Änderung werden andere Sitzungen abgemeldet.</CardDescription></CardHeader><CardContent><form onSubmit={changePassword}><FieldGroup>
    <input type="hidden" name="username" autoComplete="username" value={username} />
    <Field><FieldLabel htmlFor="current-password">Aktuelles Passwort</FieldLabel><Input id="current-password" name="current-password" type="password" autoComplete="current-password" required maxLength={1024} disabled={busy} /></Field>
    <Field><FieldLabel htmlFor="profile-password">Neues Passwort</FieldLabel><Input id="profile-password" name="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} disabled={busy} /><p className="text-sm text-muted-foreground">Mindestens 12 Zeichen.</p></Field>
    <Field><FieldLabel htmlFor="profile-confirm">Neues Passwort wiederholen</FieldLabel><Input id="profile-confirm" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} disabled={busy} /></Field>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{success && <Alert role="status"><Check /><AlertDescription>Dein Passwort wurde geändert.</AlertDescription></Alert>}
    <div><Button type="submit" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Passwort ändern'}</Button></div>
  </FieldGroup></form></CardContent></Card></div>
}
