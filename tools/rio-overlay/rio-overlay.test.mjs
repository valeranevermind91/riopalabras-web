import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formMatches as clientFormMatches, isCleanVariant } from '../../src/data/headword.ts'
import { compareLegacy, legacyForms } from './compare.mjs'
import { BUCKETS, buildReview, classify } from './review.mjs'
import { CONFIDENCES, ENTRY_KEYS, REGIONS, REGISTERS, RESPONSE_SCHEMA, RIO_TYPES, SYSTEM_PROMPT, CONTEXTS, buildResponseSchema, buildSystemPrompt, buildUserPrompt } from './schema.mjs'
import { RIO_ENTRY_KEYS } from './types.ts'
import { formMatches, isCleanForm, showsForm, validateBatch, validateEntry } from './validate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'generate.mjs')
const OUT = path.join(HERE, 'out')
const dictionary = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'public', 'words_enriched.json'), 'utf8'))
const byWord = new Map(dictionary.map((e) => [e.es_word, e]))
const input = (w) => byWord.get(w)

const entry = (es_word, over = {}) => ({
  es_word,
  reasoning: `AR: x; UY: x; std: y -> ${over.rio_type ?? 'replacement'}`,
  rio_type: 'replacement',
  rio_form: null,
  region: null,
  alt_form: null,
  alt_region: null,
  std_meaning_en: null,
  std_meaning_ru: null,
  register: 'neutral',
  note_en: null,
  note_ru: null,
  example_sentence: null,
  example_translation_en: null,
  example_translation_ru: null,
  word_form_in_example: null,
  en_translation: null,
  ru_translation: null,
  confidence: 'high',
  ...over,
})
const none = (w) => entry(w, { rio_type: 'none', confidence: 'medium' })
const periodico = () => entry('periódico', { rio_form: 'diario' }) // current example already shows "diario"
const codes = (r) => r.errors.map((e) => e.split(':')[0])

describe('schema', () => {
  const props = RESPONSE_SCHEMA.items.properties

  it('has exactly the fields of the TypeScript type, in the same order', () => {
    expect(Object.keys(props)).toEqual([...RIO_ENTRY_KEYS])
    expect(ENTRY_KEYS).toEqual([...RIO_ENTRY_KEYS])
    expect(RESPONSE_SCHEMA.items.required).toEqual(ENTRY_KEYS)
    expect(RESPONSE_SCHEMA.items.propertyOrdering).toEqual(ENTRY_KEYS)
  })

  it('is an array of objects and uses only keywords the Gemini responseSchema documents', () => {
    const allowed = new Set(['type', 'description', 'enum', 'nullable', 'properties', 'required', 'propertyOrdering', 'items'])
    const walk = (node) => {
      for (const key of Object.keys(node)) expect(allowed.has(key), `unsupported keyword ${key}`).toBe(true)
      if (node.items) walk(node.items)
      for (const child of Object.values(node.properties ?? {})) walk(child)
    }
    expect(RESPONSE_SCHEMA.type).toBe('ARRAY')
    walk(RESPONSE_SCHEMA)
    for (const p of Object.values(props)) expect(['STRING', 'OBJECT', 'ARRAY']).toContain(p.type)
  })

  it('carries the enums, and marks every optional field nullable (and only those)', () => {
    expect(props.rio_type.enum).toEqual(RIO_TYPES)
    expect(props.region.enum).toEqual(REGIONS)
    expect(props.alt_region.enum).toEqual(REGIONS)
    expect(props.register.enum).toEqual(REGISTERS)
    expect(props.confidence.enum).toEqual(CONFIDENCES)
    const nonNullable = Object.entries(props).filter(([, p]) => !p.nullable).map(([k]) => k)
    expect(nonNullable).toEqual(['es_word', 'reasoning', 'rio_type', 'register', 'confidence'])
  })

  it('keeps the same fields in every context and only changes descriptions', () => {
    for (const context of CONTEXTS) {
      const schema = buildResponseSchema({ context })
      expect(Object.keys(schema.items.properties)).toEqual([...RIO_ENTRY_KEYS])
    }
    expect(buildResponseSchema({ context: 'minimal' }).items.properties.example_sentence.description).toContain('Always null')
    expect(buildResponseSchema({ context: 'full' }).items.properties.example_sentence.description).toContain('current example')
    expect(JSON.stringify(buildResponseSchema({ context: 'minimal' }))).not.toBe(JSON.stringify(buildResponseSchema({ context: 'full' })))
  })

  it('puts the reasoning before the decision', () => {
    expect(ENTRY_KEYS.indexOf('reasoning')).toBeLessThan(ENTRY_KEYS.indexOf('rio_type'))
  })
})

const FULL_PROMPT = buildSystemPrompt({ context: 'full' })

