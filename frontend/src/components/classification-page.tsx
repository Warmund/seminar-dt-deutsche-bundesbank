import { useEffect, useState } from 'react'
import { Check, FileText, FlaskConical, Layers, LoaderCircle, Map, Play, Satellite } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const allClasses = Array.from({ length: 21 }, (_, i) => String.fromCharCode(65 + i))
const steps = ['Daten auswählen', 'Quellen zusammenstellen', 'LLM-Klassifizierung', 'Ergebnisse prüfen']
const sourceOptions = [
  { id: 'text', label: 'Quelltexte', description: 'Wikidata, Wikipedia und Website', icon: FileText },
  { id: 'osm', label: 'OpenStreetMap', description: 'Kartenbilder zur räumlichen Einordnung', icon: Map },
  { id: 'satellite', label: 'Satellitenbilder', description: 'Visueller Kontext des Standorts', icon: Satellite },
] as const

export function NewClassificationRun({ onCreated }: { onCreated: (id: string) => void }) {
  const [data, setData] = useState<{ total: number; classes: { category: string; title: string; count: number }[] }>({ total: 0, classes: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [classes, setClasses] = useState(allClasses)
  const [count, setCount] = useState('10')
  const [sources, setSources] = useState({ text: true, osm: true, satellite: true })
  const [method, setMethod] = useState('zero_shot')
  const [promptConfig, setPromptConfig] = useState('Simple')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<{ configured: boolean; model: string } | null>(null)
  const [configError, setConfigError] = useState('')
  const running = saving
  const available = data.classes.filter(item => classes.includes(item.category)).reduce((sum, item) => sum + item.count, 0)
  const amount = Number(count)
  const validSelection = !loading && classes.length > 0 && Number.isInteger(amount) && amount >= 1 && amount <= Math.min(1000, available)
  const phase = validSelection ? 1 : 0

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/classification/dataset', { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(response.status === 401 ? 'Bitte erneut anmelden.' : 'Daten konnten nicht geladen werden.'); return response.json() })
      .then(setData).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/classification/status', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Modellstatus konnte nicht geladen werden.')
      setConfig(await response.json())
    }).catch(e => { if (e.name !== 'AbortError') setConfigError(e.message) })
    return () => { controller.abort() }
  }, [])

  async function start() {
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/classification/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, method, prompt_config: promptConfig, selection: { count: amount, classes }, sources }) })
      const body = await response.json()
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Lauf konnte nicht angelegt werden.')
      onCreated(body.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.') }
    finally { setSaving(false) }
  }

  return <div className="flex flex-col gap-6 p-4 lg:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-col gap-1"><h1 className="text-2xl font-semibold tracking-tight">Neuer Lauf</h1><p className="text-sm text-muted-foreground">Von Unternehmensdaten zur nachvollziehbaren NACE-Einordnung.</p></div><Badge variant="secondary"><FlaskConical data-icon="inline-start" />{config?.model ?? 'OpenAI'}</Badge></div>
    <Alert><FlaskConical /><AlertDescription>Beim Start werden die ausgewählten Texte und Bilder an OpenAI gesendet. Die Referenzklasse wird nicht übermittelt. Auswahl und Quellen werden im Lauf festgehalten. Das Anlegen eines Laufs löst noch keine API-Aufrufe aus.</AlertDescription></Alert>
    {(configError || config && !config.configured) && <Alert variant="destructive"><AlertDescription>{configError || 'Der OpenAI-Key fehlt noch im Backend. Bitte zuerst konfigurieren.'}</AlertDescription></Alert>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{steps.map((label, index) => <div key={label} className={cn('flex items-center gap-3 rounded-xl border p-4', phase > index ? 'border-primary/25 bg-secondary' : 'bg-card')}><span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium', phase > index ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{phase > index ? <Check className="size-4" /> : index + 1}</span><span className="text-sm font-medium">{label}</span></div>)}</div>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="min-w-0"><CardHeader><CardTitle>Datenauswahl festlegen</CardTitle><CardDescription>{data.total} Datenpunkte insgesamt · {available} passen zu den gewählten Klassen</CardDescription></CardHeader><CardContent className="flex flex-col gap-6">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <FieldGroup><Field><FieldLabel htmlFor="dataset-count">Anzahl der Datenpunkte insgesamt</FieldLabel><Input id="dataset-count" className="max-w-48" type="number" min={1} max={Math.min(1000, available)} step={1} value={count} disabled={saving || loading} aria-invalid={!loading && !validSelection} onChange={e => setCount(e.target.value)} /><p className="text-sm text-muted-foreground">Insgesamt über alle gewählten Klassen, maximal {Math.min(1000, available)} Datenpunkte.</p></Field>
        <Field><div className="flex flex-wrap items-center justify-between gap-2"><FieldLabel>NACE-Klassen</FieldLabel><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={saving || loading} onClick={() => setClasses(allClasses)}>Alle wählen</Button><Button size="sm" variant="ghost" disabled={saving || loading} onClick={() => setClasses([])}>Auswahl leeren</Button></div></div>
        {loading ? <p role="status">Klassen werden geladen …</p> : <FieldGroup className="grid gap-3 sm:grid-cols-2">{data.classes.map(item => <Field key={item.category} orientation="horizontal" className="items-start rounded-lg border p-3"><Checkbox id={`class-${item.category}`} disabled={saving || !item.count} checked={classes.includes(item.category)} onCheckedChange={checked => setClasses(previous => checked ? [...previous, item.category] : previous.filter(value => value !== item.category))} /><div className="min-w-0 flex-1"><FieldLabel htmlFor={`class-${item.category}`}>{item.category} · {item.title}</FieldLabel><p className="mt-1 text-xs text-muted-foreground">{item.count} Datenpunkte</p></div></Field>)}</FieldGroup>}</Field></FieldGroup>
        <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">Die Auswahl erfolgt automatisch aus den passenden Klassen in fester OSM-Reihenfolge. Die Anzahl gilt insgesamt, ohne feste Quote je Klasse. Filter und konkrete Datenpunkte werden beim Anlegen im Lauf gespeichert.</div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Durchlauf konfigurieren</CardTitle><CardDescription>Wähle die Quellen für die Klassifizierung.</CardDescription></CardHeader><CardContent className="flex flex-col gap-5">
        <FieldGroup><Field><FieldLabel>Verfahren</FieldLabel><ToggleGroup type="single" variant="outline" value={method} disabled={saving} onValueChange={value => { if (value) { setMethod(value); if (value === 'multi_turn') setSources({ text: true, osm: true, satellite: true }) } }} aria-label="Klassifizierungsverfahren"><ToggleGroupItem value="zero_shot">Zero-Shot</ToggleGroupItem><ToggleGroupItem value="multi_turn">Multi-Turn</ToggleGroupItem></ToggleGroup><p className="text-xs text-muted-foreground">{method === 'multi_turn' ? 'Bis zu fünf getrennte Quellenanalysen, danach Klassifizierung anhand der Hinweise. Alle verfügbaren Quellen werden verwendet.' : 'Ein Aufruf pro Unternehmen mit Name und ausgewählten Quellen.'}</p></Field><Field><FieldLabel>MONETA-Prompt</FieldLabel><ToggleGroup type="single" variant="outline" value={promptConfig} disabled={saving} onValueChange={value => { if (value) setPromptConfig(value) }} aria-label="Promptumfang"><ToggleGroupItem value="Simple">Simple</ToggleGroupItem><ToggleGroupItem value="Extended">Extended</ToggleGroupItem></ToggleGroup><p className="text-xs text-muted-foreground">{promptConfig === 'Extended' ? 'Abschnitte mit Beschreibungen, Einschlüssen und Ausschlüssen.' : 'Abschnittscodes und Titel.'}</p></Field><Field><FieldLabel htmlFor="run-name">Name des Laufs</FieldLabel><Input id="run-name" value={name} maxLength={150} placeholder="z. B. Baseline · alle Quellen" disabled={saving} onChange={e => setName(e.target.value)} /></Field>{sourceOptions.map(({ id, label, description, icon: Icon }) => <Field key={id} orientation="horizontal"><Icon className="size-4 shrink-0 text-muted-foreground" /><div className="flex-1"><FieldLabel htmlFor={`source-${id}`}>{label}</FieldLabel><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><Switch id={`source-${id}`} disabled={running || method === 'multi_turn'} checked={sources[id]} onCheckedChange={checked => setSources(previous => ({ ...previous, [id]: checked }))} /></Field>)}</FieldGroup>
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-4"><div className="flex items-center gap-2 text-sm font-medium"><Layers className="size-4" />NACE-Abschnitte A–U</div><p className="text-xs leading-relaxed text-muted-foreground">Das Modell ordnet die Haupttätigkeit einem NACE-Abschnitt des MONETA-Schemas zu. Bei unzureichenden Belegen ist das Ergebnis UNK.</p></div>
        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Datenpunkte im Lauf</span><span className="font-medium">{validSelection ? amount : 0}</span></div>
        <Button disabled={running || !name.trim() || !validSelection} onClick={start}>{running ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}{running ? 'Wird gespeichert …' : 'Lauf anlegen'}</Button>
        <p className="text-xs text-muted-foreground">Fehlende Bilder werden als nicht verfügbar ausgewiesen. Quelltexte werden auf 6.000 Zeichen je Quelle begrenzt. Ohne verfügbare Quellen wird wie in MONETA nur der Name verwendet. Multi-Turn benötigt bis zu sechs kostenpflichtige Aufrufe je Unternehmen. Ein laufender API-Aufruf wird beim Stoppen noch abgeschlossen.</p>
      </CardContent></Card>
    </div>
  </div>
}
