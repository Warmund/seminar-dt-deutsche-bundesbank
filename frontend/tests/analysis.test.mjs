import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const output = mkdtempSync(join(tmpdir(), 'wz-analysis-test-'))
let analysis
try {
  execFileSync(fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url)), ['--ignoreConfig', '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--outDir', output, fileURLToPath(new URL('../src/lib/analysis.ts', import.meta.url))])
  analysis = await import(`data:text/javascript;base64,${readFileSync(join(output, 'analysis.js')).toString('base64')}`)
} finally { rmSync(output, { recursive: true, force: true }) }
const { normalize, stats, threshold, hash } = analysis

test('normalizes saved runs and legacy imports without inventing confidence', () => {
  const { items, skipped } = normalize({ items: [
    { reference: 'G', result: { prediction: { category: 'G' }, confidence: 0.8, confidence_method: 'verbalized' } },
    { category: 'A', llm_response: 'UNK', confidence: 1.2 },
    { reference: 'A', prediction: 'invalid' }, null,
  ] })
  assert.equal(skipped, 2)
  assert.equal(items[0].confidence, 0.8)
  assert.equal(items[0].method, 'verbalized')
  assert.equal(items[1].confidence, null)
})

test('accuracy includes missing confidence; calibration excludes it; AUROC handles ties', () => {
  const { items } = normalize([
    { reference: 'A', prediction: 'A', confidence: 0.8 },
    { reference: 'A', prediction: 'B', confidence: 0.8 },
    { reference: 'B', prediction: 'A', confidence: 0.2 },
    { reference: 'B', prediction: 'B' },
  ])
  const m = stats(items)
  assert.equal(m.accuracy, 0.5)
  assert.equal(m.valid.length, 3)
  assert.equal(m.auc, 0.75)
  assert.ok(Math.abs(m.ece - (2 / 3 * 0.3 + 1 / 3 * 0.2)) < 1e-10)
  assert.equal(stats([]).accuracy, null)
  assert.equal(stats([items[0]]).auc, null)
})

test('unknown predictions and missing confidence always require review', () => {
  const { items } = normalize([
    { osm_type: 'way', osm_id: '1', reference: 'A', prediction: 'A', confidence: 0.8 },
    { reference: 'A', prediction: 'UNK', confidence: 1 },
    { reference: 'B', prediction: 'B' },
  ])
  assert.deepEqual(threshold(items, 0.8), { review: 2 / 3, accuracy: 1, n: 1 })
  assert.equal(threshold(items, 0).n, 1)
  assert.equal(threshold(items, 1).accuracy, null)
  assert.equal(hash(items[0], 0), hash(items[0], 500))
})
