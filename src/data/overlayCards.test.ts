import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from './dictionary'
import { effectiveExample, headword, headwordDecision, highlightTarget } from './headword'
import { clozeTarget } from './practice'
import { headwordRegion, headwordRegister, relationFor, translationsFor } from './relation'
import { parseFallbackExamples, parseRioOverlay } from './rio'

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
