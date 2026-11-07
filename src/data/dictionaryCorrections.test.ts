import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from './dictionary'
import { isPracticeWord } from './practice'
import { isInLearnPool } from './stats'
import { wordStatus } from './wordState'

// Corrections to single dictionary entries after a word report or an evidence check. Each is a decision with its reason; the test keeps it from going stale.

const raw: { es_word: string; pos: string; en_translation: string; ru_translation: string }[] = JSON.parse(readFileSync('public/words_enriched.json', 'utf8'))
const entry = (esWord: string) => raw.find((d) => d.es_word === esWord)
const words = parseDictionary(raw)
const word = (esWord: string) => words.find((w) => w.esWord === esWord)!

describe('words removed from the dictionary', () => {
  // boy, baby and wow are English words the frequency list counted, shown as Spanish nouns/interjections with a sentence that used the English word (ASALE's
  // Diccionario de americanismos: "voz inglesa", no Argentine or Uruguayan sense; Spanish Wiktionary has no Spanish section for baby or wow). tony's gloss
  // ("high-class snob") belonged to another word (its legacy value was "cheto"); the real word is a circus clown, rare in Uruguay.
  const removed = ['boy', 'baby', 'wow', 'tony']
  const standard = { boy: 'chico', baby: 'bebé', wow: 'guau', tony: 'payaso' }

  it.each(removed)('%s is in no shipped data file and not in the fallback source', (esWord) => {
    expect(entry(esWord), 'dictionary').toBeUndefined()
    const fallback: { es_word: string }[] = JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))
    expect(fallback.map((e) => e.es_word), 'public fallback').not.toContain(esWord)
    const source = JSON.parse(readFileSync('tools/rio-overlay/results/overlay-v1/examples.fallback.json', 'utf8'))
    expect(Object.keys(source.examples), 'fallback source').not.toContain(esWord)
    const overlay: { es_word: string }[] = JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))
    expect(overlay.map((e) => e.es_word), 'overlay').not.toContain(esWord)
  })

  it.each(Object.entries(standard))('%s is gone but the Spanish word for it, %s, is still taught', (_removed, spanish) => {
    expect(entry(spanish)).toBeDefined()
  })
})

describe('jo: a short gloss, not a sentence', () => {
  it('reads like a gloss in both languages and says it is mild and from Spain', () => {
    const jo = entry('jo')!
    expect(jo.en_translation).toBe('damn!, darn! (mild; Spain)')
    expect(jo.ru_translation).toBe('чёрт!, блин! (мягко; Испания)')
  })
})

describe('pa: a preposition ("para" shortened), not a noun', () => {
  it('is a preposition like para, so it is reference only: not offered in Learn, not in Review or practice', () => {
    expect(entry('pa')!.pos).toBe('prep')
    expect(entry('para')!.pos).toBe('prep')
    for (const esWord of ['pa', 'para']) {
      const w = word(esWord)
      expect(isInLearnPool(w), `${esWord} in the Learn pool`).toBe(false)
      expect(isPracticeWord({ ...w, repetitions: 3 }), `${esWord} in practice`).toBe(false)
      expect(wordStatus(w, new Date()).kind, `${esWord} status`).toBe('reference')
    }
  })
})

describe('Gil: the gloss leads with the slang, not the surname', () => {
  it('says "fool, sucker (informal)" in English and «дурак, простофиля (разг.)» in Russian', () => {
    const gil = entry('Gil')!
    expect(gil.en_translation).toBe('fool, sucker (informal)')
    expect(gil.ru_translation).toBe('дурак, простофиля (разг.)')
  })

  it('keeps its capitalized key: user progress, hidden and favorite rows are keyed by es_word and upserted on the exact string, so a rename would leave a second row behind', () => {
    expect(entry('Gil')).toBeDefined()
    expect(entry('gil')).toBeUndefined()
  })
})
