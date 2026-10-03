#!/usr/bin/env node
// Generates the Rioplatense overlay with Gemini under a strict response schema, then validates it.
// Plain Node (>=22), no dependencies. See --help.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareLegacy } from './compare.mjs'
import { CONTEXTS, DEFAULT_CONTEXT, buildResponseSchema, buildSystemPrompt, buildUserPrompt } from './schema.mjs'
import { validateBatch } from './validate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const DICTIONARY_PATH = path.join(ROOT, 'public', 'words_enriched.json')
const OUT_DIR = path.join(HERE, 'out')

// USD per 1M tokens, standard paid tier (thinking tokens bill as output). Checked 2026-10-02 against
// https://ai.google.dev/gemini-api/docs/pricing. gemini-3.x Flash input/output double on 2027-01-01.
const PRICING = {
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-flash-lite': { in: 0.1, out: 0.4 },
  'gemini-3.8-flash': { in: 0.75, out: 3.75 },
  'gemini-3.5-flash': { in: 1.5, out: 9.0 },
  // Pro-class, prompts up to 200k tokens (checked 2026-10-02 on the same page).
  'gemini-2.5-pro': { in: 1.25, out: 10 },
  'gemini-3.1-pro-preview': { in: 2.0, out: 12 },
}

const DEFAULT_MODEL = 'gemini-2.5-flash' // what the riopalabras-proxy /enrich endpoint uses
// Only the tests point this at a local fake server.
const API_BASE = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com'

const HELP = `Usage: node tools/rio-overlay/generate.mjs [selection] [options]

Selection (one of):
  --words a,b,c        exact es_word values from public/words_enriched.json
  --stage1             the entries that already have es_rioplatense (134)
  --all                every dictionary word
  --limit N            only the first N selected words (by rank)

Options:
  --run NAME           names the output/checkpoint files (default: run) -> out/NAME.json, NAME.report.json, ...
  --model ID           Gemini model (default: ${DEFAULT_MODEL})
  --batch-size N       words per request (default 10)
  --delay-ms N         pause after each request, per worker (default 6000)
  --concurrency N      parallel workers (default 1)
  --temperature X      default 0.2
  --thinking N         thinkingBudget in tokens; omitted unless given (not all models accept it)
  --max-output-tokens N  default 16384 (thinking tokens count against it)
  --retry-base-ms N    first backoff after a 429/5xx/network error, doubling per attempt (default 4000)
  --context MODE       what the model sees besides es_word (default ${DEFAULT_CONTEXT}):
                         minimal  es_word and pos only
                         sense    plus the current English translation
                         full     plus Russian translation and the dictionary example (the old behaviour)
                       minimal/sense never send the example, its translations or word_form_in_example
  --no-hint            do not send the legacy es_rioplatense field to the model (this is the default)
  --with-hint          send it anyway, as "legacy_es_rioplatense" (only for A/B experiments; anchors the model)
  --compare-legacy     also write out/NAME.compare.json: words where the overlay disagrees with the legacy es_rioplatense
  --retry-invalid      also re-request words whose earlier result failed validation or whose batch failed
  --fresh              ignore and replace an existing checkpoint for this run
  --verbose            print every field of every entry
  --estimate           print token/cost/time estimates for the selection; no API call, no key needed
  --print-prompt       print the system prompt, response schema and a sample user prompt; no API call
  --help

API key: GEMINI_API_KEY from the environment or from .env.local in the repo root (gitignored).
The key is never printed or logged.`

// ---------------------------------------------------------------- output (always redacted)

