// Helpers for composing a study case set. The criteria from the study proposal are shown as guidance only;
// the team can pick any combination of finished cases.

export type Candidate = {
  position: number
  name: string
  osm: string
  reference: string
  ai_code: string | null
  confidence: number | null
  correct: boolean | null
  texts: number
  images: number
}

export type SelectionSummary = {
  n: number
  correct: number
  wrong: number
  unscored: number
  wrongShare: number | null
  baselineWrongShare: number | null
  baselineN: number
  aboveThreshold: number
  missingConfidence: number
  sections: string[]
  bins: { low: number; high: number; n: number; wrong: number }[]
}

const isCode = (value: string | null) => !!value && /^[A-U]$/.test(value)

export function belowThreshold(item: Candidate, threshold: number | null) {
  return threshold === null || (item.confidence !== null && item.confidence < threshold)
}

export function confidenceBins(threshold: number | null, count = 5) {
  const top = threshold ?? 1
  return Array.from({ length: count }, (_, index) => ({ low: (top / count) * index, high: (top / count) * (index + 1) }))
}

export function summarize(selected: Candidate[], all: Candidate[], threshold: number | null): SelectionSummary {
  const scored = selected.filter(item => item.correct !== null)
  const baseline = all.filter(item => item.correct !== null && belowThreshold(item, threshold))
  const bins = confidenceBins(threshold).map((bin, index, list) => {
    const inBin = selected.filter(item => item.confidence !== null && item.confidence >= bin.low && (item.confidence < bin.high || (index === list.length - 1 && item.confidence <= bin.high)))
    return { ...bin, n: inBin.length, wrong: inBin.filter(item => item.correct === false).length }
  })
  return {
    n: selected.length,
    correct: scored.filter(item => item.correct).length,
    wrong: scored.filter(item => !item.correct).length,
    unscored: selected.length - scored.length,
    wrongShare: scored.length ? scored.filter(item => !item.correct).length / scored.length : null,
    baselineWrongShare: baseline.length ? baseline.filter(item => !item.correct).length / baseline.length : null,
    baselineN: baseline.length,
    aboveThreshold: selected.filter(item => !belowThreshold(item, threshold)).length,
    missingConfidence: selected.filter(item => item.confidence === null).length,
    sections: [...new Set(selected.map(item => item.reference).filter(isCode))].sort(),
    bins,
  }
}

function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

// Picks `count` items spread over the confidence range, preferring reference sections that are not yet covered.
function spread(pool: Candidate[], count: number, used: Set<string>, next: () => number) {
  const sorted = [...pool].sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0) || a.position - b.position)
  const picked: Candidate[] = []
  for (let index = 0; index < count && index < sorted.length; index++) {
    // One pick from each equally sized confidence segment.
    const segment = sorted.slice(Math.floor((index * sorted.length) / count), Math.floor(((index + 1) * sorted.length) / count))
    const fresh = segment.filter(item => !used.has(item.reference))
    const choices = fresh.length ? fresh : segment
    const choice = choices[Math.floor(next() * choices.length)]
    picked.push(choice)
    used.add(choice.reference)
  }
  return picked
}

// Suggests a case set: below the threshold, wrong/right suggestions in the ratio of the run, spread over the
// confidence range and over as many NACE sections as possible. Deterministic for a given seed.
export function suggest(all: Candidate[], count: number, threshold: number | null, seed = 1): number[] {
  const pool = all.filter(item => item.correct !== null && item.confidence !== null && belowThreshold(item, threshold))
  const wrongPool = pool.filter(item => !item.correct)
  const rightPool = pool.filter(item => item.correct)
  const total = Math.min(count, pool.length)
  const share = pool.length ? wrongPool.length / pool.length : 0
  let wrong = Math.round(total * share)
  if (share > 0 && total >= 2) wrong = Math.max(1, wrong)
  wrong = Math.min(wrong, wrongPool.length)
  const right = Math.min(total - wrong, rightPool.length)
  wrong = Math.min(total - right, wrongPool.length)
  const next = random(seed)
  const used = new Set<string>()
  return [...spread(wrongPool, wrong, used, next), ...spread(rightPool, right, used, next)]
    .sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0))
    .map(item => item.position)
}
