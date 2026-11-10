import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Item = { osm_type: string; osm_id: string; name: string; category: string; osm: boolean; satellite: boolean }
const folderAttributes = { webkitdirectory: '', directory: '' }
const pngFiles = (files: FileList | null) => Array.from(files ?? []).filter(file => /\.png$/i.test(file.name))

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

function sourceTexts(value: unknown, path = ''): [string, string][] {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, entry]): [string, string][] => {
    const label = path ? `${path} · ${key}` : key
    if (typeof entry === 'string') {
      return entry.trim() && !/^https?:\/\//i.test(entry.trim()) && (entry.length > 180 || /website|wikipedia|wikidata|text|description|content|abstract/i.test(key)) ? [[label, entry]] : []
    }
    return sourceTexts(entry, label)
  })
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
            <Field><FieldLabel htmlFor="moneta-osm">Kartenbilder aus images/osm</FieldLabel><Input disabled={busy} id="moneta-osm" type="file" accept=".png" multiple onChange={e => setOsmFiles(Array.from(e.target.files ?? []))} /><FieldLabel htmlFor="moneta-osm-folder">Oder gesamten osm-Ordner auswählen</FieldLabel><Input disabled={busy} id="moneta-osm-folder" type="file" multiple {...folderAttributes} onChange={e => setOsmFiles(pngFiles(e.target.files))} /><span role="status" className="text-sm text-muted-foreground">{osmFiles.length} Kartenbilder für den Import ausgewählt</span></Field>
            <Field><FieldLabel htmlFor="moneta-satellite">Satellitenbilder aus images/satellite</FieldLabel><Input disabled={busy} id="moneta-satellite" type="file" accept=".png" multiple onChange={e => setSatelliteFiles(Array.from(e.target.files ?? []))} /><FieldLabel htmlFor="moneta-satellite-folder">Oder gesamten satellite-Ordner auswählen</FieldLabel><Input disabled={busy} id="moneta-satellite-folder" type="file" multiple {...folderAttributes} onChange={e => setSatelliteFiles(pngFiles(e.target.files))} /><span role="status" className="text-sm text-muted-foreground">{satelliteFiles.length} Satellitenbilder für den Import ausgewählt</span></Field>
          </div>
          <p className="text-sm text-muted-foreground">Wähle entweder mehrere PNG-Dateien oder den gesamten jeweiligen Bildordner aus. Prüfe die angezeigte Anzahl und starte anschließend den Import. Bilder können ohne erneute JSON-Auswahl ergänzt werden. Maximal 3 MB pro PNG.</p>
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
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{selected?.name}</DialogTitle>
          <DialogDescription>{selected?.osm_type}_{selected?.osm_id} · NACE {selected?.category}</DialogDescription>
        </DialogHeader>
        {selected && <div className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-2">{(['osm', 'satellite'] as const).map(kind => <figure key={kind} className="flex min-w-0 flex-col gap-2">
            <figcaption className="text-sm font-medium">{kind === 'osm' ? 'OpenStreetMap-Karte' : 'Satellitenbild'}</figcaption>
            {selected[kind] ? <img className="max-h-96 w-full rounded-lg border object-contain" src={`/api/moneta/records/${selected.osm_type}/${selected.osm_id}/images/${kind}?v=${revision}`} alt={`${kind === 'osm' ? 'Karte' : 'Satellitenbild'}: ${selected.name}`} /> : <p className="rounded-lg border p-6 text-sm text-muted-foreground">Dieses Bild wurde noch nicht hochgeladen.</p>}
          </figure>)}</div>
          <section className="flex flex-col gap-4" aria-label="Aufbereitete Texte">
            <h3 className="font-semibold">Aufbereitete Texte</h3>
            {!detail ? <p role="status">Quellen werden geladen …</p> : sourceTexts(detail).length ? sourceTexts(detail).map(([label, text]) => <div key={label} className="flex flex-col gap-2"><h4 className="text-sm font-medium">{label}</h4><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p></div>) : <p className="text-sm text-muted-foreground">Für diesen Datenpunkt sind keine angereicherten Texte vorhanden.</p>}
          </section>
          {detail !== null && <details><summary className="cursor-pointer text-sm text-muted-foreground">Alle Quelldaten und Metadaten</summary><pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs whitespace-pre-wrap break-words">{JSON.stringify(detail, null, 2)}</pre></details>}
        </div>}
      </DialogContent>
    </Dialog>
  </div>
}
