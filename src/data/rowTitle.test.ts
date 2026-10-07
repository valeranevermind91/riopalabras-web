import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { parseDictionary } from './dictionary'
import { headword } from './headword'
import { parseFallbackExamples, parseRioOverlay } from './rio'
import { rowTitle } from './rowTitle'
import { searchWords } from './search'
import type { Word } from './types'

const real = parseDictionary(
  JSON.parse(readFileSync('public/words_enriched.json', 'utf8')),
  parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))),
  parseFallbackExamples(JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))),
)
const word = (esWord: string) => real.find((w) => w.esWord === esWord)!
const hit = (query: string, esWord: string) => {
  const found = searchWords(real, query, Number.POSITIVE_INFINITY, { translations: true }).find((h) => h.word.esWord === esWord)
  if (!found) throw new Error(`${esWord} not found for "${query}"`)
  return rowTitle(found.word, found.via)
}

describe('what a row leads with, in a search', () => {
  it('typing "ciga": cigarrillo leads, with the Rioplatense form beside it', () => {
    expect(hit('ciga', 'cigarrillo')).toEqual({ title: 'cigarrillo', alt: 'pucho' })
    expect(hit('ciga', 'cigarro')).toEqual({ title: 'cigarro', alt: 'pucho' })
  })

  it('typing "pucho": pucho leads, with the standard word beside it — and the two words can be told apart', () => {
    expect(hit('pucho', 'cigarrillo')).toEqual({ title: 'pucho', alt: 'cigarrillo' })
    expect(hit('pucho', 'cigarro')).toEqual({ title: 'pucho', alt: 'cigarro' })
  })

  it('a match through a translation uses the card rule, with the standard word beside the headword when they differ', () => {
    const found = searchWords(real, 'cigarette', 99, { translations: true }).find((h) => h.word.esWord === 'cigarrillo')!
    expect(found.via).toBe('en')
    expect(rowTitle(found.word, found.via)).toEqual(rowTitle(found.word, null))
  })
})

describe('what a row leads with, outside a search: the headword, and the standard word when the headword is not it', () => {
  it('cigarro and cigarrillo both lead with pucho where the cards do, and each shows its own standard word', () => {
    for (const es of ['cigarro', 'cigarrillo']) {
      const head = headword(word(es))
      const row = rowTitle(word(es), null)
      expect(row.title).toBe(head.text)
      if (head.form === 'rioplatense') expect(row).toEqual({ title: 'pucho', alt: es })
    }
    // the point: whatever the headword is, the two rows are not identical
    expect(rowTitle(word('cigarro'), null)).not.toEqual(rowTitle(word('cigarrillo'), null))
  })

  it('a word whose headword is its own standard form has no second word', () => {
    expect(rowTitle(word('casa'), null).alt).toBeNull()
    expect(rowTitle(makeWord('perro'), null)).toEqual({ title: 'perro', alt: null })
  })

  it('every word whose headword is not its own form shows that form, and none shows a second word otherwise', () => {
    let switched = 0
    for (const w of real) {
      const head = headword(w)
      const row = rowTitle(w, null)
      if (head.text.toLowerCase() !== w.esWord.toLowerCase()) {
        switched++
        expect(row.alt, w.esWord).toBe(w.esWord)
      } else {
        expect(row.alt, w.esWord).toBeNull()
      }
    }
    expect(switched).toBeGreaterThan(5)
  })

  it('the legacy Rioplatense field (no overlay) works the same way', () => {
    const legacy: Word = makeWord('coger', { esRioplatense: 'agarrar', wordFormInExample: 'agarrar', exampleSentence: 'Voy a agarrar el bus.' })
    const row = rowTitle(legacy, null)
    expect(row.title).toBe(headword(legacy).text)
    if (row.title !== 'coger') expect(row.alt).toBe('coger')
  })
})
