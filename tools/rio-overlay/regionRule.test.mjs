import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FAMILY, MIN_INDEPENDENT_SOURCES, applyRegionRule, familiesOf, isSupported, parseCountryLists, sourcesSayingBoth, sourcesSayingOnlyIn } from './regionRule.mjs'

// The rule for country labels, on hand-written source answers copied from the real stage-1 data (the build reads the raw runs from the untracked
// out/ folder, so these tests do not depend on it).

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RESULTS = path.join(HERE, 'results', 'overlay-v1')
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'))

// What each source said about the real cases (reasoning lines and Claude's entries as they are in the stage-1 results).
const sources = {
  guri: { A: { reasoning: 'AR: chico; UY: chico; std: chico -> none' }, B: { reasoning: 'AR: chico/pibe; UY: chico/gurí; std: chico -> none. "Chico" is used as "boy" or "small" in Rioplatense.' }, Claude: { rio_type: 'replacement', rio_form: 'gurí', region: 'uy', alt_form: 'pibe', alt_region: 'ar' }, DAMER: {} },
  omnibus: { A: { reasoning: 'AR: colectivo; UY: ómnibus; std: autobús -> replacement' }, B: { reasoning: 'AR: colectivo; UY: ómnibus; std: autobús -> replacement' }, Claude: { rio_type: 'replacement', rio_form: 'ómnibus', region: 'uy', alt_form: 'colectivo', alt_region: 'ar' }, DAMER: { colectivo: { found: true, ar: true, ur: true } } },
  departamento: { A: { reasoning: 'AR: departamento; UY: apartamento; std: apartamento -> replacement' }, B: { reasoning: 'AR: departamento; UY: apartamento/departamento; std: apartamento -> replacement' }, Claude: { rio_type: 'replacement', rio_form: 'departamento', region: 'ar', alt_form: null, alt_region: null }, DAMER: { departamento: { found: true, ar: true, ur: true } } },
  subte: { A: { reasoning: 'AR: subte; UY: subte; std: metro -> replacement' }, B: { reasoning: 'AR: subte; UY: subte; std: metro (subway) -> replacement' }, Claude: { rio_type: 'replacement', rio_form: 'subte', region: 'ar', alt_form: null, alt_region: null }, DAMER: { subte: { found: true, ar: true, ur: true } } },
  golero: { A: { reasoning: 'AR: arquero; UY: arquero; std: portero -> replacement' }, B: { reasoning: 'AR: portero; UY: portero; std: portero -> none' }, Claude: { rio_type: 'replacement', rio_form: 'golero', region: 'uy', alt_form: 'arquero', alt_region: 'ar' }, DAMER: {} },
  deMas: { A: { reasoning: 'AR: copado; UY: de más; std: guay -> replacement' }, B: { reasoning: 'AR: copado/piola; UY: copado/piola; std: guay -> replacement' }, Claude: { rio_type: 'replacement', rio_form: 'bárbaro', region: null, alt_form: null, alt_region: null }, DAMER: { copado: { found: true, ar: true, ur: true } } },
  foco: { A: { reasoning: 'AR: lamparita, foco; UY: lamparita, foco; std: foco -> none' }, B: { reasoning: 'AR: foco; UY: foco; std: focus, spotlight -> meaning_shift' }, Claude: { rio_type: 'replacement', rio_form: 'lamparita', region: null, alt_form: null, alt_region: null }, DAMER: { foco: { found: true, ar: true, ur: true } } },
}
const entry = (es_word, over) => ({ es_word, rio_form: null, region: null, alt_form: null, alt_region: null, ...over })

