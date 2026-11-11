import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Plus, Play, RefreshCw } from 'lucide-react'
import { NewClassificationRun } from '@/components/classification-page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Clue = { text: string; model: string; input_tokens: number | null; output_tokens: number | null }
type Result = { clue_input_tokens?: number; clue_output_tokens?: number; prediction: { category: string; explanation: string; evidence: string[]; uncertainty: string }; model: string; used_sources: string[]; missing_sources: string[]; input_tokens: number | null; output_tokens: number | null }
type RunItem = { position: number; name: string; osm_type: string; osm_id: string; reference: string; state: string; clues: Record<string, Clue>; result: Result | null; error: string | null; stalled: boolean }
const methodLabel = (value: string) => value === 'multi_turn' ? 'Multi-Turn' : value === 'legacy' ? 'Zero-Shot (frühere Version)' : 'Zero-Shot'
type Run = { method: string; prompt_config: string; id: string; name: string; model: string; created_at: string; sources: Record<string, boolean>; total: number; done: number; errors: number; running: number }
type Detail = Run & { selection: { count?: number; classes?: string[] }; items: RunItem[]; prompt: string; clue_prompts: Record<string, string> }
const navigate = (path = '') => { window.location.hash = `classification${path ? '/' + path : ''}` }
const date = (value: string) => new Date(value).toLocaleString('de-DE')
const stateLabel = (item: RunItem) => ({ pending: 'Offen', running: item.stalled ? 'Unterbrochen · prüfen' : 'In Bearbeitung', done: 'Abgeschlossen', error: 'Fehlgeschlagen' })[item.state] ?? item.state
async function api(path: string, options?: RequestInit) {
  const response = await fetch('/api/classification/runs' + path, options)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : `Anfrage fehlgeschlagen (${response.status})`)
  return body
}