describe('system prompt', () => {
  it.each([
    ['the five types', ['replacement', 'meaning_shift', 'regional_only', 'form', 'none']],
    ['the examples that were already there', ['periódico', 'vereda', 'tenés', 'tienes', 'che']],
    ['the audience', ['Russian-speaking learners', 'Uruguay']],
    ['the reasoning pattern', ['AR: x; UY: y; std: z -> type']],
    ['the translation rule and its worked example', ['translate the headword the learner sees', 'keeping only the senses that fit it', 'pluma', 'lapicera', 'ручка', 'not "feather"']],
    ['that form needs a different rio_form', ['rio_form MUST differ from es_word']],
    ['that ordinary voseo is not flagged', ['Ordinary voseo conjugations', 'are NOT flagged', 'general grammar rule']],
    ['that a word that is itself the Rioplatense form is regional_only', ['itself the Rioplatense form', 'never use "form" for it']],
    ['the divergence storage convention', ['put the Uruguayan form in rio_form with region "uy"', 'Argentine form in alt_form with alt_region "ar"', 'storage convention']],
    ['the vulgar-standard-meaning rule', ['VULGAR OR TABOO STANDARD MEANING', 'record it as replacement', 'rio_form is the everyday word', 'warning goes in note_en', 'Do not use meaning_shift for this']],
    ['that register describes rio_form', ['It describes rio_form, not es_word']],
    ['the hard length limits', ['at most 100 characters INCLUDING spaces', 'aim for about 70', 'Russian runs longer than English']],
    ['the anchoring rule', ['not a real standard Spanish word', 'answer none']],
    ['the region rule', ['region is null', 'only one country uses the Rioplatense form']],
    ['the clean-form rule', ['1 to 3 words', 'letters', 'No digits']],
    ['the never-invent rule', ['Never invent', 'confidence "low"']],
  ])('states %s', (_label, needles) => {
    for (const needle of needles) expect(SYSTEM_PROMPT).toContain(needle)
  })

  it.each([
    ['the either-form example rule', ['rio_form or alt_form', 'either country\'s form is fine']],
    ['the example group rule', ['all set or all null', 'asterisks']],
    ['the override translation rule', ['keep only the senses that fit it', 'If the current translation already fits rio_form']],
  ])('full context states %s', (_label, needles) => {
    for (const needle of needles) expect(FULL_PROMPT).toContain(needle)
  })

  it('minimal and sense tell the model it will not see the example and must leave the example fields null', () => {
    for (const context of ['minimal', 'sense']) {
      const prompt = buildSystemPrompt({ context })
      expect(prompt).toContain('Leave all four fields null')
      expect(prompt).not.toContain('The current example is provided')
      expect(prompt).not.toContain('current example sentence')
    }
    expect(SYSTEM_PROMPT).toContain('only its part of speech')
    expect(buildSystemPrompt({ context: 'sense' })).toContain('English gloss')
  })

  it('minimal asks for the translation of rio_form on every non-none entry; sense and full keep the override rule', () => {
    expect(SYSTEM_PROMPT).toContain('For every entry that is not none, give both')
    expect(buildSystemPrompt({ context: 'sense' })).toContain('already fits rio_form, leave both null')
  })

  it('rejects an unknown context', () => {
    expect(() => buildSystemPrompt({ context: 'everything' })).toThrow(/context/)
    expect(() => buildUserPrompt([], { context: 'everything' })).toThrow(/context/)
    expect(() => buildResponseSchema({ context: 'everything' })).toThrow(/context/)
  })

  it('does not use the dry-run words as new examples, so they stay independent tests', () => {
    for (const context of CONTEXTS) {
      const prompt = buildSystemPrompt({ context })
      for (const word of ['metro', 'autobús', 'colectivo', 'ómnibus', 'cigarrillo', 'pucho', 'mina', 'tony', 'subte', 'cheto', 'caldera', 'zapatilla', 'pila', 'pava']) {
        expect(prompt, `${context}: ${word}`).not.toMatch(new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, 'iu'))
      }
    }
  })

  it('mentions the legacy hint only when the hint is actually sent', () => {
    expect(SYSTEM_PROMPT).not.toContain('legacy')
    expect(buildSystemPrompt({ withHint: false })).toBe(SYSTEM_PROMPT)
    expect(buildSystemPrompt({ withHint: true })).toContain('legacy_es_rioplatense')
    expect(buildSystemPrompt({ withHint: true }).startsWith(SYSTEM_PROMPT.slice(0, 200))).toBe(true)
  })

  it('sends only es_word and pos in minimal, plus the English translation in sense, never the example', () => {
    const word = input('autobús')
    const minimal = JSON.parse(buildUserPrompt([word], { context: 'minimal' }).split('\n\n')[1])
    const sense = JSON.parse(buildUserPrompt([word], { context: 'sense' }).split('\n\n')[1])
    expect(minimal).toEqual([{ es_word: 'autobús', pos: word.pos }])
    expect(sense).toEqual([{ es_word: 'autobús', pos: word.pos, en_translation: word.en_translation }])
    expect(buildUserPrompt([word])).toBe(buildUserPrompt([word], { context: 'minimal' })) // minimal is the default
    for (const context of ['minimal', 'sense']) {
      const prompt = buildUserPrompt([word], { context, withHint: false })
      for (const secret of [word.example_sentence.replace(/\*+/g, ''), word.example_translation_en, word.example_translation_ru, word.word_form_in_example, word.ru_translation, 'colectivo']) {
        expect(prompt, `${context}: ${secret}`).not.toContain(secret)
      }
      for (const key of ['example_sentence', 'example_translation_en', 'example_translation_ru', 'word_form_in_example']) expect(prompt).not.toContain(key)
    }
  })

  it('builds the full user turn with the context for every word, no hint by default, and no ** markers', () => {
    const word = { ...input('autobús'), example_sentence: 'Tomate el **colectivo** 60.' }
    const prompt = buildUserPrompt([word], { context: 'full' })
    expect(prompt).toContain('"es_word": "autobús"')
    expect(prompt).toContain('"example_sentence": "Tomate el colectivo 60."')
    expect(prompt).not.toContain('legacy')
    expect(prompt).not.toContain('es_rioplatense')
    expect(prompt).not.toContain('*')
  })

  it('sends the legacy field only on request', () => {
    const prompt = buildUserPrompt([input('autobús')], { withHint: true, context: 'sense' })
    expect(prompt).toContain('"legacy_es_rioplatense": "colectivo"')
  })
})

describe('clean-form rule stays identical to the client (src/data/headword.ts)', () => {
  const corpus = [
    ...dictionary.map((e) => e.es_rioplatense).filter(Boolean),
    'diario', 'con vos', 'uno dos tres', 'uno dos tres cuatro', 'ex-novio', 'su/sus', 'pedir / postularse', '¡Qué bárbaro!', 'rápido,', 'a  b', '',
  ]
  it('agrees on isClean for every value', () => {
    for (const v of corpus) expect(isCleanForm(v), JSON.stringify(v)).toBe(isCleanVariant(v))
  })

  it('agrees on form matching for every dictionary entry and a set of tricky pairs', () => {
    for (const e of dictionary) {
      if (e.es_rioplatense) expect(formMatches(e.word_form_in_example, e.es_rioplatense), e.es_word).toBe(clientFormMatches(e.word_form_in_example, e.es_rioplatense))
    }
    for (const [a, b] of [['papas', 'papa'], ['pa', 'para'], ['Capaz', 'capaz'], ['recibieron', 'recibir'], ['abc', 'abd'], [null, 'x'], ['', 'x']]) {
      expect(formMatches(a, b)).toBe(clientFormMatches(a, b))
    }
  })

  it('also requires no surrounding whitespace', () => {
    expect(isCleanForm(' diario')).toBe(false)
    expect(isCleanForm('diario ')).toBe(false)
  })
})

describe('showsForm', () => {
  it('finds the form, an inflection, and a phrase; rejects the standard word', () => {
    expect(showsForm('Compré el diario hoy.', 'diario')).toBe(true)
    expect(showsForm('Unas papas fritas.', 'papa')).toBe(true)
    expect(showsForm('Me gustaría ir con vos esta noche.', 'con vos')).toBe(true)
    expect(showsForm('Compré el periódico.', 'diario')).toBe(false)
  })
})

