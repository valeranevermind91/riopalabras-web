import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from './dictionary'
import { findDuplicate } from './customWords'
import { genderArticle, parseNounGender } from './gender'
import { headword } from './headword'
import { parseFallbackExamples, parseRioOverlay } from './rio'
import { foldText, searchWords } from './search'
import type { Word } from './types'
import { wordKey } from './words'
import { makeWord } from '../testing/makeWord'

// The grammatical gender of a noun, shown as its article before the headword ("la casa"). It is display only: the article is a separate field of the word, never part of
// esWord, so the key, the search and the duplicate check read what they always read. The data is public/noun_gender.json, built and checked by hand (tools/gender).

const read = (file: string) => JSON.parse(readFileSync(`public/${file}`, 'utf8'))
const rio = parseRioOverlay(read('rio_overlay.json'))
const fallback = parseFallbackExamples(read('examples_fallback.json'))
const rawGender = read('noun_gender.json')
const gender = parseNounGender(rawGender)!
const plain = parseDictionary(read('words_enriched.json'), rio, fallback)
const words = parseDictionary(read('words_enriched.json'), rio, fallback, gender)
const byKey = new Map(words.map((w) => [wordKey(w.esWord), w]))
const word = (key: string): Word => byKey.get(key)!
const noun = (esWord: string, article: 'el' | 'la' | 'el/la' | 'los' | 'las', form = esWord, over: Partial<Word> = {}): Word => makeWord(esWord, { gender: { article, form }, ...over })

describe('the data file', () => {
  it('is { v: 1, e: { key: value } }; a value is an article, or an article and the word when the card shows another form than the key', () => {
    expect(rawGender.v).toBe(1)
    for (const [key, value] of Object.entries<string>(rawGender.e)) {
      expect(value, key).toMatch(/^(el\/la|el|la|los|las)( \S.*)?$/)
    }
  })

  it('parses into one entry per key, and every key is a noun of the dictionary', () => {
    expect(gender.size).toBe(Object.keys(rawGender.e).length)
    for (const key of gender.keys()) {
      const w = byKey.get(key)
      expect(w, `${key} is not in the dictionary`).toBeDefined()
      expect(w!.pos, key).toBe('n')
    }
  })

  it('is a few thousand nouns, the article of the commonest ones is right', () => {
    expect(gender.size).toBeGreaterThan(2400)
    expect(gender.get('casa')).toEqual({ article: 'la', form: 'casa' })
    expect(gender.get('día')).toEqual({ article: 'el', form: 'día' })
    expect(gender.get('agua')).toEqual({ article: 'el', form: 'agua' }) // a feminine noun with a stressed a-: "el agua"
    expect(gender.get('estudiante')?.article).toBe('el/la')
    expect(gender.get('gafas')).toEqual({ article: 'los', form: 'lentes' }) // plural, and the Rioplatense word leads
    expect(gender.get('gracias')).toEqual({ article: 'las', form: 'gracias' })
    expect(gender.get('metro')).toEqual({ article: 'el', form: 'subte' }) // the Rioplatense form leads, so it is the form the article belongs to
  })

  it('has the owner\'s decisions: these get the article given, the words he listed get none', () => {
    for (const [key, article] of [['arte', 'el'], ['virgen', 'la'], ['papi', 'el'], ['bienes', 'los'], ['muebles', 'los'], ['modales', 'los'], ['quinto', 'el']] as const) {
      expect(gender.get(key)?.article, key).toBe(article)
    }
    for (const key of ['gana', 'malo', 'mía', 'tuya', 'rica', 'católico', 'federal', 'veras', 'detente', 'miro', 'etcétera', 'charles', 'house', 'i', 't', 'repente', 'través', 'ma', 'may.']) {
      expect(gender.has(key), `${key} must have no article`).toBe(false)
    }
  })

  it('has none for the words that mean two things by gender (el capital / la capital) and none for a word that is not a noun', () => {
    for (const key of ['capital', 'orden', 'cura', 'frente', 'guía', 'policía', 'cometa', 'modelo']) expect(gender.has(key), key).toBe(false)
    for (const key of ['te', 'mi', 'malo']) expect(gender.has(key), key).toBe(false)
  })

  it('leaves the epicene -o words with their own feminine as masculine ("el médico"), and the ones that do not have one as "el/la"', () => {
    for (const key of ['médico', 'testigo', 'piloto', 'músico', 'refugiado', 'luchador', 'veterano']) expect(gender.get(key)?.article, key).toBe('el')
    expect(gender.get('artista')?.article).toBe('el/la')
  })
})

