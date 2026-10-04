import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_REASON, STD_USAGE_KEYS, STD_USAGE_SCHEMA, STD_USAGE_SYSTEM_PROMPT, STD_USAGE_VALUES, buildStdUsageUserText, selectStdUsageScope, validateStdUsage } from './stdusage.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const SCRIPT = path.join(HERE, 'generate-examples.mjs')
const OUT = path.join(HERE, 'out')
const dictionary = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'words_enriched.json'), 'utf8'))
const overlay = JSON.parse(fs.readFileSync(path.join(HERE, 'results', 'overlay-v1', 'overlay.v1.json'), 'utf8'))
const usageFile = JSON.parse(fs.readFileSync(path.join(HERE, 'results', 'overlay-v1', 'std-usage.v1.json'), 'utf8'))
const client = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'rio_overlay.json'), 'utf8'))
const scope = selectStdUsageScope(overlay, dictionary)

describe('selectStdUsageScope', () => {
  it('takes the 63 accepted entries whose form differs from es_word, and no meaning_shift / regional_only / rejected / pending ones', () => {
    expect(scope).toHaveLength(63)
    const words = scope.map((s) => s.es_word)
    expect(words).toEqual(expect.arrayContaining(['autobús', 'metro', 'apartamento', 'chico', 'aquí', 'periódico', 'pastel', 'cabello', 'carro', 'fila', 'escoger', 'quizá', 'tú', 'contigo']))
    for (const out of ['foco', 'guapo', 'vos', 'mona', 'niño', 'hermoso']) expect(words).not.toContain(out)
    expect(scope.every((s) => s.type === 'replacement')).toBe(true)
  })

  it('carries pos and region, and is sorted by rank', () => {
    expect(scope.find((s) => s.es_word === 'metro')).toMatchObject({ rio_form: 'subte', region: 'ar', pos: 'n' })
    expect(scope.find((s) => s.es_word === 'aquí')).toMatchObject({ region: null })
    expect(scope.map((s) => s.rank)).toEqual([...scope.map((s) => s.rank)].sort((a, b) => a - b))
  })
})

describe('prompt and schema', () => {
  it('asks the one narrow question with the three values, reason first, and no examples from the dictionary', () => {
    for (const needle of ['ITSELF used in everyday speech', 'not_used', 'less_common', 'equally_used', 'prefer less_common over not_used', 'reason']) expect(STD_USAGE_SYSTEM_PROMPT).toContain(needle)
    expect(STD_USAGE_KEYS).toEqual(['es_word', 'reason', 'std_usage'])
    expect(Object.keys(STD_USAGE_SCHEMA.items.properties)).toEqual(STD_USAGE_KEYS)
    expect(STD_USAGE_SCHEMA.items.properties.std_usage.enum).toEqual(STD_USAGE_VALUES)
    // none of the words the owner sanity-checks appear in the prompt as examples
    for (const w of ['autobús', 'metro', 'apartamento', 'chico', 'aquí', 'periódico', 'pastel', 'cabello', 'carro', 'fila', 'escoger', 'quizá']) expect(STD_USAGE_SYSTEM_PROMPT).not.toContain(w)
  })

  it('sends only es_word, rio_form, pos and region: no example, no legacy hint, no evidence', () => {
    const text = buildStdUsageUserText([scope.find((s) => s.es_word === 'metro')])
    expect(JSON.parse(text.slice(text.indexOf('[')))).toEqual([{ es_word: 'metro', rio_form: 'subte', pos: 'n', region: 'ar' }])
    expect(text).not.toMatch(/example|legacy|evidence|rank|type|confidence/i)
  })
})

