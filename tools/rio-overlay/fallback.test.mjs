import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EXAMPLE_KEYS } from './examples.mjs'
import { FALLBACK_EXCLUDED, FALLBACK_SCHEMA, FALLBACK_SYSTEM_PROMPT, PENINSULAR_BANS, buildFallbackUserText, peninsularHits, selectFallbackScope, validateFallback } from './fallback.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const SCRIPT = path.join(HERE, 'generate-examples.mjs')
const OUT = path.join(HERE, 'out')
const dictionary = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'words_enriched.json'), 'utf8'))
const overlay = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'rio_overlay.json'), 'utf8'))
const published = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'examples_fallback.json'), 'utf8'))
const { scope, excluded } = selectFallbackScope(dictionary, overlay)
const find = (w) => scope.find((i) => i.es_word === w)

describe('selectFallbackScope', () => {
  it('finds the 47 words (plus tony, excluded) whose old example shows another word', () => {
    expect(scope).toHaveLength(47)
    expect(excluded.map((e) => e.es_word)).toEqual(['tony'])
    expect(Object.keys(FALLBACK_EXCLUDED)).toEqual(['tony'])
    expect(scope.map((i) => i.es_word)).toEqual(expect.arrayContaining(['niño', 'pequeño', 'mona', 'esposo', 'tarta', 'deprisa', 'garaje']))
  })

  it('never includes an overlay word, a word whose example already shows it, or an irregular form of itself', () => {
    const overlayWords = new Set(overlay.map((e) => e.es_word))
    expect(scope.filter((i) => overlayWords.has(i.es_word))).toEqual([])
    for (const w of ['casa', 'aquí', 'autobús', 'ser', 'ver', 'oír', 'alguno', 'r']) expect(scope.map((i) => i.es_word)).not.toContain(w)
  })

  it('records the old form, and bans it (and the legacy alternatives) in the new sentence', () => {
    expect(find('niño')).toMatchObject({ old_word_form: 'pibe', avoid: ['pibe'], pos: 'n' })
    expect(find('solicitar').avoid).toEqual(expect.arrayContaining(['postularme', 'pedir', 'postularse']))
    expect(find('mona').avoid).toEqual(['borracha'])
  })

  it('sorts by rank', () => {
    expect(scope.map((i) => i.rank)).toEqual([...scope.map((i) => i.rank)].sort((a, b) => a - b))
  })
})

describe('prompt and schema', () => {
  it('shows the model the word, its meaning and what to avoid, but not the old sentence', () => {
    const text = buildFallbackUserText([find('niño')])
    expect(text).toContain('"es_word": "niño"')
    expect(text).toContain('"avoid": [')
    expect(text).toContain('"pibe"')
    expect(text).not.toContain(find('niño').old_sentence)
  })

  it('asks for neutral standard Spanish, the word once, in its standard sense, and keeps the same output keys', () => {
    for (const needle of ['neutral', 'EXACTLY ONCE', 'standard sense', 'avoid', 'substring of example_es', 'No asterisks']) expect(FALLBACK_SYSTEM_PROMPT).toContain(needle)
    expect(Object.keys(FALLBACK_SCHEMA.items.properties)).toEqual(EXAMPLE_KEYS)
  })
})