describe('validateEntry: a good entry', () => {
  it('passes a replacement whose current example already shows the form', () => {
    const r = validateEntry(periodico(), input('periódico'))
    expect(r.errors).toEqual([])
  })

  it('passes none with everything null', () => {
    expect(validateEntry(none('casa'), input('casa')).errors).toEqual([])
  })

  it('passes a meaning_shift with its standard meaning', () => {
    const w = { ...input('mate'), word_form_in_example: 'mate', example_sentence: 'Tomamos mate juntos.' }
    const e = entry('mate', { rio_type: 'meaning_shift', rio_form: 'mate', std_meaning_en: 'checkmate (chess)', std_meaning_ru: 'мат (в шахматах)' })
    expect(validateEntry(e, w).errors).toEqual([])
  })

  it('passes a divergent-region entry; the current example may show either form', () => {
    // autobús' current example uses "colectivo" (the alt form here), so no new example is needed
    const e = entry('autobús', { rio_form: 'ómnibus', region: 'uy', alt_form: 'colectivo', alt_region: 'ar' })
    expect(validateEntry(e, input('autobús')).errors).toEqual([])
  })

  it('does not warn about which country is primary', () => {
    const e = entry('autobús', { rio_form: 'colectivo', region: 'ar', alt_form: 'ómnibus', alt_region: 'uy' })
    const r = validateEntry(e, input('autobús'))
    expect(r.errors).toEqual([])
    expect(r.warnings.join()).not.toContain('region_ar_primary')
    expect(r.warnings.join()).not.toContain('primary')
  })

  it('passes a new example that shows the form, with a matching word form', () => {
    const w = input('cigarrillo') // current example uses the standard word
    const e = entry('cigarrillo', {
      rio_form: 'pucho',
      example_sentence: '¿Me convidás un pucho?',
      example_translation_en: 'Can you spare me a cigarette?',
      example_translation_ru: 'Угостишь сигаретой?',
      word_form_in_example: 'pucho',
    })
    expect(validateEntry(e, w).errors).toEqual([])
  })

  it('accepts a new example that uses the alternative country\'s form, with a word form matching it', () => {
    const e = entry('cigarrillo', {
      rio_form: 'pucho',
      region: 'uy',
      alt_form: 'faso',
      alt_region: 'ar',
      example_sentence: 'Me pidió un faso en la esquina.',
      example_translation_en: 'He asked me for a smoke on the corner.',
      example_translation_ru: 'Он попросил у меня сигарету на углу.',
      word_form_in_example: 'faso',
    })
    expect(validateEntry(e, input('cigarrillo')).errors).toEqual([])
  })

  it('accepts a form entry for a notable (irregular) voseo case, with an audit warning', () => {
    const r = validateEntry(entry('ser', { rio_type: 'form', rio_form: 'sos' }), input('ser'))
    expect(r.errors).toEqual([])
    expect(r.warnings.join()).toContain('form_type_notable_only')
  })

  it('accepts regional_only for a word that is itself the Rioplatense form', () => {
    const r = validateEntry(entry('vos', { rio_type: 'regional_only', rio_form: 'vos', register: 'informal' }), input('vos'))
    expect(r.errors).toEqual([])
  })
})

