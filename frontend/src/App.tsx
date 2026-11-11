import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Layers2, ArrowRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { AdminPage } from '@/components/admin-page'
import { MonetaPage } from '@/components/moneta-page'
import { AppSidebar } from '@/components/app-sidebar'
import { Toaster } from '@/components/ui/sonner'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SpeedInsights } from '@vercel/speed-insights/react'
import './App.css' 

function App() {
  const [page, setPage] = useState(() => window.location.hash === '#settings' ? 'settings' : window.location.hash === '#admin' ? 'admin' : 'moneta')
  const [user, setUser] = useState<{ username: string; is_admin: boolean } | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(async response => {
      if (response.ok) setUser(await response.json())
      else if (response.status !== 401) setError('Der Dienst ist nicht erreichbar. Bitte versuchen Sie es erneut.')
    }).catch(() => setError('Der Dienst ist nicht erreichbar. Bitte versuchen Sie es erneut.')).finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    const updatePage = () => setPage(window.location.hash === '#settings' ? 'settings' : window.location.hash === '#admin' ? 'admin' : 'moneta')
    window.addEventListener('hashchange', updatePage)
    return () => window.removeEventListener('hashchange', updatePage)
  }, [])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) })
      if (response.ok) setUser(await response.json())
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
  if (user) return (
    <TooltipProvider>
      <SidebarProvider style={{ '--sidebar-width': 'calc(var(--spacing) * 72)', '--header-height': 'calc(var(--spacing) * 12)' } as React.CSSProperties}>
        <AppSidebar variant="inset" username={user.username} isAdmin={user.is_admin} page={page} onLogout={logout} />
        <SidebarInset>
          <SiteHeader title={page === 'settings' ? 'Einstellungen' : page === 'admin' ? 'Admin-Panel' : 'Moneta'} />
          {page === 'moneta' && <MonetaPage />}
          {page === 'admin' && (user.is_admin ? <AdminPage /> : <p className="p-6">Administratorzugriff erforderlich.</p>)}
          {error && <div className="p-4"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></div>}
        </SidebarInset>
      </SidebarProvider>
      <Toaster />
      <SpeedInsights />
    </TooltipProvider>
  )
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
      <SpeedInsights />
    </div>
  )
}
export default App
