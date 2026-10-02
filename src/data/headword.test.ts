import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from './dictionary'
import { formMatches, headword, highlightTarget, isCleanVariant } from './headword'
import { relationFor } from './relation'

const dictionary = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')))
const byWord = new Map(dictionary.map((w) => [w.esWord, w]))
const entry = (esWord: string) => {
  const w = byWord.get(esWord)
  if (!w) throw new Error(`${esWord} not in dictionary`)
  return w
}
const highlighted = (esWord: string) => {
  const r = highlightTarget(entry(esWord))
  return r.range ? r.sentence.slice(r.range.start, r.range.end) : null
}

describe('headword: uses the Rioplatense form', () => {
  it.each([
    ['periódico', 'diario'],
    ['patata', 'papa'], // word form "papas" is an inflection
    ['contigo', 'con vos'], // clean multi-word phrase
    ['autobús', 'colectivo'],
    ['aquí', 'acá'],
    ['tontería', 'boludez'], // word form "boludeces"
    ['enfadar', 'enojar'], // word form "enojes"
  ])('%s → %s', (esWord, expected) => {
    const h = headword(entry(esWord))
    expect(h.form).toBe('rioplatense')
    expect(h.text).toBe(expected)
    expect(h.secondary).toBe(esWord)
  })
})

describe('headword: falls back to es_word', () => {
  it.each([
    ['cigarrillo', 'sentence uses the standard word, not "pucho"'],
    ['pa', 'word form shorter than the 3-char prefix rule'],
    ['chance', 'sentence uses the standard word'],
    ['vos', 'identical to es_word'],
    ['Gil', 'identical to es_word apart from case'],
    ['mina', 'value is "mina (slang…)" — a gloss'],
    ['vuestro', 'value is "su/sus" — alternatives'],
    ['solicitar', 'value is "pedir / postularse"'],
    ['wow', 'value is "¡Qué bárbaro!" — punctuation'],
    ['puto', 'value is a long explanation'],
    ['portar', 'sentence uses the standard word'],
  ])('%s (%s)', (esWord) => {
    const w = entry(esWord)
    const h = headword(w)
    expect(h.form).toBe('standard')
    expect(h.text).toBe(w.esWord)
    expect(h.secondary).toBeNull()
  })

  it('every dictionary word without a Rioplatense form is its own headword', () => {
    for (const w of dictionary) {
      if (w.esRioplatense === null) expect(headword(w)).toEqual({ text: w.esWord, form: 'standard', secondary: null })
    }
  })

  it('applies to exactly 113 of the 134 Rioplatense entries (the audit figure)', () => {
    const withRio = dictionary.filter((w) => w.esRioplatense !== null)
    expect(withRio).toHaveLength(134)
    expect(withRio.filter((w) => headword(w).form === 'rioplatense')).toHaveLength(113)
  })
})

describe('isCleanVariant', () => {
  it.each([
    ['diario', true],
    ['con vos', true],
    ['hacer pis', true],
    ['control remoto', true],
    ['básquet', true],
    ['ex-novio', true],
    ['uno dos tres', true],
    ['uno dos tres cuatro', false],
    ['su/sus', false],
    ['pedir / postularse', false],
    ['mina (slang for girl/chick)', false],
    ['¡Qué bárbaro!', false],
    ['', false],
    ['  ', false],
    ['dos  espacios', false],
    ['rápido,', false],
  ])('%j → %s', (value, expected) => {
    expect(isCleanVariant(value)).toBe(expected)
  })
})

describe('formMatches', () => {
  it.each([
    ['diario', 'diario', true],
    ['Capaz', 'capaz', true],
    ['papas', 'papa', true],
    ['boludeces', 'boludez', true],
    ['recibieron', 'recibir', true],
    ['apures', 'apurar', true],
    ['pa', 'para', false],
    ['cigarrillo', 'pucho', false],
    ['portar', 'llevar', false],
    ['abc', 'abd', false],
    [null, 'diario', false],
    ['', 'diario', false],
  ])('%s vs %s → %s', (form, variant, expected) => {
    expect(formMatches(form, variant)).toBe(expected)
  })
})