describe('parseNounGender', () => {
  it('reads an article as "the article and the key" and a whole display as its own form', () => {
    const map = parseNounGender({ v: 1, e: { casa: 'la', coche: 'el auto', 'ciencia ficción': 'la', gafas: 'las' } })!
    expect(map.get('casa')).toEqual({ article: 'la', form: 'casa' })
    expect(map.get('coche')).toEqual({ article: 'el', form: 'auto' })
    expect(map.get('ciencia ficción')).toEqual({ article: 'la', form: 'ciencia ficción' })
    expect(map.get('gafas')).toEqual({ article: 'las', form: 'gafas' })
  })

  it('skips an entry it does not understand and keeps the rest', () => {
    const map = parseNounGender({ v: 1, e: { casa: 'la', mesa: 'una', silla: 7, perro: '', gato: 'el ', libro: 'unos libros', pan: 'el' } })!
    expect([...map.keys()].sort()).toEqual(['casa', 'pan'])
  })

  it('is null for anything that is not the file (the app then runs without articles)', () => {
    for (const bad of [null, undefined, 'x', 3, [], {}, { v: 1 }, { v: 1, e: [] }, { v: 2, e: { casa: 'la' } }]) expect(parseNounGender(bad), JSON.stringify(bad)).toBeNull()
  })
})

describe('the word carries it', () => {
  it('parseDictionary attaches the entry by the word\'s key; without the file no word has one and nothing else changes', () => {
    expect(word('casa').gender).toEqual({ article: 'la', form: 'casa' })
    expect(plain.every((w) => w.gender === null)).toBe(true)
    expect(plain.map((w) => w.esWord)).toEqual(words.map((w) => w.esWord))
    expect(parseDictionary(read('words_enriched.json'), rio, fallback, null).every((w) => w.gender === null)).toBe(true)
  })

  it('a word that is not a noun has none', () => {
    expect(words.filter((w) => w.pos !== 'n' && w.gender !== null)).toEqual([])
  })
})

describe('genderArticle: the article of the word as the card shows it', () => {
  it('is the stored article when the headword is the form it was made for', () => {
    expect(genderArticle(word('casa'))).toBe('la')
    expect(genderArticle(word('agua'))).toBe('el')
  })

  it('is null for a word with no entry', () => {
    expect(genderArticle(makeWord('casa'))).toBeNull()
    expect(genderArticle(word('capital'))).toBeNull()
  })

  it('is null when the card shows another form than the one the entry was made for (the overlay did not lead, so the Rioplatense word\'s article would be wrong)', () => {
    const metro = word('metro')
    expect(headword(metro).text).toBe('subte')
    expect(genderArticle(metro)).toBe('el')
    const withoutOverlay = noun('metro', 'el', 'subte') // the same entry on a card whose headword is "metro"
    expect(headword(withoutOverlay).text).toBe('metro')
    expect(genderArticle(withoutOverlay)).toBeNull()
  })

  it('compares the form the way it is shown: case does not matter, accents do', () => {
    expect(genderArticle(noun('Casa', 'la', 'casa'))).toBe('la')
    expect(genderArticle(noun('día', 'el', 'dia'))).toBeNull()
  })

  it('is null for a word the user added, whatever it carries', () => {
    expect(genderArticle(noun('casa', 'la', 'casa', { isCustom: true }))).toBeNull()
  })

  it('is null for a word that is not a noun', () => {
    expect(genderArticle(noun('casa', 'la', 'casa', { pos: 'v' }))).toBeNull()
  })

  it('every entry of the file is shown on the card it was made for, but one: tontería was made for itself and its card leads with boludez, so it shows none (never the wrong one)', () => {
    const hidden = words.filter((w) => w.gender && !genderArticle(w)).map((w) => `${w.esWord} → ${w.gender!.form}, card: ${headword(w).text}`)
    expect(hidden).toEqual(['tontería → tontería, card: boludez'])
  })
})

describe('the article is not part of the word', () => {
  it('esWord, the key and the card\'s headword text carry no article', () => {
    for (const w of words) {
      if (!w.gender) continue
      expect(w.esWord, w.esWord).not.toMatch(/^(el|la|los|las|el\/la) /i)
      expect(headword(w).text, w.esWord).not.toMatch(/^(el|la|los|las|el\/la) /i)
    }
    expect(words.map((w) => wordKey(w.esWord))).toEqual(plain.map((w) => wordKey(w.esWord)))
  })

  it('search finds the same words in the same order with and without the data, and "la casa" is not a search the article opens up', () => {
    for (const query of ['casa', 'agua', 'subte', 'metro', 'día', 'estudiante', 'gafas', 'la casa']) {
      const a = searchWords(words, query, 8).map((h) => [h.word.esWord, h.via])
      const b = searchWords(plain, query, 8).map((h) => [h.word.esWord, h.via])
      expect(a, query).toEqual(b)
    }
    expect(foldText('la casa')).toBe('la casa')
  })

  it('the duplicate check sees the same words: a typed "casa" is the dictionary\'s casa, a typed "la casa" is not', () => {
    const found = (list: readonly Word[], typed: string) => {
      const d = findDuplicate(list, typed)
      return d && { word: d.word.esWord, via: d.via }
    }
    for (const typed of ['casa', 'la casa', 'subte', 'el subte', 'las gafas', 'lentes', 'agua']) expect(found(words, typed), typed).toEqual(found(plain, typed))
    expect(found(words, 'casa')).toEqual({ word: 'casa', via: 'es_word' })
    expect(found(words, 'la casa')).toBeNull()
  })
})