describe('validateEntry: every rule reports, nothing is repaired', () => {
  const w = input('periódico')
  const bad = (over, word = w, base = periodico()) => validateEntry({ ...base, ...over }, word)

  it.each([
    ['es_word must echo the input exactly', { es_word: 'Periódico' }, 'es_word_echo'],
    ['rio_type must be an allowed value', { rio_type: 'synonym' }, 'bad_rio_type'],
    ['region must be an allowed value', { region: 'br' }, 'bad_region'],
    ['register must be an allowed value', { register: 'rude' }, 'bad_register'],
    ['confidence must be an allowed value', { confidence: 'sure' }, 'bad_confidence'],
    ['rio_form must be clean: glosses', { rio_form: 'diario (newspaper)' }, 'rio_form_not_clean'],
    ['rio_form must be clean: alternatives', { rio_form: 'diario / periódico' }, 'rio_form_not_clean'],
    ['rio_form must be clean: punctuation', { rio_form: '¡diario!' }, 'rio_form_not_clean'],
    ['rio_form must be clean: too many words', { rio_form: 'el diario de hoy mismo' }, 'rio_form_not_clean'],
    ['a replacement needs a different form', { rio_form: 'periódico' }, 'rio_form_equals_es_word'],
    ['rio_form is required for non-none types', { rio_form: null }, 'rio_form_missing'],
    ['reasoning cannot be empty', { reasoning: '  ' }, 'reasoning_empty'],
    ['reasoning is capped at 200 chars', { reasoning: 'x'.repeat(201) }, 'reasoning_too_long'],
    ['no asterisks anywhere', { note_en: 'use **diario**', note_ru: 'ок' }, 'asterisk'],
    ['empty strings are not null', { note_en: '', note_ru: '' }, 'empty_string'],
    ['alt_form needs alt_region', { alt_form: 'ómnibus' }, 'alt_pair_mismatch'],
    ['alt_form needs a region', { alt_form: 'ómnibus', alt_region: 'ar' }, 'alt_without_region'],
    ['alt_region must differ from region', { region: 'uy', alt_form: 'ómnibus', alt_region: 'uy' }, 'alt_region_same_as_region'],
    ['alt_form must be clean', { region: 'uy', alt_form: 'a/b', alt_region: 'ar' }, 'alt_form_not_clean'],
    ['alt_form must differ from rio_form', { region: 'uy', alt_form: 'diario', alt_region: 'ar' }, 'alt_form_equals_rio_form'],
    ['std_meaning is for meaning_shift only', { std_meaning_en: 'a', std_meaning_ru: 'б' }, 'std_meaning_not_allowed'],
    ['notes are set together', { note_en: 'careful', note_ru: null }, 'note_pair_mismatch'],
    ['notes are capped at 100 chars', { note_en: 'x'.repeat(101), note_ru: 'ок' }, 'note_too_long'],
    ['the example group is all-or-nothing', { example_sentence: 'Leí el diario.' }, 'example_group_partial'],
    ['translations are set together', { en_translation: 'newspaper', ru_translation: null }, 'translation_pair_mismatch'],
    ['reasoning must follow the AR/UY/std pattern', { reasoning: 'Standard newspaper; people say diario.' }, 'reasoning_pattern'],
    ['reasoning must name the same type as rio_type', { reasoning: 'AR: a; UY: b; std: c -> none' }, 'reasoning_type_mismatch'],
    ['reasoning needs all three parts', { reasoning: 'AR: a; std: c -> replacement' }, 'reasoning_pattern'],
  ])('%s', (_label, over, code) => {
    expect(codes(bad(over))).toContain(code)
  })

  it('meaning_shift / regional_only must keep es_word as rio_form, and meaning_shift needs both meanings', () => {
    const base = entry('periódico', { rio_type: 'meaning_shift', rio_form: 'diario', std_meaning_en: 'a', std_meaning_ru: 'б' })
    expect(codes(validateEntry(base, w))).toContain('rio_form_should_equal_es_word')
    const regional = { ...base, rio_type: 'regional_only', std_meaning_en: null, std_meaning_ru: null }
    expect(codes(validateEntry(regional, w))).toContain('rio_form_should_equal_es_word')
    const noStd = entry('periódico', { rio_type: 'meaning_shift', rio_form: 'periódico' })
    expect(codes(validateEntry(noStd, w))).toContain('std_meaning_missing')
  })

  it('a none entry may not carry data', () => {
    const r = validateEntry({ ...none('casa'), rio_form: 'casa', note_en: 'x', note_ru: 'y' }, input('casa'))
    expect(codes(r)).toContain('none_has_data')
  })

  it('every key must be present, and no others', () => {
    const { reasoning: _dropped, ...withoutReasoning } = periodico()
    expect(codes(validateEntry(withoutReasoning, w))).toContain('missing_keys')
    expect(codes(validateEntry({ ...periodico(), bonus: 1 }, w))).toContain('unexpected_keys')
    expect(codes(validateEntry('nope', w))).toContain('not_an_object')
  })

  it('a new example must contain the form, show it as the word form, and not exist unnecessarily', () => {
    const cig = input('cigarrillo')
    const base = entry('cigarrillo', {
      rio_form: 'pucho',
      example_sentence: '¿Me convidás un pucho?',
      example_translation_en: 'Can you spare one?',
      example_translation_ru: 'Угостишь?',
      word_form_in_example: 'pucho',
    })
    const v = (over) => validateEntry({ ...base, ...over }, cig)
    expect(codes(v({ example_sentence: '¿Me convidás un cigarrillo?' }))).toContain('example_missing_rio_form')
    expect(codes(v({ alt_form: 'faso', alt_region: 'ar', region: 'uy', example_sentence: '¿Me convidás un cigarrillo?' }))).toContain('example_missing_rio_form') // neither form
    expect(codes(v({ word_form_in_example: 'convidás' }))).toContain('word_form_not_rio_form')
    expect(codes(v({ word_form_in_example: 'fumar' }))).toContain('word_form_not_in_sentence')
    expect(codes(v({ example_sentence: 'Un **pucho**, dale.' }))).toContain('asterisk')
    // periódico's current example already shows "diario": replacing it is only a warning
    const unnecessary = validateEntry(
      entry('periódico', { rio_form: 'diario', example_sentence: 'Leí el diario.', example_translation_en: 'I read the paper.', example_translation_ru: 'Я прочитал газету.', word_form_in_example: 'diario' }),
      w,
    )
    expect(unnecessary.errors).toEqual([])
    expect(unnecessary.warnings.join()).toContain('example_replaced_unnecessarily')
  })

  it('flags needs_example_check, not an error, when no new example was written, and reports whether the current example shows the form', () => {
    const lacking = validateEntry(entry('cigarrillo', { rio_form: 'pucho' }), input('cigarrillo'))
    expect(lacking.errors).toEqual([])
    expect(lacking.flags).toEqual(['needs_example_check'])
    expect(lacking.currentExampleShowsForm).toBe(false)

    const showing = validateEntry(periodico(), input('periódico'))
    expect(showing.errors).toEqual([])
    expect(showing.flags).toEqual(['needs_example_check'])
    expect(showing.currentExampleShowsForm).toBe(true)

    // either form counts
    const alt = validateEntry(entry('autobús', { rio_form: 'ómnibus', region: 'uy', alt_form: 'colectivo', alt_region: 'ar' }), input('autobús'))
    expect(alt.currentExampleShowsForm).toBe(true)

    // a new example, or none at all, carries no flag
    const withExample = validateEntry(
      entry('cigarrillo', { rio_form: 'pucho', example_sentence: 'Me convidás un pucho?', example_translation_en: 'Can I bum a smoke?', example_translation_ru: 'Угостишь?', word_form_in_example: 'pucho' }),
      input('cigarrillo'),
    )
    expect(withExample.flags).toEqual([])
    expect(withExample.currentExampleShowsForm).toBeNull()
    expect(validateEntry(none('casa'), input('casa')).flags).toEqual([])
  })

  it('validateBatch carries the flags through', () => {
    const { results } = validateBatch([entry('cigarrillo', { rio_form: 'pucho' })], [input('cigarrillo')])
    expect(results.get('cigarrillo')).toMatchObject({ flags: ['needs_example_check'], currentExampleShowsForm: false })
  })

  it('warns, without failing, on low confidence, sensitive registers and unchanged translations', () => {
    const r = bad({ confidence: 'low', register: 'vulgar', en_translation: w.en_translation, ru_translation: w.ru_translation })
    expect(r.errors).toEqual([])
    const warned = r.warnings.map((x) => x.split(':')[0])
    expect(warned).toEqual(expect.arrayContaining(['low_confidence', 'sensitive_register', 'translation_unchanged']))
  })
})

describe('validateBatch', () => {
  const inputs = [input('periódico'), input('casa')]

  it('matches by echoed es_word regardless of order', () => {
    const { results, batchErrors } = validateBatch([none('casa'), periodico()], inputs)
    expect(batchErrors).toEqual([])
    expect([...results.keys()].sort()).toEqual(['casa', 'periódico'])
  })

  it('reports missing, unexpected and duplicate words', () => {
    const { batchErrors } = validateBatch([periodico(), periodico(), none('perro')], inputs)
    expect(batchErrors.join(' | ')).toMatch(/duplicate_es_word.*periódico/)
    expect(batchErrors.join(' | ')).toMatch(/unexpected_es_word.*perro/)
    expect(batchErrors.join(' | ')).toMatch(/missing_words.*casa/)
  })

  it('rejects a non-array response', () => {
    expect(validateBatch({ nope: true }, inputs).batchErrors).toEqual(['response_not_an_array'])
  })
})

// ------------------------------------------------------------------ the CLI against a fake Gemini

// Assembled at runtime so no key-shaped literal sits in the source (secret scanners would flag it).
const KEY = ['AIza', 'SyFAKEKEYFORTESTS_1234567890abcdefgh'].join('')

function fakeGemini(handler) {
  const requests = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null
      const text = body?.contents?.[0]?.parts?.[0]?.text ?? ''
      const words = text.includes('[') ? JSON.parse(text.slice(text.indexOf('['))).map((w) => w.es_word) : []
      const record = { url: req.url, headers: req.headers, body, words }
      requests.push(record)
      handler(record, requests.length, res)
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })))
}

const ok = (res, entries) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(entries) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 400, thoughtsTokenCount: 100 } }))
}
const answer = (words, overrides = {}) => words.map((w) => overrides[w] ?? (w === 'periódico' ? periodico() : none(w)))

