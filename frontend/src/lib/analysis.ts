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

// Threshold groups overlap, matching the cumulative comparisons in the kickoff.
export function kickoffStats(items: Item[]) {
  const references = [...new Set(items.map(item => item.reference))].sort()
  const byClass = references.map(reference => {
    const group = items.filter(item => item.reference === reference)
    return { reference, n: group.length, accuracy: group.filter(item => item.prediction === reference).length / group.length * 100 }
  }).sort((a, b) => a.accuracy - b.accuracy || a.reference.localeCompare(b.reference))
  const valid = items.filter((item): item is Item & { confidence: number } => item.confidence !== null)
  const groups = [
    { label: '<85 %', values: valid.filter(item => item.confidence < 0.85) },
    ...[85, 90, 95, 98].map(value => ({ label: `≥${value} %`, values: valid.filter(item => item.confidence >= value / 100) })),
  ].map(({ label, values }) => ({ label, n: values.length, accuracy: values.length ? values.filter(item => item.prediction === item.reference).length / values.length * 100 : null }))
  const byThreshold: Array<Record<string, string | number | null> & { threshold: string }> = [85, 90, 95, 98].map(value => {
    const group = valid.filter(item => item.confidence >= value / 100)
    const values: Record<string, number | null> = {}
    for (const reference of references) {
      const selected = group.filter(item => item.reference === reference)
      values[reference] = selected.length ? selected.filter(item => item.prediction === reference).length / selected.length * 100 : null
      values[`n_${reference}`] = selected.length
    }
    return { threshold: `≥${value} %`, ...values }
  })
  return { references, byClass, groups, byThreshold }
}

export function comparisonStats(runs: { model: string; setup: string; items: Item[] }[]) {
  const models = [...new Set(runs.map(run => run.model))]
  const rows = [...new Set(runs.map(run => run.setup))].map(setup => {
    const row: Record<string, string | number | null> = { setup }
    models.forEach((model, index) => {
      const accuracies = runs.filter(run => run.setup === setup && run.model === model).map(run => stats(run.items).accuracy).filter((value): value is number => value !== null).map(value => value * 100)
      const mean = accuracies.length ? accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length : null
      row[`series_${index}`] = mean
      row[`spread_${index}`] = mean !== null && accuracies.length > 1 ? Math.sqrt(accuracies.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (accuracies.length - 1)) : null
      row[`count_${index}`] = accuracies.length
    })
    return row
  })
  return { models, rows }
}

export type PlotDataset = { id: string; label: string; model: string; setup: string; items: Item[] }

export function plotDataset(body: { id: string; name: string; model: string; method?: string; prompt_config?: string; selection?: { dataset_name?: string }; sources?: Record<string, boolean> }, items: Item[]): PlotDataset {
  const sources = body.sources ? Object.entries(body.sources).filter(([, enabled]) => enabled).map(([key]) => ({ text: 'Text', osm: 'OSM', satellite: 'Satellit' }[key] ?? key)).join(' + ') || 'Nur Name' : 'Quellen unbekannt'
  const setup = [body.selection?.dataset_name ?? 'MONETA-1000', sources, body.method === 'multi_turn' ? 'Multi-Turn' : body.method === 'zero_shot' ? 'Zero-Shot' : body.method, body.prompt_config].filter(Boolean).join(' · ')
  return { id: body.id, label: body.name, model: body.model, setup, items }
}
