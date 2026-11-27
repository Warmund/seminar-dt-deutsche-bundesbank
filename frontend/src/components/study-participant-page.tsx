import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, ChevronLeft, ChevronRight, Layers2, LoaderCircle, MessageSquare } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { INTRO, SECTION_CODES, TEXT, TLX, TLX_SCALES, sectionName, type Language, type TlxScale } from '@/lib/study-i18n'

type Status = 'created' | 'running' | 'questionnaire' | 'completed'
type Me = { participant_code: string; language: Language; status: Status; cases: { rank: number; name: string; decided: boolean }[]; total: number }
type CaseData = {
  rank: number; total: number; name: string; texts: Record<string, string>; tags: Record<string, unknown>
  images: Record<'satellite' | 'osm', boolean>; clues: Record<string, string>
  ai: { code: string | null; confidence: number | null; explanation: string; evidence: string[]; uncertainty: string }
  entry: { decision: string | null; final_code: string | null; certainty: number | null; rationale: string; messages: { question: string; answer: string }[] }
}

class StudyError extends Error {
  status: number
  constructor(code: string, status: number) { super(code); this.status = status }
}

async function call<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/study/' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const value = await response.json().catch(() => null)
  if (!response.ok) throw new StudyError(typeof value?.detail === 'string' ? value.detail : 'generic', response.status)
  return value as T
}

// Timing events are best effort; the server measures the time between them.
function sendEvent(action: 'show' | 'hide', rank?: number) {
  void fetch('/api/study/me/events', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rank ? { action, rank } : { action }) }).catch(() => undefined)
}

function Shell({ language, children, side }: { language: Language; children: React.ReactNode; side?: React.ReactNode }) {
  return <div className="min-h-svh bg-muted/40 font-sans text-foreground">
    <header className="flex h-14 items-center justify-between border-b bg-background px-4 lg:px-8">
      <div className="flex items-center gap-2 text-sm font-medium"><span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Layers2 aria-hidden="true" className="size-4" /></span>{TEXT[language].appName}</div>
      {side}
    </header>
    <main className="mx-auto w-full max-w-[1600px] p-4 lg:p-8">{children}</main>
  </div>
}

export function StudyParticipantPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [language, setLanguage] = useState<Language>(() => navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const t = TEXT[language]
  const message = useCallback((e: unknown) => {
    const code = e instanceof StudyError ? e.message : 'generic'
    return TEXT[language].errors[code] ?? TEXT[language].errors.generic
  }, [language])

  const refresh = useCallback(async () => {
    try {
      const value = await call<Me>('me')
      setMe(value)
      setLanguage(value.language)
      setError('')
    } catch (e) {
      setMe(null)
      if (!(e instanceof StudyError && e.status === 401)) setError(message(e))
    } finally { setLoading(false) }
  }, [message])

  useEffect(() => { void refresh() }, [refresh])

  if (loading) return <main className="flex min-h-svh items-center justify-center" role="status"><LoaderCircle aria-hidden="true" className="size-8 animate-spin text-muted-foreground" /><span className="sr-only">{t.loading}</span></main>
  if (!me) return <CodeForm language={language} initialError={error} onDone={refresh} message={message} />
  const side = <Badge variant="outline">{t.participant}: {me.participant_code}</Badge>
  if (me.status === 'created') return <Shell language={language} side={side}><Intro language={language} onStart={async () => { await call('me/start', 'POST'); await refresh() }} message={message} /></Shell>
  if (me.status === 'running') return <Shell language={language} side={side}><Cases me={me} language={language} onChanged={refresh} message={message} /></Shell>
  if (me.status === 'questionnaire') return <Shell language={language} side={side}><QuestionnaireForm language={language} onDone={refresh} message={message} /></Shell>
  return <Shell language={language} side={side}><Card className="mx-auto mt-12 max-w-xl"><CardHeader><CardTitle role="heading" aria-level={1}>{t.doneTitle}</CardTitle><CardDescription>{t.doneText}</CardDescription></CardHeader></Card></Shell>
}

