import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { collectForms, isAllowed, labelsInclude, labelsOnly, parseDamerPage, parseRobots, parseSenseCell } from './damer-check.mjs'

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'damer-check.mjs')

// Shaped like DAMER's real markup (a trimmed entry; the layout is what matters, not the content).
const sense = (num, cell) => `<tr><td> </td><td> </td><td class="da7"><span class="da3">${num}</span></td><td valign="top" colspan="2">${cell}</td></tr>`
const code = (c) => `<i><span class="da5">${c}</span></i>`
const sep = '<span class="da5">, </span>'
const entry = (header, rows) =>
  `<entry xmlns="http://www.w3.org/1999/xhtml" header="${header}" key="${header}"><table class="da4"><tr><td colspan="5" class="da2"><span class="da8">${header}.</span> <span class="da1">(Del quech.).</span></td></tr>${rows}</table></entry>`
const page = (inner) => `<html><head><meta name="description" content="Ar, Ur"></head><body><div id="resultados">${inner}</div></body></html>`

const PUCHO_LIKE = page(
  entry(
    'pucho',
    `<tr><td> </td><td class="da7"><span class="da3">I.</span></td><td class="da7"><span class="da3">1.</span></td><td colspan="2" class="da6">m. ${code('Pe')}${sep}${code('Ar')}${sep}${code('Ur.')}<span class="da5"> Texto uno. pop.</span><span class="da5"> &#x25C6; </span><a href='cabo'>cabo</a><span class="da5">.</span></td></tr>` +
      sense('2.', `${code('Co:O,SO')}${sep}${code('Ch.')}<span class="da5"> Texto dos. pop.</span>`) +
      sense('3.', `${code('Ho')}${sep}${code('ES')}<span class="da5">;</span>${code(' CR')}${sep}${code('Co:C')}<span class="da5">, pop. Texto tres, cuatro.</span>`) +
      sense('4.', `${code('Pa.')}<span class="da5"> </span><a href='boay'>boay</a>`),
  ),
)
const NOT_FOUND = page('<div class="aviso">Aviso: La palabra <b>tarta</b> no está en el Diccionario.</div>')

describe('robots.txt handling', () => {
  const ROBOTS = `# comment\nUser-agent: *\nCrawl-delay: 5\nAllow: /core/*.css$\nDisallow: /core/\nDisallow: /search/\nDisallow: /*/media/oembed\n`

  it('reads the Crawl-delay and the rules for User-agent *', () => {
    const rules = parseRobots(ROBOTS)
    expect(rules.crawlDelay).toBe(5)
    expect(rules.disallow).toEqual(['/core/', '/search/', '/*/media/oembed'])
  })

  it('allows /damer/ unless it is disallowed, with the longest rule winning', () => {
    const rules = parseRobots(ROBOTS)
    expect(isAllowed(rules, '/damer/pucho')).toBe(true)
    expect(isAllowed(rules, '/search/node')).toBe(false)
    expect(isAllowed(rules, '/core/style.css')).toBe(true)
    expect(isAllowed(rules, '/core/x.php')).toBe(false)
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /damer/\n'), '/damer/pucho')).toBe(false)
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /damer/\nAllow: /damer/pucho\n'), '/damer/pucho')).toBe(true)
    expect(isAllowed(parseRobots('User-agent: otherbot\nDisallow: /\n'), '/damer/pucho')).toBe(true) // other bots' rules do not apply to us
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:\n'), '/damer/pucho')).toBe(true)
  })
})

