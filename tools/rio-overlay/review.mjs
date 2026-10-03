#!/usr/bin/env node
// Builds the human review file and the candidate overlay from two finished runs (no API, no key).
//   A is the base of the candidate overlay; B only feeds the review.
// Usage: node tools/rio-overlay/review.mjs --a s1-A --b s1-B [--name stage1]
//   -> out/<name>.review.md and out/<name>.merged.json

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareLegacy } from './compare.mjs'
import { ENTRY_KEYS } from './schema.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(HERE, 'out')
const DICTIONARY_PATH = path.join(HERE, '..', '..', 'public', 'words_enriched.json')

export const BUCKETS = [
  ['a', 'A and B disagree on rio_type, rio_form, region or alt_form'],
  ['b', 'A or B disagrees with the legacy es_rioplatense'],
  ['c', 'Validation errors (A or B)'],
  ['d', 'Confidence low or medium (A or B)'],
  ['e', 'Register vulgar or offensive (A or B)'],
  ['f', 'Pass-2 queue: A is not none and the current dictionary example lacks the form'],
  ['g', 'Legacy marked it, but both A and B answer none'],
]

const lower = (v) => (v === null || v === undefined ? null : String(v).toLowerCase())
const sig = (e) => JSON.stringify([e.rio_type, lower(e.rio_form), e.region, lower(e.alt_form)])

/** One-line summary of an entry. */
export function brief(r) {
  if (!r) return 'MISSING'
  const e = r.entry
  if (e.rio_type === 'none') return `none (${e.confidence}, ${e.register})`
  const region = e.region ? ` region=${e.region}` : ''
  const alt = e.alt_form ? ` alt=${e.alt_form}/${e.alt_region}` : ''
  return `${e.rio_type}: ${e.rio_form}${region}${alt} (${e.confidence}, ${e.register})`
}

/**
 * @param dictionary  the dictionary entries
 * @param a, b        checkpoint `results` maps: es_word -> { entry, errors, warnings, flags, currentExampleShowsForm }
 * @param words       the selection, in rank order
 */
export function classify(dictionary, a, b, words) {
  const input = new Map(dictionary.map((e) => [e.es_word, e]))
  const rowsOf = (results) => words.filter((w) => results[w]).map((w) => ({ input: input.get(w), entry: results[w].entry, valid: results[w].errors.length === 0 }))
  const legacyA = new Map(compareLegacy(rowsOf(a)).map((d) => [d.es_word, d]))
  const legacyB = new Map(compareLegacy(rowsOf(b)).map((d) => [d.es_word, d]))

  const buckets = Object.fromEntries(BUCKETS.map(([k]) => [k, []]))
  for (const w of words) {
    const ra = a[w]
    const rb = b[w]
    const legacy = input.get(w)?.es_rioplatense ?? null
    const tags = []
    if (ra && rb && sig(ra.entry) !== sig(rb.entry)) tags.push('a')
    if (legacyA.has(w) || legacyB.has(w)) tags.push('b')
    if (ra?.errors.length || rb?.errors.length) tags.push('c')
    if ([ra, rb].some((r) => r && (r.entry.confidence === 'low' || r.entry.confidence === 'medium'))) tags.push('d')
    if ([ra, rb].some((r) => r && (r.entry.register === 'vulgar' || r.entry.register === 'offensive'))) tags.push('e')
    if (ra && ra.entry.rio_type !== 'none' && ra.flags?.includes('needs_example_check') && ra.currentExampleShowsForm === false) tags.push('f')
    if (legacy && ra?.entry.rio_type === 'none' && rb?.entry.rio_type === 'none') tags.push('g')
    for (const t of tags) buckets[t].push(w)
  }
  return { buckets, legacyA, legacyB }
}

const show = (v) => (v === null ? 'null' : JSON.stringify(v))

function detail(w, input, ra, rb) {
  const lines = [`#### ${w}  (legacy: ${show(input?.es_rioplatense ?? null)})`]
  for (const [label, r] of [['A', ra], ['B', rb]]) {
    if (!r) {
      lines.push(`- ${label}: MISSING`)
      continue
    }
    lines.push(`- ${label}: ${ENTRY_KEYS.filter((k) => k !== 'es_word' && r.entry[k] !== null).map((k) => `${k}=${show(r.entry[k])}`).join('; ')}`)
    if (r.errors.length) lines.push(`  - ERRORS: ${r.errors.join(' | ')}`)
    if (r.warnings.length) lines.push(`  - warnings: ${r.warnings.join(' | ')}`)
    if (r.flags?.includes('needs_example_check')) lines.push(`  - needs_example_check; current example shows form: ${r.currentExampleShowsForm}`)
  }
  return lines.join('\n')
}