function CodeForm({ language, initialError, onDone, message }: { language: Language; initialError: string; onDone: () => Promise<void>; message: (e: unknown) => string }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const t = TEXT[language]
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try { await call('access', 'POST', { code }); await onDone() } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  return <div className="flex min-h-svh flex-col items-center justify-center bg-muted px-6 py-12 font-sans text-foreground">
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="flex items-center justify-center gap-2 text-sm font-medium"><span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Layers2 aria-hidden="true" className="size-4" /></span>{t.appName}</div>
      <Card>
        <CardHeader><CardTitle role="heading" aria-level={1}>{t.codeTitle}</CardTitle><CardDescription>{t.codeDescription}</CardDescription></CardHeader>
        <CardContent><form onSubmit={submit}><FieldGroup>
          <Field><FieldLabel htmlFor="study-code">{t.codeLabel}</FieldLabel><Input id="study-code" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX" maxLength={40} required className="font-mono tracking-widest" /></Field>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Button type="submit" disabled={busy || !code.trim()}>{t.codeSubmit}<ArrowRight data-icon="inline-end" aria-hidden="true" /></Button>
        </FieldGroup></form></CardContent>
      </Card>
    </div>
  </div>
}

function Intro({ language, onStart, message }: { language: Language; onStart: () => Promise<void>; message: (e: unknown) => string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const intro = INTRO[language]
  return <Card className="mx-auto mt-8 max-w-2xl">
    <CardHeader><CardTitle role="heading" aria-level={1} className="text-xl">{intro.title}</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-4">
      {intro.paragraphs.map(text => <p key={text} className="text-sm leading-relaxed">{text}</p>)}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button className="self-start" size="lg" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onStart() } catch (e) { setError(message(e)) } finally { setBusy(false) } }}>{TEXT[language].start}<ArrowRight data-icon="inline-end" aria-hidden="true" /></Button>
    </CardContent>
  </Card>
}

