import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from './dictionary'
import { effectiveExample, headword, headwordDecision, highlightTarget } from './headword'
import { findDuplicate } from './customWords'
import { lemmaOfForm } from './lemmaNote'
import { clozeTarget } from './practice'
import { headwordRegion, headwordRegister, relationFor, translationsFor } from './relation'
import { parseFallbackExamples, parseRioOverlay } from './rio'
import { searchWords } from './search'

// Overlay entries decided by hand after a teacher's review (an Argentine-Spanish teacher; her comments were leads, the evidence is named in each block).
// The cards are built with the app's own functions on the shipped data files, so these pins fail if an entry, its example or the fallback source drifts.

const json = (file: string) => JSON.parse(readFileSync(`public/${file}`, 'utf8'))
const words = parseDictionary(json('words_enriched.json'), parseRioOverlay(json('rio_overlay.json')), parseFallbackExamples(json('examples_fallback.json')))
const word = (esWord: string) => words.find((w) => w.esWord === esWord)!
const overlayEntry = (esWord: string) => (json('rio_overlay.json') as { es_word: string }[]).find((e) => e.es_word === esWord)

describe('conducir → manejar: the everyday verb for driving leads, conducir is the standard word', () => {
  // ASALE's DAMER: «manejar» "Conducir un vehículo" is labelled for 18 countries, Ar and Ur among them (so no country label here); «conducir» has only the
  // "dirigir una institución" sense (Bo, Ar, Ur) and nothing against the driving sense. SpanishDict: manejar "Regionalism used in Latin America. Does not include
  // Spain." The DLE lists Argentina and Uruguay for manejar "guiar un vehículo". conducir stays understood (licencia de conducir), hence less_common, not not_used.
  it('is a replacement with no country, neutral, and the standard word is still said', () => {
    expect(overlayEntry('conducir')).toMatchObject({ rio_type: 'replacement', rio_form: 'manejar', region: null, alt_form: null, register: 'neutral', std_usage: 'less_common' })
  })

  it('the card leads with manejar and shows conducir as the standard word', () => {
    const conducir = word('conducir')
    expect(headword(conducir)).toEqual({ text: 'manejar', form: 'rioplatense', secondary: 'conducir' })
    expect(headwordDecision(conducir)).toMatchObject({ switched: true, reason: 'overlay-example-has-form' })
    expect(relationFor(conducir)).toMatchObject({ type: 'replacement', standardWord: 'conducir', standardUsage: 'less_common' })
    expect(headwordRegion(conducir)).toBeNull()
    expect(headwordRegister(conducir)).toBeNull()
  })

  it('keeps driving as the first gloss, in both languages', () => {
    expect(translationsFor(word('conducir'))).toEqual({ en: 'to drive, to manage', ru: 'водить (машину), управлять' })
  })

  it('shows a voseo sentence that has the verb, highlighted, and Cloze asks for that form', () => {
    const conducir = word('conducir')
    const example = effectiveExample(conducir)
    expect(example.source).toBe('overlay')
    expect(example.sentence).toBe('¿Vos manejás de noche? A mí no me gusta, hay mucho tránsito.')
    expect(example.wordForm).toBe('manejás')
    const { sentence, range } = highlightTarget(conducir)
    expect(sentence.slice(range!.start, range!.end)).toBe('manejás')
    expect(clozeTarget(conducir)?.target).toBe('manejás')
    expect(example.sentence).not.toMatch(/conduc/i)
  })

  it('is a card of its own: manejar (rank 844) keeps its entry and its example', () => {
    const manejar = word('manejar')
    expect(manejar.rio).toBeNull()
    expect(headword(manejar).text).toBe('manejar')
    expect(effectiveExample(manejar).sentence).toBe('¿Vos sabés manejar bien en la ciudad?')
  })
})

