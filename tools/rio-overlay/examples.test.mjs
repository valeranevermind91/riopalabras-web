import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EXAMPLE_KEYS, EXAMPLE_SCHEMA, SYSTEM_PROMPT, buildUserText, containsWholeWord, countForm, selectScope, validateExample } from './examples.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'generate-examples.mjs')
const OUT = path.join(HERE, 'out')
const dictionary = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'public', 'words_enriched.json'), 'utf8'))
const realOverlay = JSON.parse(fs.readFileSync(path.join(HERE, 'results', 'overlay-v1', 'overlay.v1.json'), 'utf8'))

const entry = (es_word, over = {}) => ({ es_word, rank: dictionary.find((d) => d.es_word === es_word).rank, status: 'accepted', rio_type: 'replacement', rio_form: null, region: null, alt_form: null, alt_region: null, register: 'neutral', notes: null, std_meaning: null, translation: null, ...over })
const item = (over = {}) => ({ es_word: 'autobús', pos: 'n', type: 'replacement', rio_form: 'ómnibus', region: 'uy', alt_form: 'colectivo', register: 'neutral', meaning_en: 'bus', ...over })
const good = (over = {}) => ({ es_word: 'autobús', example_es: 'Todos los días tomo el ómnibus para ir al trabajo.', example_en: 'Every day I take the bus to work.', example_ru: 'Каждый день я езжу на работу на автобусе.', word_form_in_example: 'ómnibus', ...over })

describe('selectScope', () => {
  const scope = selectScope(realOverlay, dictionary)
  const words = scope.map((s) => s.es_word)

  it('takes replacements only when the dictionary example lacks the form', () => {
    expect(words).toEqual(expect.arrayContaining(['autobús', 'cigarrillo', 'chico', 'guay', 'portero', 'asilo']))
    for (const shown of ['aquí', 'periódico', 'metro', 'coger', 'vuestro']) expect(words).not.toContain(shown) // the example already shows the form
    expect(scope.filter((s) => s.type === 'replacement').map((s) => s.reason)).toEqual(Array(6).fill('replacement: dictionary example lacks the form'))
  })

  it('takes every accepted meaning_shift and regional_only entry (tú and contigo became replacements, and their dictionary examples already show vos / con vos)', () => {
    const typed = realOverlay.filter((e) => e.status === 'accepted' && ['meaning_shift', 'regional_only', 'form'].includes(e.rio_type)).map((e) => e.es_word)
    expect(typed).toHaveLength(13)
    expect(realOverlay.some((e) => e.rio_type === 'form')).toBe(false)
    expect(words).toEqual(expect.arrayContaining(typed))
    expect(words).not.toContain('tú')
    expect(words).not.toContain('contigo')
  })

  it('ignores rejected, pending and none entries and sorts by rank', () => {
    expect(words).not.toContain('mona')
    expect(words).not.toContain('niño')
    expect(scope.map((s) => s.rank)).toEqual([...scope.map((s) => s.rank)].sort((a, b) => a - b))
    expect(scope).toHaveLength(19)
  })

  it('uses the overlay translation as the meaning, and keeps the standard meaning for meaning_shift only', () => {
    const foco = scope.find((s) => s.es_word === 'foco')
    expect(foco).toMatchObject({ meaning_en: 'light bulb', standard_meaning_en: 'focus, spotlight', alt_form: null })
    expect(scope.find((s) => s.es_word === 'chance').standard_meaning_en).toBeNull()
  })
})

describe('prompt', () => {
  it('shows the model the entry but never the dictionary example or the evidence', () => {
    const text = buildUserText([item({ note_en: 'a note', standard_meaning_en: 'std' })])
    expect(text).toContain('"rio_form": "ómnibus"')
    expect(text).toContain('"note": "a note"')
    expect(text).toContain('"standard_meaning": "std"')
    expect(text).not.toMatch(/example_sentence|evidence|colectivo 60/)
  })

  it('states the rules the validator enforces', () => {
    for (const needle of ['EXACTLY ONCE', 'never use es_word', 'Uruguayan', 'meaning', 'substring of example_es', 'No asterisks']) expect(SYSTEM_PROMPT).toContain(needle)
    expect(Object.keys(EXAMPLE_SCHEMA.items.properties)).toEqual(EXAMPLE_KEYS)
  })
})

