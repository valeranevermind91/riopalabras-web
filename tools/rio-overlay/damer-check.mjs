#!/usr/bin/env node
// Looks up the forms claimed in stage 1 in ASALE's "Diccionario de americanismos" (DAMER) and records the
// country labels of each sense. Plain Node (>=22), no dependencies, our own HTML parsing, no model in the loop.
//
// Politeness, by design:
//  - reads https://www.asale.org/robots.txt first and refuses to run if /damer/ is disallowed for us;
//  - waits max(2 s, the site's Crawl-delay) between network requests (cache hits cost nothing);
//  - sends a descriptive User-Agent;
//  - caches every response in out/damer-cache/ and never re-requests a cached page;
//  - stops on 403, 429 or any 5xx: no retry loop. Re-running resumes from the cache.
//
// A miss is not a refutation: DAMER lists only americanisms.
// Usage: node tools/rio-overlay/damer-check.mjs [--list] [--limit N] [--a out/s1-A.json] [--b out/s1-B.json]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { legacyForms } from './compare.mjs'
import { isCleanForm } from './validate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const OUT_DIR = path.join(HERE, 'out')
// DAMER_TEST_DIR redirects the cache and the result file (tests only, so they never touch the real ones).
const TEST_DIR = process.env.DAMER_TEST_DIR
const CACHE_DIR = TEST_DIR ? path.join(TEST_DIR, 'cache') : path.join(OUT_DIR, 'damer-cache')
// The committed copy holds labels only (no definition text); the full output, glosses included, stays in the gitignored out/.
const RESULT_PATH = TEST_DIR ? path.join(TEST_DIR, 'damer.json') : path.join(HERE, 'results', 'stage1', 'damer.json')
const FULL_PATH = TEST_DIR ? path.join(TEST_DIR, 'damer.full.json') : path.join(OUT_DIR, 'damer.full.json')
const DICTIONARY_PATH = path.join(ROOT, 'public', 'words_enriched.json')

// Only the tests point this at a local fake server.
const BASE = process.env.DAMER_BASE_URL ?? 'https://www.asale.org'
const USER_AGENT = 'riopalabras-web-research/0.1 (personal vocabulary-app data check, a few hundred pages at most, cached; contact: vkriukov@movchans.com)'
const MIN_DELAY_MS = 2000

// ---------------------------------------------------------------- robots.txt

/** The rules that apply to us (`User-agent: *`): Disallow patterns and Crawl-delay in seconds. */
export function parseRobots(text) {
  const rules = { disallow: [], allow: [], crawlDelay: 0 }
  let applies = false
  let inGroupHeader = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'user-agent') {
      if (!inGroupHeader) applies = false
      if (value === '*') applies = true
      inGroupHeader = true
      continue
    }
    inGroupHeader = false
    if (!applies) continue
    if (key === 'disallow' && value) rules.disallow.push(value)
    else if (key === 'allow' && value) rules.allow.push(value)
    else if (key === 'crawl-delay') rules.crawlDelay = Number(value) || 0
  }
  return rules
}

const patternToRegExp = (pattern) => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'))

/** Longest matching rule wins; Allow wins ties (the usual robots.txt semantics). */
export function isAllowed(rules, pathname) {
  let best = { length: -1, allowed: true }
  for (const [list, allowed] of [[rules.disallow, false], [rules.allow, true]]) {
    for (const p of list) {
      if (patternToRegExp(p).test(pathname) && (p.length > best.length || (p.length === best.length && allowed))) best = { length: p.length, allowed }
    }
  }
  return best.allowed
}

// ---------------------------------------------------------------- HTML parsing

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
const squish = (s) => decode(s).replace(/\s+/g, ' ').trim()
const stripTags = (s) => s.replace(/<[^>]+>/g, '')

