export type Item = { osm_type?: string; osm_id?: string; reference: string; prediction: string; confidence: number | null; method: string }
type RunItem = { osm_type?: string; osm_id?: string; reference?: unknown; category?: unknown; result?: { reference?: unknown; prediction?: { category?: unknown; confidence?: unknown }; confidence?: unknown; confidence_method?: unknown; provider?: string } | null; llm_response?: unknown; prediction?: string | { category?: unknown; confidence?: unknown }; confidence?: unknown; confidence_method?: unknown }
export function normalize(value: unknown): { items: Item[]; skipped: number } {
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
export function hash(item: Item, index: number) {
  const str = item.osm_id ? `${item.osm_type}_${item.osm_id}` : String(index)
  let h = 2166136261
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) % 100
}
export function stats(items: Item[]) {
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
export function threshold(items: Item[], t: number) {
  const valid = items.filter(x => x.confidence !== null)
  const auto = valid.filter(x => x.prediction !== 'UNK' && x.confidence! >= t)
  return { review: items.length ? (items.length-auto.length)/items.length : null, accuracy: auto.length ? auto.filter(x => x.reference === x.prediction).length/auto.length : null, n: auto.length }
}