describe('what a source says', () => {
  it('reads the AR and UY lists of a reasoning line (several forms, accents, a trailing explanation, "?")', () => {
    const lists = parseCountryLists('AR: chico/pibe; UY: Chico, gurí (boy); std: chico -> none. "Chico" is used as "boy".')
    expect([...lists.ar]).toEqual(['chico', 'pibe'])
    expect([...lists.uy]).toEqual(['chico', 'gurí'])
    expect([...parseCountryLists('AR: ?; UY: ?; std: maya -> none').ar]).toEqual([])
    for (const bad of [null, undefined, '', 'no countries here', 'AR: x only', 5]) expect(parseCountryLists(bad)).toBeNull()
  })

  it('a form counts for a country when it is in that country\'s list and not in the other\'s', () => {
    expect(sourcesSayingOnlyIn('uy', 'gurí', sources.guri)).toEqual(['B', 'Claude']) // A has chico in both and no gurí
    expect(sourcesSayingOnlyIn('ar', 'pibe', sources.guri)).toEqual(['B', 'Claude'])
    expect(sourcesSayingOnlyIn('uy', 'ómnibus', sources.omnibus)).toEqual(['A', 'B', 'Claude'])
    expect(sourcesSayingOnlyIn('ar', 'colectivo', sources.omnibus)).toEqual(['A', 'B', 'Claude']) // DAMER has it for both countries: it does not count
    expect(sourcesSayingOnlyIn('ar', 'departamento', sources.departamento)).toEqual(['A', 'Claude']) // B has it in Uruguay too
    expect(sourcesSayingOnlyIn('ar', 'subte', sources.subte)).toEqual(['Claude']) // A and B have it in both
    expect(sourcesSayingOnlyIn('uy', 'foco', sources.foco)).toEqual([])
  })

  it('DAMER counts only when the form has a label for one country and none for the other', () => {
    expect(sourcesSayingOnlyIn('ar', 'x', { DAMER: { x: { found: true, ar: true, ur: false } } })).toEqual(['DAMER'])
    expect(sourcesSayingOnlyIn('uy', 'x', { DAMER: { x: { found: true, ar: true, ur: false } } })).toEqual([])
    expect(sourcesSayingOnlyIn('ar', 'x', { DAMER: { x: { found: true, ar: true, ur: true } } })).toEqual([])
    expect(sourcesSayingOnlyIn('ar', 'x', { DAMER: { x: { found: false, ar: false, ur: false } } })).toEqual([])
    expect(sourcesSayingOnlyIn('ar', 'unseen', { DAMER: {} })).toEqual([])
  })

  it('records who says both countries use it (not part of the rule: a note on a label kept over a dissent)', () => {
    expect(sourcesSayingBoth('departamento', sources.departamento)).toEqual(['B', 'DAMER'])
    expect(sourcesSayingBoth('subte', sources.subte)).toEqual(['A', 'B', 'DAMER'])
    expect(sourcesSayingBoth('foco', sources.foco)).toEqual(['A', 'B', 'DAMER'])
  })
})

describe('two independent sources', () => {
  it('needs two different families: A and B are both Gemini, so together they are one', () => {
    expect(MIN_INDEPENDENT_SOURCES).toBe(2)
    expect(FAMILY).toEqual({ A: 'Gemini', B: 'Gemini', Claude: 'Claude', DAMER: 'DAMER' })
    expect(familiesOf(['A', 'B'])).toBe(1)
    expect(familiesOf(['A', 'B', 'Claude'])).toBe(2)
    expect(isSupported([])).toBe(false)
    expect(isSupported(['Claude'])).toBe(false)
    expect(isSupported(['A', 'B'])).toBe(false)
    expect(isSupported(['B', 'Claude'])).toBe(true)
    expect(isSupported(['A', 'DAMER'])).toBe(true)
  })
})

