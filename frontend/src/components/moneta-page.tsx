import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Item = { osm_type: string; osm_id: string; name: string; category: string; osm: boolean; satellite: boolean }
type Overview = { total: number; items: Item[] }
const MAX_SIZE = 3_000_000

async function api(path: string, options?: RequestInit) {
  const response = await fetch(`/api/moneta${path}`, options)
  if (!response.ok) {
    let message = response.status === 401 ? 'Die Sitzung ist abgelaufen. Bitte neu anmelden.' : `Anfrage fehlgeschlagen (${response.status})`
    try { const body = await response.json(); if (typeof body.detail === 'string') message = body.detail } catch { /* Non-JSON proxy errors retain the status. */ }
    throw new Error(message)
  }
  return response.json()
}

export function MonetaPage() {
  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [osmFiles, setOsmFiles] = useState<File[]>([])
  const [satelliteFiles, setSatelliteFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [revision, setRevision] = useState(0)
  const [overview, setOverview] = useState<Overview>({ total: 0, items: [] })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Item | null>(null)
  const [detail, setDetail] = useState<unknown>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    api(`/records?q=${encodeURIComponent(q)}&offset=${offset}`, { signal: controller.signal })
      .then(setOverview).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [q, offset, revision])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    setDetail(null)
    api(`/records/${selected.osm_type}/${selected.osm_id}`, { signal: controller.signal })
      .then(setDetail).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    return () => controller.abort()
  }, [selected])

  async function upload() {
    setBusy(true); setError(''); setProgress('Dateien werden geprüft …'); setSelected(null)
    let saved = 0
    let cleaned = 0
    try {
      const records: string[] = []
      if (jsonFile) {
        if (jsonFile.size > 100_000_000) throw new Error('Die JSON-Datei darf höchstens 100 MB groß sein.')
        const parsed: unknown = JSON.parse(await jsonFile.text())
        if (!Array.isArray(parsed) || !parsed.length) throw new Error('Die JSON-Datei muss eine nicht leere Liste von MONETA-Datenpunkten enthalten.')
        const keys = new Set<string>()
        for (const record of parsed) {
          if (!record || !['node', 'way', 'relation'].includes(record.type) || !Number.isSafeInteger(record.id) || record.id <= 0 || !/^[A-U]$/.test(record.category) || !Array.isArray(record.bbox) || record.bbox.length !== 4 || !(record.tags?.name || record.osm_tags?.name || record.name)) throw new Error('Ungültiger Datenpunkt: type, id, category, bbox und Name sind erforderlich.')
          const key = `${record.type}_${record.id}`
          if (keys.has(key)) throw new Error(`Doppelter Datenpunkt in der Datei: ${key}`)
          keys.add(key)
          const body = JSON.stringify(record)
          if (new Blob([body]).size > MAX_SIZE) throw new Error(`Datenpunkt ${key} überschreitet 3 MB.`)
          records.push(body)
        }
      }
      const images = [...osmFiles.map(file => ({ file, kind: 'osm' })), ...satelliteFiles.map(file => ({ file, kind: 'satellite' }))]
      const imageKeys = new Set<string>()
      for (const { file, kind } of images) {
        if (!/^(node|way|relation)_[1-9]\d*\.png$/.test(file.name)) throw new Error(`Ungültiger Bildname: ${file.name}. Erwartet wird z. B. way_123.png.`)
        if (file.size > MAX_SIZE) throw new Error(`${file.name} überschreitet 3 MB.`)
        const key = kind + file.name
        if (imageKeys.has(key)) throw new Error(`Doppeltes Bild: ${file.name}`)
        imageKeys.add(key)
      }
      const total = records.length + images.length
      for (const body of records) {
        setProgress(`Import ${saved + 1} von ${total}: Unternehmensdaten`)
        const record = JSON.parse(body)
        try {
          const result = await api('/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
          cleaned += result.removed_null_characters ?? 0
        } catch (e) { throw new Error(`${record.type}_${record.id} (${record.tags?.name ?? record.name ?? ''}): ${e instanceof Error ? e.message : 'Import fehlgeschlagen'}`) }
        saved++
      }
      for (const { file, kind } of images) {
        const [type, id] = file.name.slice(0, -4).split('_')
        setProgress(`Import ${saved + 1} von ${total}: ${file.name}`)
        try { await api(`/records/${type}/${id}/images/${kind}`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: file }) }
        catch (e) { throw new Error(`${file.name}: ${e instanceof Error ? e.message : 'Upload fehlgeschlagen'}`) }
        saved++
      }
      setProgress(`Import abgeschlossen: ${saved} Datenpunkte und Bilder gespeichert.${cleaned ? ` ${cleaned} ungültige Nullzeichen aus Quelltexten entfernt.` : ''}`)
    } catch (e) {
      setError(`${e instanceof Error ? e.message : 'Import fehlgeschlagen'} Bereits gespeichert: ${saved}. Ein erneuter Import kann sicher gestartet werden.`)
      setProgress(`Import angehalten.${cleaned ? ` Bis dahin ${cleaned} Nullzeichen bereinigt.` : ''}`)
    } finally { setBusy(false); setOffset(0); setRevision(r => r + 1) }
  }

  return <div className="flex flex-col gap-6 p-4 lg:p-6">
    <Card>
      <CardHeader><CardTitle>Daten importieren</CardTitle><CardDescription>MONETA_extended.json und die lokal erzeugten PNG-Bilder auswählen. Bilder werden über ihren Dateinamen dem Unternehmen zugeordnet. Bestehende Datenpunkte werden aktualisiert; vorhandene Bilder bleiben erhalten.</CardDescription></CardHeader>
      <CardContent>
        <FieldGroup>
          <Field><FieldLabel htmlFor="moneta-json">Angereicherte Daten (JSON)</FieldLabel><Input disabled={busy} id="moneta-json" type="file" accept=".json,application/json" onChange={e => setJsonFile(e.target.files?.[0] ?? null)} /></Field>
          <div className="grid gap-5 md:grid-cols-2">
            <Field><FieldLabel htmlFor="moneta-osm">Kartenbilder aus images/osm</FieldLabel><Input disabled={busy} id="moneta-osm" type="file" accept=".png" multiple onChange={e => setOsmFiles(Array.from(e.target.files ?? []))} /><span className="text-sm text-muted-foreground">{osmFiles.length} Bilder ausgewählt</span></Field>
            <Field><FieldLabel htmlFor="moneta-satellite">Satellitenbilder aus images/satellite</FieldLabel><Input disabled={busy} id="moneta-satellite" type="file" accept=".png" multiple onChange={e => setSatelliteFiles(Array.from(e.target.files ?? []))} /><span className="text-sm text-muted-foreground">{satelliteFiles.length} Bilder ausgewählt</span></Field>
          </div>
          <p className="text-sm text-muted-foreground">Bilder können auch später ergänzt werden. PNG: maximal 3 MB pro Bild. Zuerst werden die JSON-Daten importiert.</p>
          <div><Button disabled={busy || (!jsonFile && !osmFiles.length && !satelliteFiles.length)} onClick={upload}>{busy ? 'Import läuft …' : 'Import starten'}</Button></div>
          {progress && <p role="status" className="text-sm text-muted-foreground">{progress}</p>}
        </FieldGroup>
      </CardContent>
    </Card>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Card>
      <CardHeader><CardTitle>Datenpunkte</CardTitle><CardDescription>{overview.total} Treffer · NACE-Abschnitte aus dem importierten Datensatz</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input aria-label="Datenpunkte suchen" placeholder="Name, OSM-ID oder NACE-Abschnitt suchen …" value={q} onChange={e => { setQ(e.target.value); setOffset(0) }} />
        <Table><TableHeader><TableRow><TableHead>Unternehmen</TableHead><TableHead>OSM-ID</TableHead><TableHead>NACE</TableHead><TableHead>Karte</TableHead><TableHead>Satellit</TableHead><TableHead><span className="sr-only">Details</span></TableHead></TableRow></TableHeader>
          <TableBody>{loading ? <TableRow><TableCell colSpan={6}>Daten werden geladen …</TableCell></TableRow> : !overview.items.length ? <TableRow><TableCell colSpan={6}>Keine Datenpunkte vorhanden.</TableCell></TableRow> : overview.items.map(item => <TableRow key={`${item.osm_type}_${item.osm_id}`}>
            <TableCell>{item.name}</TableCell><TableCell>{item.osm_type}_{item.osm_id}</TableCell><TableCell><Badge variant="secondary">{item.category}</Badge></TableCell><TableCell>{item.osm ? 'Vorhanden' : 'Fehlt'}</TableCell><TableCell>{item.satellite ? 'Vorhanden' : 'Fehlt'}</TableCell><TableCell><Button variant="outline" size="sm" onClick={() => setSelected(item)}>Details</Button></TableCell>
          </TableRow>)}</TableBody></Table>
        <div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">Seite {Math.floor(offset / 25) + 1} von {Math.max(1, Math.ceil(overview.total / 25))}</span><div className="flex gap-2"><Button variant="outline" disabled={loading || offset === 0} onClick={() => setOffset(o => o - 25)}>Zurück</Button><Button variant="outline" disabled={loading || offset + 25 >= overview.total} onClick={() => setOffset(o => o + 25)}>Weiter</Button></div></div>
      </CardContent>
    </Card>
    {selected && <Card><CardHeader><CardTitle>{selected.name}</CardTitle><CardDescription>{selected.osm_type}_{selected.osm_id} · NACE {selected.category}</CardDescription><Button variant="outline" onClick={() => setSelected(null)}>Details schließen</Button></CardHeader><CardContent className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">{(['osm', 'satellite'] as const).filter(kind => selected[kind]).map(kind => <figure key={kind}><img className="w-full rounded-lg border" src={`/api/moneta/records/${selected.osm_type}/${selected.osm_id}/images/${kind}?v=${revision}`} alt={kind === 'osm' ? `Karte: ${selected.name}` : `Satellitenbild: ${selected.name}`} /><figcaption className="mt-2 text-sm text-muted-foreground">{kind === 'osm' ? 'OpenStreetMap-Karte' : 'Satellitenbild'}</figcaption></figure>)}</div>
      <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs whitespace-pre-wrap break-words">{detail ? JSON.stringify(detail, null, 2) : 'Quellen und Metadaten werden geladen …'}</pre>
    </CardContent></Card>}
  </div>
}