describe('Peninsular-only ban list', () => {
  const found = (text, own) => peninsularHits(text, own).map((h) => h.name)

  it.each([
    ['Compramos un coche pequeño.', 'coche'],
    ['Los coches están en la calle.', 'coche'],
    ['Quiero aparcar aquí.', 'aparcar'],
    ['Dejé el auto aparcado y aparqué mal.', 'aparcar'],
    ['Mi ordenador es nuevo.', 'ordenador'],
    ['Me llamó al móvil ayer.', 'móvil'],
    ['Voy a coger el autobús.', 'coger'],
    ['Quiero que cojas esto.', 'coger'],
    ['Me gusta conducir de noche.', 'conducir'],
    ['Vosotros sois muy simpáticos.', 'vosotros'],
    ['Este es vuestro problema.', 'vosotros'],
    ['Os llamo luego.', 'vosotros'],
    ['Vosotros habláis rápido.', 'vosotros verb forms'],
    ['¿Ya tenéis hambre?', 'vosotros verb forms'],
    ['Tú siempre llegas tarde.', 'tú'],
    ['Tienes que estudiar mucho.', 'tú verb forms'],
    ['Si puedes, quieres y vienes, avísame.', 'tú verb forms'],
    ['Vale, nos vemos mañana.', 'vale'],
    ['Tomé un zumo de naranja.', 'zumo'],
    ['Pelé unas patatas fritas.', 'patata'],
    ['Esperé en el salón de casa.', 'salón'],
    ['¡Qué guay estuvo el concierto!', 'guay'],
  ])('flags %j as %s', (text, name) => {
    expect(found(text, '')).toContain(name)
  })

  it('does not flag the Rioplatense words it asks for, voseo, or look-alikes', () => {
    for (const text of [
      'Dejé el auto estacionado en la cochera.',
      'La computadora y el celular están sobre la mesa.',
      'Si querés, podés venir con tu hermano; tenés tiempo, ¿no?',
      'Hay que comprar papa, frutilla y jugo en la feria.',
      'Las compras y las sales están en la heladera.',
      'Vale la pena esperar, porque la canilla anda mal.',
      'Es oscuro y el molar me duele.',
      'Quiero que vaya y me avise cuando llegue.',
      'Ustedes tienen que venir, y su casa queda cerca.',
    ]) {
      expect(found(text, ''), text).toEqual([])
    }
  })

  it('exempts a ban entry that matches the card\'s own word (gafas, vaquero, ayuntamiento are es_words here)', () => {
    expect(found('Necesito unas gafas nuevas.', 'gafas')).toEqual([])
    expect(found('Mi coche nuevo es lindo.', 'gafas')).toContain('coche')
    expect(found('Fui al ayuntamiento hoy.', 'ayuntamiento')).toEqual([])
  })

  it('the prompt names the main cases and the preferred Rioplatense words and asks for voseo', () => {
    for (const needle of ['coche', 'aparcar', 'ordenador', 'móvil', 'vosotros', 'tú', 'tienes', 'auto', 'estacionar', 'computadora', 'celular', 'voseo', 'tenés']) expect(FALLBACK_SYSTEM_PROMPT).toContain(needle)
  })

  it('has an entry for every case the user listed', () => {
    const names = PENINSULAR_BANS.map((b) => b.name)
    for (const n of ['coche', 'aparcar', 'ordenador', 'móvil', 'vosotros', 'vosotros verb forms', 'tú verb forms']) expect(names).toContain(n)
  })
})

describe('validateFallback', () => {
  const item = { es_word: 'niño', pos: 'n', avoid: ['pibe'], meaning_en: 'child' }
  const good = (over = {}) => ({ es_word: 'niño', example_es: 'El niño está jugando con una pelota en el parque grande.', example_en: 'The boy is playing with a ball in the large park.', example_ru: 'Мальчик играет с мячом в большом парке.', word_form_in_example: 'niño', ...over })
  const codes = (r) => r.errors.map((e) => e.split(':')[0])

  it('accepts a good sentence, an inflection and a capitalised form', () => {
    expect(validateFallback(good(), item).errors).toEqual([])
    expect(validateFallback(good({ example_es: 'Los niños juegan con una pelota en el parque grande del barrio.', word_form_in_example: 'niños' }), item).errors).toEqual([])
    expect(validateFallback(good({ example_es: 'Niño, ven a comer algo antes de salir a jugar con tus amigos.', word_form_in_example: 'Niño' }), item).errors).toEqual([])
  })

  it.each([
    ['the old regional word is used', good({ example_es: 'El niño y el pibe están jugando con una pelota en el parque.' }), 'avoided_word_present'],
    ['es_word is missing', good({ example_es: 'El chico está jugando con una pelota en el parque grande.', word_form_in_example: 'chico' }), 'word_form_not_es_word'],
    ['es_word twice', good({ example_es: 'El niño le pasó la pelota a otro niño en el parque grande.' }), 'es_word_repeated'],
    ['the word form is not a substring', good({ word_form_in_example: 'niña' }), 'word_form_not_substring'],
    ['an asterisk', good({ example_es: 'El **niño** está jugando con una pelota en el parque grande.' }), 'asterisk'],
    ['the Russian is English', good({ example_ru: 'The boy plays.' }), 'example_ru_not_russian'],
    ['too short', good({ example_es: 'El niño juega.', word_form_in_example: 'niño' }), 'length'],
    ['a Peninsular word (coche)', good({ example_es: 'El niño juega en el parque al lado del coche rojo de su papá.' }), 'peninsular_word_present'],
    ['a tú form (tienes)', good({ example_es: 'Si tienes tiempo, lleva al niño al parque grande de la ciudad.' }), 'peninsular_word_present'],
    ['a stranger key', { ...good(), extra: 1 }, 'unexpected_keys'],
  ])('rejects %s', (_label, row, code) => {
    expect(codes(validateFallback(row, item))).toContain(code)
  })

  it('warns, without failing, when the length is outside 8 to 14 words', () => {
    const r = validateFallback(good({ example_es: 'El niño juega con la pelota hoy.' }), item)
    expect(r.errors).toEqual([])
    expect(r.warnings.join()).toContain('length_outside_8_14')
  })
})

