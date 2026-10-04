#!/usr/bin/env node
// Pass 2 (default) writes one new example sentence per overlay entry whose current example does not show the
// Rioplatense form or sense (see examples.mjs). Pass 3 (--pass fallback) writes a neutral sentence with the standard
// word for dictionary words that are not in the overlay but carry an old example for the legacy Rioplatense form
// (see fallback.mjs). Built on generate.mjs's request machinery (structured output, backoff, key handling and
// redaction). Without --run it is a dry run: it lists the scope and the cost and calls nothing. The validator never
// repairs: failures are listed, not edited.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXAMPLE_SCHEMA, SYSTEM_PROMPT, buildUserText, selectScope, validateExample } from './examples.mjs'
import { FALLBACK_SCHEMA, FALLBACK_SYSTEM_PROMPT, buildFallbackUserText, selectFallbackScope, validateFallback } from './fallback.mjs'
import { GeminiError, OUT_DIR, PRICING, ROOT, chunk, loadApiKey, log, logErr, MISSING_KEY_HELP, request, setSecret, sleep, writeJson } from './generate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_MODEL = 'gemini-3.1-pro-preview' // best available for natural prose; dozens of sentences cost cents

const readJsonFile = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

/** What differs between the passes: the scope, the prompt, the schema, the validator and the shape of a stored example. */
const PASSES = {
  overlay: {
    systemPrompt: SYSTEM_PROMPT,
    schema: EXAMPLE_SCHEMA,
    userText: buildUserText,
    validate: validateExample,
    defaultOut: 'tools/rio-overlay/results/overlay-v1/examples.v1.json',
    select: (args, dictionary) => ({ items: selectScope(readJsonFile(args.overlay), dictionary), excluded: [] }),
    columns: ['word', 'rio_form', 'type', 'region', 'alt_form', 'reason'],
    row: (i) => [i.es_word, i.rio_form, i.type, String(i.region ?? '-'), String(i.alt_form ? `${i.alt_form}(${i.alt_region ?? '-'})` : '-'), i.reason],
    // replacements pass the automatic checks and ship; the others wait for a human to confirm the sense
    example: (item, r) => ({ es: r.row.example_es, en: r.row.example_en, ru: r.row.example_ru, word_form: r.row.word_form_in_example, rio_form: item.rio_form, type: item.type, review: item.type === 'replacement' ? 'auto' : 'pending', warnings: r.warnings }),
    failure: (item) => ({ es_word: item.es_word, rio_form: item.rio_form, type: item.type }),
    show: (w, e) => `${w} → ${e.rio_form} (${e.type}, review ${e.review})`,
  },
  fallback: {
    systemPrompt: FALLBACK_SYSTEM_PROMPT,
    schema: FALLBACK_SCHEMA,
    userText: buildFallbackUserText,
    validate: validateFallback,
    defaultOut: 'tools/rio-overlay/results/overlay-v1/examples.fallback.json',
    select: (args, dictionary) => {
      const { scope, excluded } = selectFallbackScope(dictionary, readJsonFile(path.join(ROOT, 'public', 'rio_overlay.json')))
      return { items: scope, excluded }
    },
    columns: ['word', 'pos', 'old form', 'avoid', 'meaning'],
    row: (i) => [i.es_word, i.pos, i.old_word_form, i.avoid.join(', '), i.meaning_en.slice(0, 40)],
    example: (item, r) => ({ es: r.row.example_es, en: r.row.example_en, ru: r.row.example_ru, word_form: r.row.word_form_in_example, warnings: r.warnings }),
    failure: (item) => ({ es_word: item.es_word, old_word_form: item.old_word_form }),
    show: (w) => w,
  },
}

const HELP = `Usage: node tools/rio-overlay/generate-examples.mjs [options]

Without --run: dry run (scope + cost estimate, no API call, no key needed).

  --pass overlay|fallback  overlay (default): pass 2, examples for overlay entries. fallback: pass 3, neutral sentences with the standard word
                       for words outside the overlay whose old example shows another word.
  --run NAME           actually generate; names out/NAME.checkpoint.json, out/NAME.raw.jsonl
  --model ID           default ${DEFAULT_MODEL}
  --batch-size N       entries per request (default 8)
  --delay-ms N         pause between requests (default 6000)
  --temperature X      default 0.7
  --thinking N         thinkingBudget in tokens (omitted unless given)
  --max-output-tokens N  default 16384
  --retry-base-ms N    backoff base after 429/5xx/network errors (default 4000)
  --retry-invalid      re-request entries whose earlier result failed validation
  --fresh              ignore and replace an existing checkpoint for this run
  --overlay PATH       default results/overlay-v1/overlay.v1.json
  --out PATH           compact result file (default results/overlay-v1/examples.v1.json)
  --verbose            print every sentence
  --help`