let SECRET = null
const KEY_SHAPE = /AIza[0-9A-Za-z_-]{20,}/g
const redact = (value) => {
  let s = String(value)
  if (SECRET) s = s.split(SECRET).join('[redacted]')
  return s.replace(KEY_SHAPE, '[redacted]')
}
const log = (...parts) => console.log(redact(parts.join(' ')))
const logErr = (...parts) => console.error(redact(parts.join(' ')))

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const flags = new Set(['--stage1', '--all', '--retry-invalid', '--fresh', '--verbose', '--estimate', '--print-prompt', '--help', '--no-hint', '--with-hint', '--compare-legacy'])
  const values = new Set(['--words', '--limit', '--run', '--model', '--batch-size', '--delay-ms', '--concurrency', '--temperature', '--thinking', '--max-output-tokens', '--retry-base-ms', '--context'])
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (flags.has(a)) args[a.slice(2)] = true
    else if (values.has(a)) {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`)
      args[a.slice(2)] = v
    } else throw new Error(`Unknown argument: ${a}\n\n${HELP}`)
  }
  const num = (key, fallback) => {
    if (args[key] === undefined) return fallback
    const n = Number(args[key])
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${key} must be a non-negative number`)
    return n
  }
  if (args['no-hint'] && args['with-hint']) throw new Error('--no-hint and --with-hint contradict each other')
  const withHint = Boolean(args['with-hint'])
  const context = args.context ?? DEFAULT_CONTEXT
  if (!CONTEXTS.includes(context)) throw new Error(`--context must be one of ${CONTEXTS.join(', ')}`)
  return {
    ...args,
    withHint,
    context,
    systemPrompt: buildSystemPrompt({ withHint, context }),
    responseSchema: buildResponseSchema({ context }),
    run: args.run ?? 'run',
    model: args.model ?? DEFAULT_MODEL,
    batchSize: Math.max(1, num('batch-size', 10)),
    delayMs: num('delay-ms', 6000),
    concurrency: Math.max(1, num('concurrency', 1)),
    temperature: num('temperature', 0.2),
    thinking: args.thinking === undefined ? null : num('thinking', 0),
    maxOutputTokens: num('max-output-tokens', 16384),
    retryBaseMs: num('retry-base-ms', 4000),
    limit: args.limit === undefined ? null : num('limit', 0),
  }
}

// ---------------------------------------------------------------- key

function loadApiKey() {
  const fromEnv = process.env.GEMINI_API_KEY?.trim()
  if (fromEnv) return fromEnv

  const file = process.env.RIO_ENV_FILE ?? path.join(ROOT, '.env.local') // override is for the tests
  if (!fs.existsSync(file)) return null
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*(.*?)\s*$/)
    if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2') || null
  }
  return null
}

const MISSING_KEY_HELP = `GEMINI_API_KEY is not set, so nothing was sent to Gemini.

Set it in ONE of these ways (never paste the key into chat or commit it):
  1. Create a file named .env.local in the repo root (it is gitignored: .gitignore covers .env.* and *.local) with the single line
         GEMINI_API_KEY=your-key-here
  2. Or export it for the current shell only:
         export GEMINI_API_KEY=your-key-here
Get a key at https://aistudio.google.com/apikey (create it in the same Google project the proxy uses if you want access to gemini-2.5-flash,
which Google now limits to projects that have used it before). Then re-run the same command.`

// ---------------------------------------------------------------- dictionary

function loadDictionary() {
  return JSON.parse(fs.readFileSync(DICTIONARY_PATH, 'utf8')).sort((a, b) => a.rank - b.rank)
}

function selectWords(args, dictionary) {
  let selected
  const notFound = []

  if (args.words) {
    const byWord = new Map(dictionary.map((e) => [e.es_word, e]))
    selected = []
    for (const w of args.words.split(',').map((s) => s.trim()).filter(Boolean)) {
      const entry = byWord.get(w)
      if (entry) selected.push(entry)
      else notFound.push(w)
    }
  } else if (args.stage1) selected = dictionary.filter((e) => e.es_rioplatense)
  else if (args.all) selected = dictionary
  else throw new Error('Choose a selection: --words, --stage1 or --all (see --help)')

  selected = [...new Map(selected.map((e) => [e.es_word, e])).values()].sort((a, b) => a.rank - b.rank)
  if (args.limit !== null) selected = selected.slice(0, args.limit)
  return { selected, notFound }
}

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------- Gemini

class GeminiError extends Error {
  constructor(kind, message, status = null) {
    super(message)
    this.kind = kind // 'fatal' (stop everything) | 'content' (this request's output unusable) | 'retryable'
    this.status = status
  }
}

const SAFETY_OFF = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map((category) => ({
  category,
  threshold: 'BLOCK_NONE', // this is lexicography: vulgar and derogatory words must be describable
}))