async function cli(args, { url, env = {} }) {
  const childEnv = { ...process.env, GEMINI_API_KEY: KEY, GEMINI_BASE_URL: url, RIO_ENV_FILE: '/nonexistent/.env.local', ...env }
  for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k]
  const child = spawn(process.execPath, [SCRIPT, ...args], { env: childEnv })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (c) => (stdout += c))
  child.stderr.on('data', (c) => (stderr += c))
  const [code] = await once(child, 'close')
  return { code, stdout, stderr, all: stdout + stderr }
}

const runFiles = (run) => ({
  entries: path.join(OUT, `${run}.json`),
  report: path.join(OUT, `${run}.report.json`),
  checkpoint: path.join(OUT, `${run}.checkpoint.json`),
})
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const clean = () => {
  if (!fs.existsSync(OUT)) return
  for (const f of fs.readdirSync(OUT)) if (f.startsWith('t-')) fs.rmSync(path.join(OUT, f))
}
beforeAll(clean)
afterAll(clean)

describe('generate.mjs against a fake Gemini', () => {
  const base = ['--delay-ms', '0', '--retry-base-ms', '5']

  it('sends a proper request (systemInstruction, strict schema, key in a header only) and writes validated output', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    const out = await cli(['--words', 'periódico,casa', '--run', 't-happy', ...base], g)
    g.server.close()

    expect(out.code).toBe(0)
    const [req] = g.requests
    expect(req.url).toContain('/v1beta/models/gemini-2.5-flash:generateContent')
    expect(req.url).not.toContain(KEY)
    expect(req.url).not.toContain('key=')
    expect(req.headers['x-goog-api-key']).toBe(KEY)
    expect(req.body.systemInstruction.parts[0].text).toBe(SYSTEM_PROMPT)
    expect(req.body.contents).toHaveLength(1)
    expect(req.body.contents[0].role).toBe('user')
    expect(req.body.generationConfig.responseMimeType).toBe('application/json')
    expect(req.body.generationConfig.responseSchema).toEqual(RESPONSE_SCHEMA)
    expect(req.body.generationConfig.temperature).toBe(0.2)
    expect(req.body.generationConfig).not.toHaveProperty('thinkingConfig') // opt-in only
    expect(req.words).toEqual(['casa', 'periódico']) // dictionary-rank order

    const f = runFiles('t-happy')
    expect(readJson(f.entries).map((e) => e.es_word)).toEqual(['casa', 'periódico']) // by dictionary rank
    const report = readJson(f.report)
    expect(report).toMatchObject({ model: 'gemini-2.5-flash', selected: 2, returned: 2, withErrors: 0 })
    expect(report.usage).toMatchObject({ requests: 1, prompt: 1000, output: 400, thoughts: 100 })
    expect(out.all).not.toContain(KEY)
  })

  it('resumes from the checkpoint: a second run requests nothing', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    await cli(['--words', 'periódico,casa', '--run', 't-resume', ...base], g)
    const before = g.requests.length
    const again = await cli(['--words', 'periódico,casa', '--run', 't-resume', ...base], g)
    g.server.close()
    expect(before).toBe(1)
    expect(g.requests).toHaveLength(1)
    expect(again.stdout).toContain('2 already done, 0 to request')
  })

  it('reports validation failures verbatim and never repairs the entry', async () => {
    const glossy = entry('periódico', { rio_form: 'diario (newspaper)' })
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words, { periódico: glossy })))
    const out = await cli(['--words', 'periódico,casa', '--run', 't-invalid', ...base], g)
    g.server.close()

    expect(out.code).toBe(0)
    expect(out.stdout).toMatch(/periódico\s+replacement.*FAIL\(1\)/) // not clean
    const f = runFiles('t-invalid')
    const report = readJson(f.report)
    expect(report.withErrors).toBe(1)
    expect(report.failures[0].es_word).toBe('periódico')
    expect(report.failures[0].errors.map((e) => e.split(':')[0])).toEqual(['rio_form_not_clean'])
    expect(readJson(f.entries).find((e) => e.es_word === 'periódico').rio_form).toBe('diario (newspaper)')
  })

  it('skips words that are not in the dictionary and says so', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    const out = await cli(['--words', 'periódico,vereda', '--run', 't-missing', ...base], g)
    g.server.close()
    expect(out.stdout).toContain('Not in the dictionary, skipped: vereda')
    expect(g.requests[0].words).toEqual(['periódico'])
  })

  it('stops on a 400 (schema rejected), keeps the checkpoint, and never prints the key even if the API echoes it', async () => {
    const g = await fakeGemini((r, n, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `Invalid JSON payload for key ${KEY}` } }))
    })
    const out = await cli(['--words', 'periódico', '--run', 't-400', ...base], g)
    g.server.close()
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('HTTP 400')
    expect(out.stderr).toContain('re-run the same command to resume')
    expect(out.all).not.toContain(KEY)
    expect(g.requests).toHaveLength(1) // fatal: no retry
  })

  it('retries a 429 with backoff and then succeeds', async () => {
    const g = await fakeGemini((r, n, res) => {
      if (n === 1) {
        res.writeHead(429, { 'Retry-After': '0' })
        return res.end('{}')
      }
      ok(res, answer(r.words))
    })
    const out = await cli(['--words', 'periódico', '--run', 't-429', ...base], g)
    g.server.close()
    expect(out.code).toBe(0)
    expect(g.requests).toHaveLength(2)
    expect(out.stdout).toContain('retrying in')
  })

  it('asks again when the output is unusable, then falls back to one word per request', async () => {
    const g = await fakeGemini((r, n, res) => {
      if (r.words.length > 1) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }))
      }
      ok(res, answer(r.words))
    })
    const out = await cli(['--words', 'periódico,casa', '--run', 't-fallback', ...base], g)
    g.server.close()
    expect(out.code).toBe(0)
    expect(g.requests.map((r) => r.words.length)).toEqual([2, 2, 2, 1, 1]) // 1 try + 2 re-asks, then the two singles
    expect(readJson(runFiles('t-fallback').entries)).toHaveLength(2)
  })

  it('records words the model never returned instead of dropping them silently', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words).filter((e) => e.es_word !== 'casa')))
    const out = await cli(['--words', 'periódico,casa', '--run', 't-gap', ...base], g)
    g.server.close()
    const report = readJson(runFiles('t-gap').report)
    expect(report.missing.map((m) => m.es_word)).toEqual(['casa'])
    expect(report.missing[0].reason).toContain('missing_words')
    expect(out.stdout).toContain('1 missing')
  })

  it('runs several workers without duplicating or losing words', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    await cli(['--words', 'periódico,casa,perro,mesa', '--run', 't-conc', '--batch-size', '1', '--concurrency', '2', ...base], g)
    g.server.close()
    expect(g.requests.map((r) => r.words[0]).sort()).toEqual(['casa', 'mesa', 'perro', 'periódico'].sort())
    expect(readJson(runFiles('t-conc').entries)).toHaveLength(4)
  })

  it('sends the thinking budget only when asked', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    await cli(['--words', 'casa', '--run', 't-think', '--thinking', '512', ...base], g)
    g.server.close()
    expect(g.requests[0].body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 512 })
  })

  it('refuses to run without a key, explains how to set one, and sends nothing', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    const out = await cli(['--words', 'periódico', '--run', 't-nokey', ...base], { ...g, env: { GEMINI_API_KEY: undefined } })
    g.server.close()
    expect(out.code).toBe(2)
    expect(out.stderr).toContain('GEMINI_API_KEY is not set')
    expect(out.stderr).toContain('.env.local')
    expect(out.stderr).toContain('export GEMINI_API_KEY=')
    expect(g.requests).toHaveLength(0)
  })

  it('reads the key from an env file (quoted), and never echoes it', async () => {
    const file = path.join(os.tmpdir(), `rio-env-${process.pid}.local`)
    fs.writeFileSync(file, `# comment\nOTHER=1\nGEMINI_API_KEY="${KEY}"\n`)
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    const out = await cli(['--words', 'casa', '--run', 't-envfile', ...base], { ...g, env: { GEMINI_API_KEY: undefined, RIO_ENV_FILE: file } })
    g.server.close()
    fs.rmSync(file)
    expect(out.code).toBe(0)
    expect(g.requests[0].headers['x-goog-api-key']).toBe(KEY)
    expect(out.all).not.toContain(KEY)
  })

  it('--estimate and --print-prompt need no key and no network', async () => {
    const env = { GEMINI_API_KEY: undefined, GEMINI_BASE_URL: 'http://127.0.0.1:9' }
    const estimate = await cli(['--stage1', '--estimate'], { url: 'http://127.0.0.1:9', env })
    expect(estimate.code).toBe(0)
    expect(estimate.stdout).toContain('Selection: 134 words -> 14 requests')
    expect(estimate.stdout).toContain('gemini-2.5-flash')
    const prompt = await cli(['--print-prompt'], { url: 'http://127.0.0.1:9', env })
    expect(prompt.code).toBe(0)
    expect(prompt.stdout).toContain(SYSTEM_PROMPT.slice(0, 60))
    expect(prompt.stdout).toContain('"type": "ARRAY"')
  })

  it('--stage1 selects exactly the 134 entries that have es_rioplatense', async () => {
    const stage1 = dictionary.filter((e) => e.es_rioplatense)
    expect(stage1).toHaveLength(134)
    const out = await cli(['--stage1', '--estimate', '--batch-size', '10'], { url: 'http://127.0.0.1:9', env: { GEMINI_API_KEY: undefined } })
    expect(out.stdout).toContain('134 words')
  })
})


