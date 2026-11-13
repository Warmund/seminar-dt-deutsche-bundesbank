import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as jsx from 'react/jsx-runtime'
import { transformWithOxc } from 'vite'

const source = readFileSync(new URL('../src/components/classification-runs-page.tsx', import.meta.url), 'utf8')
const transformed = await transformWithOxc(source, 'classification-runs-page.tsx')
const code = transformed.code
  .replace(/^import \{ (.+) \} from "(.+)";$/gm, (_, names, path) => `const { ${names.replaceAll(' as ', ': ')} } = imports(${JSON.stringify(path)});`)
  .replace('export function ClassificationPage', 'globalThis.ClassificationPage = function ClassificationPage')

function renderRun(items) {
  const run = { id: '123', name: 'Lauf', model: 'gpt-5-mini', method: 'zero_shot', prompt_config: 'default', created_at: '2026-01-01', runner_state: 'paused', sources: {}, items, selection: {}, prompt: '', clue_prompts: {} }
  const states = ['123', { items: [], total: 0 }, 0, run, null, null, null, false, '', '', false, false, 0]
  let index = 0
  const ui = new Proxy({}, { get: (_, name) => props => React.createElement('div', { 'data-component': String(name) }, props.children) })
  const imports = path => {
    if (path === 'react') return { useEffect() {}, useState: () => [states[index++], () => {}] }
    if (path === 'react/jsx-runtime') return jsx
    if (path === '@/lib/classification-cost') return { estimateRunCost: () => null, formatCost: () => '' }
    return ui
  }
  const context = { imports, window: { location: { hash: '#classification/123' } }, Date }
  vm.runInNewContext(code, context)
  return renderToStaticMarkup(React.createElement(context.ClassificationPage))
}

const item = { position: 0, name: 'Beispiel', osm_type: 'way', osm_id: '1', reference: 'G', clues: {}, result: null, stalled: false }

test('shows stored provider errors on the run page without opening details', () => {
  const html = renderRun([{ ...item, state: 'error', error: 'API-Kontingent erreicht.' }])
  assert.match(html, /Klassifizierung fehlgeschlagen/)
  assert.match(html, /Beispiel: API-Kontingent erreicht\./)
})

test('does not show a failure alert for a pending item', () => {
  assert.doesNotMatch(renderRun([{ ...item, state: 'pending', error: null }]), /Klassifizierung fehlgeschlagen/)
})