async function requestOnce(inputs, cfg, key) {
  const body = {
    systemInstruction: { parts: [{ text: cfg.systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(inputs, { withHint: cfg.withHint, context: cfg.context }) }] }],
    generationConfig: {
      temperature: cfg.temperature,
      maxOutputTokens: cfg.maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: cfg.responseSchema,
      ...(cfg.thinking !== null ? { thinkingConfig: { thinkingBudget: cfg.thinking } } : {}),
    },
    safetySettings: SAFETY_OFF,
  }

  let res
  try {
    res = await fetch(`${API_BASE}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new GeminiError('retryable', `network error: ${err.message}`)
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 600)
    const message = `HTTP ${res.status}: ${text}`
    if (res.status === 429 || res.status >= 500) {
      const err = new GeminiError('retryable', message, res.status)
      err.retryAfterMs = Number(res.headers.get('retry-after')) * 1000 || null
      throw err
    }
    // 400 (bad request / schema rejected), 401/403 (key), 404 (model): retrying cannot help.
    throw new GeminiError('fatal', message, res.status)
  }

  const data = await res.json()
  if (data.promptFeedback?.blockReason) throw new GeminiError('content', `prompt blocked: ${data.promptFeedback.blockReason}`)

  const candidate = data.candidates?.[0]
  const finish = candidate?.finishReason
  if (!candidate || (finish && finish !== 'STOP')) throw new GeminiError('content', `finishReason ${finish ?? 'missing candidate'}`)

  const text = (candidate.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('')
  let entries
  try {
    entries = JSON.parse(text)
  } catch {
    throw new GeminiError('content', `response was not valid JSON (${text.slice(0, 80).replace(/\s+/g, ' ')}…)`)
  }

  const u = data.usageMetadata ?? {}
  return {
    entries,
    text,
    usage: { prompt: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thoughts: u.thoughtsTokenCount ?? 0 },
  }
}

const MAX_TRANSPORT_RETRIES = 5
const MAX_CONTENT_RETRIES = 2

/** One request with exponential backoff for transport errors and a couple of re-asks for unusable output. */
async function request(inputs, cfg, key, onWait) {
  let contentFailures = 0
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await requestOnce(inputs, cfg, key)
      if (!Array.isArray(result.entries)) throw new GeminiError('content', 'response was not a JSON array')
      return result
    } catch (err) {
      if (!(err instanceof GeminiError)) throw err
      if (err.kind === 'fatal') throw err
      if (err.kind === 'content') {
        if (++contentFailures > MAX_CONTENT_RETRIES) throw err
        onWait(`unusable output (${err.message}); asking again`)
        continue
      }
      if (attempt >= MAX_TRANSPORT_RETRIES) throw err
      const wait = Math.max(err.retryAfterMs ?? 0, Math.min(60000, cfg.retryBaseMs * 2 ** attempt)) + Math.random() * 1000
      onWait(`${err.message.slice(0, 120)}; retrying in ${Math.round(wait / 1000)}s`)
      await sleep(wait)
    }
  }
}

// ---------------------------------------------------------------- checkpoint

const paths = (run) => ({
  checkpoint: path.join(OUT_DIR, `${run}.checkpoint.json`),
  raw: path.join(OUT_DIR, `${run}.raw.jsonl`),
  entries: path.join(OUT_DIR, `${run}.json`),
  report: path.join(OUT_DIR, `${run}.report.json`),
  compare: path.join(OUT_DIR, `${run}.compare.json`),
})

/** Identifies the exact instructions a run was made with: results from different prompts must not be mixed. */
const promptHash = (cfg) => crypto.createHash('sha256').update(cfg.systemPrompt).update(JSON.stringify(cfg.responseSchema)).update(String(cfg.withHint)).update(`context=${cfg.context}`).digest('hex').slice(0, 12)

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

function loadCheckpoint(file, cfg, fresh) {
  const hash = promptHash(cfg)
  if (!fresh && fs.existsSync(file)) {
    const cp = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (cp.model && cp.model !== cfg.model) {
      throw new Error(`Checkpoint ${path.relative(ROOT, file)} was made with ${cp.model}, not ${cfg.model}. Use a different --run name, or --fresh to start over.`)
    }
    if (cp.context && cp.context !== cfg.context) {
      throw new Error(`Checkpoint ${path.relative(ROOT, file)} was made with --context ${cp.context}, not ${cfg.context}. Use a different --run name, or --fresh to start over.`)
    }
    if (cp.promptHash && cp.promptHash !== hash) {
      throw new Error(`Checkpoint ${path.relative(ROOT, file)} was made with a different prompt/schema (${cp.promptHash}, now ${hash}). Use a different --run name, or --fresh to start over.`)
    }
    return { ...cp, promptHash: hash }
  }
  return { version: 2, model: cfg.model, context: cfg.context, promptHash: hash, withHint: cfg.withHint, startedAt: new Date().toISOString(), results: {}, failedWords: {}, usage: { requests: 0, prompt: 0, output: 0, thoughts: 0 } }
}

// ---------------------------------------------------------------- running

function toInput(e) {
  return {
    es_word: e.es_word,
    pos: e.pos,
    en_translation: e.en_translation,
    ru_translation: e.ru_translation,
    example_sentence: e.example_sentence,
    example_translation_en: e.example_translation_en,
    example_translation_ru: e.example_translation_ru,
    word_form_in_example: e.word_form_in_example,
    es_rioplatense: e.es_rioplatense,
  }
}

async function run(args, selected, key) {
  const p = paths(args.run)
  const cp = loadCheckpoint(p.checkpoint, args, args.fresh)

  const settled = (w) => (w in cp.results && (args['retry-invalid'] ? cp.results[w].errors.length === 0 : true))
  const todo = selected.filter((e) => !settled(e.es_word)).map(toInput)
  const skipped = selected.length - todo.length

  log(`Model: ${args.model} | run: ${args.run} | context: ${args.context} | hint: ${args.withHint ? 'sent' : 'not sent'} | ${selected.length} selected, ${skipped} already done, ${todo.length} to request`)
  if (todo.length === 0) return finish(args, selected, cp, p)

  const batches = chunk(todo, args.batchSize)
  const queue = [...batches]
  let done = 0
  let aborted = null
  const started = Date.now()

  const record = (inputs, response) => {
    cp.usage.requests++
    cp.usage.prompt += response.usage.prompt
    cp.usage.output += response.usage.output
    cp.usage.thoughts += response.usage.thoughts
    fs.mkdirSync(OUT_DIR, { recursive: true })
    fs.appendFileSync(p.raw, JSON.stringify({ at: new Date().toISOString(), model: args.model, words: inputs.map((w) => w.es_word), usage: response.usage, text: response.text }) + '\n')

    const { results, batchErrors } = validateBatch(response.entries, inputs)
    for (const [word, r] of results) {
      cp.results[word] = r
      delete cp.failedWords[word]
    }
    for (const w of inputs) {
      if (!results.has(w.es_word)) cp.failedWords[w.es_word] = `not returned by the model (${batchErrors.join('; ')})`
    }
    return results
  }

  async function processBatch(inputs) {
    const wait = (msg) => log(`  ${msg}`)
    try {
      return record(inputs, await request(inputs, args, key, wait))
    } catch (err) {
      if (!(err instanceof GeminiError) || err.kind === 'fatal') throw err
      if (inputs.length === 1) {
        cp.failedWords[inputs[0].es_word] = err.message
        log(`  FAILED ${inputs[0].es_word}: ${err.message}`)
        return null
      }
      log(`  batch failed (${err.message}); retrying its ${inputs.length} words one by one`)
      for (const single of inputs) await processBatch([single])
      return null
    }
  }

  async function worker() {
    while (!aborted) {
      const inputs = queue.shift()
      if (!inputs) return
      try {
        const results = await processBatch(inputs)
        done++
        const bad = results ? [...results.values()].filter((r) => r.errors.length).length : inputs.length
        const eta = ((Date.now() - started) / done) * (batches.length - done)
        log(`Batch ${done}/${batches.length} [${inputs[0].es_word}…] ${inputs.length - bad} ok, ${bad} need attention | ETA ${formatDuration(eta / args.concurrency)}`)
      } catch (err) {
        aborted = err
        return
      } finally {
        writeJson(p.checkpoint, cp)
      }
      if (queue.length) await sleep(args.delayMs)
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concurrency, batches.length) }, worker))
  writeJson(p.checkpoint, cp)

  if (aborted) {
    logErr(`\nStopped: ${aborted.message}`)
    logErr(`Progress is saved (${Object.keys(cp.results).length} words). Fix the cause and re-run the same command to resume.`)
    process.exitCode = 1
    return
  }
  finish(args, selected, cp, p)
}

function finish(args, selected, cp, p) {
  const ordered = selected.filter((e) => e.es_word in cp.results)
  const entries = ordered.map((e) => cp.results[e.es_word].entry)
  writeJson(p.entries, entries)

  const failures = ordered
    .filter((e) => cp.results[e.es_word].errors.length || cp.results[e.es_word].warnings.length)
    .map((e) => ({ es_word: e.es_word, errors: cp.results[e.es_word].errors, warnings: cp.results[e.es_word].warnings }))
  const missing = selected.filter((e) => !(e.es_word in cp.results)).map((e) => ({ es_word: e.es_word, reason: cp.failedWords[e.es_word] ?? 'not requested yet' }))
  const price = PRICING[args.model]
  const cost = price ? (cp.usage.prompt * price.in + (cp.usage.output + cp.usage.thoughts) * price.out) / 1e6 : null

  writeJson(p.report, {
    model: args.model,
    run: args.run,
    selected: selected.length,
    returned: entries.length,
    withErrors: failures.filter((f) => f.errors.length).length,
    withWarnings: failures.filter((f) => f.warnings.length).length,
    missing,
    context: args.context,
    // Non-none entries the model wrote no example for. Where the dictionary's current example lacks the form, they await the example pass.
    needsExampleCheck: ordered.filter((e) => cp.results[e.es_word].flags?.includes('needs_example_check')).map((e) => ({ es_word: e.es_word, currentExampleShowsForm: cp.results[e.es_word].currentExampleShowsForm })),
    pass2Queue: ordered.filter((e) => cp.results[e.es_word].flags?.includes('needs_example_check') && cp.results[e.es_word].currentExampleShowsForm === false).map((e) => e.es_word),
    usage: cp.usage,
    estimatedCostUsd: cost,
    failures,
  })

  printTable(ordered.map((e) => ({ word: e.es_word, ...cp.results[e.es_word] })), args.verbose)

  if (args['compare-legacy']) {
    const rows = ordered.map((e) => ({ input: e, entry: cp.results[e.es_word].entry, valid: cp.results[e.es_word].errors.length === 0 }))
    const disagreements = compareLegacy(rows)
    writeJson(p.compare, { run: args.run, compared: rows.length, disagreements })
    const count = (kind) => disagreements.filter((d) => d.kind === kind).length
    log(`\nLegacy comparison (${path.relative(ROOT, p.compare)}): ${disagreements.length} of ${rows.length} disagree — ${count('legacy_only')} legacy-only, ${count('overlay_only')} overlay-only, ${count('different')} different form`)
    for (const d of disagreements) {
      log(`  ${d.kind.padEnd(12)} ${d.es_word.padEnd(12)} legacy=${JSON.stringify(d.legacy)} overlay=${d.overlay.rio_type}${d.overlay.rio_form ? `:${d.overlay.rio_form}` : ''}${d.overlay.alt_form ? ` / ${d.overlay.alt_form}` : ''} (${d.confidence})`)
    }
  }
  const checks = ordered.filter((e) => cp.results[e.es_word].flags?.includes('needs_example_check'))
  if (checks.length) {
    const lacking = checks.filter((e) => cp.results[e.es_word].currentExampleShowsForm === false)
    log(`\nneeds_example_check: ${checks.length} entries have no new example; the current dictionary example lacks the form in ${lacking.length}${lacking.length ? ` (pass-2 queue: ${lacking.map((e) => e.es_word).join(', ')})` : ''}`)
  }
  log(`\nWrote ${path.relative(ROOT, p.entries)} (${entries.length} entries) and ${path.relative(ROOT, p.report)}`)
  log(`Validation: ${failures.filter((f) => f.errors.length).length} entries with errors, ${failures.filter((f) => f.warnings.length).length} with warnings, ${missing.length} missing`)
  log(`Usage: ${cp.usage.requests} requests, ${cp.usage.prompt} prompt + ${cp.usage.output} output + ${cp.usage.thoughts} thinking tokens${cost !== null ? ` ≈ $${cost.toFixed(4)}` : ''}`)
}

// ---------------------------------------------------------------- reporting

function formatDuration(ms) {
  const m = Math.round(ms / 60000)
  if (m < 1) return '<1m'
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

function printTable(rows, verbose) {
  const cell = (v, n) => String(v ?? '-').slice(0, n).padEnd(n)
  log('')
  log(`${cell('word', 12)} ${cell('type', 13)} ${cell('rio_form', 14)} ${cell('reg', 4)} ${cell('alt', 14)} ${cell('register', 9)} ${cell('conf', 6)} ${cell('ex', 3)} ${cell('tr', 3)} valid`)
  for (const { word, entry, errors, warnings } of rows) {
    log(
      `${cell(word, 12)} ${cell(entry.rio_type, 13)} ${cell(entry.rio_form, 14)} ${cell(entry.region, 4)} ${cell(entry.alt_form ? `${entry.alt_form}(${entry.alt_region})` : null, 14)} ${cell(entry.register, 9)} ${cell(entry.confidence, 6)} ${cell(entry.example_sentence ? 'new' : '-', 3)} ${cell(entry.en_translation ? 'new' : '-', 3)} ${errors.length ? `FAIL(${errors.length})` : warnings.length ? `ok, ${warnings.length} warn` : 'ok'}`,
    )
  }
  if (!verbose) return
  for (const { word, entry, errors, warnings } of rows) {
    log(`\n--- ${word} ---`)
    for (const [k, v] of Object.entries(entry)) log(`  ${k.padEnd(24)} ${v === null ? 'null' : JSON.stringify(v)}`)
    for (const e of errors) log(`  ERROR   ${e}`)
    for (const w of warnings) log(`  warning ${w}`)
  }
}

function printEstimate(args, selected) {
  const tokens = (text) => Math.ceil(text.length / 4.9) // calibrated on the 2026-10-02 dry run (2694 real prompt tokens for 9 words)
  const batches = chunk(selected.map(toInput), args.batchSize)
  const fixed = tokens(args.systemPrompt) + tokens(JSON.stringify(args.responseSchema))
  const promptTokens = batches.reduce((sum, b) => sum + fixed + tokens(buildUserPrompt(b, { withHint: args.withHint, context: args.context })), 0)

  const share = args.all ? 0.08 : 1 // fraction of words expected to get a full (non-none) entry
  const substantive = Math.round(selected.length * share)
  const noneCount = selected.length - substantive
  const outputTokens = substantive * 280 + noneCount * 120
  // Unbounded (default) thinking measured ~6500 tokens for one 9-word request; an explicit budget caps it.
  const thinkingPerRequest = args.thinking === null ? 6500 : Math.min(args.thinking, 6500)
  const thoughtTokens = batches.length * thinkingPerRequest
  const latency = 25 // seconds per request, assumed

  const serial = batches.length * (latency + args.delayMs / 1000)
  log(`Selection: ${selected.length} words -> ${batches.length} requests of up to ${args.batchSize}`)
  log(`Assumptions (rough, calibrated on one real request): prompt ${fixed} fixed tokens/request; ${share === 1 ? 'every word gets' : `~${share * 100}% of words get`} a full entry (~280 output tokens, none ~120); ~${thinkingPerRequest} thinking tokens/request; ~${latency}s/request`)
  log(`Tokens: ~${promptTokens} prompt, ~${outputTokens} output, ~${thoughtTokens} thinking`)
  for (const [model, price] of Object.entries(PRICING)) {
    const cost = (promptTokens * price.in + (outputTokens + thoughtTokens) * price.out) / 1e6
    log(`  ${model.padEnd(24)} ≈ $${cost.toFixed(3)}  (in $${price.in} / out $${price.out} per 1M)`)
  }
  log(`Time: ~${formatDuration(serial * 1000)} with 1 worker; ~${formatDuration((serial * 1000) / 4)} with --concurrency 4 (rate limits permitting)`)
}

function printPrompt(args, selected) {
  log('===== SYSTEM INSTRUCTION =====\n')
  log(args.systemPrompt)
  log('\n===== RESPONSE SCHEMA (generationConfig.responseSchema) =====\n')
  log(JSON.stringify(args.responseSchema, null, 2))
  log('\n===== SAMPLE USER TURN =====\n')
  log(buildUserPrompt(selected.slice(0, 2).map(toInput), { withHint: args.withHint, context: args.context }))
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return log(HELP)

  const dictionary = loadDictionary()
  const needsSelection = !(args['print-prompt'] && !args.words && !args.stage1 && !args.all)
  const { selected, notFound } = needsSelection ? selectWords(args, dictionary) : { selected: dictionary.slice(0, 2), notFound: [] }
  if (notFound.length) log(`Not in the dictionary, skipped: ${notFound.join(', ')}`)

  if (args['print-prompt']) return printPrompt(args, selected)
  if (args.estimate) return printEstimate(args, selected)
  if (selected.length === 0) throw new Error('Nothing selected.')

  const key = loadApiKey()
  if (!key) {
    logErr(MISSING_KEY_HELP)
    process.exitCode = 2
    return
  }
  SECRET = key

  await run(args, selected, key)
}

main().catch((err) => {
  logErr(`Error: ${err.message}`)
  process.exit(1)
})