describe('compareLegacy', () => {
  const row = (word, overlay, valid = true) => ({ input: input(word), entry: { ...entry(word), ...overlay }, valid })

  it('splits legacy values into comparable forms (glosses dropped, alternatives split)', () => {
    expect(legacyForms('pedir / postularse')).toEqual(['pedir', 'postularse'])
    expect(legacyForms('mina (slang for girl/chick)')).toEqual(['mina'])
    expect(legacyForms('su/sus')).toEqual(['su', 'sus'])
    expect(legacyForms(null)).toEqual([])
  })

  it('lists only disagreements, by kind', () => {
    const rows = [
      row('periódico', { rio_form: 'diario' }), // agrees
      row('casa', { rio_type: 'none' }), // no legacy, no overlay: agrees
      row('autobús', { rio_form: 'ómnibus', region: 'uy', alt_form: 'colectivo', alt_region: 'ar' }), // legacy matches the alt form: agrees
      row('pa', { rio_type: 'none' }), // legacy said "para", overlay says none
      row('mesa', { rio_form: 'mueble' }), // legacy had nothing, overlay found an angle
      row('metro', { rio_form: 'tren' }, false), // both flag it, with different forms
    ]
    const out = compareLegacy(rows)
    expect(out.map((d) => [d.es_word, d.kind])).toEqual([
      ['pa', 'legacy_only'],
      ['mesa', 'overlay_only'],
      ['metro', 'different'],
    ])
    expect(out[0]).toMatchObject({ legacy: 'para', overlay: { rio_type: 'none' } })
    expect(out[2].valid).toBe(false)
    expect(out[2].reasoning).toBeTruthy()
  })

  it('treats a legacy value equal to es_word as agreeing with an overlay rio_form equal to es_word', () => {
    expect(compareLegacy([row('vos', { rio_type: 'regional_only', rio_form: 'vos' })])).toEqual([])
  })
})