describe('validateStdUsage', () => {
  const item = { es_word: 'aquí' }
  const good = (over = {}) => ({ es_word: 'aquí', reason: 'People say acá in everyday speech; aquí sounds formal.', std_usage: 'less_common', ...over })
  const codes = (r) => r.errors.map((e) => e.split(':')[0])

  it('accepts each of the three values', () => {
    for (const v of STD_USAGE_VALUES) expect(validateStdUsage(good({ std_usage: v }), item).errors).toEqual([])
  })

  it.each([
    ['an unknown value', good({ std_usage: 'sometimes' }), 'bad_std_usage'],
    ['an empty reason', good({ reason: ' ' }), 'reason_empty'],
    ['a reason over the limit', good({ reason: 'x'.repeat(MAX_REASON + 1) }), 'reason_too_long'],
    ['a multi-line reason', good({ reason: 'one\ntwo' }), 'reason_not_one_line'],
    ['an asterisk', good({ reason: 'a **bold** claim' }), 'asterisk'],
    ['a wrong echo', good({ es_word: 'acá' }), 'es_word_echo'],
    ['a stranger key', { ...good(), extra: 1 }, 'unexpected_keys'],
    ['a missing key', { es_word: 'aquí', std_usage: 'not_used' }, 'missing_keys'],
  ])('rejects %s', (_label, row, code) => {
    expect(codes(validateStdUsage(row, item))).toContain(code)
  })
})

describe('the stored answers and the client file', () => {
  it('std-usage.v1.json answers exactly the 63 entries in scope, all valid, none failed', () => {
    expect(usageFile.meta).toMatchObject({ pass: 'stdusage', selected: 63, generated: 63, failed: 0 })
    expect(Object.keys(usageFile.usage).sort()).toEqual(scope.map((s) => s.es_word).sort())
    for (const item of scope) {
      const u = usageFile.usage[item.es_word]
      expect(validateStdUsage({ es_word: item.es_word, reason: u.reason, std_usage: u.std_usage }, item).errors, item.es_word).toEqual([])
      expect(u.rio_form).toBe(item.rio_form)
    }
    expect(usageFile.failed).toEqual([])
  })

  // the only entries that stay not_used: unambiguously Peninsular-only, with no other common sense in Rioplatense
  const KEPT = ['aparcar', 'chaval', 'gilipollas', 'guay', 'ordenador', 'patata', 'vosotros', 'vuestro']

  it('the client file has std_usage on every replacement and null on the others; only the 8 Peninsular-only words stay not_used', () => {
    for (const e of client) {
      if (e.rio_type !== 'replacement') expect(e.std_usage, e.es_word).toBeNull()
      else if (KEPT.includes(e.es_word)) expect(e.std_usage, e.es_word).toBe('not_used')
      else expect(['less_common', 'equally_used'], e.es_word).toContain(e.std_usage)
    }
    expect(client.filter((e) => e.std_usage === 'not_used').map((e) => e.es_word).sort()).toEqual(KEPT)
    expect(client.filter((e) => e.std_usage === 'less_common')).toHaveLength(51)
    expect(client.filter((e) => e.std_usage === 'equally_used')).toHaveLength(4)
  })

  it('every change from the model\'s answer is a downgrade, recorded as manual with its reason in the full overlay file', () => {
    const rank = { not_used: 0, less_common: 1, equally_used: 2 }
    const changed = overlay.filter((e) => e.std_usage && e.std_usage !== usageFile.usage[e.es_word].std_usage)
    expect(changed.length).toBeGreaterThanOrEqual(30)
    for (const e of changed) {
      expect(rank[e.std_usage], e.es_word).toBeGreaterThan(rank[usageFile.usage[e.es_word].std_usage]) // never towards "rarely used"
      expect(e.std_usage_reason, e.es_word).toContain('decided by hand')
      expect(e.evidence.join('\n'), e.es_word).toMatch(/manual (override|rule)/)
    }
    // the eleven that have another everyday sense in the region carry that reason verbatim
    for (const w of ['pluma', 'falda', 'cubo', 'maya', 'portero', 'balón', 'condón', 'metro', 'mando', 'carretera', 'mantequilla']) {
      expect(overlay.find((e) => e.es_word === w).std_usage_reason, w).toContain('has another everyday sense in the region')
    }
    for (const w of KEPT) expect(overlay.find((e) => e.es_word === w).std_usage_reason, w).toContain('kept by hand')
  })

  it('the model\'s reasons stay out of the client file (they are for review)', () => {
    for (const e of client) expect(e).not.toHaveProperty('std_usage_reason')
    expect(overlay.filter((e) => e.std_usage).every((e) => typeof e.std_usage_reason === 'string' && e.std_usage_reason.length > 0)).toBe(true)
  })
})

