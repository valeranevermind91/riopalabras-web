import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from './dictionary'
import { foldText, searchWords } from './search'
import { parseRioOverlay } from './rio'
import { headwordDecision } from './headword'

const words = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')), parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))))
const find = (q: string, limit?: number) => searchWords(words, q, limit)
const names = (q: string, limit?: number) => find(q, limit).map((h) => h.word.esWord)

describe('foldText', () => {
  it.each([
    ['Aquí', 'aqui'],
    ['  ÁCÁ ', 'aca'],
    ['señor', 'senor'],
    ['ómnibus', 'omnibus'],
  ])('%j → %j', (input, expected) => expect(foldText(input)).toBe(expected))
})

describe('searchWords', () => {
  it('is case- and accent-insensitive on es_word', () => {
    expect(names('aqui')[0]).toBe('aquí')
    expect(names('AQUÍ')[0]).toBe('aquí')
    expect(names('Periodico')[0]).toBe('periódico')
  })

  it('matches the overlay rio_form too, and says so', () => {
    const hit = find('aca').find((h) => h.word.esWord === 'aquí')
    expect(hit?.via).toBe('rio_form')
    expect(names('pucho')).toEqual(expect.arrayContaining(['cigarrillo', 'cigarro']))
    expect(find('pucho').every((h) => h.via === 'rio_form')).toBe(true)
    expect(names('ómnibus')).toContain('autobús')
  })

  it('does not match words only through the legacy field or a rejected entry', () => {
    expect(names('cheto')).toEqual([]) // tony's old legacy value; not in the overlay
    expect(names('borracha')).not.toContain('mona')
  })

  it('puts exact matches first, then prefix matches, then the rest, and breaks ties by frequency rank', () => {
    expect(names('casa')[0]).toBe('casa')
    const hits = find('cas', 50)
    const isPrefix = (h: (typeof hits)[number]) => [h.word.esWord, h.word.rio?.form ?? ''].some((f) => foldText(f).startsWith('cas'))
    const flags = hits.map(isPrefix)
    expect(flags).toEqual([...flags].sort((x, y) => Number(y) - Number(x))) // prefix matches before the others
    const ranks = hits.filter(isPrefix).map((h) => h.word.rank ?? Infinity)
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y))
  })

  it('returns at most 8 by default and respects a custom limit', () => {
    expect(find('a')).toHaveLength(8)
    expect(find('a', 3)).toHaveLength(3)
  })

  it('returns nothing for an empty or blank query, or no match', () => {
    expect(find('')).toEqual([])
    expect(find('   ')).toEqual([])
    expect(find('zzzzqq')).toEqual([])
  })

  it('matches a later word of a phrase form (control remoto)', () => {
    expect(names('remoto')).toContain('mando')
  })

  it('finds each quick-button word', () => {
    for (const w of ['aquí', 'cigarrillo', 'metro', 'coger', 'autobús', 'foco', 'guapo', 'portero']) expect(names(w)[0]).toBe(w)
  })
})

describe('headwordDecision (what the preview explains)', () => {
  const by = (w: string) => words.find((x) => x.esWord === w)!
  it.each([
    ['aquí', true, 'sentence-has-form', 'acá'],
    ['cigarrillo', false, 'sentence-lacks-form', null],
    ['guapo', false, 'not-replacement', null],
    ['mona', false, 'no-overlay', null],
  ])('%s → switched %s (%s)', (esWord, switched, reason, matched) => {
    expect(headwordDecision(by(esWord))).toEqual({ switched, reason, matched })
  })

  it('reports the legacy rule when only the old field is present', () => {
    const legacy = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8'))).find((w) => w.esWord === 'periódico')!
    expect(headwordDecision(legacy)).toEqual({ switched: true, reason: 'legacy', matched: null })
  })
})