function ScaleButtons({ value, onChange, values, label, low, high, compact = false }: { value: number | null; onChange: (value: number) => void; values: number[]; label: string; low: string; high: string; compact?: boolean }) {
  return <div className="flex flex-col gap-1">
    <div role="radiogroup" aria-label={label} className={compact ? 'grid gap-0.5' : 'flex gap-2'} style={compact ? { gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` } : undefined}>
      {values.map(option => <Button key={option} type="button" role="radio" aria-checked={value === option} aria-label={`${option}`} variant={value === option ? 'default' : 'outline'} className={compact ? 'h-8 min-w-0 px-0 text-[0.65rem]' : 'flex-1'} onClick={() => onChange(option)}>{compact ? (option % 50 === 0 ? option : '') : option}</Button>)}
    </div>
    <p className="flex justify-between text-xs text-muted-foreground"><span>{low}</span><span>{high}</span></p>
  </div>
}

function Cases({ me, language, onChanged, message }: { me: Me; language: Language; onChanged: () => Promise<void>; message: (e: unknown) => string }) {
  const t = TEXT[language]
  const [rank, setRank] = useState(() => me.cases.find(item => !item.decided)?.rank ?? 1)
  const [data, setData] = useState<CaseData | null>(null)
  const [mode, setMode] = useState<'' | 'confirm' | 'correct'>('')
  const [code, setCode] = useState('')
  const [certainty, setCertainty] = useState<number | null>(null)
  const [rationale, setRationale] = useState('')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<number | 'finish' | null>(null)
  const [finishOpen, setFinishOpen] = useState(false)
  const rankRef = useRef(rank)

  const reset = useCallback((value: CaseData) => {
    const final = value.entry.final_code
    setMode(final ? (final === value.ai.code ? 'confirm' : 'correct') : '')
    setCode(final && final !== value.ai.code ? final : '')
    setCertainty(value.entry.certainty)
    setRationale(value.entry.rationale)
  }, [])

  useEffect(() => {
    let active = true
    rankRef.current = rank
    sendEvent('show', rank)
    setData(null)
    setError('')
    setQuestion('')
    call<CaseData>(`me/cases/${rank}`).then(value => { if (active) { setData(value); reset(value) } }).catch(e => { if (active) setError(message(e)) })
    return () => { active = false }
  }, [rank, reset, message])

  useEffect(() => {
    const visibility = () => sendEvent(document.visibilityState === 'hidden' ? 'hide' : 'show', document.visibilityState === 'hidden' ? undefined : rankRef.current)
    const leave = () => sendEvent('hide')
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', leave)
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', leave) }
  }, [])

  const finalCode = mode === 'confirm' ? data?.ai.code ?? '' : mode === 'correct' ? code : ''
  const saved = data?.entry
  const dirty = !!data && (finalCode !== (saved?.final_code ?? '') || certainty !== saved?.certainty || rationale.trim() !== (saved?.rationale ?? '')) && !!(mode || certainty || rationale.trim())
  const complete = !!finalCode && !!certainty && !!rationale.trim()
  const open = me.cases.filter(item => !item.decided).length

  function go(target: number | 'finish') {
    if (dirty) { setPending(target); return }
    if (target === 'finish') setFinishOpen(true)
    else setRank(target)
  }

  async function save() {
    if (!data || !complete) return
    setBusy(true)
    setError('')
    try {
      await call(`me/cases/${rank}/decision`, 'POST', { final_code: finalCode, certainty, rationale: rationale.trim() })
      const value = { ...data, entry: { ...data.entry, final_code: finalCode, certainty, rationale: rationale.trim(), decision: finalCode === data.ai.code ? 'confirmed' : 'corrected' } }
      setData(value)
      await onChanged()
      // Jump to the next open case (wrapping around); stay when all cases are decided.
      const open = new Set(me.cases.filter(item => !item.decided && item.rank !== rank).map(item => item.rank))
      const following = [...me.cases.map(item => item.rank).filter(item => item > rank), ...me.cases.map(item => item.rank).filter(item => item < rank)]
      const target = following.find(item => open.has(item))
      if (target) setRank(target)
    } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }

  async function ask() {
    if (!data || !question.trim()) return
    setAsking(true)
    setError('')
    try {
      const answer = await call<{ question: string; answer: string }>(`me/cases/${rank}/chat`, 'POST', { question: question.trim() })
      setData({ ...data, entry: { ...data.entry, messages: [...data.entry.messages, answer] } })
      setQuestion('')
    } catch (e) { setError(message(e)) } finally { setAsking(false) }
  }

  async function finish() {
    setBusy(true)
    setError('')
    try { await call('me/finish-cases', 'POST'); setFinishOpen(false); await onChanged() } catch (e) { setFinishOpen(false); setError(message(e)) } finally { setBusy(false) }
  }

  const total = me.cases.length
  return <div className="flex flex-col gap-5">
    <div className="flex flex-col gap-3 rounded-xl border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{t.caseOf(rank, total)}</p>
        <h1 className="truncate text-lg font-semibold tracking-tight">{data?.name ?? me.cases.find(item => item.rank === rank)?.name}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={rank <= 1} onClick={() => go(rank - 1)}><ChevronLeft data-icon="inline-start" />{t.previous}</Button>
        <Button variant="outline" disabled={rank >= total} onClick={() => go(rank + 1)}>{t.next}<ChevronRight data-icon="inline-end" /></Button>
        <Button disabled={open > 0 || busy} onClick={() => go('finish')}><Check data-icon="inline-start" />{t.finish}</Button>
      </div>
    </div>
    <nav aria-label={t.cases} className="flex flex-wrap items-center gap-2">
      {me.cases.map(item => <Button key={item.rank} size="sm" variant={item.rank === rank ? 'default' : 'outline'} aria-current={item.rank === rank ? 'step' : undefined} onClick={() => item.rank !== rank && go(item.rank)} className="min-w-10">
        {item.decided && <Check data-icon="inline-start" aria-label={t.decided} />}{item.rank}
      </Button>)}
      <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">{t.finishHint(open)}<Progress className="w-24" value={total ? ((total - open) / total) * 100 : 0} aria-label={t.decided} /></span>
    </nav>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {!data ? <div className="flex justify-center py-16" role="status"><LoaderCircle aria-hidden="true" className="size-6 animate-spin text-muted-foreground" /><span className="sr-only">{t.loading}</span></div> :
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,1fr)]">
        <Card className="min-w-0 gap-4 shadow-none xl:sticky xl:top-4">
          <CardHeader><CardTitle>{t.sources}</CardTitle></CardHeader>
          <CardContent>
            <Tabs defaultValue="texts" key={rank}>
              <TabsList className="w-full"><TabsTrigger value="texts">{t.texts}</TabsTrigger><TabsTrigger value="images">{t.images}</TabsTrigger><TabsTrigger value="tags">{t.tags}</TabsTrigger><TabsTrigger value="clues">{t.clues}</TabsTrigger></TabsList>
              <TabsContent value="texts" className="max-h-[65vh] overflow-y-auto pr-2">
                {Object.entries(data.texts).map(([source, text]) => <section key={source} className="border-b py-5 last:border-0"><h3 className="font-medium">{source}</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{text}</p></section>)}
                {!Object.keys(data.texts).length && <p className="py-4 text-sm text-muted-foreground">{t.noTexts}</p>}
              </TabsContent>
              <TabsContent value="images" className="max-h-[70vh] overflow-y-auto pr-2">
                {(['satellite', 'osm'] as const).map(kind => <section key={kind} className="mt-4"><h3 className="font-medium">{kind === 'satellite' ? t.satellite : t.map}</h3>
                  {data.images[kind] ? <a href={`/api/study/me/cases/${rank}/images/${kind}`} target="_blank" rel="noreferrer"><img className="mt-2 w-full rounded-lg" src={`/api/study/me/cases/${rank}/images/${kind}`} alt={kind === 'satellite' ? t.satellite : t.map} /></a> : <p className="py-2 text-sm text-muted-foreground">{t.missing}</p>}
                </section>)}
              </TabsContent>
              <TabsContent value="tags" className="max-h-[65vh] overflow-y-auto">
                {Object.keys(data.tags).length ? <Table><TableBody>{Object.entries(data.tags).map(([key, value]) => <TableRow key={key}><TableCell>{key}</TableCell><TableCell className="whitespace-normal">{String(value)}</TableCell></TableRow>)}</TableBody></Table> : <p className="py-4 text-sm text-muted-foreground">{t.noTags}</p>}
              </TabsContent>
              <TabsContent value="clues" className="max-h-[65vh] overflow-y-auto pr-2">
                {Object.entries(data.clues).map(([source, text]) => <section className="mt-4" key={source}><h3 className="font-medium">{source}</h3><p className="whitespace-pre-wrap text-sm">{text}</p></section>)}
                {!Object.keys(data.clues).length && <p className="py-4 text-sm text-muted-foreground">{t.noClues}</p>}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="shadow-none">
            <CardHeader className="gap-3">
              <CardTitle>{t.suggestion}</CardTitle>
              <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">{data.ai.code ?? '–'}</span>
                <div className="min-w-0">
                  <p className="font-semibold leading-snug text-primary">{sectionName(data.ai.code, language) || t.noSuggestion}</p>
                  <p className="text-xs text-muted-foreground">{t.confidence}: {data.ai.confidence !== null ? `${(data.ai.confidence * 100).toLocaleString(language === 'de' ? 'de-DE' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %` : t.noConfidence}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{data.ai.explanation || t.noExplanation}</p>
              {data.ai.evidence.map((text, index) => <p className="text-sm text-muted-foreground" key={index}>{text}</p>)}
              {data.ai.uncertainty && <p className="text-sm">{t.uncertainty}: {data.ai.uncertainty}</p>}
            </CardContent>
          </Card>
          <Card className="border-primary/25 shadow-none">
            <CardHeader><CardTitle className="flex items-center justify-between gap-3">{t.yourDecision}{dirty ? <Badge variant="outline">{t.unsaved}</Badge> : saved?.final_code ? <Badge variant="secondary"><Check data-icon="inline-start" />{t.saved}</Badge> : null}</CardTitle></CardHeader>
            <CardContent><FieldGroup>
              <div role="radiogroup" aria-label={t.yourDecision} className="grid gap-2 sm:grid-cols-2">
                <Button type="button" role="radio" aria-checked={mode === 'confirm'} variant={mode === 'confirm' ? 'default' : 'outline'} disabled={!data.ai.code || !SECTION_CODES.includes(data.ai.code)} onClick={() => setMode('confirm')}>{t.confirm}{data.ai.code ? ` (${data.ai.code})` : ''}</Button>
                <Button type="button" role="radio" aria-checked={mode === 'correct'} variant={mode === 'correct' ? 'default' : 'outline'} onClick={() => setMode('correct')}>{t.correct}</Button>
              </div>
              {mode === 'correct' && <Field><FieldLabel>{t.classLabel}</FieldLabel><Select value={code} onValueChange={setCode}><SelectTrigger aria-label={t.classLabel}><SelectValue placeholder={t.chooseClass} /></SelectTrigger><SelectContent><SelectGroup>{SECTION_CODES.filter(item => item !== data.ai.code).map(item => <SelectItem key={item} value={item}>{item} · {sectionName(item, language)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>}
              <Field><FieldLabel>{t.certainty}</FieldLabel><ScaleButtons value={certainty} onChange={setCertainty} values={[1, 2, 3, 4, 5]} label={t.certainty} low={t.certaintyLow} high={t.certaintyHigh} /></Field>
              <Field><FieldLabel htmlFor="study-rationale">{t.rationale}</FieldLabel><Textarea id="study-rationale" className="min-h-24" placeholder={t.rationaleHint} value={rationale} maxLength={5000} onChange={e => setRationale(e.target.value)} /></Field>
              <Button disabled={busy || !complete || !dirty} onClick={save}>{t.save}</Button>
            </FieldGroup></CardContent>
          </Card>
          <Card className="shadow-none">
            <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="size-4" />{t.questions}</CardTitle><CardDescription>{t.questionsHint}</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-3">
              {data.entry.messages.map((item, index) => <div key={index} className="flex flex-col gap-2 border-b pb-3"><p className="text-sm font-medium">{item.question}</p><p className="whitespace-pre-wrap text-sm">{item.answer}</p></div>)}
              <Field><FieldLabel htmlFor="study-question">{t.question}</FieldLabel><Textarea id="study-question" className="min-h-16" value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)} /></Field>
              <Button variant="outline" disabled={asking || !question.trim()} onClick={ask}>{asking ? t.asking : t.ask}</Button>
            </CardContent>
          </Card>
        </div>
      </div>}
    <Dialog open={pending !== null} onOpenChange={value => { if (!value) setPending(null) }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader><DialogTitle>{t.discardTitle}</DialogTitle><DialogDescription>{t.discardText}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setPending(null)}>{t.stay}</Button><Button variant="destructive" onClick={() => { const target = pending; setPending(null); if (data) reset(data); if (target === 'finish') setFinishOpen(true); else if (target !== null) setRank(target) }}>{t.discard}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={finishOpen} onOpenChange={setFinishOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.finishTitle}</DialogTitle><DialogDescription>{t.finishText}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setFinishOpen(false)}>{t.cancel}</Button><Button disabled={busy} onClick={finish}>{t.finish}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}

function QuestionnaireForm({ language, onDone, message }: { language: Language; onDone: () => Promise<void>; message: (e: unknown) => string }) {
  const t = TEXT[language]
  const [tlx, setTlx] = useState<Record<TlxScale, number | null>>({ mental: null, physical: null, temporal: null, performance: null, effort: null, frustration: null })
  const [usability, setUsability] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const complete = TLX_SCALES.every(scale => tlx[scale] !== null) && usability !== null
  const steps = Array.from({ length: 21 }, (_, index) => index * 5)
  async function submit() {
    if (!complete) { setError(t.answerAll); return }
    setBusy(true)
    setError('')
    try { await call('me/questionnaire', 'POST', { tlx, usability, comment: comment.trim() }); await onDone() } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  return <Card className="mx-auto max-w-3xl">
    <CardHeader><CardTitle role="heading" aria-level={1} className="text-xl">{t.questionnaireTitle}</CardTitle><CardDescription>{t.questionnaireText}</CardDescription></CardHeader>
    <CardContent><FieldGroup>
      {TLX_SCALES.map(scale => <Field key={scale}>
        <FieldLabel>{TLX[language][scale].title}</FieldLabel>
        <p className="text-sm text-muted-foreground">{TLX[language][scale].question}</p>
        <ScaleButtons compact value={tlx[scale]} onChange={value => setTlx(current => ({ ...current, [scale]: value }))} values={steps} label={TLX[language][scale].title} low={TLX[language][scale].low} high={TLX[language][scale].high} />
      </Field>)}
      <Field>
        <FieldLabel>{t.usabilityTitle}</FieldLabel>
        <p className="text-sm text-muted-foreground">{t.usabilityQuestion}</p>
        <ScaleButtons value={usability} onChange={setUsability} values={[1, 2, 3, 4, 5]} label={t.usabilityQuestion} low={t.usabilityLow} high={t.usabilityHigh} />
      </Field>
      <Field><FieldLabel htmlFor="study-comment">{t.comment}</FieldLabel><Textarea id="study-comment" value={comment} maxLength={5000} onChange={e => setComment(e.target.value)} /></Field>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button disabled={busy} onClick={submit}>{t.submit}</Button>
    </FieldGroup></CardContent>
  </Card>
}
