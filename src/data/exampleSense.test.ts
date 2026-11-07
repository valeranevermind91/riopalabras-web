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
    expect(puto.example_sentence).toContain('puto peso') // the intensifier sense («ni un puto peso»)
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

// cerdo is glossed "pig" / «свинья» (the animal) and its Rioplatense word is chancho. DAMER lists chancho for both the animal and the meat (Ar, Ur), but a user report
// from Uruguay says the everyday word for the meat there is cerdo ("picada de cerdo" on price tags). So the example shows the first gloss, the animal, and never the meat.
describe('cerdo: the example shows the animal (the first gloss), not the meat', () => {
  const words = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')))
  const cerdo = words.find((w) => w.esWord === 'cerdo')!

  it('the gloss is the animal, and the sentence is about an animal on a farm, in all three languages', () => {
    const d = entry('cerdo')
    expect(d.en_translation.startsWith('pig')).toBe(true)
    expect(d.ru_translation.startsWith('свинья')).toBe(true)
    expect(d.example_sentence).toMatch(/\bchancho\b/i)
    expect(d.example_sentence).not.toMatch(/\b(carne|asado|parrilla|chorizo|milanesa|comer|comimos|compr\w*|cocin\w*)\b/i) // no food
    expect(d.example_sentence).toMatch(/\b(chacra|granja|campo|corral|establo)\b/i) // a place where the animal lives
    expect(d.example_translation_en).toMatch(/\bpig\b/i)
    expect(d.example_translation_en).not.toMatch(/\b(pork|meat|bacon|ham|barbecue|roast)\b/i)
    expect(d.example_translation_ru).toMatch(/свинь/i)
    expect(d.example_translation_ru).not.toMatch(/свинин|мяс|барбекю|шашлык/i)
  })

  it('the card still leads with chancho, highlights it in the sentence and can blank it in Cloze', () => {
    expect(headword(cerdo).text).toBe('chancho')
    expect(cerdo.wordFormInExample).toBe('chancho')
    const { sentence, range } = highlightTarget(cerdo)
    expect(range).not.toBeNull()
    expect(sentence.slice(range!.start, range!.end)).toBe('chancho')
    expect(clozeTarget(cerdo)?.target).toBe('chancho')
  })
})

// A teacher of Argentine Spanish found «¡Qué maldito frío hace hoy!» unnatural: maldito is a word you aim at a thing that is bothering you (the alarm clock, the
// neighbour's dog), not a way to say "very cold". puto had the same template («¡Qué puto frío hace hoy!»). Both examples keep the sense they showed (maldito: "damned";
// puto: the intensifier, never the slur) in a sentence an Argentine or Uruguayan would say. The gloss and the word are unchanged.
describe('maldito and puto: natural examples instead of the "¡Qué … frío hace hoy!" template', () => {
  const words = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')))

  it('maldito: an annoying thing, said about it, in all three languages', () => {
    const d = entry('maldito')
    expect(d.en_translation).toBe('damned, cursed')
    expect(d.ru_translation).toBe('проклятый')
    expect(d.example_sentence).toBe('Ese maldito despertador no sonó y llegué tarde.')
    expect(d.example_translation_en).toBe("That damn alarm clock didn't go off and I was late.")
    expect(d.example_translation_ru).toBe('Этот проклятый будильник не сработал, и я опоздал.')
  })

  it('puto: the intensifier in «ni un puto peso», never the slur', () => {
    const d = entry('puto')
    expect(d.example_sentence).toBe('No tengo ni un puto peso, así que hoy no salgo.')
    expect(d.example_translation_en).toBe("I don't have a single damn peso, so I'm not going out today.")
    expect(d.example_translation_ru).toBe('У меня нет ни одного чертова песо, так что сегодня я никуда не иду.')
  })

  it.each(['maldito', 'puto'])('%s: neither example has the old template any more', (esWord) => {
    const d = entry(esWord)
    expect(d.example_sentence).not.toMatch(/frío/i)
    expect(d.example_translation_en).not.toMatch(/cold/i)
    expect(d.example_translation_ru).not.toMatch(/холод/i)
  })

  it.each(['maldito', 'puto'])('%s: the form is stored, the highlight finds it and Cloze can blank it', (esWord) => {
    const w = words.find((x) => x.esWord === esWord)!
    expect(w.wordFormInExample).toBe(esWord)
    expect(headword(w).text).toBe(esWord)
    const { sentence, range } = highlightTarget(w)
    expect(sentence.slice(range!.start, range!.end)).toBe(esWord)
    expect(clozeTarget(w)?.target).toBe(esWord)
  })
})