describe('parseSenseCell', () => {
  it('reads labels ending with a period, and skips the part-of-speech marker', () => {
    const r = parseSenseCell(`m. ${code('Pe')}${sep}${code('Ar')}${sep}${code('Ur.')}<span class="da5"> Texto uno. pop.</span><span class="da5"> &#x25C6; </span><a href='cabo'>cabo</a>`)
    expect(r.labels).toEqual(['Pe', 'Ar', 'Ur'])
    expect(r.gloss).toBe('Texto uno. pop.') // the ◆ cross-references are cut
  })

  it('keeps sub-region codes whole and tolerates ";" separators and a label list without its own period', () => {
    expect(parseSenseCell(`${code('Co:O,SO')}${sep}${code('Ch.')}<span class="da5"> Texto dos.</span>`).labels).toEqual(['Co:O,SO', 'Ch'])
    const r = parseSenseCell(`${code('Ho')}${sep}${code('ES')}<span class="da5">;</span>${code(' CR')}${sep}${code('Co:C')}<span class="da5">, pop. Texto tres, cuatro.</span>`)
    expect(r.labels).toEqual(['Ho', 'ES', 'CR', 'Co:C'])
    expect(r.gloss).toBe('pop. Texto tres, cuatro.')
  })

  it('does not take an italic word inside the gloss for a label, and handles a sense without labels', () => {
    const r = parseSenseCell('<span class="da5">Texto doce con </span><i><span class="da5">palabra</span></i><span class="da5"> mucho.</span>')
    expect(r.labels).toEqual([])
    expect(r.gloss).toBe('Texto doce con palabra mucho.')
  })

  it('reads several codes inside one italic run (Ni, CR) and keeps a sub-region list like Bo:O,C,SO whole', () => {
    const r = parseSenseCell(`m. <i><span class="da5">Ni, CR</span></i>${sep}${code('Ch')}${sep}${code('Ar')}${sep}${code('Ur.')}<span class="da5"> Texto seis.</span>`)
    expect(r.labels).toEqual(['Ni', 'CR', 'Ch', 'Ar', 'Ur'])
    expect(r.gloss).toBe('Texto seis.')
    expect(parseSenseCell(`m-f. ${code('Bo:O,C,SO.')}<span class="da5"> Texto siete </span><i><span class="da0">con una parte en cursiva</span></i><span class="da5">. pop.</span>`)).toEqual({
      labels: ['Bo:O,C,SO'],
      gloss: 'Texto siete con una parte en cursiva. pop.',
    })
  })

  it('skips part-of-speech markers such as m-f., intr. prnl. and one between two labels', () => {
    expect(parseSenseCell(`m-f. ${code('Ch.')}<span class="da5"> Texto cinco.</span>`)).toEqual({ labels: ['Ch'], gloss: 'Texto cinco.' })
    expect(parseSenseCell(`<span class="da5">intr.</span> <span class="da5">prnl. </span>${code('Gu.')}<span class="da5"> Texto ocho.</span>`)).toEqual({ labels: ['Gu'], gloss: 'Texto ocho.' })
    const mid = parseSenseCell(`f. ${code('Co')}<span class="da5">;</span> <span class="da5">m-f. </span>${code('Ch')}<span class="da5">. Texto nueve. pop.</span>`)
    expect(mid.labels).toEqual(['Co', 'Ch'])
    expect(mid.gloss).toBe('Texto nueve. pop.')
  })

  it('handles slash part-of-speech markers (sust/adj.) and label lists with ";" or no space after the comma', () => {
    expect(parseSenseCell(`<span class="da5">adj/sust. </span>${code('Co:O, Bo;Py')}${sep}${code('Ar')}${sep}${code('Ur')}<span class="da5">, pop. Texto diez.</span>`)).toEqual({ labels: ['Co:O', 'Bo', 'Py', 'Ar', 'Ur'], gloss: 'pop. Texto diez.' })
    expect(parseSenseCell(`sust/adj. ${code('Gu, Ho, ES,Ni,CR,Ch.')}<span class="da5"> Texto once.</span>`).labels).toEqual(['Gu', 'Ho', 'ES', 'Ni', 'CR', 'Ch'])
  })

  it('decodes HTML entities', () => {
    expect(parseSenseCell(`${code('Ar.')}<span class="da5"> Texto &amp; m&#xE1;s.</span>`).gloss).toBe('Texto & más.')
  })
})

describe('parseDamerPage', () => {
  it('lists the senses with their labels and skips the etymology row', () => {
    const r = parseDamerPage(PUCHO_LIKE)
    expect(r.found).toBe(true)
    expect(r.headwords).toEqual(['pucho'])
    expect(r.senses.map((s) => s.labels)).toEqual([['Pe', 'Ar', 'Ur'], ['Co:O,SO', 'Ch'], ['Ho', 'ES', 'CR', 'Co:C'], ['Pa']])
    expect(labelsInclude(r.senses, 'Ar')).toBe(true)
    expect(labelsInclude(r.senses, 'Ur')).toBe(true)
    expect(labelsInclude(r.senses, 'Co')).toBe(true) // "Co:O,SO" is Colombia
    expect(labelsInclude(r.senses, 'Mx')).toBe(false)
  })

  it('reports a found entry without Ar/Ur as found, and a page without an entry as not found', () => {
    const noAr = parseDamerPage(page(entry('guay', sense('1.', `${code('Pa.')}<span class="da5"> </span><a href='boay'>boay</a>`))))
    expect(noAr.found).toBe(true)
    expect(labelsInclude(noAr.senses, 'Ar') || labelsInclude(noAr.senses, 'Ur')).toBe(false)
    const none = parseDamerPage(NOT_FOUND)
    expect(none.found).toBe(false)
    expect(none.notInDictionary).toBe(true)
    expect(parseDamerPage('<html><body>nothing</body></html>').found).toBe(false)
  })

  it('reads several entries (homographs) from one page', () => {
    const r = parseDamerPage(page(entry('forro', sense('1.', `${code('Ar.')}<span class="da5">Texto quince.</span>`)) + entry('forro, rra', sense('1.', `${code('Ar.')}<span class="da5">Texto dieciseis.</span>`))))
    expect(r.headwords).toEqual(['forro', 'forro, rra'])
    expect(r.senses).toHaveLength(2)
  })
})

