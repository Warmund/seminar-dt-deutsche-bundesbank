type Usage = { model: string; input_tokens: number | null; output_tokens: number | null }
type Item = { state: string; stalled: boolean; clues: Record<string, Usage>; result: Usage | null }

// Standard prices per million tokens, verified 12 November 2026. Update when provider pricing changes.
const PRICES: Record<string, { input: number; output: number }> = {
  'gpt-6-luna': { input: 0.10, output: 0.50 },
  'gpt-6.1-terra': { input: 1, output: 5 },
  'jev-1.13': { input: 0.042, output: 0 },
  'jev-1.13-free': { input: 0, output: 0 },
}

export function estimateRunCost(model: string, items: Item[]) {
  let usd = 0, calls = 0, missing = 0
  for (const item of items) {
    const usages = [...Object.values(item.clues), ...(item.result ? [item.result] : [])]
    for (const usage of usages) {
      // Jev's response model may omit the free-tier suffix; the requested model determines billing.
      const requested = model.startsWith('jev-') ? model : usage.model
      const key = Object.keys(PRICES).find(name => requested === name || (name.startsWith('gpt-') && requested?.startsWith(name + '-')))
      const price = key ? PRICES[key] : undefined
      if (!price || (price.input > 0 && (typeof usage.input_tokens !== 'number' || !Number.isFinite(usage.input_tokens) || usage.input_tokens < 0)) || (price.output > 0 && (typeof usage.output_tokens !== 'number' || !Number.isFinite(usage.output_tokens) || usage.output_tokens < 0))) {
        missing++
        continue
      }
      usd += ((usage.input_tokens ?? 0) * price.input + (usage.output_tokens ?? 0) * price.output) / 1_000_000
      calls++
    }
    if (item.state === 'error' || item.stalled) missing++
  }
  return { usd, calls, missing, supported: model in PRICES }
}

export function formatCost(usd: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(usd)
}
