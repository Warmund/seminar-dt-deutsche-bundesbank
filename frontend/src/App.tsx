import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Layers2, ArrowRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import './App.css'

function Dashboard({ logout, username }: { logout: () => void; username: string }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">WZ</span><div><strong>WZ-Validierung</strong><span>Forschungsprototyp</span></div></div>
        <div className="account"><span>{username}</span><Button variant="outline" onClick={logout}>Abmelden</Button></div>
      </header>
      <main>
        <div className="breadcrumb">ARBEITSBEREICH <span>/</span> ÜBERSICHT</div>
        <section className="intro"><div><p className="eyebrow"><span /> WILLKOMMEN</p><h1>Validierung im Überblick<span>.</span></h1><p className="lead">Wirtschaftszweige gemeinsam mit KI prüfen – strukturiert, nachvollziehbar und auf einen Blick.</p></div><div className="intro-tag"><span>◌</span> Forschungsprototyp</div></section>
        <section aria-labelledby="overview-title" className="overview"><div className="section-head"><div><p className="eyebrow">IHR ARBEITSBEREICH</p><h2 id="overview-title">Übersicht</h2></div><span className="muted">Aktueller Stand</span></div>
          <div className="stats"><article className="stat"><div className="stat-head"><span>FÄLLE GESAMT</span><span className="icon">▦</span></div><strong>—</strong><p>Noch keine Daten verfügbar</p></article><article className="stat"><div className="stat-head"><span>ZUR PRÜFUNG</span><span className="icon amber">◷</span></div><strong>—</strong><p>Warten auf eine Entscheidung</p></article><article className="stat"><div className="stat-head"><span>ABGESCHLOSSEN</span><span className="icon green">✓</span></div><strong>—</strong><p>Bereits bearbeitete Fälle</p></article></div>
        </section>
        <section className="cases" aria-labelledby="cases-title"><div className="cases-head"><div><p className="eyebrow">VALIDIERUNG</p><h2 id="cases-title">Prüffälle</h2><p>Hier erscheinen die Fälle, sobald Daten verfügbar sind.</p></div><span className="status"><span /> Keine Daten</span></div><div className="table-head" aria-hidden="true"><span>UNTERNEHMEN</span><span>WZ-VORSCHLAG</span><span>KONFIDENZ</span><span>STATUS</span></div><div className="empty"><div className="empty-icon">▤</div><h3>Noch keine Fälle vorhanden</h3><p>Sobald Falldaten importiert wurden, können Sie hier mit der Prüfung beginnen.</p></div></section>
      </main><footer><span>WZ-VALIDIERUNG <b> / </b> FORSCHUNGSPROTOTYP</span><span>Entscheidungen im Kontext verstehen.</span></footer>
    </div>
  )
}
function App() {
  const [user, setUser] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(async response => {
      if (response.ok) setUser((await response.json()).username)
      else if (response.status !== 401) setError('Der Dienst ist nicht erreichbar. Bitte versuchen Sie es erneut.')
    }).catch(() => setError('Der Dienst ist nicht erreichbar. Bitte versuchen Sie es erneut.')).finally(() => setChecking(false))
  }, [])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) })
      if (response.ok) setUser((await response.json()).username)
      else if (response.status === 429) setError('Zu viele Anmeldeversuche. Bitte versuchen Sie es später erneut.')
      else if (response.status === 401) setError('Benutzername oder Passwort ist falsch.')
      else setError('Die Anmeldung ist derzeit nicht möglich. Bitte versuchen Sie es erneut.')
    } catch { setError('Der Dienst ist nicht erreichbar. Bitte versuchen Sie es erneut.') }
    finally { setBusy(false) }
  }

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (response.ok || response.status === 401) { setUser(null); setError('') }
      else setError('Abmelden fehlgeschlagen. Bitte versuchen Sie es erneut.')
    } catch { setError('Abmelden fehlgeschlagen. Bitte versuchen Sie es erneut.') }
  }

  if (checking) return <main><p role="status">Anmeldung wird geprüft …</p></main>
  if (user) return <><Dashboard username={user} logout={logout} />{error && <p role="alert" className="logout-error">{error}</p>}</>
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted px-6 py-12 font-sans text-foreground">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2 text-sm font-medium">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Layers2 aria-hidden="true" className="size-4" /></span>
          WZ-Validierung
        </div>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={1}>Willkommen zurück</CardTitle>
            <CardDescription>Geben Sie Ihre Zugangsdaten ein, um sich anzumelden.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={login}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="username">Benutzername</FieldLabel>
                  <Input id="username" name="username" autoComplete="username" required maxLength={150} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">Passwort</FieldLabel>
                  <Input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
                </Field>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <Button type="submit" disabled={busy}>{busy ? 'Anmeldung läuft …' : 'Anmelden'} <ArrowRight data-icon="inline-end" aria-hidden="true" /></Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">Zugangsdaten erhalten Sie von der Projektleitung.</p>
      </div>
    </div>
  )
}
export default App