/** One country/area code: Ar, Ur, ES, Co:O,SO, Bo:O,C,SO (sub-regions after ":" are comma-separated without spaces). */
const CODE = '[A-ZÑ][A-Za-zñ]{0,2}(?::[A-Za-z]+(?:,[A-Za-z]+)*)?'
const LABEL_LIST_RE = new RegExp(`^${CODE}(?:[,;]\\s*${CODE})*$`)
const CODE_RE = new RegExp(CODE, 'g')
// Text that may sit among the labels: separators, and part-of-speech abbreviations such as "m.", "m-f.", "intr.", "prnl."
const HEAD_WORD_RE = /^(?:[,;|]|y|o|[a-zñ]{1,6}(?:[-/][a-zñ]{1,6})*\.?)$/

function isHeadText(text) {
  const words = text.split(/\s+/).filter(Boolean)
  return words.every((w) => HEAD_WORD_RE.test(w)) && (words.length === 0 || words.some((w) => /\.$/.test(w)) || words.every((w) => /^[,;|]$/.test(w)))
}

/** Splits a sense cell into italic and plain runs. Spans and links are transparent; <i> boundaries delimit runs. */
function tokenizeCell(html) {
  const tokens = []
  let plain = ''
  let italic = null
  for (const m of html.matchAll(/<(\/?)(i)\b[^>]*>|<[^>]+>|[^<]+/g)) {
    if (m[2]) {
      if (m[1] === '') {
        if (plain) tokens.push({ kind: 'text', text: plain })
        plain = ''
        italic = ''
      } else if (italic !== null) {
        tokens.push({ kind: 'i', text: decode(italic).trim() })
        italic = null
      }
    } else if (!m[0].startsWith('<')) {
      if (italic !== null) italic += m[0]
      else plain += m[0]
    }
  }
  if (plain) tokens.push({ kind: 'text', text: plain })
  return tokens.map((t) => (t.kind === 'text' ? { ...t, text: decode(t.text) } : t))
}

/**
 * One sense cell -> { labels, gloss }. The cell is: optional part-of-speech text, italic country codes (separated by
 * ", " or ";", sometimes several in one italic run, the last usually ending with "."), possibly more part-of-speech
 * text between them, then the gloss up to the ◆ cross-references.
 */
export function parseSenseCell(cellHtml) {
  const tokens = tokenizeCell(cellHtml)
  const labels = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t.kind === 'i') {
      const text = t.text.replace(/[.,]$/, '')
      if (!LABEL_LIST_RE.test(text)) break
      labels.push(...(text.match(CODE_RE) ?? []))
      i++
      if (t.text.endsWith('.')) break
    } else if (isHeadText(t.text)) i++
    else {
      // the label list may end without a "." of its own: ", pop. Gloss..." or ". Gloss..." follows the last code
      if (labels.length && /^[,;.]\s*\S/.test(t.text)) tokens[i] = { ...t, text: t.text.replace(/^[,;.]\s*/, '') }
      break
    }
  }
  // a part-of-speech marker may follow the last label's own period: "Ch. Individuo" is a gloss, so only skip head text before it
  const gloss = squish(tokens.slice(i).map((t) => t.text).join('')).split('◆')[0].trim()
  return { labels, gloss }
}

const NOT_IN_DICTIONARY = /no est[aá] en el diccionario/i

/**
 * @returns {{found: boolean, headwords: string[], senses: {gloss: string, labels: string[]}[]}}
 */
export function parseDamerPage(html) {
  const body = html.slice(html.search(/<body/i) >= 0 ? html.search(/<body/i) : 0)
  const entries = [...body.matchAll(/<entry\b([^>]*)>([\s\S]*?)<\/entry>/g)]
  if (entries.length === 0) return { found: false, headwords: [], senses: [], notInDictionary: NOT_IN_DICTIONARY.test(stripTags(body)) }

  const senses = []
  const headwords = []
  for (const [, attrs, inner] of entries) {
    headwords.push(attrs.match(/\bheader="([^"]*)"/)?.[1] ?? '')
    for (const [, row] of inner.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({ attrs: c[1], html: c[2] }))
      const numerals = cells.filter((c) => /class="da7"/.test(c.attrs)).map((c) => squish(stripTags(c.html)))
      if (!numerals.some((n) => /^\d+\.$/.test(n))) continue // etymology header and non-sense rows
      const cell = cells[cells.length - 1]
      senses.push(parseSenseCell(cell.html))
    }
  }
  return { found: senses.length > 0, headwords, senses }
}

