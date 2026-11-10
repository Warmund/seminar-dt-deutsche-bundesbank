import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
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
  return <div className="app login-page">
    <header className="topbar"><div className="brand"><span className="brand-mark">WZ</span><div><strong>WZ-Validierung</strong><span>Forschungsprototyp</span></div></div><span className="top-label">MENSCH + KI</span></header>
    <main className="login-main"><section className="login-card" aria-labelledby="login-title">
      <p className="eyebrow"><span /> IHR ARBEITSBEREICH</p><h1 id="login-title">Willkommen zurück<span>.</span></h1>
      <p className="lead">Melden Sie sich an, um mit der Validierung zu beginnen.</p>
      <form onSubmit={login} className="login-form">
        <FieldGroup><Field><FieldLabel htmlFor="username">Benutzername</FieldLabel><Input id="username" name="username" autoComplete="username" required maxLength={150} /></Field>
        <Field><FieldLabel htmlFor="password">Passwort</FieldLabel><Input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} /></Field></FieldGroup>
        {error && <p role="alert" className="login-error">{error}</p>}
        <Button type="submit" size="lg" disabled={busy}>{busy ? 'Anmeldung läuft …' : 'Anmelden'}</Button>
      </form><p className="login-note">Zugangsdaten erhalten Sie von der Projektleitung.</p>
    </section></main><footer><span>WZ-VALIDIERUNG <b> / </b> FORSCHUNGSPROTOTYP</span><span>Entscheidungen im Kontext verstehen.</span></footer>
  </div>
}
export default App
