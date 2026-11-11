import { useState, type FormEvent } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export function AdminPage() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    if (values.get('password') !== values.get('confirm')) { setError('Die Passwörter stimmen nicht überein.'); setSuccess(''); return }
    setBusy(true); setError(''); setSuccess('')
    try {
      const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: values.get('username'), password: values.get('password') }) })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(typeof body?.detail === 'string' ? body.detail : 'Benutzer konnte nicht angelegt werden.')
      }
      setSuccess(`Benutzer „${values.get('username')}“ wurde angelegt.`); form.reset()
    } catch (e) { setError(e instanceof Error ? e.message : 'Anfrage fehlgeschlagen.') }
    finally { setBusy(false) }
  }
  return <div className="p-4 lg:p-6"><Card className="max-w-xl"><CardHeader><CardTitle>Benutzer hinzufügen</CardTitle><CardDescription>Erstelle einen Zugang für eine weitere Person.</CardDescription></CardHeader><CardContent><form onSubmit={createUser}><FieldGroup>
    <Field><FieldLabel htmlFor="new-username">Benutzername</FieldLabel><Input id="new-username" name="username" autoComplete="off" required maxLength={150} pattern="\\S+" title="Bitte einen Benutzernamen ohne Leerzeichen eingeben." /></Field>
    <Field><FieldLabel htmlFor="new-password">Passwort</FieldLabel><Input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} /><p className="text-sm text-muted-foreground">Mindestens 12 Zeichen.</p></Field>
    <Field><FieldLabel htmlFor="confirm-password">Passwort wiederholen</FieldLabel><Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} /></Field>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{success && <Alert><AlertDescription>{success}</AlertDescription></Alert>}
    <div><Button type="submit" disabled={busy}>{busy ? 'Wird angelegt …' : 'Benutzer anlegen'}</Button></div>
  </FieldGroup></form></CardContent></Card></div>
}
