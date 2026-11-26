import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const output = mkdtempSync(join(tmpdir(), 'wz-study-selection-test-'))
let selection
try {
  execFileSync(fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url)), ['--ignoreConfig', '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--outDir', output, fileURLToPath(new URL('../src/lib/study-selection.ts', import.meta.url))])
  selection = await import(pathToFileURL(join(output, 'study-selection.js')).href)
} finally {
  rmSync(output, { recursive: true, force: true })
}

const sections = 'ABCDEFGHIJ'.split('')
const candidates = Array.from({ length: 60 }, (_, index) => {
  const reference = sections[index % sections.length]
  const correct = index % 4 !== 0
  return { position: index, name: `F${index}`, osm: `way_${index}`, reference, ai_code: correct ? reference : 'Z', confidence: index / 60, correct, texts: 1, images: 0 }
})

test('suggestion stays below the threshold, keeps the wrong share and spreads confidence and sections', () => {
  const positions = selection.suggest(candidates, 10, 0.8, 3)
  const chosen = candidates.filter(item => positions.includes(item.position))
  assert.equal(new Set(positions).size, 10)
  assert.ok(chosen.every(item => item.confidence < 0.8))
  const wrong = chosen.filter(item => !item.correct).length
  const pool = candidates.filter(item => item.confidence < 0.8)
  assert.equal(wrong, Math.round(10 * pool.filter(item => !item.correct).length / pool.length))
  assert.ok(new Set(chosen.map(item => item.reference)).size >= 6)
  assert.ok(Math.min(...chosen.map(item => item.confidence)) < 0.2 && Math.max(...chosen.map(item => item.confidence)) > 0.6)
  assert.deepEqual(selection.suggest(candidates, 10, 0.8, 3), positions)
})

test('suggestion never returns more cases than available', () => {
  assert.equal(selection.suggest(candidates.slice(0, 3), 10, 0.8).length, 3)
  assert.deepEqual(selection.suggest([], 10, 0.8), [])
})

test('summary compares the selection with the run below the threshold', () => {
  const chosen = [candidates[0], candidates[1], candidates[55], { ...candidates[2], correct: null, reference: '' }]
  const summary = selection.summarize(chosen, candidates, 0.8)
  assert.equal(summary.n, 4)
  assert.equal(summary.wrong, 1)
  assert.equal(summary.correct, 2)
  assert.equal(summary.unscored, 1)
  assert.equal(summary.aboveThreshold, 1)
  assert.equal(summary.bins.length, 5)
  assert.equal(summary.bins.reduce((sum, bin) => sum + bin.n, 0), 3)
  assert.deepEqual(summary.sections, ['A', 'B', 'F'])
})
