import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronDown, FileText, LoaderCircle, Map, Plus, Satellite } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

const allClasses = Array.from({ length: 21 }, (_, i) => String.fromCharCode(65 + i))
const sourceOptions = [
  { id: 'text', label: 'Quelltexte', description: 'Wikidata, Wikipedia und Website', icon: FileText },
  { id: 'osm', label: 'OpenStreetMap', description: '', icon: Map },
  { id: 'satellite', label: 'Satellitenbilder', description: '', icon: Satellite },
] as const

export function NewClassificationRun({ onCreated, onBack }: { onCreated: (id: string) => void; onBack: () => void }) {
  const [data, setData] = useState<{ total: number; classes: { category: string; title: string; count: number }[] }>({ total: 0, classes: [] })
  const [datasets,setDatasets]=useState<{id:number;name:string;total:number}[]>([])
  const [datasetId,setDatasetId]=useState('1')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [classes, setClasses] = useState(allClasses)
  const [count, setCount] = useState('10')
  const [sources, setSources] = useState({ text: true, osm: true, satellite: true })
  const [model, setModel] = useState('gpt-6-luna')
  const [method, setMethod] = useState('zero_shot')
  const [promptConfig, setPromptConfig] = useState('Simple')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<{ configured: boolean; model: string; opencode_configured: boolean; vercel_configured: boolean; uni_mainz_configured: boolean; uni_mainz_models: {id: string; name: string}[]; uni_mainz_error: string | null; jev_model: string } | null>(null)
  const [configError, setConfigError] = useState('')
  const running = saving
  const available = data.classes.filter(item => classes.includes(item.category)).reduce((sum, item) => sum + item.count, 0)
  const amount = Number(count)
  const validSelection = !loading && classes.length > 0 && Number.isInteger(amount) && amount >= 1 && amount <= Math.min(1000, available)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setData({total:0,classes:[]})
    fetch(`/api/classification/dataset?dataset_id=${datasetId}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(response.status === 401 ? 'Bitte erneut anmelden.' : 'Daten konnten nicht geladen werden.'); return response.json() })
      .then(setData).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [datasetId])

  useEffect(()=>{fetch('/api/moneta/datasets').then(async response=>{if(!response.ok)throw new Error('Datensätze konnten nicht geladen werden.');return response.json()}).then(value=>setDatasets(value.items)).catch(e=>setError(e.message))},[])

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
      const response = await fetch('/api/classification/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset_id:Number(datasetId), name, model, method, prompt_config: promptConfig, selection: { count: amount, classes }, sources }) })
      const body = await response.json()
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Lauf konnte nicht angelegt werden.')
      onCreated(body.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.') }
    finally { setSaving(false) }
  }

  const isJev = model.startsWith('jev-')
  const isDecider = model === 'perplexity/pplx-decider-v1.2'
  const isMainz = model.startsWith('uni-mainz/')
  const isDecision = isJev || isDecider
  const providerReady = isJev ? config?.opencode_configured : isDecider ? config?.vercel_configured : isMainz ? config?.uni_mainz_configured : config?.configured
  const modelName = isMainz ? config?.uni_mainz_models?.find(item => item.id === model)?.name ?? model.slice('uni-mainz/'.length) + ' (UNI-MAINZ)' : isDecider ? 'Perplexity Decider V1.2' : isJev ? model.endsWith('-free') ? 'Jev 1.13 Free' : 'Jev 1.13' : model === 'gpt-5-mini' ? 'GPT-5 Mini' : model === 'gpt-6.1-terra' ? 'GPT-6.1 Terra' : 'GPT-6 Luna'
  const classLabel = classes.length === 21 ? 'Alle Klassen' : !classes.length ? 'Keine Klassen' : classes.length <= 4 ? classes.slice().sort().join(', ') : `${classes.length} Klassen`
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 lg:p-8">
    <div className="flex items-center gap-3"><Button size="icon" variant="outline" aria-label="Zur Laufübersicht" onClick={onBack}><ArrowLeft /></Button><h1 className="text-xl font-semibold tracking-tight">Neuer Lauf</h1></div>
    {(error || configError || config && !providerReady) && <Alert variant="destructive"><AlertDescription>{error || configError || (isJev ? 'OpenCode-Key fehlt im Backend.' : isDecider ? 'Vercel-AI-Gateway-Key fehlt im Backend.' : isMainz ? 'Uni-Mainz-Key fehlt im Backend.' : 'OpenAI-Key fehlt im Backend.')}</AlertDescription></Alert>}
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <Card className="gap-0 overflow-hidden shadow-none">
        <CardHeader className="pb-6"><CardTitle>Lauf konfigurieren</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-7">
          <FieldGroup className="grid gap-5 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="run-name">Name</FieldLabel><Input id="run-name" value={name} maxLength={150} placeholder="z. B. Baseline 01" disabled={saving} onChange={e => setName(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="run-model">Modell</FieldLabel><Select value={model} onValueChange={value => { setModel(value); if (value.startsWith('jev-') || value === 'perplexity/pplx-decider-v1.2') setMethod('zero_shot') }} disabled={saving}><SelectTrigger id="run-model" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{config?.uni_mainz_models?.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}{config && !config.uni_mainz_models?.length && <SelectItem value="uni-mainz-unavailable" disabled>UNI-MAINZ · nicht verfügbar</SelectItem>}<SelectItem value="perplexity/pplx-decider-v1.2">Perplexity Decider V1.2 · Vercel</SelectItem><SelectItem value="gpt-5-mini">GPT-5 Mini</SelectItem><SelectItem value="gpt-6-luna">GPT-6 Luna</SelectItem><SelectItem value="gpt-6.1-terra">GPT-6.1 Terra</SelectItem><SelectItem value={config?.jev_model === 'jev-1.13-free' ? 'jev-1.13-free' : 'jev-1.13'}>{config?.jev_model === 'jev-1.13-free' ? 'Jev 1.13 Free' : 'Jev 1.13'} · OpenCode</SelectItem></SelectGroup></SelectContent></Select>{config?.uni_mainz_error && <p className="text-xs text-muted-foreground">{config.uni_mainz_error}</p>}</Field>
          </FieldGroup>
          <Separator />
          <section className="flex flex-col gap-4" aria-labelledby="dataset-heading"><div className="flex items-center justify-between gap-3"><h2 id="dataset-heading" className="text-sm font-semibold">Datenauswahl</h2><span className="text-xs text-muted-foreground">{loading ? 'Lädt …' : `${available} Treffer`}</span></div>
            <Field><FieldLabel htmlFor="run-dataset">Datensatz</FieldLabel><Select value={datasetId} disabled={saving} onValueChange={setDatasetId}><SelectTrigger id="run-dataset"><SelectValue/></SelectTrigger><SelectContent><SelectGroup>{datasets.map(dataset=><SelectItem key={dataset.id} value={String(dataset.id)}>{dataset.name} · {dataset.total} Datenpunkte</SelectItem>)}</SelectGroup></SelectContent></Select></Field><FieldGroup className="grid gap-5 sm:grid-cols-[140px_minmax(0,1fr)]"><Field><FieldLabel htmlFor="dataset-count">Anzahl gesamt</FieldLabel><Input id="dataset-count" type="number" min={1} max={Math.min(1000, available)} step={1} value={count} disabled={saving || loading} aria-invalid={!loading && !validSelection} onChange={e => setCount(e.target.value)} /><p className="text-xs text-muted-foreground">Max. {Math.min(1000, available)}</p></Field>
              <Field><FieldLabel htmlFor="dataset-classes">NACE-Klassen</FieldLabel>
          <DropdownMenu><DropdownMenuTrigger asChild><Button id="dataset-classes" variant="outline" className="w-full justify-between" disabled={saving || loading}><span className="truncate">{loading ? 'Klassen werden geladen …' : classes.length === allClasses.length ? 'Alle Klassen' : !classes.length ? 'Klassen auswählen' : classes.length <= 4 ? classes.slice().sort().join(', ') : `${classes.length} Klassen ausgewählt`}</span><ChevronDown data-icon="inline-end" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-[min(28rem,calc(100vw-2rem))] overflow-y-auto">
              <DropdownMenuGroup><DropdownMenuItem onSelect={event => { event.preventDefault(); setClasses(allClasses) }}>Alle Klassen wählen</DropdownMenuItem><DropdownMenuItem onSelect={event => { event.preventDefault(); setClasses([]) }}>Auswahl leeren</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator />
              <DropdownMenuGroup>{data.classes.map(item => <DropdownMenuCheckboxItem key={item.category} checked={classes.includes(item.category)} disabled={!item.count} onSelect={event => event.preventDefault()} onCheckedChange={checked => setClasses(previous => checked ? [...previous, item.category] : previous.filter(value => value !== item.category))}><span className="min-w-0 flex-1 whitespace-normal">{item.category} · {item.title}</span><span className="ml-3 text-xs text-muted-foreground tabular-nums">{item.count}</span></DropdownMenuCheckboxItem>)}</DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
              </Field></FieldGroup><p className="text-xs text-muted-foreground">Auswahl nach OSM-ID, ohne Klassenquoten.</p>
          </section>
          <Separator />
          <FieldGroup className="grid gap-5 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="run-method">Verfahren</FieldLabel><Select value={method} disabled={saving} onValueChange={value => { setMethod(value); if (value === 'multi_turn') setSources({ text:true, osm:true, satellite:true }) }}><SelectTrigger id="run-method" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="zero_shot">Zero-Shot</SelectItem><SelectItem value="multi_turn" disabled={isDecision}>Multi-Turn</SelectItem></SelectGroup></SelectContent></Select><p className="text-xs text-muted-foreground">{isDecision ? 'Klassenentscheidung mit Wahrscheinlichkeiten. Keine Textbegründung.' : method === 'multi_turn' ? 'Hinweise je Quelle, dann Klassifizierung.' : 'Direkte Klassifizierung aus den Quellen.'}</p></Field>
            <Field><FieldLabel htmlFor="run-prompt">Prompt</FieldLabel><Select value={promptConfig} onValueChange={setPromptConfig} disabled={saving}><SelectTrigger id="run-prompt" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="Simple">Simple</SelectItem><SelectItem value="Extended">Extended</SelectItem></SelectGroup></SelectContent></Select><p className="text-xs text-muted-foreground">{promptConfig === 'Extended' ? 'Mit Beschreibungen, Ein- und Ausschlüssen.' : 'NACE-Codes und Titel.'}</p></Field>
          </FieldGroup>
          <Separator />
          <section className="flex flex-col gap-4" aria-labelledby="sources-heading"><div className="flex items-center justify-between gap-3"><h2 id="sources-heading" className="text-sm font-semibold">Quellen</h2>{isJev && <span className="text-xs text-muted-foreground">Jev: Bilder experimentell</span>}{method === 'multi_turn' && <span className="text-xs text-muted-foreground">Multi-Turn: alle verfügbaren</span>}</div><FieldGroup className="gap-0 divide-y">{sourceOptions.map(({ id, label, description, icon: Icon }) => <Field key={id} orientation="horizontal" className="py-3 first:pt-0 last:pb-0"><Icon className="size-4 shrink-0 text-muted-foreground" /><div className="flex-1"><FieldLabel htmlFor={`source-${id}`}>{label}</FieldLabel>{description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}</div><Switch id={`source-${id}`} disabled={running || method === 'multi_turn'} checked={sources[id]} onCheckedChange={checked => setSources(previous => ({ ...previous, [id]:checked }))} /></Field>)}</FieldGroup></section>
        </CardContent>
      </Card>
      <Card className="gap-5 shadow-none lg:sticky lg:top-6"><CardHeader><CardTitle>Zusammenfassung</CardTitle><CardDescription className="truncate">{name.trim() || 'Neuer Lauf'}</CardDescription></CardHeader><CardContent className="flex flex-col gap-5"><div><span className="text-4xl font-semibold tracking-tight tabular-nums">{validSelection ? amount : '–'}</span><p className="mt-1 text-sm text-muted-foreground">Datenpunkte</p></div><Separator /><dl className="flex flex-col gap-3 text-sm">{[['Datensatz',datasets.find(dataset=>String(dataset.id)===datasetId)?.name??'–'],['Modell',modelName],['Verfahren',method === 'multi_turn' ? 'Multi-Turn' : 'Zero-Shot'],['Prompt',promptConfig],['Klassen',classLabel],['Modellaufrufe',validSelection ? method === 'multi_turn' ? `max. ${amount * 6}` : String(amount) : '–']].map(([label,value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right">{value}</dd></div>)}</dl><Separator /><Button className="w-full" disabled={saving || !name.trim() || !validSelection} onClick={start}>{saving ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Plus data-icon="inline-start" />}{saving ? 'Wird angelegt …' : 'Lauf anlegen'}</Button><p className="text-xs leading-relaxed text-muted-foreground">Anlegen ist kostenlos. API-Kosten entstehen beim Start.</p>{model === 'gpt-5-mini' && <p className="text-xs text-muted-foreground">OpenAI stellt GPT-5 Mini am 11.12.2026 ein.</p>}</CardContent></Card>
    </div>
  </div>
}