describe('pequeño → chico (adjective): the everyday word for "small" leads, pequeño is the standard word', () => {
  // Wiktionary and the DLE (a search summary: the page refuses automated reads) give the adjective chico, "small", with no regional label, so it is general Spanish and
  // the card carries no country. ASALE's DAMER has no sense for it (it lists americanisms only: chico there is a Mexican fruit, a Chilean vulgarity and a Uruguayan drum),
  // so DAMER neither supports nor contradicts it. The two stage-1 runs both list chico for Argentina and for Uruguay, but they are one family (Gemini), and only run A
  // typed it as a replacement. pequeño is understood and common, hence less_common. That is thinner evidence than for most entries; the owner approved it.
  it('is a replacement with no country, neutral, less common, and takes its example from the dictionary', () => {
    const entry = overlayEntry('pequeño') as Record<string, unknown>
    expect(entry).toMatchObject({ rio_type: 'replacement', rio_form: 'chico', region: null, alt_form: null, register: 'neutral', std_usage: 'less_common' })
    expect(entry.example).toBeUndefined()
  })

  it('the card leads with chico, the standard word is pequeño, and the example is the dictionary\'s «Mi hermano es re chico»', () => {
    const pequeno = word('pequeño')
    expect(headword(pequeno)).toEqual({ text: 'chico', form: 'rioplatense', secondary: 'pequeño' })
    expect(headwordDecision(pequeno)).toMatchObject({ switched: true, reason: 'dictionary-example-has-form' })
    expect(relationFor(pequeno)).toMatchObject({ type: 'replacement', standardWord: 'pequeño', standardUsage: 'less_common' })
    expect(headwordRegion(pequeno)).toBeNull()
    expect(translationsFor(pequeno)).toEqual({ en: 'small', ru: 'маленький' })
    const example = effectiveExample(pequeno)
    expect(example).toMatchObject({ source: 'dictionary', sentence: 'Mi hermano es re chico, todavía va al jardín.', wordForm: 'chico' })
    const { sentence, range } = highlightTarget(pequeno)
    expect(sentence.slice(range!.start, range!.end)).toBe('chico')
    expect(clozeTarget(pequeno)?.target).toBe('chico')
  })

  // The fallback sentence («…muy pequeño para cuatro personas») is published only for words outside the overlay (build-examples-fallback.mjs drops it once the word enters), and
  // an overlay or fallback example would win over the dictionary's. The generated source keeps it, as the record of what the model wrote.
  it('has no fallback example any more in the shipped file, so nothing can override the dictionary\'s', () => {
    expect(word('pequeño').fallbackExample).toBeNull()
    const shipped: { es_word: string }[] = json('examples_fallback.json')
    expect(shipped.map((e) => e.es_word)).not.toContain('pequeño')
  })

  describe('against the noun chico (rank 109), whose card is headed «gurí»', () => {
    const chico = word('chico')

    it('the noun keeps its card; the two cards read differently', () => {
      expect(headword(chico)).toEqual({ text: 'gurí', form: 'rioplatense', secondary: 'chico' })
      expect(headwordRegion(chico)).toBe('uy')
      expect(effectiveExample(chico).sentence).toBe('El gurí estaba jugando a la pelota en la rambla.')
      expect([chico.pos, word('pequeño').pos]).toEqual(['n', 'adj'])
      expect(translationsFor(chico).en).toBe('boy, kid')
    })

    it('search: typing chico finds the noun first (by its own word), then the adjective (by its Rioplatense form); gurí finds the noun, pequeño the adjective', () => {
      const hits = searchWords(words, 'chico', 8).map((h) => [h.word.esWord, h.via])
      expect(hits.slice(0, 2)).toEqual([
        ['chico', 'es_word'],
        ['pequeño', 'rio_form'],
      ])
      expect(searchWords(words, 'gurí', 1)[0]).toMatchObject({ via: 'rio_form' })
      expect(searchWords(words, 'gurí', 1)[0].word.esWord).toBe('chico')
      expect(searchWords(words, 'pequeño', 1)[0]).toMatchObject({ via: 'es_word' })
      expect(searchWords(words, 'pequeño', 1)[0].word.esWord).toBe('pequeño')
    })

    it('adding a word: typing chico is the noun (its own word wins), typing pequeño is the adjective', () => {
      expect(findDuplicate(words, 'chico')).toMatchObject({ via: 'es_word' })
      expect(findDuplicate(words, 'chico')!.word.esWord).toBe('chico')
      expect(findDuplicate(words, 'pequeño')).toMatchObject({ via: 'es_word' })
      expect(findDuplicate(words, 'pequeño')!.word.esWord).toBe('pequeño')
    })

    it('Cloze: neither answer is called a form of the other word, and each card blanks its own headword', () => {
      expect(lemmaOfForm(word('pequeño'), 'chico')).toBeNull()
      expect(lemmaOfForm(chico, 'gurí')).toBeNull()
      expect(clozeTarget(chico)?.target).toBe('gurí')
      expect(clozeTarget(word('pequeño'))?.target).toBe('chico')
    })
  })
})

describe('adding a word that is a Rioplatense form: the entry that is that word opens, not the earlier-ranked card that leads with it', () => {
  // 11 overlay replacements lead with a form that is also a dictionary word of its own; typing it used to open the standard word's card (the first overlay match in rank order).
  const forms = ['acá', 'agarrar', 'capaz', 'estancia', 'lentes', 'lindo', 'manejar', 'mozo', 'ruta', 'torta', 'vos']

  it.each(forms)('%s opens its own card', (form) => {
    expect(findDuplicate(words, form)).toMatchObject({ via: 'es_word', word: { esWord: form } })
  })

  it('and the rule holds for every overlay replacement form that is a dictionary word, not only these 11', () => {
    const own = new Set(words.map((w) => w.esWord.toLowerCase()))
    const led = [...new Set(words.filter((w) => w.rio?.type === 'replacement' && own.has(w.rio.form.toLowerCase())).map((w) => w.rio!.form.toLowerCase()))]
    expect(led.length).toBeGreaterThan(30)
    for (const form of led) expect(findDuplicate(words, form), form).toMatchObject({ via: 'es_word' })
    for (const form of led) expect(findDuplicate(words, form)!.word.esWord.toLowerCase(), form).toBe(form)
  })

  it('a form that is nobody\'s own word still finds the card that leads with it', () => {
    expect(findDuplicate(words, 'gurí')).toMatchObject({ via: 'overlay', word: { esWord: 'chico' } })
    expect(findDuplicate(words, 'subte')).toMatchObject({ via: 'overlay', word: { esWord: 'metro' } })
  })
})