describe('labelsOnly', () => {
  it('keeps headword, found, ar, ur and the labels per sense, and drops every gloss', () => {
    const full = { pucho: { found: true, headword: 'pucho', ar: true, ur: false, senses: [{ gloss: 'Texto uno.', labels: ['Ar'] }] }, tarta: { found: false, headword: null, ar: false, ur: false, senses: [] } }
    expect(labelsOnly(full)).toEqual({ pucho: { headword: 'pucho', found: true, ar: true, ur: false, senses: [{ labels: ['Ar'] }] }, tarta: { headword: null, found: false, ar: false, ur: false, senses: [] } })
  })
})

describe('collectForms', () => {
  it('collects rio_form and alt_form from both runs plus the legacy forms, lower-cased, deduplicated, with their sources', () => {
    const A = [{ rio_form: 'colectivo', alt_form: 'Ómnibus' }, { rio_form: null, alt_form: null }]
    const B = [{ rio_form: 'colectivo', alt_form: null }]
    const { forms, skipped } = collectForms({ runs: { A, B }, legacyValues: ['colectivo', 'pasaje / boleto', 'arquero (goalkeeper), encargado (doorman)', '¡Qué bárbaro!', 'Used as a strong intensifier or general expletive'] })
    const bySource = Object.fromEntries(forms.map((f) => [f.form, f.sources]))
    expect(bySource.colectivo).toEqual(['A', 'B', 'legacy'])
    expect(bySource['ómnibus']).toEqual(['A'])
    expect(Object.keys(bySource)).toEqual(expect.arrayContaining(['pasaje', 'boleto', 'arquero', 'encargado']))
    expect(skipped.map((s) => s.form)).toEqual(expect.arrayContaining(['¡qué bárbaro!']))
    expect(bySource['¡qué bárbaro!']).toBeUndefined()
  })
})

// ---------------------------------------------------------------- CLI against a fake ASALE

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'damer-test-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

function fakeAsale(handler) {
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, ua: req.headers['user-agent'] })
    handler(req, res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })))
}
const send = (res, status, body, type = 'text/html') => {
  res.writeHead(status, { 'Content-Type': type })
  res.end(body)
}
const OK_ROBOTS = 'User-agent: *\nCrawl-delay: 5\nDisallow: /search/\n'