function tally(results, words, pick) {
  const out = {}
  for (const w of words) {
    const e = results[w]?.entry
    if (!e) continue
    const key = pick(e) ?? 'null'
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

export function buildReview({ dictionary, a, b, words, runs }) {
  const input = new Map(dictionary.map((e) => [e.es_word, e]))
  const { buckets, legacyA, legacyB } = classify(dictionary, a, b, words)

  const counts = {
    rio_type: tally(a, words, (e) => e.rio_type),
    region: tally(a, words, (e) => e.region),
    register: tally(a, words, (e) => e.register),
  }

  const md = []
  md.push(`# Stage 1 review: ${words.length} words with a legacy es_rioplatense`)
  md.push('')
  md.push(`Base (A): \`${runs.a.run}\` — ${runs.a.model}, context ${runs.a.context}. Review only (B): \`${runs.b.run}\` — ${runs.b.model}, context ${runs.b.context}. No hint was sent in either run.`)
  md.push('')
  md.push('| bucket | size |')
  md.push('|---|---|')
  for (const [k, title] of BUCKETS) md.push(`| (${k}) ${title} | ${buckets[k].length} |`)
  md.push('')
  md.push('Line format: `word | legacy | A | B`, then the two reasoning strings. Types are rio_type: rio_form (region, alt_form/alt_region), then (confidence, register). Every entry in a bucket has its full fields in the Details section at the end.')

  for (const [k, title] of BUCKETS) {
    md.push('')
    md.push(`## (${k}) ${title} — ${buckets[k].length}`)
    if (buckets[k].length === 0) md.push('\n_none_')
    for (const w of buckets[k]) {
      const ra = a[w]
      const rb = b[w]
      md.push('')
      md.push(`- **${w}** | legacy ${show(input.get(w)?.es_rioplatense ?? null)} | A ${brief(ra)} | B ${brief(rb)}`)
      md.push(`  - A reasoning: ${ra?.entry.reasoning ?? '-'}`)
      md.push(`  - B reasoning: ${rb?.entry.reasoning ?? '-'}`)
      if (k === 'b') {
        for (const [label, map] of [['A', legacyA], ['B', legacyB]]) if (map.has(w)) md.push(`  - ${label} vs legacy: ${map.get(w).kind}`)
      }
      if (k === 'c') {
        for (const [label, r] of [['A', ra], ['B', rb]]) if (r?.errors.length) md.push(`  - ${label} errors: ${r.errors.join(' | ')}`)
      }
      if (k === 'f' && rb && rb.entry.rio_type !== 'none' && rb.flags?.includes('needs_example_check') && rb.currentExampleShowsForm === false) md.push('  - B also needs an example')
    }
  }

  const flagged = words.filter((w) => Object.values(buckets).some((list) => list.includes(w)))
  md.push('')
  md.push(`## Details: every field of the ${flagged.length} entries that appear in a bucket (null fields omitted)`)
  md.push('')
  for (const w of flagged) md.push(detail(w, input.get(w), a[w], b[w]), '')

  // ---- candidate overlay: A is the base; entries that fail validation are held back, not repaired ----
  const reviewFlags = {}
  for (const [k, list] of Object.entries(buckets)) for (const w of list) (reviewFlags[w] ??= []).push(k)
  const entries = []
  const invalid = []
  const missing = []
  for (const w of words) {
    const r = a[w]
    if (!r) missing.push(w)
    else if (r.errors.length) invalid.push({ es_word: w, errors: r.errors })
    else entries.push(r.entry)
  }
  const merged = {
    meta: {
      generatedAt: new Date().toISOString(),
      note: 'Candidate overlay, not yet reviewed. Base = run A; run B only feeds the review. Entries with validation errors are held back in `invalid`, never repaired. reviewFlags maps es_word to the review buckets (a-g) it appears in.',
      base: { run: runs.a.run, model: runs.a.model, context: runs.a.context },
      compared: { run: runs.b.run, model: runs.b.model, context: runs.b.context },
      selected: words.length,
      counts,
    },
    entries,
    invalid,
    missing,
    reviewFlags,
  }

  return { markdown: md.join('\n') + '\n', merged, buckets, counts }
}

// ---------------------------------------------------------------- CLI

function main() {
  const argv = process.argv.slice(2)
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : fallback
  }
  const runA = arg('a')
  const runB = arg('b')
  const name = arg('name', 'stage1')
  if (!runA || !runB) {
    console.error('Usage: review.mjs --a RUN_A --b RUN_B [--name stage1]')
    process.exit(2)
  }
  const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
  const dictionary = readJson(DICTIONARY_PATH).sort((x, y) => x.rank - y.rank)
  const cpA = readJson(path.join(OUT_DIR, `${runA}.checkpoint.json`))
  const cpB = readJson(path.join(OUT_DIR, `${runB}.checkpoint.json`))
  const wanted = new Set([...Object.keys(cpA.results), ...Object.keys(cpB.results)])
  const words = dictionary.filter((e) => wanted.has(e.es_word)).map((e) => e.es_word)

  const meta = (run, cp) => ({ run, model: cp.model, context: cp.context ?? '?' })
  const result = buildReview({ dictionary, a: cpA.results, b: cpB.results, words, runs: { a: meta(runA, cpA), b: meta(runB, cpB) } })

  fs.writeFileSync(path.join(OUT_DIR, `${name}.review.md`), result.markdown)
  fs.writeFileSync(path.join(OUT_DIR, `${name}.merged.json`), JSON.stringify(result.merged, null, 2))

  console.log(`Wrote out/${name}.review.md and out/${name}.merged.json`)
  console.log(`words ${words.length}; candidate entries ${result.merged.entries.length}; held back ${result.merged.invalid.length}; missing ${result.merged.missing.length}`)
  for (const [k, title] of BUCKETS) console.log(`  (${k}) ${String(result.buckets[k].length).padStart(3)}  ${title}`)
  console.log('A counts:', JSON.stringify(result.counts))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