describe('validateExample', () => {
  const codes = (r) => r.errors.map((e) => e.split(':')[0])

  it('accepts a good sentence', () => {
    expect(validateExample(good(), item())).toEqual({ errors: [], warnings: [] })
  })

  it('accepts an inflected form (plural) and a short word as the form', () => {
    const r = validateExample(good({ example_es: 'Los ómnibus de acá siempre llegan tarde, ¿viste?', word_form_in_example: 'ómnibus' }), item())
    expect(r.errors).toEqual([])
  })

  it.each([
    ['the word form is not a substring', good({ word_form_in_example: 'omnibus' }), 'word_form_not_substring'],
    ['the word form is another word', good({ word_form_in_example: 'tomo' }), 'word_form_not_rio_form'],
    ['the sentence lacks the form', good({ example_es: 'Todos los días tomo el colectivo hasta el trabajo.', word_form_in_example: 'colectivo' }), 'example_lacks_rio_form'],
    ['the form is used twice', good({ example_es: 'Tomo el ómnibus y después otro ómnibus para llegar.' }), 'rio_form_repeated'],
    ['the standard word is present', good({ example_es: 'El ómnibus y el autobús salen de la terminal juntos.' }), 'standard_word_present'],
    ['an asterisk', good({ example_es: 'Tomo el **ómnibus** todos los días al trabajo.' }), 'asterisk'],
    ['an empty translation', good({ example_en: '  ' }), 'empty_or_not_string'],
    ['the Russian is not Russian', good({ example_ru: 'Every day I take the bus.' }), 'example_ru_not_russian'],
    ['the English is Russian', good({ example_en: 'Каждый день на автобусе.' }), 'example_en_not_english'],
    ['too short', good({ example_es: 'Tomo el ómnibus.' }), 'length'],
    ['a stranger key', { ...good(), extra: 'x' }, 'unexpected_keys'],
    ['a wrong echo', good({ es_word: 'bus' }), 'es_word_echo'],
  ])('rejects %s', (_label, row, code) => {
    expect(codes(validateExample(row, item()))).toContain(code)
  })

  it('does not require the standard word to be absent for meaning_shift (es_word == rio_form)', () => {
    const foco = item({ es_word: 'foco', type: 'meaning_shift', rio_form: 'foco', alt_form: null })
    const r = validateExample({ es_word: 'foco', example_es: 'Se quemó el foco del baño y no tenemos otro.', example_en: 'The bulb in the bathroom burned out and we have no other.', example_ru: 'В ванной перегорела лампочка, а другой у нас нет.', word_form_in_example: 'foco' }, foco)
    expect(r.errors).toEqual([])
  })

  it('warns, without failing, when the length is outside 8 to 14 words', () => {
    const r = validateExample(good({ example_es: 'Tomo el ómnibus al trabajo hoy.' }), item())
    expect(r.errors).toEqual([])
    expect(r.warnings.join()).toContain('length_outside_8_14')
  })

  it('helpers: whole word and occurrence count', () => {
    expect(containsWholeWord('El autobús sale ya', 'autobús')).toBe(true)
    expect(containsWholeWord('Los autobuses salen', 'autobús')).toBe(false)
    expect(countForm('el foco y los focos', 'foco', 'n')).toBe(2)
  })
})

// ---------------------------------------------------------------- CLI against a fake Gemini

const KEY = ['AIza', 'SyFAKEKEYFORTESTS_1234567890abcdefgh'].join('')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'examples-test-'))
const overlayFile = path.join(tmp, 'overlay.json')
beforeAll(() => {
  fs.writeFileSync(
    overlayFile,
    JSON.stringify([
      entry('autobús', { rio_form: 'ómnibus', region: 'uy', alt_form: 'colectivo', alt_region: 'ar' }),
      entry('aquí', { rio_form: 'acá' }),
      entry('foco', { rio_type: 'meaning_shift', rio_form: 'foco', region: 'uy', std_meaning: { en: 'focus, spotlight', ru: 'x' }, translation: { en: 'light bulb', ru: 'лампочка' } }),
    ]),
  )
})
const cleanup = () => {
  if (fs.existsSync(OUT)) for (const f of fs.readdirSync(OUT)) if (f.startsWith('tx-')) fs.rmSync(path.join(OUT, f))
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
  res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(rows) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 300, thoughtsTokenCount: 200 } }))
}
const rowsFor = (words, bad = {}) =>
  words.map((w) =>
    bad[w] ??
    (w === 'autobús'
      ? good()
      : { es_word: 'foco', example_es: 'Se quemó el foco del baño y no tenemos otro.', example_en: 'The bulb in the bathroom burned out and we have no other.', example_ru: 'В ванной перегорела лампочка, а другой у нас нет.', word_form_in_example: 'foco' }),
  )

async function cli(args, { url, env = {} }) {
  const childEnv = { ...process.env, GEMINI_API_KEY: KEY, GEMINI_BASE_URL: url, RIO_ENV_FILE: '/nonexistent/.env.local', ...env }
  for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k]
  const child = spawn(process.execPath, [SCRIPT, ...args], { env: childEnv })
  let out = ''
  child.stdout.on('data', (c) => (out += c))
  child.stderr.on('data', (c) => (out += c))
  const [code] = await once(child, 'close')
  return { code, out }
}
const base = (name) => ['--run', name, '--overlay', overlayFile, '--out', path.join(tmp, `${name}.out.json`), '--delay-ms', '0', '--retry-base-ms', '5']