describe('highlightTarget', () => {
  it('highlights the stored word form and strips ** markers', () => {
    const r = highlightTarget(entry('autobús'))
    expect(r.sentence).toBe('Tomate el colectivo 60 para llegar al centro.')
    expect(r.range && r.sentence.slice(r.range.start, r.range.end)).toBe('colectivo')
  })

  it('matches case-insensitively (sentence-initial "Capaz")', () => {
    expect(highlighted('quizá')).toBe('Capaz')
  })

  it('highlights an inflected form (papas, enojes)', () => {
    expect(highlighted('patata')).toBe('papas')
    expect(highlighted('enfadar')).toBe('enojes')
  })

  it('highlights multi-word forms (con vos)', () => {
    expect(highlighted('contigo')).toBe('con vos')
  })

  it('highlights a 2-letter form as a whole word (pa)', () => {
    expect(highlighted('pa')).toBe('pa')
  })

  it('does not match inside a longer word: "su" ignores "sus" and "suyo"', () => {
    const r = highlightTarget({
      esWord: 'vuestro',
      esRioplatense: null,
      wordFormInExample: 'su',
      exampleSentence: 'Sus amigos dijeron que este es su problema.',
    })
    expect(r.range && r.sentence.slice(r.range.start, r.range.end)).toBe('su')
    expect(r.range?.start).toBe(r.sentence.indexOf(' su ') + 1)
  })

  it('highlights only the first occurrence', () => {
    const r = highlightTarget({
      esWord: 'casa',
      esRioplatense: null,
      wordFormInExample: 'casa',
      exampleSentence: 'Mi casa es tu casa.',
    })
    expect(r.range).toEqual({ start: 3, end: 7 })
  })

  it('is Unicode-aware at word boundaries (accents are letters)', () => {
    const r = highlightTarget({
      esWord: 'tren',
      esRioplatense: null,
      wordFormInExample: 'tren',
      exampleSentence: 'El trenecito y el tren llegaron.',
    })
    expect(r.range && r.sentence.slice(r.range.start, r.range.end)).toBe('tren')
    expect(r.range?.start).toBe('El trenecito y el '.length)
  })

  it('prefers the stored word form over an earlier occurrence of the standard word', () => {
    const r = highlightTarget({
      esWord: 'periódico',
      esRioplatense: 'diario',
      wordFormInExample: 'diario',
      exampleSentence: 'Leí el periódico y después el diario de la mañana.',
    })
    expect(r.range && r.sentence.slice(r.range.start, r.range.end)).toBe('diario')
  })

  it('with no word form the Rioplatense form is unproven, so the headword is the standard word', () => {
    const r = highlightTarget({
      esWord: 'periódico',
      esRioplatense: 'diario',
      wordFormInExample: null,
      exampleSentence: 'Leí el periódico y después el diario de la mañana.',
    })
    // headword() needs a matching word form to pick "diario"; the Rioplatense form is then only the
    // "other form" fallback, tried after the (standard) headword matched.
    expect(r.range && r.sentence.slice(r.range.start, r.range.end)).toBe('periódico')
  })

  it('never falls straight back to es_word on a Rioplatense-first card', () => {
    const r = highlightTarget({
      esWord: 'periódico',
      esRioplatense: 'diario',
      wordFormInExample: 'diarios', // not in the sentence as a whole word, but headword "diario" is
      exampleSentence: 'El periódico llegó, y el diario también.',
    })
    expect(r.range && r.sentence.slice(r.range.start, r.range.end)).toBe('diario')
  })

  it('falls back to the other form only after the word form and headword fail', () => {
    const r = highlightTarget({
      esWord: 'periódico',
      esRioplatense: 'diario',
      wordFormInExample: 'gaceta',
      exampleSentence: 'Compré el periódico temprano.',
    })
    expect(r.range && r.sentence.slice(r.range.start, r.range.end)).toBe('periódico')
  })

  it('on a standard-headword card the clean Rioplatense value is the other-form fallback', () => {
    const r = highlightTarget({
      esWord: 'cigarrillo',
      esRioplatense: 'pucho',
      wordFormInExample: null,
      exampleSentence: 'Me convidó un pucho.',
    })
    expect(r.range && r.sentence.slice(r.range.start, r.range.end)).toBe('pucho')
  })

  it('last resort: a form that only starts a longer word still highlights the whole word', () => {
    expect(highlighted('obstáculo')).toBe('obstáculos')
    expect(highlighted('culpar')).toBe('culparte')
    expect(highlighted('involucrar')).toBe('involucrarme')
  })

  it('returns no range for an empty sentence or when nothing matches', () => {
    expect(highlightTarget({ esWord: 'casa', esRioplatense: null, wordFormInExample: 'casa', exampleSentence: '' }).range).toBeNull()
    expect(highlightTarget({ esWord: 'casa', esRioplatense: null, wordFormInExample: 'perro', exampleSentence: 'Nada de eso.' }).range).toBeNull()
  })

  it('finds a highlight for every dictionary word', () => {
    const missing = dictionary.filter((w) => highlightTarget(w).range === null).map((w) => w.esWord)
    expect(missing).toEqual([])
  })

  it('never leaves ** markers in the sentence', () => {
    for (const w of dictionary) expect(highlightTarget(w).sentence).not.toContain('*')
  })
})

describe('relationFor', () => {
  it('is a replacement with the standard word when the Rioplatense form leads', () => {
    expect(relationFor(entry('periódico'))).toEqual({ type: 'replacement', standardWord: 'periódico' })
  })

  it('is null when the standard form leads', () => {
    expect(relationFor(entry('cigarrillo'))).toBeNull()
    expect(relationFor(entry('casa'))).toBeNull()
  })
})