function parseArgs(argv) {
  const flags = new Set(['--retry-invalid', '--fresh', '--verbose', '--help'])
  const values = new Set(['--pass', '--run', '--model', '--batch-size', '--delay-ms', '--temperature', '--thinking', '--max-output-tokens', '--retry-base-ms', '--overlay', '--out'])
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
  const num = (key, fallback) => (args[key] === undefined ? fallback : Number(args[key]))
  if (args.pass !== undefined && !(args.pass in PASSES)) throw new Error(`--pass must be one of ${Object.keys(PASSES).join(', ')}`)
  const pass = PASSES[args.pass ?? 'overlay']
  return {
    ...args,
    pass,
    model: args.model ?? DEFAULT_MODEL,
    batchSize: Math.max(1, num('batch-size', 8)),
    delayMs: num('delay-ms', 6000),
    temperature: num('temperature', 0.7),
    thinking: args.thinking === undefined ? null : num('thinking', 0),
    maxOutputTokens: num('max-output-tokens', 16384),
    retryBaseMs: num('retry-base-ms', 4000),
    overlay: path.resolve(ROOT, args.overlay ?? 'tools/rio-overlay/results/overlay-v1/overlay.v1.json'),
    out: path.resolve(ROOT, args.out ?? pass.defaultOut),
  }
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const promptHash = (cfg) => crypto.createHash('sha256').update(cfg.pass.systemPrompt).update(JSON.stringify(cfg.pass.schema)).update(cfg.model).digest('hex').slice(0, 12)

function estimate(items, batchSize, pass) {
  const tokens = (text) => Math.ceil(text.length / 4.9)
  const batches = chunk(items, batchSize)
  const fixed = tokens(pass.systemPrompt) + tokens(JSON.stringify(pass.schema))
  const prompt = batches.reduce((sum, b) => sum + fixed + tokens(pass.userText(b)), 0)
  const output = items.length * 160 // sentence + EN + RU + word form as JSON
  const thinking = batches.length * 3500 // measured ~3500-4700 per 10-entry request with the stage-1 prompts
  const costs = Object.entries(PRICING).map(([model, p]) => [model, (prompt * p.in + (output + thinking) * p.out) / 1e6])
  return { batches: batches.length, prompt, output, thinking, costs }
}

function printScope(items, excluded, pass) {
  log(`${items.length} entries need a new example:`)
  const widths = pass.columns.map((c, i) => Math.max(c.length, ...items.map((it) => String(pass.row(it)[i]).length)))
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ')
  log(line(pass.columns))
  for (const i of items) log(line(pass.row(i)))
  for (const e of excluded) log(`excluded: ${e.es_word} (${e.reason})`)
}

async function run(args, items, key) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const files = { checkpoint: path.join(OUT_DIR, `${args.run}.checkpoint.json`), raw: path.join(OUT_DIR, `${args.run}.raw.jsonl`) }
  const hash = promptHash(args)
  const pass = args.pass
  let cp = { version: 1, model: args.model, promptHash: hash, results: {}, failedWords: {}, usage: { requests: 0, prompt: 0, output: 0, thoughts: 0 } }
  if (!args.fresh && fs.existsSync(files.checkpoint)) {
    cp = readJson(files.checkpoint)
    if (cp.model !== args.model) throw new Error(`Checkpoint was made with ${cp.model}, not ${args.model}. Use a different --run name, or --fresh.`)
    if (cp.promptHash !== hash) throw new Error(`Checkpoint was made with a different prompt/schema (${cp.promptHash}, now ${hash}). Use a different --run name, or --fresh.`)
  }

  const settled = (w) => w in cp.results && (args['retry-invalid'] ? cp.results[w].errors.length === 0 : true)
  const todo = items.filter((i) => !settled(i.es_word))
  log(`Model: ${args.model} | run: ${args.run} | ${items.length} in scope, ${items.length - todo.length} already done, ${todo.length} to request`)

  const cfg = { model: args.model, systemPrompt: pass.systemPrompt, responseSchema: pass.schema, temperature: args.temperature, maxOutputTokens: args.maxOutputTokens, thinking: args.thinking, retryBaseMs: args.retryBaseMs, userText: pass.userText }
  const byWord = new Map(items.map((i) => [i.es_word, i]))

  const record = (batch, response) => {
    cp.usage.requests++
    cp.usage.prompt += response.usage.prompt
    cp.usage.output += response.usage.output
    cp.usage.thoughts += response.usage.thoughts
    fs.appendFileSync(files.raw, JSON.stringify({ at: new Date().toISOString(), model: args.model, words: batch.map((i) => i.es_word), usage: response.usage, text: response.text }) + '\n')
    const seen = new Set()
    for (const row of response.entries) {
      const item = row && typeof row === 'object' ? byWord.get(row.es_word) : undefined
      if (!item || seen.has(item.es_word) || !batch.includes(item)) continue
      seen.add(item.es_word)
      cp.results[item.es_word] = { row, ...pass.validate(row, item) }
      delete cp.failedWords[item.es_word]
    }
    for (const item of batch) if (!seen.has(item.es_word)) cp.failedWords[item.es_word] = 'not returned by the model'
  }

  async function processBatch(batch) {
    try {
      record(batch, await request(batch, cfg, key, (msg) => log(`  ${msg}`)))
    } catch (err) {
      if (!(err instanceof GeminiError) || err.kind === 'fatal') throw err
      if (batch.length === 1) {
        cp.failedWords[batch[0].es_word] = err.message
        log(`  FAILED ${batch[0].es_word}: ${err.message}`)
        return
      }
      log(`  batch failed (${err.message}); retrying its ${batch.length} entries one by one`)
      for (const single of batch) await processBatch([single])
    }
  }

  const batches = chunk(todo, args.batchSize)
  try {
    for (const [n, batch] of batches.entries()) {
      await processBatch(batch)
      const bad = batch.filter((i) => !cp.results[i.es_word] || cp.results[i.es_word].errors.length).length
      log(`Batch ${n + 1}/${batches.length} [${batch[0].es_word}…] ${batch.length - bad} ok, ${bad} need attention`)
      writeJson(files.checkpoint, cp)
      if (n < batches.length - 1) await sleep(args.delayMs)
    }
  } catch (err) {
    writeJson(files.checkpoint, cp)
    logErr(`\nStopped: ${err.message}`)
    logErr(`Progress is saved (${Object.keys(cp.results).length} entries). Re-run the same command to resume.`)
    process.exitCode = 1
    return
  }
  writeJson(files.checkpoint, cp)
  finish(args, items, cp, hash)
}

