import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Item = { osm_type?: string; osm_id?: string; reference: string; prediction: string; confidence: number | null; method: string }
type RunItem = { osm_type?: string; osm_id?: string; reference?: unknown; category?: unknown; result?: { reference?: unknown; prediction?: { category?: unknown; confidence?: unknown }; confidence?: unknown; confidence_method?: unknown; provider?: string } | null; llm_response?: unknown; prediction?: string | { category?: unknown; confidence?: unknown }; confidence?: unknown; confidence_method?: unknown }
type Run = { id: string; name: string; model: string }
function normalize(value: unknown): { items: Item[]; skipped: number } {
  const payload = value as { items?: unknown } | null
  const rows = Array.isArray(value) ? value : payload?.items
  if (!Array.isArray(rows)) throw new Error('Erwartet wird ein Lauf mit items oder eine Liste von Ergebnissen.')
  const items = rows.flatMap((raw: RunItem): Item[] => {
    if (!raw || typeof raw !== 'object') return []
    const ref = raw.reference ?? raw.category ?? raw.result?.reference
    const pred = raw.result?.prediction?.category ?? (typeof raw.prediction === 'string' ? raw.prediction : raw.prediction?.category) ?? raw.llm_response
    const conf = raw.result?.confidence ?? raw.result?.prediction?.confidence ?? (typeof raw.prediction === 'object' ? raw.prediction?.confidence : undefined) ?? raw.confidence
    if (typeof ref !== 'string' || typeof pred !== 'string' || !/^[A-U]$/.test(ref) || !/^([A-U]|UNK)$/.test(pred)) return []
    return [{ osm_type: raw.osm_type, osm_id: raw.osm_id, reference: ref, prediction: pred, confidence: typeof conf === 'number' && Number.isFinite(conf) && conf >= 0 && conf <= 1 ? conf : null, method: String(raw.result?.confidence_method ?? raw.confidence_method ?? (raw.result?.provider === 'opencode' ? 'jev' : 'unbekannt')) }]
  })
  return { items, skipped: rows.length - items.length }
}
const fmt = (n: number | null) => n === null ? '–' : `${(n * 100).toFixed(1)} %`
function hash(item: Item, index: number) {
  const str = item.osm_id ? `${item.osm_type}_${item.osm_id}` : String(index)
  let h = 2166136261
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) % 100
}
function stats(items: Item[]) {
  const valid = items.filter((x): x is Item & { confidence: number } => x.confidence !== null)
  const bins = Array.from({ length: 10 }, (_, i) => {
    const group = valid.filter(x => Math.min(9, Math.floor(x.confidence * 10)) === i)
    return { label: `${i * 10}–${(i + 1) * 10}`, n: group.length, confidence: group.length ? group.reduce((a,x) => a+x.confidence,0)/group.length : null, accuracy: group.length ? group.filter(x => x.prediction === x.reference).length/group.length : null }
  })
  const ece = valid.length ? bins.reduce((a,b) => a+(b.n/valid.length)*Math.abs((b.accuracy ?? 0)-(b.confidence ?? 0)),0) : null
  const correct = valid.filter(x => x.prediction === x.reference), wrong = valid.filter(x => x.prediction !== x.reference)
  let wins = 0, negatives = 0
  const sorted = [...valid].sort((a, b) => a.confidence - b.confidence)
  for (let i = 0; i < sorted.length;) {
    let j = i, positives = 0, groupNegatives = 0
    while (j < sorted.length && sorted[j].confidence === sorted[i].confidence) {
      if (sorted[j].prediction === sorted[j].reference) positives++; else groupNegatives++
      j++
    }
    wins += positives * (negatives + groupNegatives / 2)
    negatives += groupNegatives
    i = j
  }
  return { valid, bins, ece, auc: correct.length && wrong.length ? wins/(correct.length*wrong.length) : null, accuracy: items.length ? items.filter(x => x.prediction === x.reference).length/items.length : null }
}
function threshold(items: Item[], t: number) {
  const valid = items.filter(x => x.confidence !== null)
  const auto = valid.filter(x => x.confidence! >= t)
  return { review: items.length ? (items.length-auto.length)/items.length : null, accuracy: auto.length ? auto.filter(x => x.reference === x.prediction).length/auto.length : null, n: auto.length }
}
export function AnalysisPage() {
  const [runs,setRuns]=useState<Run[]>([]), [offset,setOffset]=useState(0), [data,setData]=useState<Item[]>([]), [label,setLabel]=useState(''), [error,setError]=useState(''), [cut,setCut]=useState(0.8), [lockedCut,setLockedCut]=useState<number | null>(null), [skipped,setSkipped]=useState(0)
  useEffect(() => { const c=new AbortController(); fetch(`/api/classification/runs?offset=${offset}`,{signal:c.signal}).then(async r=>{if(!r.ok) throw new Error('Läufe konnten nicht geladen werden.'); return r.json()}).then(x=>setRuns(x.items)).catch(e=>{if(e.name!=='AbortError') setError(e.message)}); return()=>c.abort() },[offset])
  async function load(id:string) { try { setError('');const r=await fetch(`/api/classification/runs/${id}`);if(!r.ok)throw new Error('Lauf konnte nicht geladen werden.'); const body=await r.json();const {items,skipped}=normalize(body);if(!items.length)throw new Error('Keine abgeschlossenen Ergebnisse mit Referenz gefunden.');setData(items);setSkipped(skipped);setLockedCut(null);setLabel(`${body.name} · ${body.model}`) } catch(e){setError(e instanceof Error?e.message:'Fehler')} }
  async function upload(file:File|undefined) { if(!file)return;try{setError('');if(file.size>20_000_000)throw new Error('Datei darf maximal 20 MB groß sein.');const {items,skipped}=normalize(JSON.parse(await file.text()));if(!items.length)throw new Error('Keine gültigen Ergebnisse mit Referenz gefunden.');setData(items);setSkipped(skipped);setLockedCut(null);setLabel(file.name)}catch(e){setError(e instanceof Error?e.message:'Datei ungültig.')} }
  const metrics=useMemo(()=>stats(data),[data]); const train=useMemo(()=>data.filter((x,i)=>hash(x,i)<70),[data]);const test=useMemo(()=>data.filter((x,i)=>hash(x,i)>=70),[data]);const training=threshold(train,cut),testing=threshold(test,lockedCut ?? cut); const methods = [...new Set(metrics.valid.map(x => x.method))]; const mixed = methods.length > 1
  const curve=useMemo(()=>Array.from({length:101},(_,i)=>{const t=i/100,v=threshold(train,t);return {threshold:i, review:v.review === null ? null : v.review*100, accuracy:v.accuracy===null?null:v.accuracy*100}}),[train])
  const pareto = useMemo(() => curve.filter(a => a.accuracy !== null && !curve.some(b => b.accuracy !== null && b.review !== null && a.review !== null && b.review <= a.review && b.accuracy >= a.accuracy! && (b.review < a.review || b.accuracy > a.accuracy!))).filter((a, i, all) => all.findIndex(b => b.review === a.review && b.accuracy === a.accuracy) === i), [curve])
  return <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 lg:p-8"><h1 className="text-xl font-semibold">Analyse</h1>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>Datensatz laden</CardTitle><CardDescription>Gespeicherten Lauf oder Ergebnis-JSON auswählen.</CardDescription></CardHeader><CardContent className="grid items-end gap-4 md:grid-cols-2"><Field><FieldLabel>Gespeicherter Lauf</FieldLabel><Select onValueChange={load}><SelectTrigger className="w-full"><SelectValue placeholder="Lauf auswählen" /></SelectTrigger><SelectContent><SelectGroup>{runs.map(r=><SelectItem key={r.id} value={r.id}>{r.name} · {r.model}</SelectItem>)}</SelectGroup></SelectContent></Select><div className="flex gap-2"><Button size="sm" variant="outline" disabled={offset===0} onClick={()=>setOffset(x=>x-25)}>Zurück</Button><Button size="sm" variant="outline" disabled={runs.length<25} onClick={()=>setOffset(x=>x+25)}>Weitere</Button></div></Field><Field><FieldLabel htmlFor="analysis-file">JSON-Datei</FieldLabel><Input id="analysis-file" type="file" accept=".json,application/json" onChange={e=>upload(e.target.files?.[0])} /></Field></CardContent></Card>
    {data.length>0 && <><div><h2 className="font-semibold">{label}</h2><p className="text-sm text-muted-foreground">{data.length} Ergebnisse · {skipped} ausgelassen · {metrics.valid.length} mit numerischer Konfidenz · {data.length-metrics.valid.length} ohne Konfidenz · Methode: {methods.join(', ') || '–'}</p></div>
    {mixed && <Alert variant="destructive"><AlertDescription>Der Datensatz enthält unterschiedliche Konfidenzmethoden. Bitte getrennte Datensätze analysieren.</AlertDescription></Alert>}
    {!mixed && <><div className="grid gap-4 sm:grid-cols-3">{[['Accuracy',fmt(metrics.accuracy)],['ECE (10 Klassen)',fmt(metrics.ece)],['AUROC · richtig vs. falsch',metrics.auc===null?'–':metrics.auc.toFixed(3)]].map(([name,value])=><Card key={name}><CardHeader><CardDescription>{name}</CardDescription><CardTitle>{value}</CardTitle></CardHeader></Card>)}</div>
    <Card><CardHeader><CardTitle>Kalibrierung</CardTitle><CardDescription>Konfidenz und tatsächliche Accuracy je Intervall. ECE verwendet nur Ergebnisse mit Konfidenz.</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Konfidenz (%)</th><th>Anzahl</th><th>Ø Konfidenz</th><th>Accuracy</th></tr></thead><tbody>{metrics.bins.map(b=><tr key={b.label} className="border-b"><td className="p-2">{b.label}</td><td>{b.n}</td><td>{fmt(b.confidence)}</td><td>{fmt(b.accuracy)}</td></tr>)}</tbody></table></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Schwellenwert</CardTitle><CardDescription>Konfidenz unter dem Schwellenwert wird zur Prüfung weitergeleitet. Ergebnisse ohne Konfidenz werden ebenfalls zur Prüfung gezählt.</CardDescription></CardHeader><CardContent className="flex flex-col gap-5"><Field><FieldLabel htmlFor="threshold">Schwelle: {Math.round(cut*100)} %</FieldLabel><Input id="threshold" type="range" min="0" max="100" value={Math.round(cut*100)} onChange={e=>{setCut(Number(e.target.value)/100);setLockedCut(null)}} /></Field><p className="text-sm text-muted-foreground">Feste Aufteilung nach Datenpunkt-ID: 70 % zur Auswahl, 30 % zur Überprüfung. Prüffälle ohne ID werden anhand ihrer Reihenfolge aufgeteilt. Wiederholte Anpassungen nach Einsicht in die Überprüfung können deren Aussagekraft verzerren.</p><Button variant="outline" className="w-fit" onClick={()=>setLockedCut(cut)}>Schwelle festlegen</Button><div className="grid gap-3 sm:grid-cols-2">{[['Auswahl',training,train.length],...(lockedCut === null ? [] : [['Überprüfung',testing,test.length]])].map(([name,value,n])=>{const v=value as ReturnType<typeof threshold>;return <div key={String(name)} className="rounded-lg border p-4 text-sm"><strong>{String(name)} · {String(n)} Fälle</strong><p>Manuell: {fmt(v.review)} · Automatisch: {v.n}</p><p>Accuracy automatisch: {fmt(v.accuracy)}</p></div>})}</div><div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={curve}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="threshold" label={{ value:'Schwelle (%)', position:'insideBottom', offset:-5 }} /><YAxis domain={[0,100]} /><Tooltip /><Line type="monotone" dataKey="review" name="Prüfanteil (%)" stroke="var(--chart-2)" dot={false} /><Line type="monotone" dataKey="accuracy" name="Accuracy automatisch (%)" stroke="var(--primary)" dot={false} connectNulls={false} /></LineChart></ResponsiveContainer></div><details><summary className="cursor-pointer text-sm font-medium">Pareto-Schwellen · Auswahlmenge</summary><p className="mt-2 text-xs text-muted-foreground">Nicht dominierte Kombinationen aus Prüfanteil und automatischer Accuracy.</p><div className="mt-2 max-h-48 overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th>Schwelle</th><th>Prüfanteil</th><th>Accuracy automatisch</th></tr></thead><tbody>{pareto.map(p=><tr key={p.threshold} className="border-t"><td><Button variant="link" className="h-8 px-0" onClick={()=>{setCut(p.threshold/100);setLockedCut(null)}}>{p.threshold} %</Button></td><td>{p.review?.toFixed(1)} %</td><td>{p.accuracy?.toFixed(1)} %</td></tr>)}</tbody></table></div></details></CardContent></Card>
    <Card><CardHeader><CardTitle>Ergebnisse nach Referenzklasse</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Klasse</th><th>Anzahl</th><th>Accuracy</th><th>ECE</th><th>AUROC</th></tr></thead><tbody>{[...new Set(data.map(x=>x.reference))].sort().map(c=>{const m=stats(data.filter(x=>x.reference===c));return <tr className="border-b" key={c}><td className="p-2">{c}</td><td>{data.filter(x=>x.reference===c).length}</td><td>{fmt(m.accuracy)}</td><td>{fmt(m.ece)}</td><td>{m.auc===null?'–':m.auc.toFixed(3)}</td></tr>})}</tbody></table></div></CardContent></Card></>}
    <Alert><AlertDescription>Die Auswertung menschlicher Entscheidungen, Bearbeitungszeiten und Rückfragen benötigt Daten aus einer Nutzerstudie. Diese werden derzeit noch nicht erfasst.</AlertDescription></Alert></>}
  </div>
}