/** Country-code check; "Co:O,SO" counts as Co. */
export const labelsInclude = (senses, code) => senses.some((s) => s.labels.some((l) => l.split(':')[0] === code))

// ---------------------------------------------------------------- forms to look up

/** Clean-looking forms only: legacy values are sometimes prose, which is not a headword to look up. */
export function collectForms({ runs, legacyValues }) {
  const forms = new Map() // form -> Set(sources)
  const skipped = []
  const add = (raw, source) => {
    const form = raw.trim().toLowerCase()
    if (!form) return
    if (!isCleanForm(form)) {
      skipped.push({ form, source })
      return
    }
    if (!forms.has(form)) forms.set(form, new Set())
    forms.get(form).add(source)
  }
  for (const [name, entries] of Object.entries(runs)) {
    for (const e of entries) {
      if (e.rio_form) add(e.rio_form, name)
      if (e.alt_form) add(e.alt_form, name)
    }
  }
  for (const value of legacyValues) for (const f of legacyForms(value)) add(f, 'legacy')
  return { forms: [...forms.entries()].map(([form, sources]) => ({ form, sources: [...sources] })), skipped }
}

// ---------------------------------------------------------------- fetching (cached, polite, no retries)

const cacheFile = (form) => path.join(CACHE_DIR, `${encodeURIComponent(form).replace(/%/g, '_')}.json`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class StopError extends Error {}

async function fetchCached(url, file, state) {
  if (fs.existsSync(file)) return { ...JSON.parse(fs.readFileSync(file, 'utf8')), cached: true }
  const wait = state.lastRequestAt === null ? 0 : state.delayMs - (Date.now() - state.lastRequestAt)
  if (wait > 0) await sleep(wait)
  state.lastRequestAt = Date.now()
  state.requests++

  let res
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } })
  } catch (err) {
    throw new StopError(`network error for ${url}: ${err.message}`)
  }
  if (res.status === 403 || res.status === 429 || res.status >= 500) throw new StopError(`HTTP ${res.status} for ${url}: stopping, not retrying`)
  const entry = { url, status: res.status, fetchedAt: new Date().toISOString(), body: await res.text() }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(entry))
  return { ...entry, cached: false }
}

/** The shareable copy: form -> { headword, found, ar, ur, senses: [{ labels }] }, with every definition removed. */
export function labelsOnly(result) {
  return Object.fromEntries(
    Object.entries(result).map(([form, v]) => [form, { headword: v.headword, found: v.found, ar: v.ar, ur: v.ur, senses: v.senses.map((s) => ({ labels: s.labels })) }]),
  )
}

// ---------------------------------------------------------------- main

const log = (...parts) => console.log(parts.join(' '))