export function ClassificationPage() {
  const [view, setView] = useState(() => window.location.hash.split('/')[1] ?? '')
  const [runs, setRuns] = useState<{ items: Run[]; total: number }>({ items: [], total: 0 })
  const [offset, setOffset] = useState(0)
  const [run, setRun] = useState<Detail | null>(null)
  const [selected, setSelected] = useState<RunItem | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const stop = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    const update = () => { stop.current = true; generation.current++; setBusy(false); setRun(null); setSelected(null); setError(''); setLoading(true); setView(window.location.hash.split('/')[1] ?? '') }
    window.addEventListener('hashchange', update)
    return () => { stop.current = true; window.removeEventListener('hashchange', update) }
  }, [])
  useEffect(() => {
    if (view === 'new') return
    const controller = new AbortController()
    api(view ? '/' + view : `?offset=${offset}`, { signal: controller.signal }).then(body => { if (view) setRun(body); else setRuns(body) }).catch(e => { if (e.name !== 'AbortError') setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [view, offset, revision])
  async function execute(items: RunItem[], retry = false) {
    if (!run) return
    const id = run.id
    const epoch = generation.current
    stop.current = false; setBusy(true); setError('')
    try {
      for (const item of items) {
        if (stop.current || generation.current !== epoch) break
        let current = item
        let retryStep = retry
        do {
          await api(`/${id}/items/${item.position}${retryStep ? '?retry=true' : ''}`, { method: 'POST' })
          retryStep = false
          const updated: Detail = await api('/' + id)
          current = updated.items.find(row => row.position === item.position)!
          if (generation.current === epoch) setRun(updated)
        } while (current.state === 'pending' && !stop.current && generation.current === epoch)
      }
    } catch (e) { if (generation.current === epoch) setError(e instanceof Error ? e.message : 'Verarbeitung fehlgeschlagen.') }
    finally { if (generation.current === epoch) { setBusy(false); setRevision(r => r + 1) } }
  }
  if (view === 'new') return <div><div className="px-4 pt-4 lg:px-6"><Button variant="ghost" onClick={() => navigate()}><ArrowLeft data-icon="inline-start" />Alle Läufe</Button></div><NewClassificationRun onCreated={navigate} /></div>
  const done = run?.items.filter(item => item.state === 'done') ?? []
  const pending = run?.items.filter(item => item.state === 'pending') ?? []
  const running = run?.items.some(item => item.state === 'running' && !item.stalled)
  return <div className="flex flex-col gap-6 p-4 lg:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">{view ? run?.name ?? 'Lauf laden …' : 'Klassifizierung'}</h1></div><div className="flex gap-2">{view && <Button variant="outline" onClick={() => navigate()}><ArrowLeft data-icon="inline-start" />Alle Läufe</Button>}<Button onClick={() => navigate('new')}><Plus data-icon="inline-start" />Neuer Lauf</Button></div></div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {loading ? <p role="status">Läufe werden geladen …</p> : !view ? <Card><CardHeader><CardTitle>Meine Läufe</CardTitle><CardDescription>{runs.total} Läufe</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Lauf</TableHead><TableHead>Verfahren / Modell</TableHead><TableHead>Fortschritt</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{runs.items.map(item => <TableRow key={item.id}><TableCell><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{date(item.created_at)}</p></TableCell><TableCell><p>{methodLabel(item.method)} · {item.prompt_config}</p><p className="text-xs text-muted-foreground">{item.model}</p></TableCell><TableCell>{item.done} / {item.total}</TableCell><TableCell><Badge variant="secondary">{item.done === item.total ? 'Abgeschlossen' : item.running ? 'In Bearbeitung / unterbrochen' : item.errors ? 'Mit Fehlern' : item.done ? 'Teilweise abgeschlossen' : 'Bereit'}</Badge></TableCell><TableCell><Button variant="outline" size="sm" onClick={() => navigate(item.id)}>Öffnen</Button></TableCell></TableRow>)}{!runs.items.length && <TableRow><TableCell colSpan={5}>Noch keine Läufe.</TableCell></TableRow>}</TableBody></Table><div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={!offset} onClick={() => { setLoading(true); setOffset(o => o - 25) }}>Zurück</Button><Button variant="outline" disabled={offset + 25 >= runs.total} onClick={() => { setLoading(true); setOffset(o => o + 25) }}>Weiter</Button></div></CardContent></Card> : run && <>
      <div className="grid gap-4 sm:grid-cols-3">{[{ label: 'Unternehmen', value: run.items.length }, { label: 'Abgeschlossen', value: done.length }, { label: 'Übereinstimmung mit Referenz', value: done.length ? `${Math.round(done.filter(item => item.result?.prediction.category === item.reference).length / done.length * 100)} %` : '–' }].map(stat => <Card key={stat.label}><CardHeader><CardDescription>{stat.label}</CardDescription><CardTitle>{stat.value}</CardTitle></CardHeader></Card>)}</div>
      <Card><CardHeader><CardTitle>Konfiguration</CardTitle><CardDescription>{run.model} · {methodLabel(run.method)} · {run.prompt_config} · NACE A–U · Erstellt {date(run.created_at)}</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">{run.selection.count && <p className="text-sm text-muted-foreground">Datenauswahl: {run.selection.count} insgesamt · Klassen {run.selection.classes?.join(', ')}</p>}<div className="flex flex-wrap gap-2">{Object.entries(run.sources).filter(([, enabled]) => enabled).map(([source]) => <Badge key={source} variant="secondary">{{ text: run.method === 'legacy' ? 'Texte & OSM-Tags' : 'Quelltexte', osm: 'OSM-Karte', satellite: 'Satellitenbild' }[source] ?? source}</Badge>)}</div><details><summary className="cursor-pointer text-sm text-muted-foreground">Prompt</summary><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-xs">{run.prompt}</pre></details>{run.method === 'multi_turn' && <details><summary className="cursor-pointer text-sm text-muted-foreground">Hinweis-Prompts</summary>{Object.entries(run.clue_prompts).map(([kind, prompt]) => <div key={kind} className="mt-3"><h3 className="text-sm font-medium">{kind}</h3><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{prompt}</pre></div>)}</details>}<p className="text-sm text-muted-foreground">API-Aufrufe sind kostenpflichtig. Bei Seitenwechsel stoppt der Lauf nach der aktuellen Anfrage. Ergebnisse bleiben gespeichert.</p><div className="flex flex-wrap gap-2"><Button disabled={busy || running || !pending.length} onClick={() => execute(pending)}><Play data-icon="inline-start" />{busy ? 'Wird verarbeitet …' : done.length ? 'Kostenpflichtig fortsetzen' : 'Kostenpflichtig starten'}</Button>{busy && <Button variant="outline" onClick={() => { stop.current = true }}>Nach aktueller Anfrage stoppen</Button>}<Button variant="outline" disabled={busy} onClick={() => setRevision(r => r + 1)}><RefreshCw data-icon="inline-start" />Aktualisieren</Button></div></CardContent></Card>
      <Card><CardHeader><CardTitle>Ergebnisse</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Unternehmen</TableHead><TableHead>Vorhersage</TableHead><TableHead>Referenz</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{run.items.map(item => <TableRow key={item.position}><TableCell>{item.name}</TableCell><TableCell>{item.result?.prediction.category ?? '–'}</TableCell><TableCell>{item.reference}</TableCell><TableCell><Badge variant="outline">{stateLabel(item)}</Badge>{run.method === 'multi_turn' && <p className="mt-1 text-xs text-muted-foreground">{Object.keys(item.clues).length} Hinweise</p>}</TableCell><TableCell><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setSelected(item)}>Details</Button>{(item.state === 'error' || item.stalled) && <Button variant="outline" size="sm" disabled={busy || running} onClick={() => { if (window.confirm('Erneut kostenpflichtig anfragen? Bei unterbrochenen Anfragen kann bereits ein API-Aufruf berechnet worden sein.')) execute([item], true) }}>Erneut versuchen</Button>}</div></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
    </>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null) }}><DialogContent className="max-h-[85dvh] overflow-auto"><DialogHeader><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>{selected && stateLabel(selected)}</DialogDescription></DialogHeader>{selected?.result ? <div className="flex flex-col gap-4"><p>Vorhersage: <strong>{selected.result.prediction.category}</strong> · Referenz: {selected.reference}</p><p className="text-sm">{selected.result.prediction.explanation}</p><ul className="list-disc pl-5 text-sm">{selected.result.prediction.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul><p className="text-sm text-muted-foreground">Unsicherheit: {selected.result.prediction.uncertainty || 'Keine Angabe'}</p><p className="text-xs text-muted-foreground">{selected.result.model} · Schlussklassifizierung · Tokens: {selected.result.input_tokens ?? '–'} Eingabe / {selected.result.output_tokens ?? '–'} Ausgabe</p>{selected.result.clue_input_tokens !== undefined && <p className="text-xs text-muted-foreground">Hinweisanalysen · Tokens: {selected.result.clue_input_tokens} Eingabe / {selected.result.clue_output_tokens} Ausgabe</p>}<p className="text-sm">Übermittelt: {selected.result.used_sources.join(', ') || '–'} · Fehlend: {selected.result.missing_sources.join(', ') || '–'}</p></div> : <p className="text-sm">{selected?.error ?? 'Noch kein Ergebnis vorhanden.'}</p>}{selected && Object.keys(selected.clues).length > 0 && <div className="flex flex-col gap-3"><h3 className="font-medium">Extrahierte Hinweise</h3>{Object.entries(selected.clues).map(([kind, clue]) => <details key={kind}><summary className="cursor-pointer text-sm font-medium">{kind}</summary><p className="mt-2 whitespace-pre-wrap text-sm">{clue.text}</p><p className="mt-2 text-xs text-muted-foreground">{clue.model} · Tokens: {clue.input_tokens ?? '–'} / {clue.output_tokens ?? '–'}</p></details>)}</div>}</DialogContent></Dialog>
  </div>
}
