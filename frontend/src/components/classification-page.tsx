import { useEffect, useState } from 'react'
import { ChevronDown, FileText, LoaderCircle, Map, Play, Satellite } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Switch } from '@/components/ui/switch'

const allClasses = Array.from({ length: 21 }, (_, i) => String.fromCharCode(65 + i))
const sourceOptions = [
  { id: 'text', label: 'Quelltexte', description: 'Wikidata, Wikipedia und Website', icon: FileText },
  { id: 'osm', label: 'OpenStreetMap', description: '', icon: Map },
  { id: 'satellite', label: 'Satellitenbilder', description: '', icon: Satellite },
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
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-col gap-1"><h1 className="text-2xl font-semibold tracking-tight">Neuer Lauf</h1></div><Badge variant="secondary">{config?.model ?? 'OpenAI'}</Badge></div>
    {(configError || config && !config.configured) && <Alert variant="destructive"><AlertDescription>{configError || 'Der OpenAI-Key fehlt noch im Backend. Bitte zuerst konfigurieren.'}</AlertDescription></Alert>}
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="min-w-0"><CardHeader><CardTitle>Datenpunkte</CardTitle><CardDescription>{data.total} verfügbar</CardDescription></CardHeader><CardContent className="flex flex-col gap-6">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <FieldGroup><Field><FieldLabel htmlFor="dataset-count">Anzahl (gesamt)</FieldLabel><Input id="dataset-count" className="max-w-48" type="number" min={1} max={Math.min(1000, available)} step={1} value={count} disabled={saving || loading} aria-invalid={!loading && !validSelection} onChange={e => setCount(e.target.value)} /><p className="text-sm text-muted-foreground">Maximal {Math.min(1000, available)}.</p></Field>
        <Field><FieldLabel htmlFor="dataset-classes">NACE-Klassen</FieldLabel>
          <DropdownMenu><DropdownMenuTrigger asChild><Button id="dataset-classes" variant="outline" className="w-full justify-between sm:max-w-sm" disabled={saving || loading}><span className="truncate">{loading ? 'Klassen werden geladen …' : classes.length === allClasses.length ? 'Alle Klassen' : !classes.length ? 'Klassen auswählen' : classes.length <= 4 ? classes.slice().sort().join(', ') : `${classes.length} Klassen ausgewählt`}</span><ChevronDown data-icon="inline-end" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-[min(28rem,calc(100vw-2rem))] overflow-y-auto">
              <DropdownMenuGroup><DropdownMenuItem onSelect={event => { event.preventDefault(); setClasses(allClasses) }}>Alle Klassen wählen</DropdownMenuItem><DropdownMenuItem onSelect={event => { event.preventDefault(); setClasses([]) }}>Auswahl leeren</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator />
              <DropdownMenuGroup>{data.classes.map(item => <DropdownMenuCheckboxItem key={item.category} checked={classes.includes(item.category)} disabled={!item.count} onSelect={event => event.preventDefault()} onCheckedChange={checked => setClasses(previous => checked ? [...previous, item.category] : previous.filter(value => value !== item.category))}><span className="min-w-0 flex-1 whitespace-normal">{item.category} · {item.title}</span><span className="ml-3 text-xs text-muted-foreground tabular-nums">{item.count}</span></DropdownMenuCheckboxItem>)}</DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu><p className="text-sm text-muted-foreground">{available} Treffer</p>
        </Field></FieldGroup>
        <p className="text-xs text-muted-foreground">Auswahl nach OSM-ID, ohne Klassenquoten.</p>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Konfiguration</CardTitle></CardHeader><CardContent className="flex flex-col gap-5">
        <FieldGroup><Field><FieldLabel>Verfahren</FieldLabel><ToggleGroup type="single" variant="outline" value={method} disabled={saving} onValueChange={value => { if (value) { setMethod(value); if (value === 'multi_turn') setSources({ text: true, osm: true, satellite: true }) } }} aria-label="Klassifizierungsverfahren"><ToggleGroupItem value="zero_shot">Zero-Shot</ToggleGroupItem><ToggleGroupItem value="multi_turn">Multi-Turn</ToggleGroupItem></ToggleGroup><p className="text-xs text-muted-foreground">{method === 'multi_turn' ? 'Alle Quellen · bis zu 6 Aufrufe je Datenpunkt.' : '1 Aufruf je Datenpunkt.'}</p></Field><Field><FieldLabel>MONETA-Prompt</FieldLabel><ToggleGroup type="single" variant="outline" value={promptConfig} disabled={saving} onValueChange={value => { if (value) setPromptConfig(value) }} aria-label="Promptumfang"><ToggleGroupItem value="Simple">Simple</ToggleGroupItem><ToggleGroupItem value="Extended">Extended</ToggleGroupItem></ToggleGroup><p className="text-xs text-muted-foreground">{promptConfig === 'Extended' ? 'Mit Beschreibungen, Ein- und Ausschlüssen.' : 'Codes und Titel.'}</p></Field><Field><FieldLabel htmlFor="run-name">Name</FieldLabel><Input id="run-name" value={name} maxLength={150} placeholder="Laufname" disabled={saving} onChange={e => setName(e.target.value)} /></Field>{sourceOptions.map(({ id, label, description, icon: Icon }) => <Field key={id} orientation="horizontal"><Icon className="size-4 shrink-0 text-muted-foreground" /><div className="flex-1"><FieldLabel htmlFor={`source-${id}`}>{label}</FieldLabel>{description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}</div><Switch id={`source-${id}`} disabled={running || method === 'multi_turn'} checked={sources[id]} onCheckedChange={checked => setSources(previous => ({ ...previous, [id]: checked }))} /></Field>)}</FieldGroup>
        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Datenpunkte</span><span className="font-medium">{validSelection ? amount : 0}</span></div>
        <Button disabled={running || !name.trim() || !validSelection} onClick={start}>{running ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}{running ? 'Wird gespeichert …' : 'Lauf anlegen'}</Button>
        <p className="text-xs text-muted-foreground">Anlegen ist kostenlos. Beim Start werden Quellen an OpenAI übermittelt.</p>
      </CardContent></Card>
    </div>
  </div>
}