async function cli(dir, base, extra = []) {
  const runA = path.join(dir, 'A.json')
  const runB = path.join(dir, 'B.json')
  fs.writeFileSync(runA, JSON.stringify([{ es_word: 'periódico', rio_form: 'diario', alt_form: null }, { es_word: 'autobús', rio_form: 'ómnibus', alt_form: 'colectivo' }]))
  fs.writeFileSync(runB, JSON.stringify([{ es_word: 'periódico', rio_form: 'diario', alt_form: null }]))
  const child = spawn(process.execPath, [SCRIPT, '--a', runA, '--b', runB, ...extra], { env: { ...process.env, DAMER_BASE_URL: base, DAMER_TEST_DIR: dir, RIO_TEST_NO_DELAY: '1' } })
  let out = ''
  child.stdout.on('data', (c) => (out += c))
  child.stderr.on('data', (c) => (out += c))
  const [code] = await once(child, 'close')
  return { code, out, result: fs.existsSync(path.join(dir, 'damer.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'damer.json'), 'utf8')) : null }
}
const pages = {
  '/damer/diario': PUCHO_LIKE,
  '/damer/%C3%B3mnibus': page(entry('ómnibus', sense('1.', `${code('Ar')}${sep}${code('Ur.')}<span class="da5">Texto trece.</span>`))),
  '/damer/colectivo': page(entry('colectivo', sense('1.', `${code('Pa.')}<span class="da5">Texto catorce.</span>`))),
}

describe('damer-check.mjs against a fake ASALE', () => {
  it('reads robots.txt first, identifies itself, caches every response and writes the result shape', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'ok-'))
    const f = await fakeAsale((req, res) => {
      if (req.url === '/robots.txt') return send(res, 200, OK_ROBOTS, 'text/plain')
      if (pages[req.url]) return send(res, 200, pages[req.url])
      send(res, 404, NOT_FOUND)
    })
    const first = await cli(dir, f.url)
    expect(first.code).toBe(0)
    expect(f.requests[0].url).toBe('/robots.txt')
    for (const r of f.requests) expect(r.ua).toMatch(/^riopalabras-web-research\/.+contact:/)
    expect(Object.keys(first.result).sort()).toEqual(['colectivo', 'diario', 'ómnibus'])
    expect(first.result['ómnibus']).toMatchObject({ found: true, ar: true, ur: true })
    // the shareable copy has labels only: no definition text anywhere in it
    expect(first.result.diario.senses[0]).toEqual({ labels: ['Pe', 'Ar', 'Ur'] })
    expect(Object.keys(first.result.diario).sort()).toEqual(['ar', 'found', 'headword', 'senses', 'ur'])
    expect(JSON.stringify(first.result)).not.toContain('Texto')
    expect(JSON.stringify(first.result)).not.toContain('gloss')
    const full = JSON.parse(fs.readFileSync(path.join(dir, 'damer.full.json'), 'utf8'))
    expect(full.diario.senses[0]).toEqual({ gloss: 'Texto uno. pop.', labels: ['Pe', 'Ar', 'Ur'] })
    expect(first.result.colectivo).toMatchObject({ found: true, ar: false, ur: false })
    expect(first.out).toContain('attested with Ar and/or Ur: 2')
    expect(first.out).toContain('found without Ar/Ur labels: 1')
    expect(first.out).toContain('not found: 0')
    expect(fs.readdirSync(path.join(dir, 'cache'))).toHaveLength(4) // robots + 3 forms

    const before = f.requests.length
    const second = await cli(dir, f.url)
    f.server.close()
    expect(second.code).toBe(0)
    expect(f.requests.length).toBe(before) // everything came from the cache
  })

  it('records a 404 as not found and keeps going', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'nf-'))
    const f = await fakeAsale((req, res) => (req.url === '/robots.txt' ? send(res, 200, OK_ROBOTS, 'text/plain') : send(res, 404, NOT_FOUND)))
    const r = await cli(dir, f.url)
    f.server.close()
    expect(r.code).toBe(0)
    expect(r.result.diario).toMatchObject({ found: false, senses: [], ar: false, ur: false })
    expect(r.out).toContain('not found: 3')
  })

  it('stops at the first 403, without retrying, and writes no result', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, '403-'))
    const f = await fakeAsale((req, res) => (req.url === '/robots.txt' ? send(res, 200, OK_ROBOTS, 'text/plain') : send(res, 403, 'blocked')))
    const r = await cli(dir, f.url)
    f.server.close()
    expect(r.code).toBe(1)
    expect(r.out).toContain('HTTP 403')
    expect(r.out).toContain('not retrying')
    expect(r.result).toBeNull()
    expect(f.requests.filter((x) => x.url !== '/robots.txt')).toHaveLength(1)
  })

  it('stops on 429 too', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, '429-'))
    const f = await fakeAsale((req, res) => (req.url === '/robots.txt' ? send(res, 200, OK_ROBOTS, 'text/plain') : send(res, 429, 'slow down')))
    const r = await cli(dir, f.url)
    f.server.close()
    expect(r.code).toBe(1)
    expect(r.out).toContain('HTTP 429')
    expect(f.requests.filter((x) => x.url !== '/robots.txt')).toHaveLength(1)
  })

  it('refuses to run when robots.txt disallows /damer/', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'robots-'))
    const f = await fakeAsale((req, res) => (req.url === '/robots.txt' ? send(res, 200, 'User-agent: *\nDisallow: /damer/\n', 'text/plain') : send(res, 200, PUCHO_LIKE)))
    const r = await cli(dir, f.url)
    f.server.close()
    expect(r.code).toBe(1)
    expect(r.out).toContain('disallows /damer/')
    expect(f.requests.map((x) => x.url)).toEqual(['/robots.txt'])
    expect(r.result).toBeNull()
  })

  it('--list shows the forms without any network request', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'list-'))
    const f = await fakeAsale((req, res) => send(res, 200, 'x'))
    const r = await cli(dir, f.url, ['--list'])
    f.server.close()
    expect(r.out).toContain('diario [A,B,legacy]')
    expect(f.requests).toHaveLength(0)
  })
})