describe('generate.mjs: hint handling, prompt guard and legacy comparison', () => {
  const base = ['--delay-ms', '0', '--retry-base-ms', '5']

  it('does not send the legacy hint by default, nor mention it in the system instruction', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    // cigarrillo's legacy value is "pucho", which does not occur anywhere else in what is sent
    await cli(['--words', 'cigarrillo', '--run', 't-nohint', ...base], g)
    await cli(['--words', 'cigarrillo', '--run', 't-nohint2', '--no-hint', ...base], g) // explicit flag = same behaviour
    g.server.close()
    for (const req of g.requests) {
      expect(req.body.contents[0].parts[0].text).not.toContain('legacy_es_rioplatense')
      expect(req.body.contents[0].parts[0].text).not.toContain('pucho') // the legacy value itself is not leaked
      expect(req.body.systemInstruction.parts[0].text).toBe(SYSTEM_PROMPT)
      expect(req.body.systemInstruction.parts[0].text).not.toContain('legacy')
    }
  })

  it('sends the hint (and the matching system instruction) only with --with-hint', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    await cli(['--words', 'autobús', '--run', 't-withhint', '--with-hint', ...base], g)
    g.server.close()
    const [req] = g.requests
    expect(req.body.contents[0].parts[0].text).toContain('"legacy_es_rioplatense": "colectivo"')
    expect(req.body.systemInstruction.parts[0].text).toBe(buildSystemPrompt({ withHint: true }))
  })

  it('rejects contradictory hint flags', async () => {
    const out = await cli(['--words', 'casa', '--no-hint', '--with-hint'], { url: 'http://127.0.0.1:9' })
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('contradict')
  })

  it('refuses to mix results made with a different prompt into one run, unless --fresh', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    await cli(['--words', 'casa', '--run', 't-guard', ...base], g)
    const mixed = await cli(['--words', 'casa,perro', '--run', 't-guard', '--with-hint', ...base], g)
    expect(mixed.code).toBe(1)
    expect(mixed.stderr).toContain('different prompt/schema')
    expect(g.requests).toHaveLength(1)
    const fresh = await cli(['--words', 'casa', '--run', 't-guard', '--with-hint', '--fresh', ...base], g)
    g.server.close()
    expect(fresh.code).toBe(0)
    expect(g.requests).toHaveLength(2)
  })

  it('--compare-legacy writes the review queue of words where the overlay disagrees with the legacy field', async () => {
    const overrides = {
      pa: none('pa'), // legacy "para" vs none
      mesa: entry('mesa', { rio_form: 'mueble' }), // legacy nothing vs overlay
      metro: entry('metro', { rio_form: 'tren' }), // legacy "subte" vs "tren"
      autobús: entry('autobús', { rio_form: 'ómnibus', region: 'uy', alt_form: 'colectivo', alt_region: 'ar' }), // agrees via alt_form
    }
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words, overrides)))
    const out = await cli(['--words', 'periódico,autobús,pa,mesa,metro,casa', '--run', 't-compare', '--compare-legacy', ...base], g)
    g.server.close()

    expect(out.code).toBe(0)
    const compare = readJson(path.join(OUT, 't-compare.compare.json'))
    expect(compare.compared).toBe(6)
    expect(compare.disagreements.map((d) => [d.es_word, d.kind]).sort()).toEqual([['mesa', 'overlay_only'], ['metro', 'different'], ['pa', 'legacy_only']].sort())
    expect(out.stdout).toContain('Legacy comparison')
    expect(out.stdout).toContain('3 of 6 disagree')
    // the comparison never reaches the model
    for (const req of g.requests) expect(req.body.contents[0].parts[0].text).not.toContain('legacy')
  })

  it('does not write a comparison file unless asked', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    await cli(['--words', 'casa', '--run', 't-nocompare', ...base], g)
    g.server.close()
    expect(fs.existsSync(path.join(OUT, 't-nocompare.compare.json'))).toBe(false)
  })
})

describe('generate.mjs: --context', () => {
  const base = ['--delay-ms', '0', '--retry-base-ms', '5']
  const wordsWithExamples = ['autobús', 'tony', 'cigarrillo']
  // word_form_in_example is often the headword itself, which the model of course sees as es_word
  const secretsOf = (w) => [input(w).example_sentence.replace(/\*+/g, ''), input(w).example_translation_en, input(w).example_translation_ru, input(w).word_form_in_example, input(w).ru_translation].filter((x) => x !== w)

  it('defaults to minimal: es_word and pos only, and never the dictionary example', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    const out = await cli(['--words', wordsWithExamples.join(','), '--run', 't-ctx-default', ...base], g)
    g.server.close()
    const [req] = g.requests
    const text = req.body.contents[0].parts[0].text
    expect(out.stdout).toContain('context: minimal')
    for (const item of JSON.parse(text.slice(text.indexOf('[')))) expect(Object.keys(item).sort()).toEqual(['es_word', 'pos'])
    for (const w of wordsWithExamples) for (const secret of secretsOf(w)) expect(text).not.toContain(secret)
    expect(req.body.systemInstruction.parts[0].text).toBe(buildSystemPrompt({ context: 'minimal' }))
    expect(req.body.generationConfig.responseSchema).toEqual(buildResponseSchema({ context: 'minimal' }))
    expect(readJson(runFiles('t-ctx-default').checkpoint).context).toBe('minimal')
  })

  it('sense adds only the current English translation', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    await cli(['--words', wordsWithExamples.join(','), '--run', 't-ctx-sense', '--context', 'sense', ...base], g)
    g.server.close()
    const [req] = g.requests
    const text = req.body.contents[0].parts[0].text
    for (const item of JSON.parse(text.slice(text.indexOf('[')))) {
      expect(Object.keys(item).sort()).toEqual(['en_translation', 'es_word', 'pos'])
      expect(item.en_translation).toBe(input(item.es_word).en_translation)
    }
    for (const w of wordsWithExamples) for (const secret of secretsOf(w)) expect(text).not.toContain(secret)
    expect(req.body.systemInstruction.parts[0].text).toBe(buildSystemPrompt({ context: 'sense' }))
  })

  it('full sends the example (the old behaviour, minus the hint)', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    await cli(['--words', 'tony', '--run', 't-ctx-full', '--context', 'full', ...base], g)
    g.server.close()
    const text = g.requests[0].body.contents[0].parts[0].text
    expect(text).toContain(input('tony').example_sentence.replace(/\*+/g, ''))
    expect(text).not.toContain('legacy')
  })

  it('rejects an unknown context', async () => {
    const out = await cli(['--words', 'casa', '--context', 'everything'], { url: 'http://127.0.0.1:9' })
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('--context must be one of')
  })

  it('never mixes contexts within one run, unless --fresh', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    await cli(['--words', 'casa', '--run', 't-ctx-mix', ...base], g)
    const mixed = await cli(['--words', 'casa,perro', '--run', 't-ctx-mix', '--context', 'sense', ...base], g)
    expect(mixed.code).toBe(1)
    expect(mixed.stderr).toContain('--context minimal, not sense')
    expect(g.requests).toHaveLength(1)
    const fresh = await cli(['--words', 'casa', '--run', 't-ctx-mix', '--context', 'sense', '--fresh', ...base], g)
    g.server.close()
    expect(fresh.code).toBe(0)
    expect(readJson(runFiles('t-ctx-mix').checkpoint).context).toBe('sense')
  })

  it('puts the context into the prompt hash even when the instructions would otherwise match', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words)))
    await cli(['--words', 'casa', '--run', 't-ctx-hash-a', ...base], g)
    await cli(['--words', 'casa', '--run', 't-ctx-hash-b', '--context', 'sense', ...base], g)
    g.server.close()
    const a = readJson(runFiles('t-ctx-hash-a').checkpoint)
    const b = readJson(runFiles('t-ctx-hash-b').checkpoint)
    expect(a.promptHash).not.toBe(b.promptHash)
  })

  it('reports needs_example_check and the pass-2 queue, and does not treat a missing example as an error', async () => {
    const overrides = {
      periódico: entry('periódico', { rio_form: 'diario' }), // current example shows diario
      cigarrillo: entry('cigarrillo', { rio_form: 'pucho' }), // current example does not show pucho
    }
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words, overrides)))
    const out = await cli(['--words', 'periódico,cigarrillo,casa', '--run', 't-ctx-queue', ...base], g)
    g.server.close()
    expect(out.code).toBe(0)
    const report = readJson(runFiles('t-ctx-queue').report)
    expect(report.withErrors).toBe(0)
    expect(report.context).toBe('minimal')
    expect(report.needsExampleCheck).toEqual(
      expect.arrayContaining([
        { es_word: 'periódico', currentExampleShowsForm: true },
        { es_word: 'cigarrillo', currentExampleShowsForm: false },
      ]),
    )
    expect(report.needsExampleCheck).toHaveLength(2)
    expect(report.pass2Queue).toEqual(['cigarrillo'])
    expect(out.stdout).toContain('needs_example_check: 2 entries')
    expect(out.stdout).toContain('pass-2 queue: cigarrillo')
  })
})