describe('applying the rule', () => {
  it('keeps the labels two families support: gurí (uy), ómnibus (uy) with colectivo (ar), departamento (ar)', () => {
    expect(applyRegionRule(entry('chico', { rio_form: 'gurí', region: 'uy' }), sources.guri)).toMatchObject({ region: 'uy' })
    expect(applyRegionRule(entry('autobús', { rio_form: 'ómnibus', region: 'uy', alt_form: 'colectivo', alt_region: 'ar' }), sources.omnibus)).toMatchObject({ region: 'uy', alt_form: 'colectivo', alt_region: 'ar' })
    expect(applyRegionRule(entry('apartamento', { rio_form: 'departamento', region: 'ar' }), sources.departamento)).toMatchObject({ region: 'ar' })
  })

  it('the log of a kept label names its sources, and names the dissent when there is one', () => {
    const { log } = applyRegionRule(entry('apartamento', { rio_form: 'departamento', region: 'ar' }), sources.departamento)
    expect(log).toHaveLength(1)
    expect(log[0]).toContain('kept for «departamento»')
    expect(log[0]).toContain('A + Claude')
    expect(log[0]).toContain('against: B has it in both countries; DAMER labels it for both countries (any sense)')
  })

  it('drops a label with fewer than two families, and says how many sources there were', () => {
    for (const [word, form, src, who] of [['foco', 'foco', sources.foco, 'no source says it'], ['portero', 'golero', sources.golero, 'Claude says it'], ['guay', 'de más', sources.deMas, 'A says it']]) {
      const r = applyRegionRule(entry(word, { rio_form: form, region: 'uy' }), src)
      expect(r.region, word).toBeNull()
      expect(r.log[0], word).toContain(`dropped for «${form}»: ${who}`)
      expect(r.log[0]).toContain('the questionnaire only asked Uruguayans, so it cannot set one')
    }
  })

  it('a pair stands only if both labels do: an unsupported "also" form is dropped, and a fallen region takes the pair with it', () => {
    // portero: golero (uy) has one source and arquero (ar) has one: the pair goes
    expect(applyRegionRule(entry('portero', { rio_form: 'golero', region: 'uy', alt_form: 'arquero', alt_region: 'ar' }), sources.golero)).toMatchObject({ region: null, alt_form: null, alt_region: null })
    // the region holds (gurí, two families) but the alt does not (pibe has one source here): the alt goes, the region stays
    const oneSidedSources = { ...sources.guri, B: { reasoning: 'AR: chico; UY: chico; std: chico -> none' } }
    expect(applyRegionRule(entry('chico', { rio_form: 'gurí', region: 'uy', alt_form: 'pibe', alt_region: 'ar' }), { ...oneSidedSources, DAMER: { gurí: { found: true, ar: false, ur: true } } })).toMatchObject({ region: 'uy', alt_form: null, alt_region: null })
    // an alt that is supported cannot outlive its fallen region
    const r = applyRegionRule(entry('x', { rio_form: 'f', region: 'uy', alt_form: 'g', alt_region: 'ar' }), { A: { reasoning: 'AR: g; UY: f' }, Claude: { rio_form: 'g', region: null, alt_form: null, alt_region: null }, DAMER: { g: { found: true, ar: true, ur: false } } })
    expect(r).toMatchObject({ region: null, alt_form: null, alt_region: null })
    expect(r.log[1]).toContain('the pair needs its other label')
  })

  it('the questionnaire cannot set a label: an entry with sources that say nothing, however many Uruguayans said yes, ends with none', () => {
    const noSources = { A: { reasoning: 'AR: recoger; UY: recoger; std: recoger -> none' }, B: { reasoning: 'AR: levantar; UY: levantar; std: recoger -> replacement' }, Claude: { rio_type: 'none', rio_form: null, region: null, alt_form: null, alt_region: null }, DAMER: { levantar: { found: true, ar: true, ur: true } } }
    expect(applyRegionRule(entry('recoger', { rio_form: 'levantar', region: 'uy' }), noSources)).toMatchObject({ region: null })
    // and a form with no label to begin with is left alone: the rule removes, it does not invent
    expect(applyRegionRule(entry('recoger', { rio_form: 'levantar' }), noSources)).toMatchObject({ region: null, log: [] })
  })

  it('the one named exception (an extralinguistic reason) keeps a label, and is reported as an exception, not as a two-source finding', () => {
    const exceptions = { metro: { region: 'ar', reason: 'there is no subway in Uruguay' } }
    const r = applyRegionRule(entry('metro', { rio_form: 'subte', region: 'ar' }), sources.subte, exceptions)
    expect(r.region).toBe('ar')
    expect(r.usedException).toBe(true)
    expect(r.log[0]).toContain('by an extralinguistic reason, NOT by the two-source rule')
    expect(r.log[0]).toContain('there is no subway in Uruguay')
    // without the exception, the same entry loses the label
    expect(applyRegionRule(entry('metro', { rio_form: 'subte', region: 'ar' }), sources.subte).region).toBeNull()
    // an exception for another label (or word) does nothing
    expect(applyRegionRule(entry('metro', { rio_form: 'subte', region: 'ar' }), sources.subte, { metro: { region: 'uy', reason: 'x' } }).region).toBeNull()
    expect(applyRegionRule(entry('foco', { rio_form: 'foco', region: 'uy' }), sources.foco, exceptions).region).toBeNull()
  })
})

