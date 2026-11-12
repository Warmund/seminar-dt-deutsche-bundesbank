import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const output = mkdtempSync(join(tmpdir(), 'wz-cost-test-'))
let estimateRunCost
try {
  execFileSync(fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url)), ['--ignoreConfig', '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--outDir', output, fileURLToPath(new URL('../src/lib/classification-cost.ts', import.meta.url))])
  ;({ estimateRunCost } = await import(`data:text/javascript;base64,${readFileSync(join(output, 'classification-cost.js')).toString('base64')}`))
} finally { rmSync(output, { recursive: true, force: true }) }

test('counts each saved clue and final response once, including unfinished items', () => {
  const usage = { model: 'gpt-6-luna-2026-09-22', input_tokens: 1_000_000, output_tokens: 1_000_000 }
  const cost = estimateRunCost('gpt-6-luna', [
    { state: 'done', stalled: false, clues: { osm: usage }, result: usage },
    { state: 'pending', stalled: false, clues: { website: usage }, result: null },
  ])
  assert.ok(Math.abs(cost.usd - 1.8) < 1e-10)
  assert.equal(cost.calls, 3)
  assert.equal(cost.missing, 0)
})

test('flags unknown usage and errors, without inventing free calls', () => {
  const cost = estimateRunCost('gpt-6.1-terra', [
    { state: 'error', stalled: false, clues: {}, result: null },
    { state: 'done', stalled: false, clues: {}, result: { model: 'gpt-6.1-terra', input_tokens: null, output_tokens: 5 } },
  ])
  assert.equal(cost.usd, 0)
  assert.equal(cost.calls, 0)
  assert.equal(cost.missing, 2)
  assert.equal(estimateRunCost('unknown', []).supported, false)
})

test('uses requested Jev free tier even when the response model omits its suffix', () => {
  const item = { state: 'done', stalled: false, clues: {}, result: { model: 'jev-1.13', input_tokens: 1_000_000, output_tokens: null } }
  assert.equal(estimateRunCost('jev-1.13-free', [item]).usd, 0)
  assert.equal(estimateRunCost('jev-1.13', [item]).usd, 0.042)
})

test('estimates GPT-5 Mini input and output with its standard price', () => {
  const item = { state: 'done', stalled: false, clues: {}, result: { model: 'gpt-5-mini-2025-08-07', input_tokens: 1_000_000, output_tokens: 1_000_000 } }
  assert.equal(estimateRunCost('gpt-5-mini', [item]).usd, 2.25)
})
