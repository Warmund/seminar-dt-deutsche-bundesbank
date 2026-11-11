import { Moon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

export function SettingsPage() {
  const { resolvedTheme, setTheme } = useTheme()
  return <div className="p-4 lg:p-6"><Card className="max-w-xl">
    <CardHeader><CardTitle>Darstellung</CardTitle><CardDescription>Wähle das Erscheinungsbild der Anwendung.</CardDescription></CardHeader>
    <CardContent><div className="flex items-center justify-between gap-4 rounded-lg border p-4">
      <div className="flex items-center gap-3"><Moon className="size-5 text-muted-foreground" aria-hidden="true" /><div><label htmlFor="dark-mode" className="text-sm font-medium">Dark Mode</label><p className="text-sm text-muted-foreground">Dunkles Erscheinungsbild verwenden</p></div></div>
      <Switch id="dark-mode" checked={resolvedTheme === 'dark'} onCheckedChange={checked => setTheme(checked ? 'dark' : 'light')} />
    </div></CardContent>
  </Card></div>
}