describe('the overlay that was built', () => {
  const full = readJson(RESULTS, 'overlay.v1.json')
  const shipped = readJson(HERE, '..', '..', 'public', 'rio_overlay.json')
  const byWord = new Map(full.map((e) => [e.es_word, e]))

  it('the build no longer sets a label by rule from the questionnaire, and applies this rule to every entry before it validates', () => {
    const build = fs.readFileSync(path.join(RESULTS, 'build-overlay-v1.mjs'), 'utf8')
    expect(build).not.toContain("region: 'uy',\n      register") // the by-rule block
    expect(build).not.toContain('region set to uy by rule')
    expect(build).toContain('CONSTRAINT, country labels')
    const rule = build.indexOf('applyRegionRule(o,')
    expect(rule).toBeGreaterThan(-1)
    expect(rule).toBeLessThan(build.indexOf('const r = validateEntry('))
  })

  it('the labels in the export are exactly these: gurí and ómnibus (uy), subte, departamento and pileta (ar), and colectivo as ómnibus\'s pair', () => {
    const labels = shipped.filter((e) => e.region || e.alt_region).map((e) => `${e.es_word}: ${e.rio_form} ${e.region ?? '-'}${e.alt_form ? ` + ${e.alt_form} ${e.alt_region}` : ''}`)
    expect(labels).toEqual(['chico: gurí uy', 'metro: subte ar', 'apartamento: departamento ar', 'autobús: ómnibus uy + colectivo ar', 'piscina: pileta ar'])
  })

  it('every label that is shipped says in its evidence why: two independent families, or the named extralinguistic exception', () => {
    for (const e of shipped.filter((x) => x.region || x.alt_region)) {
      const evidence = byWord.get(e.es_word).evidence
      const line = evidence.find((l) => l.startsWith(`country label ${e.region} kept for «${e.rio_form}»`))
      expect(line, `${e.es_word}: no evidence line for its label`).toBeDefined()
      if (e.es_word === 'metro') expect(line).toContain('extralinguistic reason, NOT by the two-source rule')
      else expect(line).toMatch(/\(\d+ independent families\)|\(2 independent families\)/)
      if (e.alt_form) expect(evidence.some((l) => l.startsWith(`alt_form «${e.alt_form}» (${e.alt_region}) kept`))).toBe(true)
    }
  })

  it('the labels that were dropped say so, and none of them is in the export', () => {
    for (const w of ['guay', 'portero', 'asilo', 'foco']) {
      expect(byWord.get(w).region, w).toBeNull()
      expect(byWord.get(w).evidence.some((l) => l.startsWith('country label uy dropped')), w).toBe(true)
    }
    for (const w of ['guay', 'portero', 'asilo']) expect(byWord.get(w).alt_form, w).toBeNull()
    for (const w of ['recoger', 'boleto', 'maya', 'cigarro', 'chance', 'marcador']) expect(shipped.find((e) => e.es_word === w).region, w).toBeNull()
  })

  it('the report has the section, and the by-rule wording is gone', () => {
    const report = fs.readFileSync(path.join(RESULTS, 'report.md'), 'utf8')
    expect(report).toContain('## Country labels (the two-source rule)')
    expect(report).not.toContain('set to uy by rule') // the old wording of the step that is gone
    expect(report).not.toContain('region uy by rule')
  })
})
