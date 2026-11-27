import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Copy, Download, KeyRound, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { SECTION_CODES, TLX, TLX_SCALES, sectionName } from '@/lib/study-i18n'
import { belowThreshold, suggest, summarize, type Candidate } from '@/lib/study-selection'

type Run = { id: string; name: string; model: string; owner: string; done: number; total: number; created_at: string }
type CaseSet = { id: number; name: string; run_id: string; run_name: string; model: string; positions: number[]; threshold: number | null; note: string; sessions: number; real_sessions: number; locked: boolean; created_at: string; created_by_name: string }
type Session = {
  id: string; case_set_id: number; case_set_name: string; participant_code: string; language: 'de' | 'en'; pilot: boolean
  status: 'created' | 'running' | 'questionnaire' | 'completed' | 'aborted'; created_at: string; started_at: string | null; cases_finished_at: string | null; finished_at: string | null
  case_seconds: number | null; raw_tlx: number | null; usability: number | null; total: number; decided: number; correct: number; scored: number
  accuracy: number | null; chats: number; active_seconds: number; created_by_name: string; access_code: string | null; invite_id: number | null
}
type Entry = {
  position: number; rank: number; name: string; reference: string; ai_code: string | null; confidence: number | null; decision: string | null; final_code: string | null
  correct: boolean | null; outcome: string | null; certainty: number | null; rationale: string; active_ms: number; visits: number; chats: number; changes: number
  messages: { question: string; answer: string; model: string }[]
}
type Stats = { n: number; mean: number | null; median: number | null; min: number | null; max: number | null }
type Group = { n: number; scored: number; human_correct: number; human_accuracy: number | null; ai_correct: number; seconds: Stats; chats: Stats; with_chat: number; certainty: Stats; certainty_normalized: Stats }
type Metrics = {
  sessions: number; decisions: number; outcomes: Record<'confirmed' | 'harmed' | 'detected' | 'adopted' | 'other_wrong', number>
  groups: Record<'all' | 'ai_correct' | 'ai_wrong' | 'final_correct' | 'final_wrong' | 'confirmed' | 'corrected', Group>
  confidence_bins: (Group & { label: string; low: number | null; high: number | null })[]
  per_case: (Group & { position: number; name: string; reference: string; ai_code: string | null; confidence: number | null; adopted: number; detected: number; harmed: number; decisions: string[] })[]
  questionnaire: { n: number; raw_tlx: Stats; scales: Record<string, Stats>; usability: Stats; usability_distribution: Record<string, number> }
}

async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/study/admin/' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const value = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof value?.detail === 'string' ? value.detail : `Anfrage fehlgeschlagen (${response.status})`)
  return value as T
}

async function download(path: string, filename: string) {
  const response = await fetch('/api/study/admin/' + path)
  if (!response.ok) throw new Error('Export fehlgeschlagen.')
  const blob = path.includes('kind=json') ? new Blob([JSON.stringify(await response.json(), null, 2)], { type: 'application/json' }) : await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const percent = (value: number | null | undefined) => value === null || value === undefined ? '–' : `${(value * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`
const number = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? '–' : value.toLocaleString('de-DE', { maximumFractionDigits: digits })
const ratio = (part: number, whole: number) => whole ? `${part} / ${whole} (${percent(part / whole)})` : '–'
function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return '–'
  const rounded = Math.round(seconds)
  return rounded >= 60 ? `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')} min` : `${rounded} s`
}
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–'
const STATUS: Record<Session['status'], string> = { created: 'Angelegt', running: 'Läuft', questionnaire: 'Fragebogen', completed: 'Abgeschlossen', aborted: 'Abgebrochen' }
const OUTCOME: Record<string, string> = {
  confirmed: 'Richtigen Vorschlag bestätigt', harmed: 'Richtigen Vorschlag verschlechtert', detected: 'Fehler erkannt und korrigiert',
  adopted: 'Fehler übernommen', other_wrong: 'Fehler erkannt, falsch korrigiert',
}

function Page({ title, description, actions, children }: { title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-4 lg:p-8">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div><div className="flex flex-wrap gap-2">{actions}</div></div>
    {children}
  </div>
}

function ErrorBox({ error }: { error: string }) {
  return error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null
}

function Confirm({ open, title, text, action, destructive = false, onConfirm, onClose }: { open: boolean; title: string; text: string; action: string; destructive?: boolean; onConfirm: () => void; onClose: () => void }) {
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose() }}>
    <DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{text}</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={onClose}>Abbrechen</Button><Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>{action}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

export function StudyAdminPage({ section }: { section: 'sets' | 'runs' | 'evaluation' }) {
  if (section === 'sets') return <CaseSetsSection />
  if (section === 'runs') return <RunsSection />
  return <EvaluationSection />
}

// ---------------------------------------------------------------------------------------------------------------
// Fallsets
// ---------------------------------------------------------------------------------------------------------------

type Draft = { id?: number; name: string; note: string; run_id: string; threshold: number | null; positions: number[] }

