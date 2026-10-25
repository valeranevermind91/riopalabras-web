import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
