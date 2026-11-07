import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from './dictionary'
import { clozeTarget } from './practice'
import { headword, highlightTarget } from './headword'

// The rule (README, "Conventions"): a dictionary example shows the sense that stands first in the gloss. A deliberate exception is a decision, written
// down with its reason; this test keeps it from going stale. If one of these fails, the exception was changed: decide it again, then update README and here.

const dictionary: { es_word: string; en_translation: string; ru_translation: string; example_sentence: string; example_translation_en: string; example_translation_ru: string }[] =
  JSON.parse(readFileSync('public/words_enriched.json', 'utf8'))
const entry = (esWord: string) => dictionary.find((d) => d.es_word === esWord)!

describe('the deliberate exceptions to "the example shows the first sense of the gloss"', () => {
  it('puto: the first gloss is the slur and the example uses the intensifier, and never the slur', () => {
    const puto = entry('puto')
    expect(puto.en_translation.startsWith('faggot (derogatory)')).toBe(true) // the slur stays first, with its marking
    expect(puto.ru_translation.startsWith('педик (уничиж.)')).toBe(true)
    expect(puto.example_sentence).toContain('puto frío') // the intensifier sense
    expect(puto.example_translation_en).toMatch(/damn/i)
    // the example must not voice the slur, in any of its three languages
    expect(puto.example_translation_en).not.toMatch(/faggot|\bfag\b|queer|homo/i)
    expect(puto.example_translation_ru).not.toMatch(/педик|гомосексуал|гей/i)
    expect(puto.example_sentence).not.toMatch(/\bputo\b[^.!?]*\b(maric|gay|homosexual)/i)
  })

  it('puta: the first gloss is the slur and the example uses the intensifier, and never the slur', () => {
    const puta = entry('puta')
    expect(puta.en_translation.startsWith('whore')).toBe(true) // the slur stays first
    expect(puta.ru_translation.startsWith('шлюха')).toBe(true)
    expect(puta.example_sentence).toContain('puta obra de arte') // the intensifier sense
    expect(puta.example_translation_en).toMatch(/damn/i)
    // the example must not voice the slur against anyone, in any of its three languages
    expect(puta.example_translation_en).not.toMatch(/whore|slut|bitch|hooker/i)
    expect(puta.example_translation_ru).not.toMatch(/шлюх|проститутк|сук[аиу]|стерв/i)
    expect(puta.example_sentence).not.toMatch(/\b(una|esa|la|tu|su|mi) puta\b(?! obra)/i)
  })
})

// The light verbs (dar, hacer, tener, poner, llevar, tomar, echar) are the words a beginner meets first, and a light verb is also the word most often used in an idiom. The
// card's example for the VERB itself is the first gloss shown plainly: "dar una mano" (help) under the gloss "to give", or "tener ganas de" (feel like) under "to have", would
// teach the idiom before the word. The idioms belong in the example of their own noun (mano, ganas), where they are the sense.
describe('the light verbs: the example shows the literal first gloss, not an idiom of the verb', () => {
  const words = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')))
  const word = (esWord: string) => words.find((w) => w.esWord === esWord)!

  it('dar: "to give", shown with something that is handed over, not "dar una mano"', () => {
    const dar = entry('dar')
    expect(dar.en_translation.startsWith('to give')).toBe(true)
    expect(dar.example_sentence).not.toMatch(/\bmano\b/i)
    expect(dar.example_translation_en).toMatch(/\bgive\b/i)
    expect(dar.example_translation_ru).toMatch(/дат|даю|даш|дает|дай|давай/i) // the Russian shows «давать», not «помогать»
    expect(dar.example_translation_ru).not.toMatch(/помо[чг]/i)
  })

  it('tener: "to have", shown as possession, not "tener ganas de" (feel like)', () => {
    const tener = entry('tener')
    expect(tener.en_translation.startsWith('to have')).toBe(true)
    expect(tener.example_sentence).not.toMatch(/\bganas\b/i)
    expect(tener.example_translation_en).toMatch(/\bhave\b/i)
    expect(tener.example_translation_en).not.toMatch(/feel like/i)
    expect(tener.example_translation_ru).not.toMatch(/хочется|хочешь/i)
  })

  it('hacer: "to do, to make", shown as "do" (what you do on a day), not as cooking a meal', () => {
    const hacer = entry('hacer')
    expect(hacer.en_translation.startsWith('to do')).toBe(true)
    expect(hacer.example_sentence).not.toMatch(/\b(comida|cena|almuerzo|torta|asado)\b/i)
    expect(hacer.example_translation_en).toMatch(/\bdo\b/i)
    expect(hacer.example_translation_en).not.toMatch(/mak(e|es|ing)|cook/i)
    expect(hacer.example_translation_ru).toMatch(/делаешь/i) // «делать», not «готовить»
    expect(hacer.example_translation_ru).not.toMatch(/готов/i)
  })

  it.each(['dar', 'hacer', 'tener', 'poner', 'llevar', 'tomar', 'echar'])('%s: the card still highlights and blanks the form its example shows', (esWord) => {
    const w = word(esWord)
    const { sentence, range } = highlightTarget(w)
    expect(range, 'the form is found in the sentence').not.toBeNull()
    const shown = sentence.slice(range!.start, range!.end)
    expect(shown.toLowerCase()).toBe((w.wordFormInExample ?? '').toLowerCase())
    expect(headword(w).text).toBe(esWord)
    expect(clozeTarget(w)?.target, 'Cloze can blank it').toBe(shown)
  })
})
