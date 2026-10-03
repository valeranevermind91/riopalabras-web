#!/usr/bin/env node
// Side-by-side report of several overlay runs (reads out/<run>.json and out/<run>.report.json; no API, no key).
// Usage: node tools/rio-overlay/compare-runs.mjs --runs a,b,c --words w1,w2 [--reasoning w1,w2] [--translations]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out')

const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const runs = list(arg('runs'))
const words = list(arg('words'))
const reasoningWords = list(arg('reasoning'))
if (runs.length === 0 || words.length === 0) {
  console.error('Usage: compare-runs.mjs --runs a,b,c --words w1,w2 [--reasoning w1,w2] [--translations]')
  process.exit(2)
}

const load = (run) => {
  const read = (suffix) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${run}${suffix}`), 'utf8'))
  const entries = new Map(read('.json').map((e) => [e.es_word, e]))
  return { run, entries, report: read('.report.json') }
}
const data = runs.map(load)

const cellOf = (e) => {
  if (!e) return 'MISSING'
  if (e.rio_type === 'none') return `none (${e.confidence})`
  const region = e.region ? `, region ${e.region}` : ''
  const alt = e.alt_form ? `, alt ${e.alt_form}/${e.alt_region}` : ''
  return `${e.rio_type}: ${e.rio_form}${region}${alt} (${e.confidence})`
}

console.log('## Comparison (rio_type: rio_form, region, alt_form/alt_region, confidence)\n')
console.log(`| word | ${runs.join(' | ')} |`)
console.log(`|---|${runs.map(() => '---').join('|')}|`)
for (const w of words) console.log(`| ${w} | ${data.map((d) => cellOf(d.entries.get(w))).join(' | ')} |`)

if (argv.includes('--translations')) {
  console.log('\n## Translations (en / ru), only where set\n')
  console.log(`| word | ${runs.join(' | ')} |`)
  console.log(`|---|${runs.map(() => '---').join('|')}|`)
  for (const w of words) {
    console.log(`| ${w} | ${data.map((d) => { const e = d.entries.get(w); return e?.en_translation ? `${e.en_translation} / ${e.ru_translation}` : '-' }).join(' | ')} |`)
  }
}

if (reasoningWords.length) {
  console.log('\n## Reasoning strings\n')
  for (const w of reasoningWords) {
    console.log(`**${w}**`)
    for (const d of data) console.log(`- ${d.run}: ${d.entries.get(w)?.reasoning ?? 'MISSING'}`)
    console.log('')
  }
}

console.log('## Validation, usage and cost per run\n')
let total = 0
for (const d of data) {
  const r = d.report
  total += r.estimatedCostUsd ?? 0
  console.log(`- ${d.run} (${r.model}, context ${r.context ?? '?'}): ${r.returned}/${r.selected} returned, ${r.withErrors} with errors, ${r.withWarnings} with warnings, ${r.missing.length} missing; ${r.usage.requests} request(s), ${r.usage.prompt} prompt + ${r.usage.output} output + ${r.usage.thoughts} thinking tokens = $${(r.estimatedCostUsd ?? 0).toFixed(4)}`)
  for (const f of r.failures) {
    for (const e of f.errors) console.log(`    ERROR   ${f.es_word}: ${e}`)
    for (const x of f.warnings) console.log(`    warning ${f.es_word}: ${x}`)
  }
  if (r.pass2Queue?.length) console.log(`    pass-2 queue (no new example and the current one lacks the form): ${r.pass2Queue.join(', ')}`)
  const checks = r.needsExampleCheck ?? []
  if (checks.length) console.log(`    needs_example_check: ${checks.length} entries, current example shows form in ${checks.filter((c) => c.currentExampleShowsForm).length}`)
}
console.log(`\nTotal estimated cost: $${total.toFixed(4)}`)