describe('compare-runs.mjs', () => {
  it('prints a table with one column per run, the reasoning strings, errors and the total cost', async () => {
    const g = await fakeGemini((r, n, res) => ok(res, answer(r.words, { periódico: entry('periódico', { rio_form: 'diario', reasoning: 'AR: diario; UY: diario; std: periódico -> replacement' }) })))
    const base = ['--delay-ms', '0']
    await cli(['--words', 'periódico,casa', '--run', 't-cmp-a', ...base], g)
    await cli(['--words', 'periódico,casa', '--run', 't-cmp-b', '--context', 'sense', ...base], g)
    g.server.close()
    const child = spawn(process.execPath, [path.join(HERE, 'compare-runs.mjs'), '--runs', 't-cmp-a,t-cmp-b', '--words', 'periódico,casa', '--reasoning', 'periódico'])
    let stdout = ''
    child.stdout.on('data', (c) => (stdout += c))
    const [code] = await once(child, 'close')
    expect(code).toBe(0)
    expect(stdout).toContain('| word | t-cmp-a | t-cmp-b |')
    expect(stdout).toContain('| periódico | replacement: diario (high) | replacement: diario (high) |')
    expect(stdout).toContain('| casa | none (medium) | none (medium) |')
    expect(stdout).toContain('- t-cmp-a: AR: diario; UY: diario; std: periódico -> replacement')
    expect(stdout).toContain('context sense')
    expect(stdout).toMatch(/Total estimated cost: \$0\.\d{4}/)
  })
})

describe('review.mjs: buckets and the candidate overlay', () => {
  const res = (e, over = {}) => ({ entry: e, errors: [], warnings: [], flags: [], currentExampleShowsForm: null, ...over })
  const needsCheck = (shows) => ({ flags: ['needs_example_check'], currentExampleShowsForm: shows })
  const noneHigh = (w) => entry(w, { rio_type: 'none' })
  const words = ['periódico', 'autobús', 'cigarrillo', 'metro', 'coger', 'casa']
  const a = {
    periódico: res(periodico(), needsCheck(true)),
    autobús: res(entry('autobús', { rio_form: 'ómnibus', region: 'uy', alt_form: 'colectivo', alt_region: 'ar' }), needsCheck(true)),
    cigarrillo: res(noneHigh('cigarrillo')),
    metro: res(entry('metro', { rio_form: 'subte' }), { ...needsCheck(false), errors: ['std_meaning_not_allowed: replacement must not set std_meaning_*'] }),
    coger: res(entry('coger', { rio_form: 'agarrar', register: 'vulgar' }), needsCheck(false)),
    casa: res(noneHigh('casa')),
  }
  const b = {
    periódico: res(periodico(), needsCheck(true)),
    autobús: res(entry('autobús', { rio_form: 'colectivo' }), needsCheck(true)),
    cigarrillo: res(noneHigh('cigarrillo')),
    metro: res(entry('metro', { rio_form: 'subte', confidence: 'medium' }), needsCheck(false)),
    coger: res(entry('coger', { rio_form: 'agarrar' }), needsCheck(false)),
    casa: res(noneHigh('casa')),
  }
  const runs = { a: { run: 'A', model: 'm1', context: 'sense' }, b: { run: 'B', model: 'm2', context: 'minimal' } }

  it('puts each entry in exactly the buckets its definition names', () => {
    const { buckets } = classify(dictionary, a, b, words)
    expect(buckets.a).toEqual(['autobús']) // A and B differ in rio_form/region/alt
    expect(buckets.b).toEqual(['cigarrillo']) // legacy "pucho" vs none in both; autobús agrees via alt_form in A and rio_form in B
    expect(buckets.c).toEqual(['metro'])
    expect(buckets.d).toEqual(['metro'])
    expect(buckets.e).toEqual(['coger']) // vulgar in A only
    expect(buckets.f).toEqual(['metro', 'coger']) // A not none, current example lacks the form
    expect(buckets.g).toEqual(['cigarrillo'])
    expect(BUCKETS.map(([k]) => k)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  })

  it('does not treat a legacy-marked word as disagreeing when only the case or order of forms differs', () => {
    const swapped = { ...a, autobús: res(entry('autobús', { rio_form: 'colectivo', region: 'ar', alt_form: 'ómnibus', alt_region: 'uy' })) }
    expect(classify(dictionary, swapped, b, words).buckets.b).toEqual(['cigarrillo'])
  })

  it('writes the review with every bucket, compact lines, reasoning and a details section', () => {
    const { markdown, counts } = buildReview({ dictionary, a, b, words, runs })
    for (const [k, title] of BUCKETS) expect(markdown).toContain(`## (${k}) ${title}`)
    expect(markdown).toContain('- **autobús** | legacy "colectivo" | A replacement: ómnibus region=uy alt=colectivo/ar (high, neutral) | B replacement: colectivo (high, neutral)')
    expect(markdown).toContain('  - A reasoning: AR: x; UY: x; std: y -> replacement')
    expect(markdown).toContain('#### metro')
    expect(markdown).toContain('ERRORS: std_meaning_not_allowed')
    expect(markdown).not.toContain('#### casa') // in no bucket
    expect(counts.rio_type).toEqual({ replacement: 4, none: 2 })
    expect(counts.register).toEqual({ neutral: 5, vulgar: 1 })
    expect(counts.region).toEqual({ uy: 1, null: 5 })
  })

  it('builds the candidate overlay from A only, holding back invalid entries instead of repairing them', () => {
    const { merged } = buildReview({ dictionary, a, b, words, runs })
    expect(merged.entries.map((e) => e.es_word)).toEqual(['periódico', 'autobús', 'cigarrillo', 'coger', 'casa'])
    expect(merged.entries.find((e) => e.es_word === 'autobús').rio_form).toBe('ómnibus') // A, not B
    expect(merged.invalid).toEqual([{ es_word: 'metro', errors: ['std_meaning_not_allowed: replacement must not set std_meaning_*'] }])
    expect(merged.reviewFlags.metro).toEqual(['c', 'd', 'f'])
    expect(merged.meta.base).toEqual({ run: 'A', model: 'm1', context: 'sense' })
  })
})
