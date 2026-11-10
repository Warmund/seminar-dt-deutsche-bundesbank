import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Layers2, ArrowRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { AppSidebar } from '@/components/app-sidebar'
import { ChartAreaInteractive } from '@/components/chart-area-interactive'
import { DataTable } from '@/components/data-table'
import { SectionCards } from '@/components/section-cards'
import { Toaster } from '@/components/ui/sonner'
import data from '@/app/dashboard/data.json'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import './App.css' 

function App() {
  const [page, setPage] = useState(() => window.location.hash === '#settings' ? 'settings' : window.location.hash === '#moneta' ? 'moneta' : 'dashboard')
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

  useEffect(() => {
    const updatePage = () => setPage(window.location.hash === '#settings' ? 'settings' : window.location.hash === '#moneta' ? 'moneta' : 'dashboard')
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
  if (user) return (
    <TooltipProvider>
      <SidebarProvider style={{ '--sidebar-width': 'calc(var(--spacing) * 72)', '--header-height': 'calc(var(--spacing) * 12)' } as React.CSSProperties}>
        <AppSidebar variant="inset" username={user} page={page} onLogout={logout} />
        <SidebarInset>
          <SiteHeader title={page === 'settings' ? 'Einstellungen' : page === 'moneta' ? 'Moneta' : 'Dashboard · Beispielansicht'} />
          {page === 'dashboard' && <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
            <p className="px-4 text-sm text-muted-foreground lg:px-6">Beispieldaten aus der shadcn-Vorlage. Änderungen werden nicht gespeichert.</p>
            <SectionCards />
            <div className="px-4 lg:px-6"><ChartAreaInteractive /></div>
            <DataTable data={data} />
          </div>}
          {error && <div className="p-4"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></div>}
        </SidebarInset>
      </SidebarProvider>
      <Toaster />
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
    </div>
  )
}
export default App
