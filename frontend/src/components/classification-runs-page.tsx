import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, ChevronRight, FolderOpen, LoaderCircle, Plus, Play, RefreshCw, Trash2 } from 'lucide-react'
import { NewClassificationRun } from '@/components/classification-page'
import { estimateRunCost, formatCost } from '@/lib/classification-cost'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Clue = { text: string; model: string; input_tokens: number | null; output_tokens: number | null }
type Result = { confidence?: number; probabilities?: Record<string, number>; clue_input_tokens?: number; clue_output_tokens?: number; prediction: { category: string; explanation: string; evidence: string[]; uncertainty: string }; model: string; used_sources: string[]; missing_sources: string[]; input_tokens: number | null; output_tokens: number | null }
type RunItem = { position: number; name: string; osm_type: string; osm_id: string; reference: string; state: string; clues: Record<string, Clue>; result: Result | null; error: string | null; stalled: boolean }
const methodLabel = (value: string) => value === 'multi_turn' ? 'Multi-Turn' : value === 'legacy' ? 'Zero-Shot (frühere Version)' : 'Zero-Shot'
type Run = { method: string; prompt_config: string; id: string; name: string; model: string; created_at: string; sources: Record<string, boolean>; total: number; done: number; errors: number; running: number }
const modelLabel = (value: string) => value.startsWith('uni-mainz/') ? value.slice('uni-mainz/'.length) + ' (UNI-MAINZ)' : value === 'perplexity/pplx-decider-v1.2' ? 'Perplexity Decider V1.2' : value.startsWith('jev-') ? `Jev ${value.slice(4)}` : value === 'gpt-5-mini' ? 'GPT-5 Mini' : value === 'gpt-6.1-terra' ? 'GPT-6.1 Terra' : value === 'gpt-6-luna' ? 'GPT-6 Luna' : value
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
  const [retryTarget, setRetryTarget] = useState<RunItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Run | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const stop = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    const update = () => { stop.current = true; generation.current++; setBusy(false); setRun(null); setSelected(null); setRetryTarget(null); setError(''); setLoading(true); setView(window.location.hash.split('/')[1] ?? '') }
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
  async function deleteRun() {
    if (!deleteTarget || deleting) return
    setDeleting(true); setDeleteError('')
    try {
      await api('/' + deleteTarget.id, { method: 'DELETE' })
      setDeleteTarget(null)
      if (offset > 0 && runs.items.length === 1) setOffset(value => value - 25)
      else setRevision(value => value + 1)
    } catch (e) { setDeleteError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.') }
    finally { setDeleting(false) }
  }
  if (view === 'new') return <NewClassificationRun onCreated={navigate} onBack={() => navigate()} />
  const done = run?.items.filter(item => item.state === 'done') ?? []
  const pending = run?.items.filter(item => item.state === 'pending') ?? []
  const running = run?.items.some(item => item.state === 'running' && !item.stalled)
  const cost = run ? estimateRunCost(run.model, run.items) : null
  return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 lg:p-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3">{view && <Button variant="outline" size="icon" aria-label="Zur Laufübersicht" onClick={() => navigate()}><ArrowLeft /></Button>}<div><h1 className="text-xl font-semibold tracking-tight">{view ? run?.name ?? 'Lauf laden …' : 'Läufe'}</h1><p className="mt-1 text-xs text-muted-foreground">{view && run ? `${methodLabel(run.method)} · ${modelLabel(run.model)}` : `${runs.total} Läufe`}</p></div></div><div className="flex gap-2">{view && <Button variant="outline" size="icon" aria-label="Lauf aktualisieren" disabled={busy} onClick={() => setRevision(r => r + 1)}><RefreshCw /></Button>}<Button onClick={() => navigate('new')}><Plus data-icon="inline-start" />Neuer Lauf</Button></div></header>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {loading ? <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" />Lädt …</div> : !view ? <div className="overflow-hidden rounded-xl border bg-card">
      <Table><TableHeader><TableRow><TableHead className="pl-5">Lauf</TableHead><TableHead>Verfahren</TableHead><TableHead>Modell</TableHead><TableHead>Fortschritt</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{runs.items.map(item => <TableRow key={item.id}><TableCell className="py-4 pl-5"><button className="text-left font-medium hover:underline" onClick={() => navigate(item.id)}>{item.name}</button><p className="mt-1 text-xs text-muted-foreground">{date(item.created_at)}</p></TableCell><TableCell><span className="text-sm">{methodLabel(item.method)}</span><p className="mt-1 text-xs text-muted-foreground">{item.prompt_config}</p></TableCell><TableCell className="text-sm">{modelLabel(item.model)}</TableCell><TableCell><div className="flex w-28 flex-col gap-2"><span className="text-xs text-muted-foreground tabular-nums">{item.done} / {item.total}</span><Progress value={item.total ? item.done / item.total * 100 : 0} aria-label={`${item.name}: ${item.done} von ${item.total} abgeschlossen`} /></div></TableCell><TableCell><Badge variant={item.errors ? 'destructive' : item.done === item.total ? 'secondary' : 'outline'}>{item.done === item.total ? 'Abgeschlossen' : item.running ? 'In Bearbeitung / unterbrochen' : item.errors ? 'Mit Fehlern' : item.done ? 'Pausiert' : 'Bereit'}</Badge></TableCell><TableCell className="pr-4"><div className="flex justify-end"><Button variant="ghost" size="icon" aria-label={`${item.name} löschen`} onClick={() => { setDeleteError(''); setDeleteTarget(item) }}><Trash2 /></Button><Button variant="ghost" size="icon" aria-label={`${item.name} öffnen`} onClick={() => navigate(item.id)}><ArrowUpRight /></Button></div></TableCell></TableRow>)}{!runs.items.length && <TableRow><TableCell colSpan={6}><div className="flex flex-col items-center gap-3 py-16"><FolderOpen className="size-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">Noch keine Läufe</p><Button variant="outline" onClick={() => navigate('new')}>Lauf anlegen</Button></div></TableCell></TableRow>}</TableBody></Table>
      {runs.total > 25 && <div className="flex items-center justify-between border-t px-5 py-3"><span className="text-xs text-muted-foreground">Seite {offset / 25 + 1} / {Math.ceil(runs.total / 25)}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!offset} onClick={() => { setLoading(true); setOffset(o => o - 25) }}>Zurück</Button><Button size="sm" variant="outline" disabled={offset + 25 >= runs.total} onClick={() => { setLoading(true); setOffset(o => o + 25) }}>Weiter</Button></div></div>}
    </div> : run && <>
      <Card className="gap-0 overflow-hidden shadow-none"><CardContent className="flex flex-col gap-5"><div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[['Datenpunkte',run.items.length],['Abgeschlossen',done.length],['Übereinstimmung',done.length ? `${Math.round(done.filter(item => item.result?.prediction.category === item.reference).length / done.length * 100)} %` : '–'],['Geschätzte Kosten', cost?.supported && (cost.calls > 0 || !cost.missing) ? `≈ ${formatCost(cost.usd)}` : '–']].map(([label,value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p></div>)}</div><p className="text-xs leading-relaxed text-muted-foreground">USD · {cost?.calls ?? 0} erfasste Modellaufrufe{cost?.missing ? ` · ${cost.missing} nicht vollständig erfasst` : ''}. Standardpreise vom 12.11.2026, ohne Cache-Rabatt. Fehlgeschlagene oder unterbrochene Anfragen können weitere Kosten verursachen. <a className="underline" href={run.model.startsWith('perplexity/') ? 'https://vercel.com/ai-gateway/models/pplx-decider-v1.2' : run.model.startsWith('jev-') ? 'https://opencode.ai/docs/console/models#pricing' : 'https://developers.openai.com/api/docs/pricing'} target="_blank" rel="noreferrer">Preise</a></p><Progress value={run.items.length ? done.length / run.items.length * 100 : 0} aria-label="Fortschritt des Laufs" /><Separator /><div className="flex flex-wrap items-center justify-between gap-4"><p className="max-w-sm text-xs leading-relaxed text-muted-foreground">Ergebnisse werden gespeichert. Bei Seitenwechsel stoppt der Lauf.</p><div className="flex gap-2">{busy && <Button variant="outline" onClick={() => { stop.current = true }}>Nach Anfrage stoppen</Button>}<Button disabled={busy || running || !pending.length} onClick={() => execute(pending)}>{busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Play data-icon="inline-start" />}{busy ? 'Läuft …' : done.length ? 'Kostenpflichtig fortsetzen' : 'Kostenpflichtig starten'}</Button></div></div></CardContent></Card>
      <details className="rounded-xl border bg-card"><summary className="cursor-pointer px-5 py-4 text-sm font-medium">Konfiguration</summary><div className="flex flex-col gap-5 px-5 pb-5"><dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">{[['Modell',modelLabel(run.model)],['Verfahren',methodLabel(run.method)],['Prompt',run.prompt_config],['Erstellt',date(run.created_at)]].map(([label,value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1">{value}</dd></div>)}</dl>{run.selection.count && <p className="text-xs text-muted-foreground">{run.selection.count} Datenpunkte · Klassen {run.selection.classes?.length === 21 ? 'A–U' : run.selection.classes?.join(', ')}</p>}<div className="flex flex-wrap gap-2">{Object.entries(run.sources).filter(([, enabled]) => enabled).map(([source]) => <Badge key={source} variant="secondary">{{ text: 'Quelltexte', osm: 'OSM-Karte', satellite: 'Satellitenbild' }[source] ?? source}</Badge>)}</div><Separator /><details><summary className="cursor-pointer text-xs text-muted-foreground">Klassifizierungs-Prompt</summary><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-xs">{run.prompt}</pre></details>{run.method === 'multi_turn' && <details><summary className="cursor-pointer text-xs text-muted-foreground">Hinweis-Prompts</summary>{Object.entries(run.clue_prompts).map(([kind,prompt]) => <div key={kind} className="mt-3"><h3 className="text-sm font-medium">{kind}</h3><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{prompt}</pre></div>)}</details>}</div></details>
      <div className="overflow-hidden rounded-xl border bg-card"><div className="flex items-center justify-between border-b px-5 py-4"><h2 className="text-sm font-semibold">Ergebnisse</h2><span className="text-xs text-muted-foreground">{done.length} / {run.items.length}</span></div><Table><TableHeader><TableRow><TableHead className="pl-5">Unternehmen</TableHead><TableHead>Vorhersage</TableHead><TableHead>Referenz</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{run.items.map(item => <TableRow key={item.position}><TableCell className="py-3 pl-5"><span className="font-medium">{item.name}</span><p className="mt-1 text-xs text-muted-foreground">{item.osm_type}_{item.osm_id}</p></TableCell><TableCell><Badge variant="secondary">{item.result?.prediction.category ?? '–'}</Badge></TableCell><TableCell className="text-muted-foreground">{item.reference}</TableCell><TableCell><Badge variant={item.state === 'error' ? 'destructive' : 'outline'}>{stateLabel(item)}</Badge>{run.method === 'multi_turn' && <p className="mt-1 text-xs text-muted-foreground">{Object.keys(item.clues).length} Hinweise</p>}</TableCell><TableCell className="pr-4"><div className="flex justify-end gap-2">{(item.state === 'error' || item.stalled) && <Button variant="outline" size="sm" disabled={busy || running} onClick={() => setRetryTarget(item)}>Erneut versuchen</Button>}<Button variant="ghost" size="icon" aria-label={`Details zu ${item.name}`} onClick={() => setSelected(item)}><ChevronRight /></Button></div></TableCell></TableRow>)}</TableBody></Table></div>
    </>}
    <Dialog open={!!retryTarget} onOpenChange={open => { if (!open) setRetryTarget(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Erneut prüfen?</DialogTitle>
          <DialogDescription>„{retryTarget?.name}“ wird erneut an das Modell gesendet. Dabei können Kosten entstehen.{retryTarget?.stalled && ' Die vorherige Anfrage wurde möglicherweise bereits berechnet.'}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRetryTarget(null)}>Abbrechen</Button>
          <Button disabled={busy || !!running} onClick={() => { if (retryTarget) { const item = retryTarget; setRetryTarget(null); void execute([item], true) } }}>Erneut prüfen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null) }}><DialogContent showCloseButton={!deleting}><DialogHeader><DialogTitle>Lauf löschen?</DialogTitle><DialogDescription>„{deleteTarget?.name}“ und alle zugehörigen Ergebnisse werden dauerhaft gelöscht.</DialogDescription></DialogHeader>{deleteError && <Alert variant="destructive"><AlertDescription>{deleteError}</AlertDescription></Alert>}<DialogFooter><Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>Abbrechen</Button><Button variant="destructive" disabled={deleting} onClick={deleteRun}>{deleting ? 'Wird gelöscht …' : 'Lauf löschen'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null) }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>{selected && `${selected.osm_type}_${selected.osm_id} · ${stateLabel(selected)}`}</DialogDescription></DialogHeader>
      {selected?.result ? <div className="flex flex-col gap-5"><div className="grid grid-cols-2 gap-4 rounded-lg bg-muted p-4"><div><p className="text-xs text-muted-foreground">Vorhersage</p><p className="mt-1 text-2xl font-semibold">{selected.result.prediction.category}</p></div><div><p className="text-xs text-muted-foreground">Referenz</p><p className="mt-1 text-2xl font-semibold">{selected.reference}</p></div></div>{selected.result.prediction.explanation && <section className="flex flex-col gap-2"><h3 className="text-sm font-medium">Begründung</h3><p className="text-sm leading-relaxed">{selected.result.prediction.explanation}</p></section>}{typeof selected.result.confidence === 'number' && !selected.result.probabilities && <p className="text-sm">Selbsteingeschätzte Konfidenz: {(selected.result.confidence * 100).toFixed(1)} %</p>}{selected.result.probabilities && <section className="flex flex-col gap-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">Klassenwahrscheinlichkeiten · Top 5</h3>{selected.result.confidence !== undefined && <span className="text-xs text-muted-foreground">Konfidenz: {Math.round(selected.result.confidence * 100)} %</span>}</div>{Object.entries(selected.result.probabilities).sort((a,b) => b[1]-a[1]).slice(0,5).map(([category,probability]) => <div key={category} className="flex items-center gap-3"><span className="w-8 text-sm">{category}</span><Progress value={probability * 100} aria-label={`Klasse ${category}: ${Math.round(probability * 100)} Prozent`} /><span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{(probability * 100).toFixed(1)} %</span></div>)}</section>}{selected.result.prediction.evidence.length > 0 && <section className="flex flex-col gap-2"><h3 className="text-sm font-medium">Belege</h3><ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">{selected.result.prediction.evidence.map((e,i) => <li key={i}>{e}</li>)}</ul></section>}{selected.result.prediction.uncertainty && <p className="text-sm text-muted-foreground">Unsicherheit: {selected.result.prediction.uncertainty}</p>}<Separator /><details><summary className="cursor-pointer text-xs text-muted-foreground">Modell, Quellen und Tokenverbrauch</summary><div className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground"><p>{modelLabel(selected.result.model)}</p><p>Klassifizierung: {selected.result.input_tokens ?? '–'} Eingabe / {selected.result.output_tokens ?? '–'} Ausgabe</p>{selected.result.clue_input_tokens !== undefined && <p>Hinweisanalysen: {selected.result.clue_input_tokens} Eingabe / {selected.result.clue_output_tokens} Ausgabe</p>}<p>Übermittelt: {selected.result.used_sources.join(', ') || '–'}</p><p>Fehlend: {selected.result.missing_sources.join(', ') || '–'}</p></div></details></div> : <p className="text-sm text-muted-foreground">{selected?.error ?? 'Noch kein Ergebnis vorhanden.'}</p>}
      {selected && Object.keys(selected.clues).length > 0 && <><Separator /><section className="flex flex-col gap-3"><h3 className="text-sm font-medium">Hinweise je Quelle</h3>{Object.entries(selected.clues).map(([kind,clue]) => <details key={kind} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">{kind}</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{clue.text}</p><p className="mt-3 text-xs text-muted-foreground">{modelLabel(clue.model)} · Tokens {clue.input_tokens ?? '–'} / {clue.output_tokens ?? '–'}</p></details>)}</section></>}
    </DialogContent></Dialog>
  </div>
}