function readJsonIfExists(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : fallback
  }
  const runA = readJsonIfExists(path.resolve(ROOT, arg('a', 'tools/rio-overlay/out/s1-A.json')))
  const runB = readJsonIfExists(path.resolve(ROOT, arg('b', 'tools/rio-overlay/out/s1-B.json')))
  if (!runA || !runB) throw new Error('Run outputs not found: pass --a and --b (default tools/rio-overlay/out/s1-A.json and s1-B.json)')
  const dictionary = JSON.parse(fs.readFileSync(DICTIONARY_PATH, 'utf8'))
  const selected = new Set([...runA, ...runB].map((e) => e.es_word))
  const legacyValues = dictionary.filter((d) => selected.has(d.es_word) && d.es_rioplatense).map((d) => d.es_rioplatense)

  let { forms, skipped } = collectForms({ runs: { A: runA, B: runB }, legacyValues })
  const limit = arg('limit')
  if (limit !== undefined) forms = forms.slice(0, Number(limit))

  const state = { lastRequestAt: null, delayMs: MIN_DELAY_MS, requests: 0 }
  const uncached = forms.filter((f) => !fs.existsSync(cacheFile(f.form))).length
  log(`${forms.length} forms to look up (${skipped.length} skipped as not clean headwords); ${uncached} not cached yet`)
  if (argv.includes('--list')) {
    log(forms.map((f) => `${f.form} [${f.sources.join(',')}]`).join('\n'))
    log(`\nskipped: ${skipped.map((s) => `${JSON.stringify(s.form)} (${s.source})`).join(', ') || 'none'}`)
    return
  }

  // robots.txt first: do not proceed if /damer/ is off limits, and honour a Crawl-delay if there is one
  const robots = await fetchCached(`${BASE}/robots.txt`, path.join(CACHE_DIR, '_robots.json'), state)
  if (robots.status !== 200) throw new Error(`robots.txt returned HTTP ${robots.status}; not proceeding`)
  const rules = parseRobots(robots.body)
  if (!isAllowed(rules, '/damer/')) throw new Error('robots.txt disallows /damer/ for us: stopping, nothing was looked up')
  state.delayMs = process.env.RIO_TEST_NO_DELAY ? 0 : Math.max(MIN_DELAY_MS, rules.crawlDelay * 1000) // the env switch is for the tests only
  log(`robots.txt allows /damer/ (Crawl-delay ${rules.crawlDelay || 'none'}); waiting ${state.delayMs / 1000}s between requests`)

  const result = {}
  try {
    for (const [n, { form }] of forms.entries()) {
      const url = `${BASE}/damer/${encodeURIComponent(form)}`
      const page = await fetchCached(url, cacheFile(form), state)
      let parsed = { found: false, headwords: [], senses: [] }
      if (page.status === 200) parsed = parseDamerPage(page.body)
      else if (page.status !== 404) throw new StopError(`HTTP ${page.status} for ${url}: unexpected, stopping`)
      result[form] = {
        found: parsed.found,
        headword: parsed.headwords.join(' / ') || null,
        senses: parsed.senses.map((s) => ({ gloss: s.gloss.length > 200 ? s.gloss.slice(0, 197) + '...' : s.gloss, labels: s.labels })),
        ar: labelsInclude(parsed.senses, 'Ar'),
        ur: labelsInclude(parsed.senses, 'Ur'),
      }
      if ((n + 1) % 25 === 0) log(`  ${n + 1}/${forms.length} (${state.requests} network requests so far)`)
    }
  } catch (err) {
    if (!(err instanceof StopError)) throw err
    log(`\nStopped: ${err.message}`)
    log(`${Object.keys(result).length} of ${forms.length} forms were done; every response is cached, so re-running resumes. damer.json was not written.`)
    process.exitCode = 1
    return
  }

  fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true })
  fs.mkdirSync(path.dirname(FULL_PATH), { recursive: true })
  fs.writeFileSync(FULL_PATH, JSON.stringify(result, null, 2))
  fs.writeFileSync(RESULT_PATH, JSON.stringify(labelsOnly(result), null, 2))

  const entries = Object.entries(result)
  const attested = entries.filter(([, v]) => v.ar || v.ur)
  const foundNoLabel = entries.filter(([, v]) => v.found && !v.ar && !v.ur)
  const notFound = entries.filter(([, v]) => !v.found)
  log(`\nWrote ${path.relative(ROOT, RESULT_PATH)} (labels only) and ${path.relative(ROOT, FULL_PATH)} (with glosses, not for commit): ${entries.length} forms, ${state.requests} network requests`)
  log(`attested with Ar and/or Ur: ${attested.length} (Ar only ${attested.filter(([, v]) => v.ar && !v.ur).length}, Ur only ${attested.filter(([, v]) => v.ur && !v.ar).length}, both ${attested.filter(([, v]) => v.ar && v.ur).length})`)
  log(`found without Ar/Ur labels: ${foundNoLabel.length}`)
  log(`not found: ${notFound.length}`)
  log(`attested: ${attested.map(([f, v]) => `${f}[${[v.ar && 'Ar', v.ur && 'Ur'].filter(Boolean).join('+')}]`).join(', ')}`)
  log(`found without Ar/Ur: ${foundNoLabel.map(([f]) => f).join(', ')}`)
  log(`not found: ${notFound.map(([f]) => f).join(', ')}`)
  log(`skipped (not clean headwords): ${skipped.map((s) => JSON.stringify(s.form)).join(', ') || 'none'}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`)
    process.exit(1)
  })
}
