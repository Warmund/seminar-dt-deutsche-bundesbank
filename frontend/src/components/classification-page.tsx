import { useEffect, useState } from 'react'
import { ArrowRight, Check, FileText, FlaskConical, Layers, LoaderCircle, Map, Play, Satellite, ScanLine } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

type RecordItem = { osm_type: string; osm_id: string; name: string; category: string; osm: boolean; satellite: boolean }
const key = (item: RecordItem) => `${item.osm_type}_${item.osm_id}`
const steps = ['Daten auswählen', 'Quellen zusammenstellen', 'LLM-Klassifizierung', 'Ergebnisse prüfen']
const sourceOptions = [
  { id: 'text', label: 'Texte & OSM-Tags', description: 'Angereicherte Inhalte und Unternehmensmerkmale', icon: FileText },
  { id: 'osm', label: 'OpenStreetMap', description: 'Kartenbilder zur räumlichen Einordnung', icon: Map },
  { id: 'satellite', label: 'Satellitenbilder', description: 'Visueller Kontext des Standorts', icon: Satellite },
] as const

export function ClassificationPage() {
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<{ total: number; items: RecordItem[] }>({ total: 0, items: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<RecordItem[]>([])
  const [sources, setSources] = useState({ text: true, osm: true, satellite: true })
  const [phase, setPhase] = useState(0)
  const [run, setRun] = useState<{ items: RecordItem[]; sources: typeof sources } | null>(null)
  const [detail, setDetail] = useState<RecordItem | null>(null)
  const running = phase > 0 && phase < 4

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/moneta/records?q=${encodeURIComponent(q)}&offset=${offset}&limit=10`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(response.status === 401 ? 'Bitte erneut anmelden.' : 'Daten konnten nicht geladen werden.'); return response.json() })
      .then(setData).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [q, offset])

  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => setPhase(p => p + 1), 1000)
    return () => window.clearTimeout(timer)
  }, [phase, running])

  function toggle(item: RecordItem) {
    setSelected(previous => previous.some(row => key(row) === key(item)) ? previous.filter(row => key(row) !== key(item)) : [...previous, item])
  }

  return <div className="flex flex-col gap-6 p-4 lg:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-col gap-1"><h1 className="text-2xl font-semibold tracking-tight">Klassifizierung</h1><p className="text-sm text-muted-foreground">Von Unternehmensdaten zur nachvollziehbaren NACE-Einordnung.</p></div><Badge variant="secondary"><FlaskConical data-icon="inline-start" />Interaktive Vorschau</Badge></div>
    <Alert><FlaskConical /><AlertDescription>Demo-Modus: Der Ablauf wird simuliert. Es werden keine LLM-Anfragen gesendet oder Klassifizierungen gespeichert. Angezeigte NACE-Abschnitte stammen aus dem importierten Referenzdatensatz.</AlertDescription></Alert>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{steps.map((label, index) => <div key={label} className={cn('flex items-center gap-3 rounded-xl border p-4', phase > index ? 'border-primary/25 bg-secondary' : 'bg-card')}><span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium', phase > index ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{phase > index ? <Check className="size-4" /> : index + 1}</span><span className="text-sm font-medium">{label}</span></div>)}</div>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="min-w-0"><CardHeader><CardTitle>Unternehmen auswählen</CardTitle><CardDescription>{data.total} Datenpunkte verfügbar · {selected.length} ausgewählt</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
        <Input aria-label="Unternehmen suchen" placeholder="Nach Name, OSM-ID oder NACE suchen …" value={q} disabled={running} onChange={e => { if (e.target.value !== q) { setLoading(true); setError(''); setQ(e.target.value); setOffset(0) } }} />
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Table><TableHeader><TableRow><TableHead><Checkbox aria-label="Alle Unternehmen dieser Seite auswählen" disabled={loading || running || !data.items.length} checked={data.items.length > 0 && data.items.every(item => selected.some(row => key(row) === key(item))) ? true : data.items.some(item => selected.some(row => key(row) === key(item))) ? 'indeterminate' : false} onCheckedChange={checked => setSelected(previous => checked ? [...previous.filter(row => !data.items.some(item => key(item) === key(row))), ...data.items] : previous.filter(row => !data.items.some(item => key(item) === key(row))))} /></TableHead><TableHead>Unternehmen</TableHead><TableHead>Bildquellen</TableHead></TableRow></TableHeader><TableBody>
          {loading ? <TableRow><TableCell colSpan={3}>Daten werden geladen …</TableCell></TableRow> : !data.items.length ? <TableRow><TableCell colSpan={3}>Keine Datenpunkte gefunden. Importiere Daten auf der Moneta-Seite.</TableCell></TableRow> : data.items.map(item => <TableRow key={key(item)} data-state={selected.some(row => key(row) === key(item)) ? 'selected' : undefined}><TableCell><Checkbox disabled={running} aria-label={`${item.name} auswählen`} checked={selected.some(row => key(row) === key(item))} onCheckedChange={() => toggle(item)} /></TableCell><TableCell><div className="font-medium">{item.name}</div><div className="text-xs text-muted-foreground">{key(item)}</div></TableCell><TableCell><div className="flex gap-2"><Badge variant={item.osm ? 'secondary' : 'outline'}>Karte {item.osm ? '✓' : 'fehlt'}</Badge><Badge variant={item.satellite ? 'secondary' : 'outline'}>Satellit {item.satellite ? '✓' : 'fehlt'}</Badge></div></TableCell></TableRow>)}
        </TableBody></Table>
        <div className="flex flex-wrap items-center justify-between gap-3"><Button size="sm" variant="ghost" disabled={!selected.length || running} onClick={() => setSelected([])}>Auswahl aufheben</Button><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={!offset || loading || running} onClick={() => { setLoading(true); setError(''); setOffset(o => o - 10) }}>Zurück</Button><span className="text-xs text-muted-foreground">{Math.floor(offset / 10) + 1} / {Math.max(1, Math.ceil(data.total / 10))}</span><Button variant="outline" size="sm" disabled={offset + 10 >= data.total || loading || running} onClick={() => { setLoading(true); setError(''); setOffset(o => o + 10) }}>Weiter</Button></div></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Durchlauf konfigurieren</CardTitle><CardDescription>Wähle die Quellen für die Vorschau.</CardDescription></CardHeader><CardContent className="flex flex-col gap-5">
        <FieldGroup>{sourceOptions.map(({ id, label, description, icon: Icon }) => <Field key={id} orientation="horizontal"><Icon className="size-4 shrink-0 text-muted-foreground" /><div className="flex-1"><FieldLabel htmlFor={`source-${id}`}>{label}</FieldLabel><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><Switch id={`source-${id}`} disabled={running} checked={sources[id]} onCheckedChange={checked => setSources(previous => ({ ...previous, [id]: checked }))} /></Field>)}</FieldGroup>
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-4"><div className="flex items-center gap-2 text-sm font-medium"><Layers className="size-4" />NACE-Abschnitte A–U</div><p className="text-xs leading-relaxed text-muted-foreground">Die Vorschau verwendet die Granularität des MONETA-Datensatzes. Eine detaillierte WZ-Klassifizierung folgt mit der Modellanbindung.</p></div>
        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Ausgewählte Unternehmen</span><span className="font-medium">{selected.length}</span></div>
        <Button disabled={running || !selected.length || !Object.values(sources).some(Boolean)} onClick={() => { setRun({ items: [...selected], sources: { ...sources } }); setPhase(1) }}>{running ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}{running ? 'Demo läuft …' : 'Demo-Durchlauf starten'}</Button>
        {running && <Button variant="outline" onClick={() => { setPhase(0); setRun(null) }}>Abbrechen</Button>}
        <p className="text-xs text-muted-foreground">Fehlende Bilder werden als nicht verfügbar ausgewiesen. Texte und Bilder werden in der Demo nicht ausgewertet.</p>
      </CardContent></Card>
    </div>
    <Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>Ergebnisse</CardTitle><Badge variant="outline">{phase === 4 ? 'Demo abgeschlossen' : running ? 'Simulation läuft' : 'Noch kein Durchlauf'}</Badge></div><CardDescription>Referenzdaten und Quellenstatus für den ausgewählten Durchlauf.</CardDescription></CardHeader><CardContent>
      {running ? <div className="flex items-center gap-3 py-10 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-5 animate-spin" />{['', 'Quellen werden zusammengestellt …', 'Modellschritt wird simuliert …', 'Ergebnisansicht wird vorbereitet …'][phase]}</div> : phase === 4 && run ? <Table><TableHeader><TableRow><TableHead>Unternehmen</TableHead><TableHead>NACE-Referenz</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Ergebnis öffnen</span></TableHead></TableRow></TableHeader><TableBody>{run.items.map(item => <TableRow key={key(item)}><TableCell className="font-medium">{item.name}</TableCell><TableCell><Badge variant="secondary">{item.category}</Badge></TableCell><TableCell><span className="text-sm text-muted-foreground">Simulation · keine Vorhersage</span></TableCell><TableCell><Button size="sm" variant="ghost" onClick={() => setDetail(item)}>Ansehen<ArrowRight data-icon="inline-end" /></Button></TableCell></TableRow>)}</TableBody></Table> : <div className="flex flex-col items-center gap-3 py-12 text-center"><div className="flex size-12 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><ScanLine className="size-6" /></div><p className="font-medium">Bereit für den ersten Durchlauf</p><p className="max-w-md text-sm text-muted-foreground">Wähle Unternehmen und Quellen aus. Hier erscheinen anschließend die Ergebnisse der Vorschau.</p></div>}
    </CardContent></Card>
    <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null) }}><DialogContent><DialogHeader><DialogTitle>{detail?.name}</DialogTitle><DialogDescription>Demo-Ergebnis · {detail && key(detail)}</DialogDescription></DialogHeader>{detail && run && <div className="flex flex-col gap-4"><div className="flex items-center justify-between rounded-lg bg-secondary p-4"><span className="text-sm">Importierter NACE-Abschnitt</span><Badge>{detail.category}</Badge></div><p className="text-sm text-muted-foreground">Dieser Abschnitt ist die Referenz aus dem Datensatz. Modellvorhersage, Konfidenz und Begründung werden nach der LLM-Anbindung hier angezeigt.</p><div className="flex flex-col gap-3">{sourceOptions.map(({ id, label }) => <div key={id} className="flex justify-between gap-3 text-sm"><span>{label}</span><span className="text-muted-foreground">{!run.sources[id] ? 'Nicht ausgewählt' : id === 'text' ? 'Ausgewählt · Inhalt ungeprüft' : detail[id] ? 'Bild vorhanden' : 'Bild fehlt'}</span></div>)}</div></div>}</DialogContent></Dialog>
  </div>
}