describe('the published file public/examples_fallback.json', () => {
  it('holds exactly the words in scope, each sentence valid against the current scope', () => {
    expect(published.map((p) => p.es_word).sort()).toEqual(scope.map((i) => i.es_word).sort())
    for (const p of published) {
      const r = validateFallback({ es_word: p.es_word, example_es: p.es, example_en: p.en, example_ru: p.ru, word_form_in_example: p.word_form }, find(p.es_word))
      expect(r.errors, p.es_word).toEqual([])
    }
  })

  it('contains no Peninsular-only word or tú form (0 matches against the ban list)', () => {
    expect(published.filter((p) => peninsularHits(p.es, p.es_word).length > 0).map((p) => p.es_word)).toEqual([])
  })

  it('has the shape the client reads, and no stray fields', () => {
    for (const p of published) expect(Object.keys(p).sort()).toEqual(['en', 'es', 'es_word', 'ru', 'word_form'])
  })
})

// ---------------------------------------------------------------- CLI, --pass fallback, against a fake Gemini

const KEY = ['AIza', 'SyFAKEKEYFORTESTS_1234567890abcdefgh'].join('')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fallback-test-'))
const cleanup = () => {
  if (fs.existsSync(OUT)) for (const f of fs.readdirSync(OUT)) if (f.startsWith('tf-')) fs.rmSync(path.join(OUT, f))
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
  res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(rows) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 400, thoughtsTokenCount: 300 } }))
}
const rowFor = (w, over = {}) => ({
  es_word: w,
  example_es: `Hoy veo que ${w} es una palabra muy útil para aprender español.`,
  example_en: `Today I see that ${w} is a very useful word for learning Spanish.`,
  example_ru: `Сегодня я вижу, что ${w} очень полезное слово для изучения испанского.`,
  word_form_in_example: w,
  ...over,
})

async function cli(args, { url, env = {} }) {
  const childEnv = { ...process.env, GEMINI_API_KEY: KEY, GEMINI_BASE_URL: url, RIO_ENV_FILE: '/nonexistent/.env.local', ...env }
  for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k]
  const child = spawn(process.execPath, [SCRIPT, '--pass', 'fallback', ...args], { env: childEnv })
  let out = ''
  child.stdout.on('data', (c) => (out += c))
  child.stderr.on('data', (c) => (out += c))
  const [code] = await once(child, 'close')
  return { code, out }
}
const runArgs = (name) => ['--run', name, '--out', path.join(tmp, `${name}.out.json`), '--delay-ms', '0', '--retry-base-ms', '5', '--batch-size', '20']

describe('generate-examples.mjs --pass fallback', () => {
  it('dry run lists the 47 words and the excluded one, estimates the cost and calls nothing', async () => {
    const out = await cli([], { url: 'http://127.0.0.1:9', env: { GEMINI_API_KEY: undefined } })
    expect(out.code).toBe(0)
    expect(out.out).toContain('47 entries need a new example')
    expect(out.out).toMatch(/niño\s+n\s+pibe/)
    expect(out.out).toContain('excluded: tony')
    expect(out.out).toMatch(/gemini-3\.1-pro-preview\s+≈ \$/)
    expect(out.out).toContain('No API call was made')
  })

  it('generates, validates and stores the neutral sentences; the failed list keeps rejected ones verbatim', async () => {
    const bad = { niño: rowFor('niño', { example_es: 'Hoy veo que el niño y el pibe juegan en el parque de la esquina.' }) }
    const g = await fakeGemini((r, res) => answer(res, r.words.map((w) => bad[w] ?? rowFor(w))))
    const args = runArgs('tf-run')
    const out = await cli(args, g)
    g.server.close()
    expect(out.code).toBe(0)
    expect(out.out).not.toContain(KEY)
    expect(g.requests[0].headers['x-goog-api-key']).toBe(KEY)
    expect(g.requests[0].url).not.toContain(KEY)
    expect(g.requests[0].body.systemInstruction.parts[0].text).toBe(FALLBACK_SYSTEM_PROMPT)
    expect(g.requests[0].body.generationConfig.responseSchema).toEqual(FALLBACK_SCHEMA)
    expect(g.requests.flatMap((r) => r.words).sort()).toEqual(scope.map((i) => i.es_word).sort())
    expect(g.requests[0].text).not.toContain('"rio_form"') // the overlay pass's fields are not sent

    const result = JSON.parse(fs.readFileSync(args[args.indexOf('--out') + 1], 'utf8'))
    expect(result.meta).toMatchObject({ pass: 'fallback', selected: 47, generated: 46, failed: 1 })
    expect(result.examples['mona']).toMatchObject({ word_form: 'mona', warnings: [] })
    expect(Object.keys(result.examples.mona).sort()).toEqual(['en', 'es', 'ru', 'warnings', 'word_form'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({ es_word: 'niño', old_word_form: 'pibe', errors: [expect.stringContaining('avoided_word_present')] })
    expect(result.failed[0].raw.example_es).toBe(bad['niño'].example_es) // never edited
  })

  it('rejects an unknown pass', async () => {
    const child = spawn(process.execPath, [SCRIPT, '--pass', 'nope'])
    let out = ''
    child.stderr.on('data', (c) => (out += c))
    const [code] = await once(child, 'close')
    expect(code).toBe(1)
    expect(out).toContain('--pass must be one of')
  })
})