function finish(args, items, cp, hash) {
  const price = PRICING[args.model]
  const cost = price ? (cp.usage.prompt * price.in + (cp.usage.output + cp.usage.thoughts) * price.out) / 1e6 : null
  const examples = {}
  const failed = []
  for (const item of items) {
    const r = cp.results[item.es_word]
    if (r && r.errors.length === 0) examples[item.es_word] = args.pass.example(item, r)
    else failed.push({ ...args.pass.failure(item), errors: r ? r.errors : [cp.failedWords[item.es_word] ?? 'not requested'], raw: r?.row ?? null })
  }
  const result = {
    meta: { pass: args.pass === PASSES.fallback ? 'fallback' : 'overlay', model: args.model, run: args.run, promptHash: hash, generatedAt: new Date().toISOString(), selected: items.length, generated: Object.keys(examples).length, failed: failed.length, usage: cp.usage, costUsd: cost },
    examples,
    failed,
  }
  writeJson(args.out, result)

  if (args.verbose) {
    for (const [w, e] of Object.entries(examples)) log(`\n${args.pass.show(w, e)}\n  ES ${e.es}\n  EN ${e.en}\n  RU ${e.ru}\n  form: ${e.word_form}${e.warnings.length ? `\n  warnings: ${e.warnings.join('; ')}` : ''}`)
  }
  for (const f of failed) log(`FAILED ${f.es_word}: ${f.errors.join('; ')}`)
  log(`\nWrote ${path.relative(ROOT, args.out)}: ${result.meta.generated} generated, ${failed.length} failed`)
  log(`Usage: ${cp.usage.requests} requests, ${cp.usage.prompt} prompt + ${cp.usage.output} output + ${cp.usage.thoughts} thinking tokens${cost !== null ? ` ≈ $${cost.toFixed(4)}` : ''}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return log(HELP)

  const dictionary = readJson(path.join(ROOT, 'public', 'words_enriched.json'))
  const { items, excluded } = args.pass.select(args, dictionary)
  if (items.length === 0) throw new Error('Nothing in scope.')

  if (!args.run) {
    printScope(items, excluded, args.pass)
    const e = estimate(items, args.batchSize, args.pass)
    log(`\nDry run: ${e.batches} request(s) of up to ${args.batchSize}; ~${e.prompt} prompt, ~${e.output} output and ~${e.thinking} thinking tokens`)
    for (const [model, cost] of e.costs) log(`  ${model.padEnd(24)} ≈ $${cost.toFixed(3)}`)
    log('No API call was made. Add --run NAME to generate.')
    return
  }

  const key = loadApiKey()
  if (!key) {
    logErr(MISSING_KEY_HELP)
    process.exitCode = 2
    return
  }
  setSecret(key)
  await run(args, items, key)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    logErr(`Error: ${err.message}`)
    process.exit(1)
  })
}
void HERE
