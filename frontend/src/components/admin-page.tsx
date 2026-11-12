import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Check, LoaderCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type User = { id: number; username: string; is_admin: boolean; active: boolean }

async function request(path: string, options?: RequestInit) {
  const response = await fetch(`/api/admin/users${path}`, options)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'Anfrage fehlgeschlagen. Bitte erneut versuchen.')
  return body
}

export function AdminPage({ username }: { username: string }) {
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    request('', { signal: controller.signal }).then(setUsers).catch(e => {
      if (e.name !== 'AbortError') setError(e.message)
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision])

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    if (values.get('password') !== values.get('confirm')) { setError('Die Passwörter stimmen nicht überein.'); setSuccess(''); return }
    setBusy(true); setError(''); setSuccess('')
    try {
      await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: values.get('username'), password: values.get('password') }) })
      setSuccess(`Benutzer „${values.get('username')}“ wurde angelegt.`)
      toast.success(`Benutzer „${values.get('username')}“ wurde angelegt.`)
      form.reset()
      setLoading(true); setRevision(r => r + 1)
    } catch (e) { setError(e instanceof Error ? e.message : 'Anfrage fehlgeschlagen.'); toast.error(e instanceof Error ? e.message : 'Anfrage fehlgeschlagen.') }
    finally { setBusy(false) }
  }

  async function updateUser(user: User, changes: Partial<Pick<User, 'active' | 'is_admin'>>) {
    setSaving(user.id); setError(''); setSuccess('')
    try {
      const updated: User = await request(`/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: user.active, is_admin: user.is_admin, ...changes }) })
      setUsers(items => items.map(item => item.id === updated.id ? updated : item))
      setSuccess(`Rechte für „${user.username}“ wurden gespeichert.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Anfrage fehlgeschlagen.'); toast.error(e instanceof Error ? e.message : 'Anfrage fehlgeschlagen.') }
    finally { setSaving(null) }
  }

  return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 lg:p-8">
    <h1 className="text-xl font-semibold">Nutzerverwaltung</h1>
    {(error || success) && <div aria-live="polite">{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{success && <Alert role="status"><Check /><AlertDescription>{success}</AlertDescription></Alert>}</div>}
    <Card><CardHeader className="flex flex-row items-start justify-between gap-4"><div className="flex flex-col gap-2"><CardTitle>Nutzerübersicht</CardTitle><CardDescription>Administratoren verwalten Zugänge. Gesperrte Nutzer können sich nicht anmelden.</CardDescription></div><Button variant="outline" disabled={loading || saving !== null || busy} onClick={() => { setError(''); setLoading(true); setRevision(r => r + 1) }}>Aktualisieren</Button></CardHeader><CardContent>
      {loading ? <div className="flex justify-center py-8" role="status"><LoaderCircle className="size-5 animate-spin" /><span className="sr-only">Nutzer werden geladen</span></div> : <Table><TableHeader><TableRow><TableHead>Benutzername</TableHead><TableHead>Administrator</TableHead><TableHead>Konto aktiv</TableHead></TableRow></TableHeader><TableBody>
        {users.map(user => <TableRow key={user.id}><TableCell className="font-medium">{user.username}{user.username === username && <span className="ml-2 text-xs text-muted-foreground">(du)</span>}</TableCell><TableCell><Switch aria-label={`Administratorrechte für ${user.username}`} checked={user.is_admin} disabled={saving !== null || user.username === username} onCheckedChange={is_admin => updateUser(user, { is_admin })} /></TableCell><TableCell><Switch aria-label={`Konto aktiv für ${user.username}`} checked={user.active} disabled={saving !== null || user.username === username} onCheckedChange={active => updateUser(user, { active })} /></TableCell></TableRow>)}
        {!users.length && <TableRow><TableCell colSpan={3}>Keine Nutzer verfügbar.</TableCell></TableRow>}
      </TableBody></Table>}
      <p className="mt-4 text-xs text-muted-foreground">Änderungen werden sofort gespeichert. Dein eigenes Administratorkonto bleibt aktiv.</p>
    </CardContent></Card>
    <Card className="w-full max-w-xl"><CardHeader><CardTitle>Benutzer hinzufügen</CardTitle><CardDescription>Neue Konten erhalten zunächst Nutzerrechte.</CardDescription></CardHeader><CardContent><form onSubmit={createUser}><FieldGroup>
      <Field><FieldLabel htmlFor="new-username">Benutzername</FieldLabel><Input id="new-username" name="username" autoComplete="off" required maxLength={150} pattern={String.raw`\S+`} title="Bitte einen Benutzernamen ohne Leerzeichen eingeben." disabled={busy} /></Field>
      <Field><FieldLabel htmlFor="new-password">Passwort</FieldLabel><Input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} disabled={busy} /><p className="text-sm text-muted-foreground">Mindestens 12 Zeichen.</p></Field>
      <Field><FieldLabel htmlFor="confirm-password">Passwort wiederholen</FieldLabel><Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} disabled={busy} /></Field>
      <div><Button type="submit" disabled={busy || saving !== null}>{busy ? 'Wird angelegt …' : 'Benutzer anlegen'}</Button></div>
    </FieldGroup></form></CardContent></Card>
  </div>
}