function CaseSetsSection() {
  const [sets, setSets] = useState<CaseSet[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [remove, setRemove] = useState<CaseSet | null>(null)
  const load = useCallback(async () => {
    try {
      const [setList, runList] = await Promise.all([api<{ items: CaseSet[] }>('case-sets'), api<{ items: Run[] }>('runs')])
      setSets(setList.items)
      setRuns(runList.items)
    } catch (e) { setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen.') }
  }, [])
  useEffect(() => { void load() }, [load])

  async function copy(item: CaseSet) {
    setError('')
    try { const created = await api<CaseSet>(`case-sets/${item.id}/copy`, 'POST'); await load(); setDraft({ ...created, note: created.note ?? '' }) } catch (e) { setError(e instanceof Error ? e.message : 'Kopieren fehlgeschlagen.') }
  }
  async function confirmRemove() {
    if (!remove) return
    setError('')
    try { await api(`case-sets/${remove.id}`, 'DELETE'); setRemove(null); await load() } catch (e) { setRemove(null); setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.') }
  }

  if (draft) return <CaseSetEditor draft={draft} runs={runs} onClose={async () => { setDraft(null); await load() }} />
  return <Page title="Fallsets" description="Fälle für die Nutzerstudie frei zusammenstellen. Alle Testläufe eines Fallsets sehen dieselben Fälle in zufälliger Reihenfolge."
    actions={<Button disabled={!runs.length} onClick={() => setDraft({ name: '', note: '', run_id: runs[0]?.id ?? '', threshold: 0.8, positions: [] })}><Plus data-icon="inline-start" />Neues Fallset</Button>}>
    <ErrorBox error={error} />
    {!runs.length && <Alert><AlertDescription>Es gibt noch keinen Klassifikationslauf mit abgeschlossenen Ergebnissen.</AlertDescription></Alert>}
    <Card className="shadow-none"><CardContent>
      <Table><TableHeader><TableRow><TableHead>Fallset</TableHead><TableHead>Klassifikationslauf</TableHead><TableHead>Fälle</TableHead><TableHead>Schwelle</TableHead><TableHead>Testläufe</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {sets.map(item => <TableRow key={item.id}>
            <TableCell className="py-4"><span className="font-medium">{item.name}</span>{item.note && <p className="mt-1 max-w-sm whitespace-normal text-xs text-muted-foreground">{item.note}</p>}</TableCell>
            <TableCell><span>{item.run_name}</span><p className="text-xs text-muted-foreground">{item.model}</p></TableCell>
            <TableCell className="tabular-nums">{item.positions.length}</TableCell>
            <TableCell className="tabular-nums">{item.threshold === null ? '–' : percent(item.threshold)}</TableCell>
            <TableCell className="tabular-nums">{item.real_sessions} echt · {item.sessions - item.real_sessions} sonstige</TableCell>
            <TableCell>{item.locked ? <Badge variant="secondary">Festgeschrieben</Badge> : <Badge variant="outline">Bearbeitbar</Badge>}</TableCell>
            <TableCell className="text-right"><div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setDraft({ id: item.id, name: item.name, note: item.note, run_id: item.run_id, threshold: item.threshold, positions: item.positions })}>{item.locked ? 'Ansehen' : 'Bearbeiten'}</Button>
              <Button size="sm" variant="outline" onClick={() => copy(item)}><Copy data-icon="inline-start" />Kopieren</Button>
              <Button size="sm" variant="ghost" disabled={item.sessions > 0} onClick={() => setRemove(item)}>Löschen</Button>
            </div></TableCell>
          </TableRow>)}
          {!sets.length && <TableRow><TableCell colSpan={7} className="py-6 text-muted-foreground">Noch kein Fallset angelegt.</TableCell></TableRow>}
        </TableBody>
      </Table>
      <p className="mt-4 text-xs text-muted-foreground">Ein Fallset bleibt bearbeitbar, solange nur Probeläufe existieren. Sobald ein echter Testlauf angelegt ist, wird es festgeschrieben; Änderungen dann über „Kopieren“.</p>
    </CardContent></Card>
    <Confirm open={!!remove} title="Fallset löschen?" text={`„${remove?.name}“ wird gelöscht.`} action="Löschen" destructive onConfirm={confirmRemove} onClose={() => setRemove(null)} />
  </Page>
}

function CaseSetEditor({ draft: initial, runs, onClose }: { draft: Draft; runs: Run[]; onClose: () => void }) {
  const [draft, setDraft] = useState(initial)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [locked, setLocked] = useState(false)
  const [count, setCount] = useState(10)
  const [seed, setSeed] = useState(1)
  const [search, setSearch] = useState('')
  const [onlyBelow, setOnlyBelow] = useState(true)
  const [onlySelected, setOnlySelected] = useState(false)
  const [correctness, setCorrectness] = useState('all')
  const [reference, setReference] = useState('all')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!draft.run_id) return
    let active = true
    api<{ items: Candidate[] }>(`runs/${draft.run_id}/candidates`).then(value => { if (active) setCandidates(value.items) }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [draft.run_id])
  useEffect(() => {
    if (!initial.id) return
    api<{ items: CaseSet[] }>('case-sets').then(value => setLocked(!!value.items.find(item => item.id === initial.id)?.locked)).catch(() => undefined)
  }, [initial.id])

  const selected = useMemo(() => new Set(draft.positions), [draft.positions])
  const chosen = candidates.filter(item => selected.has(item.position))
  const summary = summarize(chosen, candidates, draft.threshold)
  const visible = candidates.filter(item =>
    (!onlyBelow || belowThreshold(item, draft.threshold)) && (!onlySelected || selected.has(item.position)) &&
    (correctness === 'all' || (correctness === 'wrong' ? item.correct === false : correctness === 'right' ? item.correct === true : item.correct === null)) &&
    (reference === 'all' || item.reference === reference) && (!search.trim() || `${item.name} ${item.osm}`.toLowerCase().includes(search.trim().toLowerCase())))
  const toggle = (position: number) => setDraft(current => ({ ...current, positions: current.positions.includes(position) ? current.positions.filter(item => item !== position) : [...current.positions, position] }))

  async function save() {
    setBusy(true)
    setError('')
    try {
      const body = { name: draft.name, note: draft.note, run_id: draft.run_id, threshold: draft.threshold, positions: draft.positions }
      if (draft.id) await api(`case-sets/${draft.id}`, 'PUT', body)
      else await api('case-sets', 'POST', body)
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.') } finally { setBusy(false) }
  }

  return <Page title={draft.id ? (locked ? 'Fallset ansehen' : 'Fallset bearbeiten') : 'Neues Fallset'} description="Die Kriterien aus dem Studienvorschlag sind nur Orientierung. Ihr könnt jede Kombination abgeschlossener Fälle wählen."
    actions={<><Button variant="outline" onClick={onClose}><ArrowLeft data-icon="inline-start" />Zurück</Button>{!locked && <Button disabled={busy || !draft.name.trim() || !draft.positions.length} onClick={save}>Fallset speichern</Button>}</>}>
    <ErrorBox error={error} />
    {locked && <Alert><AlertDescription>Für dieses Fallset gibt es echte Testläufe; es ist festgeschrieben. Für Änderungen in der Übersicht „Kopieren“ wählen.</AlertDescription></Alert>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-5">
        <Card className="shadow-none"><CardContent><FieldGroup className="grid gap-4 md:grid-cols-2">
          <Field><FieldLabel htmlFor="set-name">Name</FieldLabel><Input id="set-name" value={draft.name} maxLength={150} disabled={locked} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Hauptstudie Januar" /></Field>
          <Field><FieldLabel>Klassifikationslauf</FieldLabel><Select value={draft.run_id} disabled={locked} onValueChange={value => setDraft({ ...draft, run_id: value, positions: [] })}><SelectTrigger aria-label="Klassifikationslauf"><SelectValue placeholder="Lauf wählen" /></SelectTrigger><SelectContent><SelectGroup>{runs.map(run => <SelectItem key={run.id} value={run.id}>{run.name} · {run.model} · {run.done} Ergebnisse · {run.owner}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="set-threshold">Konfidenzschwelle als Orientierung: {draft.threshold === null ? 'keine' : percent(draft.threshold)}</FieldLabel>
            <div className="flex items-center gap-3"><Switch checked={draft.threshold !== null} disabled={locked} onCheckedChange={value => setDraft({ ...draft, threshold: value ? 0.8 : null })} aria-label="Schwelle verwenden" />
              <Input id="set-threshold" type="range" min="0" max="100" step="1" disabled={locked || draft.threshold === null} value={Math.round((draft.threshold ?? 0.8) * 100)} onChange={e => setDraft({ ...draft, threshold: Number(e.target.value) / 100 })} /></div>
            <FieldDescription>Bestimmt Filter, Vergleichswert und Vorschlag. Fälle darüber bleiben wählbar.</FieldDescription></Field>
          <Field><FieldLabel htmlFor="set-note">Notiz</FieldLabel><Textarea id="set-note" value={draft.note} maxLength={2000} disabled={locked} onChange={e => setDraft({ ...draft, note: e.target.value })} placeholder="Warum diese Fälle?" /></Field>
        </FieldGroup></CardContent></Card>
        <Card className="shadow-none">
          <CardHeader><CardTitle>Fälle</CardTitle><CardDescription>{visible.length} von {candidates.length} abgeschlossenen Fällen angezeigt</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input className="sm:max-w-56" placeholder="Unternehmen suchen" value={search} onChange={e => setSearch(e.target.value)} aria-label="Unternehmen suchen" />
              <Select value={correctness} onValueChange={setCorrectness}><SelectTrigger className="w-48" aria-label="LLM-Vorschlag filtern"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">Alle Vorschläge</SelectItem><SelectItem value="right">LLM richtig</SelectItem><SelectItem value="wrong">LLM falsch</SelectItem><SelectItem value="none">Ohne Referenz</SelectItem></SelectGroup></SelectContent></Select>
              <Select value={reference} onValueChange={setReference}><SelectTrigger className="w-56" aria-label="Referenzabschnitt filtern"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">Alle Referenzabschnitte</SelectItem>{SECTION_CODES.map(code => <SelectItem key={code} value={code}>{code} · {sectionName(code, 'de')}</SelectItem>)}</SelectGroup></SelectContent></Select>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={onlyBelow} onCheckedChange={value => setOnlyBelow(value === true)} />nur unter Schwelle</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={onlySelected} onCheckedChange={value => setOnlySelected(value === true)} />nur ausgewählte</label>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-lg border">
              <Table><TableHeader className="sticky top-0 bg-background"><TableRow><TableHead className="w-10" /><TableHead>Unternehmen</TableHead><TableHead>Referenz</TableHead><TableHead>LLM</TableHead><TableHead>Ergebnis</TableHead><TableHead>Konfidenz</TableHead><TableHead>Quellen</TableHead></TableRow></TableHeader>
                <TableBody>
                  {visible.map(item => <TableRow key={item.position} data-state={selected.has(item.position) ? 'selected' : undefined}>
                    <TableCell><Checkbox checked={selected.has(item.position)} disabled={locked} onCheckedChange={() => toggle(item.position)} aria-label={`${item.name} auswählen`} /></TableCell>
                    <TableCell><span className="font-medium">{item.name}</span><p className="text-xs text-muted-foreground">{item.osm}</p></TableCell>
                    <TableCell>{item.reference || '–'}</TableCell>
                    <TableCell>{item.ai_code ?? '–'}</TableCell>
                    <TableCell>{item.correct === null ? <Badge variant="outline">ohne Referenz</Badge> : item.correct ? <Badge variant="secondary">richtig</Badge> : <Badge variant="destructive">falsch</Badge>}</TableCell>
                    <TableCell className="tabular-nums">{percent(item.confidence)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{item.texts} Texte · {item.images} Bilder</TableCell>
                  </TableRow>)}
                  {!visible.length && <TableRow><TableCell colSpan={7} className="py-6 text-muted-foreground">Keine passenden Fälle.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-col gap-5 xl:sticky xl:top-4">
        <Card className="shadow-none">
          <CardHeader><CardTitle>Auswahl</CardTitle><CardDescription>{summary.n} {summary.n === 1 ? 'Fall' : 'Fälle'} ausgewählt · Studienvorschlag: 10</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">LLM richtig / falsch</dt><dd className="tabular-nums">{summary.correct} / {summary.wrong}</dd>
              <dt className="text-muted-foreground">Anteil falsch in der Auswahl</dt><dd className="tabular-nums">{percent(summary.wrongShare)}</dd>
              <dt className="text-muted-foreground">Anteil falsch im Lauf {draft.threshold !== null ? 'unter Schwelle' : ''}</dt><dd className="tabular-nums">{percent(summary.baselineWrongShare)} <span className="text-muted-foreground">(n = {summary.baselineN})</span></dd>
              <dt className="text-muted-foreground">Referenzabschnitte</dt><dd className="text-right">{summary.sections.length ? summary.sections.join(', ') : '–'}</dd>
            </dl>
            <div>
              <p className="mb-2 text-muted-foreground">Verteilung der Konfidenz{draft.threshold !== null ? ' unter der Schwelle' : ''}</p>
              <Table><TableHeader><TableRow><TableHead>Bereich</TableHead><TableHead className="text-right">Fälle</TableHead><TableHead className="text-right">davon falsch</TableHead></TableRow></TableHeader>
                <TableBody>{summary.bins.map(bin => <TableRow key={bin.low}><TableCell className="tabular-nums">{Math.round(bin.low * 100)}–{Math.round(bin.high * 100)} %</TableCell><TableCell className="text-right tabular-nums">{bin.n}</TableCell><TableCell className="text-right tabular-nums">{bin.wrong}</TableCell></TableRow>)}</TableBody>
              </Table>
            </div>
            {(summary.aboveThreshold > 0 || summary.unscored > 0 || summary.missingConfidence > 0) && <Alert><AlertDescription className="flex flex-col gap-1">
              {summary.aboveThreshold > 0 && <span>{summary.aboveThreshold} ausgewählte Fälle liegen über der Schwelle.</span>}
              {summary.unscored > 0 && <span>{summary.unscored} Fälle haben keine gültige Referenz und zählen nicht zur Genauigkeit.</span>}
              {summary.missingConfidence > 0 && <span>{summary.missingConfidence} Fälle haben keine Konfidenz.</span>}
            </AlertDescription></Alert>}
          </CardContent>
        </Card>
        {!locked && <Card className="shadow-none">
          <CardHeader><CardTitle>Vorschlag erzeugen</CardTitle><CardDescription>Fälle unter der Schwelle, richtig/falsch im Verhältnis des Laufs, über die Konfidenz verteilt und möglichst viele Abschnitte. Ersetzt die aktuelle Auswahl; danach frei anpassbar.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <Field className="w-28"><FieldLabel htmlFor="suggest-count">Anzahl</FieldLabel><Input id="suggest-count" type="number" min={1} max={50} value={count} onChange={e => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} /></Field>
            <Button variant="outline" disabled={!candidates.length} onClick={() => { setDraft({ ...draft, positions: suggest(candidates, count, draft.threshold, seed) }); setSeed(value => value + 1) }}><Sparkles data-icon="inline-start" />Vorschlagen</Button>
            <Button variant="ghost" disabled={!draft.positions.length} onClick={() => setDraft({ ...draft, positions: [] })}>Auswahl leeren</Button>
          </CardContent>
        </Card>}
      </div>
    </div>
  </Page>
}

// ---------------------------------------------------------------------------------------------------------------
// Testläufe
// ---------------------------------------------------------------------------------------------------------------

function nextCode(sessions: Session[]) {
  const numbers = sessions.filter(item => !item.pilot).map(item => /^P(\d+)$/i.exec(item.participant_code)?.[1]).filter(Boolean).map(Number)
  return `P${String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(2, '0')}`
}

type Invite = { id: number; case_set_id: number; case_set_name: string; access_code: string; language: 'de' | 'en'; pilot: boolean; active: boolean; sessions: number; completed: number; created_at: string; created_by_name: string }
type ShownCode = { code: string; title: string; shared: boolean }

function CodeDialog({ shown, onClose }: { shown: ShownCode | null; onClose: () => void }) {
  const link = `${window.location.origin}/#study`
  const [copied, setCopied] = useState('')
  const copy = (value: string) => { void navigator.clipboard?.writeText(value).then(() => setCopied(value)) }
  const close = () => { setCopied(''); onClose() }
  return <Dialog open={!!shown} onOpenChange={value => { if (!value) close() }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{shown?.title}</DialogTitle><DialogDescription>{shown?.shared ? 'Diesen Code können beliebig viele Personen nutzen. Jede Person erhält automatisch einen eigenen Testlauf mit eigenem Teilnehmercode.' : 'Code und Link lassen sich in der Übersicht jederzeit wieder anzeigen.'}</DialogDescription></DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted px-4 py-3"><span className="font-mono text-2xl tracking-widest">{shown?.code}</span><Button size="sm" variant="outline" onClick={() => shown && copy(shown.code)}><Copy data-icon="inline-start" />{copied === shown?.code ? 'Kopiert' : 'Kopieren'}</Button></div>
        <div className="flex items-center justify-between gap-3 text-sm"><span className="truncate">Link: <span className="font-mono">{link}</span></span><Button size="sm" variant="outline" onClick={() => copy(link)}>{copied === link ? 'Kopiert' : 'Link kopieren'}</Button></div>
        <Button variant="secondary" onClick={() => shown && copy(`Link: ${link}\nZugangscode: ${shown.code}`)}><Copy data-icon="inline-start" />{copied.startsWith('Link:') ? 'Kopiert' : 'Link und Code zusammen kopieren'}</Button>
      </div>
      <DialogFooter><Button onClick={close}>Fertig</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function RunsSection() {
  const [detail, setDetail] = useState(() => window.location.hash.split('/')[1] ?? '')
  useEffect(() => {
    const update = () => setDetail(window.location.hash.split('/')[1] ?? '')
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return detail ? <RunDetail id={detail} /> : <RunList />
}

type Action = { kind: 'abort' | 'delete' | 'code'; session: Session } | { kind: 'invite-delete' | 'invite-toggle'; invite: Invite }

function RunList() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [sets, setSets] = useState<CaseSet[]>([])
  const [form, setForm] = useState({ case_set_id: '', participant_code: '', language: 'de', pilot: false, shared: false })
  const [codeTouched, setCodeTouched] = useState(false)
  const [shown, setShown] = useState<ShownCode | null>(null)
  const [confirm, setConfirm] = useState<Action | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const [sessionList, inviteList, setList] = await Promise.all([api<{ items: Session[] }>('sessions'), api<{ items: Invite[] }>('invites'), api<{ items: CaseSet[] }>('case-sets')])
      setSessions(sessionList.items)
      setInvites(inviteList.items)
      setSets(setList.items)
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen.') }
  }, [])
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 15000)
    return () => window.clearInterval(timer)
  }, [load])
  const caseSetId = form.case_set_id || (sets[0] ? String(sets[0].id) : '')
  const participantCode = codeTouched ? form.participant_code : form.pilot ? 'TEST' : nextCode(sessions.filter(item => String(item.case_set_id) === caseSetId && item.status !== 'aborted'))

  async function create() {
    setBusy(true)
    setError('')
    try {
      if (form.shared) {
        const result = await api<{ access_code: string }>('invites', 'POST', { case_set_id: Number(caseSetId), language: form.language, pilot: form.pilot })
        setShown({ code: result.access_code, title: 'Mehrfach-Code', shared: true })
      } else {
        const result = await api<{ access_code: string }>('sessions', 'POST', { case_set_id: Number(caseSetId), participant_code: participantCode, language: form.language, pilot: form.pilot })
        setShown({ code: result.access_code, title: `Zugangscode für ${participantCode}`, shared: false })
        setCodeTouched(false)
      }
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Anlegen fehlgeschlagen.') } finally { setBusy(false) }
  }

  async function run() {
    if (!confirm) return
    const action = confirm
    setConfirm(null)
    setError('')
    try {
      if (action.kind === 'abort') await api(`sessions/${action.session.id}/abort`, 'POST')
      if (action.kind === 'delete') await api(`sessions/${action.session.id}`, 'DELETE')
      if (action.kind === 'code') setShown({ code: (await api<{ access_code: string }>(`sessions/${action.session.id}/code`, 'POST')).access_code, title: `Neuer Zugangscode für ${action.session.participant_code}`, shared: false })
      if (action.kind === 'invite-toggle') await api(`invites/${action.invite.id}/active`, 'POST', { active: !action.invite.active })
      if (action.kind === 'invite-delete') await api(`invites/${action.invite.id}`, 'DELETE')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Aktion fehlgeschlagen.') }
  }

  const ended = (item: Session) => item.status === 'completed' || item.status === 'aborted'
  const dialog = !confirm ? null
    : confirm.kind === 'abort' ? { title: 'Testlauf abbrechen?', text: `Der Zugang von ${confirm.session.participant_code} wird sofort gesperrt. Bisherige Angaben bleiben gespeichert.`, action: 'Abbrechen', destructive: true }
      : confirm.kind === 'delete' ? { title: 'Testlauf löschen?', text: `Alle Daten von ${confirm.session.participant_code} (Entscheidungen, Zeiten, Rückfragen, Fragebogen) werden endgültig gelöscht, z. B. bei Widerruf der Einwilligung.`, action: 'Endgültig löschen', destructive: true }
        : confirm.kind === 'code' ? { title: 'Neuen Zugangscode erzeugen?', text: 'Der bisherige Code wird ungültig. Bereits angemeldete Teilnehmende können weiterarbeiten.', action: 'Code erzeugen', destructive: false }
          : confirm.kind === 'invite-toggle' ? { title: confirm.invite.active ? 'Mehrfach-Code deaktivieren?' : 'Mehrfach-Code wieder aktivieren?', text: confirm.invite.active ? 'Mit diesem Code kann niemand mehr einen neuen Testlauf starten. Laufende Testläufe sind nicht betroffen.' : 'Mit diesem Code können wieder neue Testläufe gestartet werden.', action: confirm.invite.active ? 'Deaktivieren' : 'Aktivieren', destructive: confirm.invite.active }
            : { title: 'Mehrfach-Code löschen?', text: 'Der Code wird ungültig. Die damit gestarteten Testläufe und ihre Daten bleiben erhalten.', action: 'Löschen', destructive: true }

  return <Page title="Testläufe" description="Testläufe anlegen, Zugangscodes ausgeben und den Stand der Sitzungen verfolgen. Die Liste aktualisiert sich alle 15 Sekunden."
    actions={<Button variant="outline" onClick={load}><RefreshCw data-icon="inline-start" />Aktualisieren</Button>}>
    <ErrorBox error={error} />
    <Card className="shadow-none">
      <CardHeader><CardTitle>Neuer Testlauf</CardTitle><CardDescription>Einzelner Code für eine Person oder ein Mehrfach-Code für beliebig viele Personen; jede Person erhält dabei automatisch einen eigenen Testlauf (P01, P02 …). Probeläufe lassen das Fallset bearbeitbar und sind in der Auswertung standardmäßig ausgeblendet.</CardDescription></CardHeader>
      <CardContent>{!sets.length ? <p className="text-sm text-muted-foreground">Zuerst unter „Fallsets“ ein Fallset anlegen.</p> :
        <div className="grid items-end gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto]">
          <Field><FieldLabel>Fallset</FieldLabel><Select value={caseSetId} onValueChange={value => setForm({ ...form, case_set_id: value })}><SelectTrigger aria-label="Fallset"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{sets.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name} · {item.positions.length} Fälle</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="participant-code">Teilnehmercode</FieldLabel>{form.shared ? <Input id="participant-code" disabled value="automatisch" /> : <Input id="participant-code" value={participantCode} maxLength={20} onChange={e => { setCodeTouched(true); setForm({ ...form, participant_code: e.target.value }) }} />}</Field>
          <Field><FieldLabel>Sprache</FieldLabel><Select value={form.language} onValueChange={value => setForm({ ...form, language: value })}><SelectTrigger aria-label="Sprache"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="de">Deutsch</SelectItem><SelectItem value="en">English</SelectItem></SelectGroup></SelectContent></Select></Field>
          <label className="flex h-8 items-center gap-2 text-sm"><Switch checked={form.shared} onCheckedChange={value => setForm({ ...form, shared: value })} />Mehrfach-Code</label>
          <label className="flex h-8 items-center gap-2 text-sm"><Switch checked={form.pilot} onCheckedChange={value => setForm({ ...form, pilot: value })} />Probelauf</label>
          <Button disabled={busy || (!form.shared && !/^[A-Za-z0-9_-]{1,20}$/.test(participantCode))} onClick={create}><KeyRound data-icon="inline-start" />Anlegen</Button>
        </div>}
      </CardContent>
    </Card>
    {invites.length > 0 && <Card className="shadow-none">
      <CardHeader><CardTitle>Mehrfach-Codes</CardTitle><CardDescription>Jede Person, die einen dieser Codes eingibt, startet einen eigenen Testlauf. Die Testläufe erscheinen unten in der Liste.</CardDescription></CardHeader>
      <CardContent><Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Fallset</TableHead><TableHead>Sprache</TableHead><TableHead>Teilnahmen</TableHead><TableHead>Status</TableHead><TableHead>Angelegt</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>{invites.map(item => <TableRow key={item.id}>
          <TableCell className="py-4 font-mono tracking-wider">{item.access_code}{item.pilot && <Badge variant="outline" className="ml-2 font-sans tracking-normal">Probelauf</Badge>}</TableCell>
          <TableCell>{item.case_set_name}</TableCell>
          <TableCell className="uppercase">{item.language}</TableCell>
          <TableCell className="tabular-nums">{item.sessions} gestartet · {item.completed} abgeschlossen</TableCell>
          <TableCell>{item.active ? <Badge variant="secondary">Aktiv</Badge> : <Badge variant="outline">Deaktiviert</Badge>}</TableCell>
          <TableCell className="text-xs text-muted-foreground">{dateTime(item.created_at)}<br />{item.created_by_name}</TableCell>
          <TableCell className="text-right"><div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setShown({ code: item.access_code, title: 'Mehrfach-Code', shared: true })}><KeyRound data-icon="inline-start" />Code & Link</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'invite-toggle', invite: item })}>{item.active ? 'Deaktivieren' : 'Aktivieren'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'invite-delete', invite: item })}>Löschen</Button>
          </div></TableCell>
        </TableRow>)}</TableBody>
      </Table></CardContent>
    </Card>}
    <Card className="shadow-none"><CardContent>
      <Table><TableHeader><TableRow><TableHead>Teilnehmer</TableHead><TableHead>Fallset</TableHead><TableHead>Status</TableHead><TableHead>Fortschritt</TableHead><TableHead>Dauer Fälle</TableHead><TableHead>Genauigkeit</TableHead><TableHead>Rückfragen</TableHead><TableHead>Raw TLX</TableHead><TableHead>Angelegt</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {sessions.map(item => <TableRow key={item.id}>
            <TableCell className="py-4"><span className="font-medium">{item.participant_code}</span> <span className="text-xs uppercase text-muted-foreground">{item.language}</span>{item.pilot && <Badge variant="outline" className="ml-2">Probelauf</Badge>}{item.invite_id !== null && <p className="text-xs text-muted-foreground">über Mehrfach-Code</p>}</TableCell>
            <TableCell>{item.case_set_name}</TableCell>
            <TableCell><Badge variant={item.status === 'completed' ? 'secondary' : item.status === 'aborted' ? 'destructive' : 'outline'}>{STATUS[item.status]}</Badge></TableCell>
            <TableCell className="tabular-nums">{item.decided} / {item.total}</TableCell>
            <TableCell className="tabular-nums">{item.case_seconds !== null ? duration(item.case_seconds) : item.started_at ? `läuft seit ${dateTime(item.started_at)}` : '–'}</TableCell>
            <TableCell className="tabular-nums">{item.cases_finished_at ? ratio(item.correct, item.scored) : '–'}</TableCell>
            <TableCell className="tabular-nums">{item.chats}</TableCell>
            <TableCell className="tabular-nums">{number(item.raw_tlx)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{dateTime(item.created_at)}<br />{item.created_by_name}</TableCell>
            <TableCell className="text-right"><div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => { window.location.hash = `study-runs/${item.id}` }}>Details</Button>
              {item.invite_id === null && (item.access_code && !ended(item)
                ? <Button size="sm" variant="ghost" onClick={() => setShown({ code: item.access_code!, title: `Zugangscode für ${item.participant_code}`, shared: false })}>Code & Link</Button>
                : <Button size="sm" variant="ghost" disabled={ended(item)} title={ended(item) ? 'Testlauf beendet' : 'Code wurde vor diesem Update nicht gespeichert'} onClick={() => setConfirm({ kind: 'code', session: item })}>Neuer Code</Button>)}
              <Button size="sm" variant="ghost" disabled={ended(item)} onClick={() => setConfirm({ kind: 'abort', session: item })}>Abbrechen</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'delete', session: item })}>Löschen</Button>
            </div></TableCell>
          </TableRow>)}
          {!sessions.length && <TableRow><TableCell colSpan={10} className="py-6 text-muted-foreground">Noch keine Testläufe.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
    <CodeDialog shown={shown} onClose={() => setShown(null)} />
    <Confirm open={!!dialog} onClose={() => setConfirm(null)} onConfirm={run} destructive={dialog?.destructive} title={dialog?.title ?? ''} text={dialog?.text ?? ''} action={dialog?.action ?? ''} />
  </Page>
}