// ---------------------------------------------------------------- CLI, --pass stdusage, against a fake Gemini

const KEY = ['AIza', 'SyFAKEKEYFORTESTS_1234567890abcdefgh'].join('')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stdusage-test-'))
const cleanup = () => {
  if (fs.existsSync(OUT)) for (const f of fs.readdirSync(OUT)) if (f.startsWith('ts-')) fs.rmSync(path.join(OUT, f))
}
beforeAll(cleanup)
afterAll(() => {
  cleanup()
  fs.rmSync(tmp, { recursive: true, force: true })
})

function fakeGemini(handler) {
  const requests = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null
      const text = body?.contents?.[0]?.parts?.[0]?.text ?? ''
      const words = text.includes('[') ? JSON.parse(text.slice(text.indexOf('['))).map((w) => w.es_word) : []
      requests.push({ url: req.url, headers: req.headers, body, text, words })
      handler(requests.at(-1), res)
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })))
}
const answer = (res, rows) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(rows) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 200, thoughtsTokenCount: 100 } }))
}
async function cli(args, { url, env = {} }) {
  const childEnv = { ...process.env, GEMINI_API_KEY: KEY, GEMINI_BASE_URL: url, RIO_ENV_FILE: '/nonexistent/.env.local', ...env }
  for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k]
  const child = spawn(process.execPath, [SCRIPT, '--pass', 'stdusage', '--overlay', path.join(HERE, 'results', 'overlay-v1', 'overlay.v1.json'), ...args], { env: childEnv })
  let out = ''
  child.stdout.on('data', (c) => (out += c))
  child.stderr.on('data', (c) => (out += c))
  const [code] = await once(child, 'close')
  return { code, out }
}
const runArgs = (name) => ['--run', name, '--out', path.join(tmp, `${name}.out.json`), '--delay-ms', '0', '--retry-base-ms', '5', '--batch-size', '30']

describe('generate-examples.mjs --pass stdusage', () => {
  it('dry run lists the 63 entries and the cost, and calls nothing', async () => {
    const out = await cli([], { url: 'http://127.0.0.1:9', env: { GEMINI_API_KEY: undefined } })
    expect(out.code).toBe(0)
    expect(out.out).toContain('63 entries to classify')
    expect(out.out).toMatch(/metro\s+subte\s+n\s+ar/)
    expect(out.out).toContain('No API call was made')
  })

  it('stores valid answers under "usage", lists invalid ones as failed, never edits them, and keeps the key in the header', async () => {
    const bad = { carro: { es_word: 'carro', reason: 'x', std_usage: 'maybe' } }
    const g = await fakeGemini((r, res) => answer(res, r.words.map((w) => bad[w] ?? { es_word: w, reason: `Everyday speech check for ${w}.`, std_usage: 'less_common' })))
    const args = runArgs('ts-run')
    const out = await cli(args, g)
    g.server.close()
    expect(out.code).toBe(0)
    expect(out.out).not.toContain(KEY)
    expect(g.requests[0].headers['x-goog-api-key']).toBe(KEY)
    expect(g.requests[0].body.systemInstruction.parts[0].text).toBe(STD_USAGE_SYSTEM_PROMPT)
    expect(g.requests[0].body.generationConfig.temperature).toBe(0.2)
    expect(g.requests.flatMap((r) => r.words).sort()).toEqual(scope.map((s) => s.es_word).sort())
    expect(g.requests[0].text).not.toMatch(/example|legacy|evidence/i)

    const result = JSON.parse(fs.readFileSync(args[args.indexOf('--out') + 1], 'utf8'))
    expect(result.meta).toMatchObject({ pass: 'stdusage', selected: 63, generated: 62, failed: 1 })
    expect(result.usage.aquí).toMatchObject({ std_usage: 'less_common', rio_form: 'acá' })
    expect(result.usage.carro).toBeUndefined()
    expect(result.failed[0]).toMatchObject({ es_word: 'carro', errors: [expect.stringContaining('bad_std_usage')] })
    expect(result.failed[0].raw.std_usage).toBe('maybe') // untouched
  })
})