describe('generate-examples.mjs', () => {
  it('dry run lists the scope and the cost and calls nothing, even without a key', async () => {
    const out = await cli(['--overlay', overlayFile], { url: 'http://127.0.0.1:9', env: { GEMINI_API_KEY: undefined } })
    expect(out.code).toBe(0)
    expect(out.out).toContain('2 entries need a new example')
    expect(out.out).toMatch(/autobús\s+ómnibus\s+replacement\s+uy\s+colectivo\(ar\)/)
    expect(out.out).toMatch(/foco\s+foco\s+meaning_shift/)
    expect(out.out).not.toMatch(/^aquí/m)
    expect(out.out).toMatch(/gemini-3\.1-pro-preview\s+≈ \$/)
    expect(out.out).toContain('No API call was made')
  })

  it('generates, validates and writes the compact result; the key stays in the header', async () => {
    const g = await fakeGemini((r, res) => answer(res, rowsFor(r.words)))
    const args = base('tx-happy')
    const out = await cli(args, g)
    g.server.close()
    expect(out.code).toBe(0)
    const [req] = g.requests
    expect(req.url).toContain('/v1beta/models/gemini-3.1-pro-preview:generateContent')
    expect(req.url).not.toContain(KEY)
    expect(req.headers['x-goog-api-key']).toBe(KEY)
    expect(req.body.systemInstruction.parts[0].text).toBe(SYSTEM_PROMPT)
    expect(req.body.generationConfig.responseSchema).toEqual(EXAMPLE_SCHEMA)
    expect(req.words).toEqual(['autobús', 'foco'])
    expect(req.text).toContain('"meaning": "light bulb"')
    expect(req.text).toContain('"standard_meaning": "focus, spotlight"')
    expect(out.out).not.toContain(KEY)

    const result = JSON.parse(fs.readFileSync(args[args.indexOf('--out') + 1], 'utf8'))
    expect(result.meta).toMatchObject({ selected: 2, generated: 2, failed: 0, model: 'gemini-3.1-pro-preview' })
    expect(result.meta.usage).toMatchObject({ requests: 1, prompt: 800, output: 300, thoughts: 200 })
    expect(result.examples['autobús']).toMatchObject({ es: good().example_es, word_form: 'ómnibus', type: 'replacement', review: 'auto' })
    expect(result.examples.foco).toMatchObject({ type: 'meaning_shift', review: 'pending' })
  })

  it('lists failures verbatim and never repairs them', async () => {
    const bad = { autobús: good({ example_es: 'Tomo el ómnibus y después otro ómnibus para llegar.' }) }
    const g = await fakeGemini((r, res) => answer(res, rowsFor(r.words, bad)))
    const args = base('tx-fail')
    const out = await cli(args, g)
    g.server.close()
    expect(out.code).toBe(0)
    const result = JSON.parse(fs.readFileSync(args[args.indexOf('--out') + 1], 'utf8'))
    expect(result.meta).toMatchObject({ generated: 1, failed: 1 })
    expect(result.examples['autobús']).toBeUndefined()
    expect(result.failed[0]).toMatchObject({ es_word: 'autobús', errors: [expect.stringContaining('rio_form_repeated')] })
    expect(result.failed[0].raw.example_es).toBe(bad['autobús'].example_es) // untouched
  })

  it('resumes from the checkpoint and refuses a different prompt or model', async () => {
    const g = await fakeGemini((r, res) => answer(res, rowsFor(r.words)))
    await cli(base('tx-resume'), g)
    const again = await cli(base('tx-resume'), g)
    expect(g.requests).toHaveLength(1)
    expect(again.out).toContain('2 already done, 0 to request')
    const other = await cli([...base('tx-resume'), '--model', 'gemini-2.5-flash'], g)
    g.server.close()
    expect(other.code).toBe(1)
    expect(other.out).toContain('was made with gemini-3.1-pro-preview')
  })

  it('stops on a fatal API error with the key redacted', async () => {
    const g = await fakeGemini((r, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `bad request for key ${KEY}` } }))
    })
    const out = await cli(base('tx-fatal'), g)
    g.server.close()
    expect(out.code).toBe(1)
    expect(out.out).toContain('HTTP 400')
    expect(out.out).not.toContain(KEY)
  })

  it('exits 2 with instructions when there is no key', async () => {
    const out = await cli(base('tx-nokey'), { url: 'http://127.0.0.1:9', env: { GEMINI_API_KEY: undefined } })
    expect(out.code).toBe(2)
    expect(out.out).toContain('GEMINI_API_KEY is not set')
  })
})