function RunDetail({ id }: { id: string }) {
  const [data, setData] = useState<{ session: Session; entries: Entry[]; questionnaire: { answers: { tlx: Record<string, number>; usability: number }; raw_tlx: number; usability: number; comment: string; language: 'de' | 'en' } | null; events: { id: number; position: number | null; action: string; created_at: string }[] } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api<NonNullable<typeof data>>(`sessions/${id}`).then(value => { if (active) setData(value) }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [id])
  const back = <Button variant="outline" onClick={() => { window.location.hash = 'study-runs' }}><ArrowLeft data-icon="inline-start" />Alle Testläufe</Button>
  if (!data) return <Page title="Testlauf" description="" actions={back}><ErrorBox error={error} /></Page>
  const { session, entries, questionnaire } = data
  return <Page title={`Testlauf ${session.participant_code}${session.pilot ? ' (Probelauf)' : ''}`} description={`${session.case_set_name} · ${STATUS[session.status]} · Sprache ${session.language.toUpperCase()}`} actions={back}>
    <ErrorBox error={error} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Tile label="Genauigkeit" value={session.cases_finished_at ? percent(session.accuracy) : '–'} hint={`${session.correct} von ${session.scored} mit Referenz`} />
      <Tile label="Dauer der Fallbearbeitung" value={duration(session.case_seconds)} hint={`aktiv auf Fällen: ${duration(session.active_seconds)}`} />
      <Tile label="Rückfragen" value={String(session.chats)} hint={`${entries.filter(item => item.chats > 0).length} Fälle mit Rückfrage`} />
      <Tile label="Raw NASA-TLX" value={number(questionnaire?.raw_tlx)} hint="0 bis 100, höher = mehr Belastung" />
      <Tile label="Nutzungsabsicht" value={questionnaire ? `${questionnaire.usability} / 5` : '–'} hint="Würde das Werkzeug nutzen" />
    </div>
    <Card className="shadow-none"><CardHeader><CardTitle>Entscheidungen</CardTitle><CardDescription>In der Reihenfolge, in der die Fälle angezeigt wurden. Zeit = Summe aller Besuche des Falls.</CardDescription></CardHeader><CardContent>
      <Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Unternehmen</TableHead><TableHead>LLM</TableHead><TableHead>Konfidenz</TableHead><TableHead>Referenz</TableHead><TableHead>Entscheidung</TableHead><TableHead>Ergebnis</TableHead><TableHead>Sicherheit</TableHead><TableHead>Zeit</TableHead><TableHead>Besuche</TableHead><TableHead>Änderungen</TableHead><TableHead>Begründung und Rückfragen</TableHead></TableRow></TableHeader>
        <TableBody>{entries.map(item => <TableRow key={item.position} className="align-top">
          <TableCell className="tabular-nums">{item.rank}</TableCell>
          <TableCell className="font-medium">{item.name}</TableCell>
          <TableCell>{item.ai_code ?? '–'}</TableCell>
          <TableCell className="tabular-nums">{percent(item.confidence)}</TableCell>
          <TableCell>{item.reference}</TableCell>
          <TableCell>{item.final_code ? `${item.final_code} (${item.decision === 'confirmed' ? 'bestätigt' : 'korrigiert'})` : '–'}</TableCell>
          <TableCell>{item.outcome ? <Badge variant={item.correct ? 'secondary' : 'destructive'}>{OUTCOME[item.outcome]}</Badge> : '–'}</TableCell>
          <TableCell className="tabular-nums">{item.certainty ?? '–'}</TableCell>
          <TableCell className="tabular-nums">{duration(item.active_ms / 1000)}</TableCell>
          <TableCell className="tabular-nums">{item.visits}</TableCell>
          <TableCell className="tabular-nums">{item.changes}</TableCell>
          <TableCell className="max-w-md whitespace-normal"><p className="text-sm">{item.rationale || '–'}</p>
            {item.messages.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted-foreground">{item.messages.length} Rückfrage{item.messages.length === 1 ? '' : 'n'}</summary>{item.messages.map((message, index) => <div key={index} className="mt-2 border-l-2 pl-2"><p className="font-medium">{message.question}</p><p className="whitespace-pre-wrap text-muted-foreground">{message.answer}</p></div>)}</details>}
          </TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </CardContent></Card>
    {questionnaire && <Card className="shadow-none"><CardHeader><CardTitle>Fragebogen</CardTitle><CardDescription>Beantwortet auf {questionnaire.language === 'de' ? 'Deutsch' : 'Englisch'}</CardDescription></CardHeader><CardContent>
      <Table><TableBody>
        {TLX_SCALES.map(scale => <TableRow key={scale}><TableCell>{TLX.de[scale].title}</TableCell><TableCell className="text-right tabular-nums">{questionnaire.answers.tlx[scale]}</TableCell></TableRow>)}
        <TableRow><TableCell className="font-medium">Raw NASA-TLX (Mittelwert)</TableCell><TableCell className="text-right font-medium tabular-nums">{number(questionnaire.raw_tlx)}</TableCell></TableRow>
        <TableRow><TableCell>Nutzungsabsicht (1–5)</TableCell><TableCell className="text-right tabular-nums">{questionnaire.usability}</TableCell></TableRow>
        <TableRow><TableCell>Anmerkungen</TableCell><TableCell className="whitespace-normal">{questionnaire.comment || '–'}</TableCell></TableRow>
      </TableBody></Table>
    </CardContent></Card>}
    <details className="rounded-xl border bg-card px-4 py-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Ereignisprotokoll ({data.events.length})</summary>
      <Table><TableBody>{data.events.map(event => <TableRow key={event.id}><TableCell className="tabular-nums">{new Date(event.created_at).toLocaleTimeString('de-DE')}</TableCell><TableCell>{event.action}</TableCell><TableCell>{event.position === null ? '' : entries.find(item => item.position === event.position)?.rank ?? ''}</TableCell></TableRow>)}</TableBody></Table>
    </details>
  </Page>
}

// ---------------------------------------------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------------------------------------------

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <Card className="gap-1 py-4 shadow-none"><CardContent><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</CardContent></Card>
}

function GroupTable({ rows }: { rows: [string, Group][] }) {
  return <Table><TableHeader><TableRow><TableHead>Gruppe</TableHead><TableHead className="text-right">Entscheidungen</TableHead><TableHead className="text-right">Genauigkeit</TableHead><TableHead className="text-right">Zeit Mittel</TableHead><TableHead className="text-right">Zeit Median</TableHead><TableHead className="text-right">Rückfragen Mittel</TableHead><TableHead className="text-right">mit Rückfrage</TableHead><TableHead className="text-right">Sicherheit 1–5</TableHead><TableHead className="text-right">Sicherheit 0–1</TableHead></TableRow></TableHeader>
    <TableBody>{rows.map(([label, group]) => <TableRow key={label}>
      <TableCell>{label}</TableCell><TableCell className="text-right tabular-nums">{group.n}</TableCell>
      <TableCell className="text-right tabular-nums">{group.scored ? ratio(group.human_correct, group.scored) : '–'}</TableCell>
      <TableCell className="text-right tabular-nums">{duration(group.seconds.mean)}</TableCell><TableCell className="text-right tabular-nums">{duration(group.seconds.median)}</TableCell>
      <TableCell className="text-right tabular-nums">{number(group.chats.mean, 2)}</TableCell><TableCell className="text-right tabular-nums">{group.n ? ratio(group.with_chat, group.n) : '–'}</TableCell>
      <TableCell className="text-right tabular-nums">{number(group.certainty.mean, 2)}</TableCell><TableCell className="text-right tabular-nums">{number(group.certainty_normalized.mean, 2)}</TableCell>
    </TableRow>)}</TableBody>
  </Table>
}

function EvaluationSection() {
  const [sets, setSets] = useState<CaseSet[]>([])
  const [caseSet, setCaseSet] = useState('all')
  const [pilot, setPilot] = useState(false)
  const [data, setData] = useState<{ metrics: Metrics; sessions: Session[] } | null>(null)
  const [error, setError] = useState('')
  const query = `${caseSet === 'all' ? '' : `case_set_id=${caseSet}&`}include_pilot=${pilot}`
  useEffect(() => { api<{ items: CaseSet[] }>('case-sets').then(value => setSets(value.items)).catch(e => setError(e.message)) }, [])
  useEffect(() => {
    let active = true
    api<{ metrics: Metrics; sessions: Session[] }>(`evaluation?${query}`).then(value => { if (active) { setData(value); setError('') } }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [query])
  const exportFile = (kind: string, name: string) => download(`export?kind=${kind}&${query}`, name).catch(e => setError(e.message))
  const m = data?.metrics
  const wrong = m?.groups.ai_wrong.scored ?? 0
  const right = m?.groups.ai_correct.scored ?? 0
  return <Page title="Auswertung der Nutzerstudie" description="Beschreibende Auswertung aller Testläufe mit abgeschlossener Fallbearbeitung. Wegen der kleinen Stichprobe keine Signifikanztests."
    actions={<>
      <Button variant="outline" onClick={() => exportFile('entries', 'nutzerstudie-entscheidungen.csv')}><Download data-icon="inline-start" />Entscheidungen (CSV)</Button>
      <Button variant="outline" onClick={() => exportFile('questionnaires', 'nutzerstudie-fragebogen.csv')}><Download data-icon="inline-start" />Fragebogen (CSV)</Button>
      <Button variant="outline" onClick={() => exportFile('json', 'nutzerstudie.json')}><Download data-icon="inline-start" />Alles (JSON)</Button>
    </>}>
    <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card px-4 py-3">
      <Select value={caseSet} onValueChange={setCaseSet}><SelectTrigger className="w-72" aria-label="Fallset"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">Alle Fallsets</SelectItem>{sets.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectGroup></SelectContent></Select>
      <label className="flex items-center gap-2 text-sm"><Switch checked={pilot} onCheckedChange={setPilot} />Probeläufe einbeziehen</label>
    </div>
    <ErrorBox error={error} />
    {m && (m.decisions === 0 ? <Alert><AlertDescription>Noch keine abgeschlossenen Testläufe für diese Auswahl.</AlertDescription></Alert> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Testläufe" value={String(m.sessions)} hint={`${m.decisions} Entscheidungen`} />
        <Tile label="Genauigkeit der Endentscheidung" value={percent(m.groups.all.human_accuracy)} hint={`LLM allein auf denselben Fällen: ${percent(m.groups.all.scored ? m.groups.all.ai_correct / m.groups.all.scored : null)}`} />
        <Tile label="Falsche Vorschläge erkannt" value={wrong ? percent(m.outcomes.detected / wrong) : '–'} hint={`${m.outcomes.detected} von ${wrong} korrigiert, ${m.outcomes.adopted} übernommen, ${m.outcomes.other_wrong} falsch korrigiert`} />
        <Tile label="Richtige Vorschläge verschlechtert" value={right ? percent(m.outcomes.harmed / right) : '–'} hint={`${m.outcomes.harmed} von ${right}`} />
      </div>
      <Card className="shadow-none"><CardHeader><CardTitle>Nach Richtigkeit des LLM-Vorschlags</CardTitle><CardDescription>Werden Fehler erkannt oder übernommen? Dauern Fälle mit falschem Vorschlag länger und wird dort häufiger nachgefragt?</CardDescription></CardHeader><CardContent>
        <GroupTable rows={[['Alle Entscheidungen', m.groups.all], ['LLM-Vorschlag richtig', m.groups.ai_correct], ['LLM-Vorschlag falsch', m.groups.ai_wrong]]} />
      </CardContent></Card>
      <Card className="shadow-none"><CardHeader><CardTitle>Sicherheit nach Endentscheidung</CardTitle><CardDescription>Wie bei Si et al. (2024): Sicherheit auf 0 bis 1 umgerechnet, Mittelwert getrennt nach richtiger und falscher Endentscheidung.</CardDescription></CardHeader><CardContent>
        <GroupTable rows={[['Endentscheidung richtig', m.groups.final_correct], ['Endentscheidung falsch', m.groups.final_wrong], ['Vorschlag bestätigt', m.groups.confirmed], ['Vorschlag korrigiert', m.groups.corrected]]} />
      </CardContent></Card>
      <Card className="shadow-none"><CardHeader><CardTitle>Nach Konfidenz des Modells</CardTitle><CardDescription>Bearbeitungszeit, Rückfragen und Genauigkeit je Konfidenzbereich.</CardDescription></CardHeader><CardContent>
        <GroupTable rows={m.confidence_bins.filter(bin => bin.n > 0).map(bin => [bin.low === null || bin.high === null ? 'ohne Konfidenz' : `${Math.round(bin.low * 100)} bis ${Math.round(bin.high * 100)} %`, bin])} />
      </CardContent></Card>
      <Card className="shadow-none"><CardHeader><CardTitle>Je Fall</CardTitle><CardDescription>Über alle Teilnehmenden; welche Fälle wurden häufig falsch entschieden?</CardDescription></CardHeader><CardContent>
        <Table><TableHeader><TableRow><TableHead>Unternehmen</TableHead><TableHead>Referenz</TableHead><TableHead>LLM</TableHead><TableHead className="text-right">Konfidenz</TableHead><TableHead className="text-right">Genauigkeit</TableHead><TableHead className="text-right">Fehler übernommen</TableHead><TableHead className="text-right">Fehler erkannt</TableHead><TableHead className="text-right">verschlechtert</TableHead><TableHead className="text-right">Zeit Mittel</TableHead><TableHead className="text-right">Rückfragen Mittel</TableHead><TableHead className="text-right">Sicherheit 1–5</TableHead><TableHead>Entscheidungen</TableHead></TableRow></TableHeader>
          <TableBody>{m.per_case.map(item => <TableRow key={item.position}>
            <TableCell className="font-medium">{item.name}</TableCell><TableCell>{item.reference}</TableCell><TableCell>{item.ai_code ?? '–'}</TableCell>
            <TableCell className="text-right tabular-nums">{percent(item.confidence)}</TableCell><TableCell className="text-right tabular-nums">{item.scored ? ratio(item.human_correct, item.scored) : '–'}</TableCell>
            <TableCell className="text-right tabular-nums">{item.adopted}</TableCell><TableCell className="text-right tabular-nums">{item.detected}</TableCell><TableCell className="text-right tabular-nums">{item.harmed}</TableCell>
            <TableCell className="text-right tabular-nums">{duration(item.seconds.mean)}</TableCell><TableCell className="text-right tabular-nums">{number(item.chats.mean, 2)}</TableCell>
            <TableCell className="text-right tabular-nums">{number(item.certainty.mean, 2)}</TableCell><TableCell className="font-mono text-xs">{item.decisions.join(' ')}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </CardContent></Card>
      <Card className="shadow-none"><CardHeader><CardTitle>Je Testlauf</CardTitle></CardHeader><CardContent>
        <Table><TableHeader><TableRow><TableHead>Teilnehmer</TableHead><TableHead>Fallset</TableHead><TableHead className="text-right">Genauigkeit</TableHead><TableHead className="text-right">Dauer Fälle</TableHead><TableHead className="text-right">Rückfragen</TableHead><TableHead className="text-right">Raw TLX</TableHead><TableHead className="text-right">Nutzungsabsicht</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{data!.sessions.map(item => <TableRow key={item.id}>
            <TableCell className="font-medium">{item.participant_code}{item.pilot && <Badge variant="outline" className="ml-2">Probelauf</Badge>}</TableCell><TableCell>{item.case_set_name}</TableCell>
            <TableCell className="text-right tabular-nums">{ratio(item.correct, item.scored)}</TableCell><TableCell className="text-right tabular-nums">{duration(item.case_seconds)}</TableCell>
            <TableCell className="text-right tabular-nums">{item.chats}</TableCell><TableCell className="text-right tabular-nums">{number(item.raw_tlx)}</TableCell><TableCell className="text-right tabular-nums">{item.usability ?? '–'}</TableCell>
            <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => { window.location.hash = `study-runs/${item.id}` }}>Details</Button></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </CardContent></Card>
      <Card className="shadow-none"><CardHeader><CardTitle>Fragebogen</CardTitle><CardDescription>Raw NASA-TLX: ungewichteter Mittelwert der sechs Skalen (0 bis 100, höher = mehr Belastung). {m.questionnaire.n} beantwortete Fragebögen.</CardDescription></CardHeader><CardContent>
        <Table><TableHeader><TableRow><TableHead>Skala</TableHead><TableHead className="text-right">Mittel</TableHead><TableHead className="text-right">Median</TableHead><TableHead className="text-right">Min</TableHead><TableHead className="text-right">Max</TableHead></TableRow></TableHeader>
          <TableBody>
            {TLX_SCALES.map(scale => <StatsRow key={scale} label={TLX.de[scale].title} stats={m.questionnaire.scales[scale]} />)}
            <StatsRow label="Raw NASA-TLX" stats={m.questionnaire.raw_tlx} strong />
            <StatsRow label="Nutzungsabsicht (1–5)" stats={m.questionnaire.usability} />
          </TableBody>
        </Table>
        <p className="mt-4 text-sm text-muted-foreground">Verteilung Nutzungsabsicht: {Object.entries(m.questionnaire.usability_distribution).map(([value, n]) => `${value}: ${n}`).join(' · ')}</p>
      </CardContent></Card>
    </>)}
  </Page>
}

function StatsRow({ label, stats, strong = false }: { label: string; stats: Stats; strong?: boolean }) {
  const cell = `text-right tabular-nums${strong ? ' font-medium' : ''}`
  return <TableRow><TableCell className={strong ? 'font-medium' : undefined}>{label}</TableCell><TableCell className={cell}>{number(stats.mean)}</TableCell><TableCell className={cell}>{number(stats.median)}</TableCell><TableCell className={cell}>{number(stats.min)}</TableCell><TableCell className={cell}>{number(stats.max)}</TableCell></TableRow>
}
