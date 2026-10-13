import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from './dictionary'
import { dayNumber, pickWordOfTheDay, wordOfTheDay, wordOfTheDayOrder, wordOfTheDayPool } from './wordOfDay'
import { parseFallbackExamples, parseRioOverlay } from './rio'
import { parseSettings } from './settings'
import type { Word } from './types'

// The word of the day comes from a fixed permutation of the pool, indexed by the local day number: every word once before any comes again.
// (It used to be a hash of the date on its own: two days could land on the same word however large the pool, and with 21 words they did.)

const real = parseDictionary(
  JSON.parse(readFileSync('public/words_enriched.json', 'utf8')),
  parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))),
  parseFallbackExamples(JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))),
)
const pool = wordOfTheDayPool(real)
const N = pool.length
/** The nth local calendar day after `from`, at noon (Date arithmetic on the fields, so months, years and leap days roll over by themselves). */
const day = (n: number, from = new Date(2026, 0, 1)) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + n, 12)
const picks = (days: number, from?: Date, words: readonly Word[] = real) => Array.from({ length: days }, (_, i) => pickWordOfTheDay(words, day(i, from))!.esWord)
const hide = (...names: string[]) => real.map((w) => (names.includes(w.esWord) ? { ...w, isHidden: true } : w))
const only = (names: string[]) => real.filter((w) => !w.rio || names.includes(w.esWord))

describe('the pool today', () => {
  const names = new Set(pool.map((w) => w.esWord))

  it('is 71 words, so the cycle is 71 days (about two and a half months)', () => {
    expect(N).toBe(71)
    expect(real.filter((w) => w.rio).length).toBe(76)
  })

  it('is the overlay entries whose card can highlight an example, the dictionary\'s when there is no overlay one, minus the five kept off the home screen', () => {
    const candidates = real.filter((w) => w.rio)
    expect(candidates.filter((w) => !names.has(w.esWord)).map((w) => w.esWord).sort()).toEqual(['cojón', 'coño', 'follar', 'gilipollas', 'vagabundo'])
    for (const out of ['coño', 'follar', 'cojón', 'gilipollas']) expect(real.find((w) => w.esWord === out)!.rio!.register).toBe('vulgar')
    expect(real.find((w) => w.esWord === 'vagabundo')!.rio!.register).toBe('pejorative')
    // entries with no overlay example of their own are in, on the dictionary's example
    for (const dictionaryExample of ['aquí', 'piscina', 'ordenador', 'apartamento']) {
      expect(names.has(dictionaryExample), dictionaryExample).toBe(true)
      expect(real.find((w) => w.esWord === dictionaryExample)!.rio!.example).toBeFalsy()
    }
  })

  it('never contains a vulgar, offensive or pejorative word, whatever the overlay grows to hold', () => {
    for (const w of pool) expect(['vulgar', 'offensive', 'pejorative']).not.toContain(w.rio!.register)
    const vulgar = real.map((w) => (w.esWord === 'aquí' ? { ...w, rio: { ...w.rio!, register: 'vulgar' } } : w))
    expect(wordOfTheDayPool(vulgar).some((w) => w.esWord === 'aquí')).toBe(false)
  })

  it('shows a card on the dictionary\'s example for such an entry: its sentence and the highlighted form', () => {
    const word = real.find((w) => w.esWord === 'piscina')!
    const day = Array.from({ length: 142 }, (_, i) => i).map((i) => pickWordOfTheDay(real, new Date(2026, 0, 1 + i, 12))!).findIndex((w) => w.esWord === 'piscina')
    const card = wordOfTheDay(real, parseSettings({}), new Date(2026, 0, 1 + day, 12))!
    expect(card.word.esWord).toBe(word.esWord)
    expect(card.headword).toBe('pileta')
    expect(card.sentence.slice(card.range.start, card.range.end).toLowerCase()).toBe('pileta')
  })
})

describe('every word once before any comes again', () => {
  it('any run of as many days as there are words shows each word exactly once, wherever it starts (over several years, across month, year and leap-day boundaries)', () => {
    for (let start = 0; start < 1500; start += 7) {
      const run = picks(N, day(start))
      expect(new Set(run).size, `from day ${start}`).toBe(N)
    }
  })

  it('so a word comes again after exactly N days, never sooner: the cycle is as long as the pool', () => {
    const long = picks(N * 5)
    for (let i = 0; i + N < long.length; i++) expect(long[i + N]).toBe(long[i])
    // and the shortest gap between a word and its next appearance is N, over five years too
    const last = new Map<string, number>()
    let shortest = Infinity
    const years = picks(1826)
    years.forEach((w, i) => {
      if (last.has(w)) shortest = Math.min(shortest, i - last.get(w)!)
      last.set(w, i)
    })
    expect(shortest).toBe(N)
  })

  it('never the same word two days running, and never "A, B, A": over five years no word comes back within N - 1 days', () => {
    const years = picks(1826)
    for (let i = 0; i < years.length; i++) for (let k = 1; k < N; k++) if (years[i + k] !== undefined) expect(years[i + k], `day ${i} and day ${i + k}`).not.toBe(years[i])
  })

  it('the days that went wrong with the date hash (9 and 10 October 2026 were the same word) are different words now', () => {
    expect(pickWordOfTheDay(real, new Date(2026, 9, 9, 12))!.esWord).not.toBe(pickWordOfTheDay(real, new Date(2026, 9, 10, 12))!.esWord)
    expect(pickWordOfTheDay(real, new Date(2026, 9, 7, 12))!.esWord).not.toBe(pickWordOfTheDay(real, new Date(2026, 9, 12, 12))!.esWord) // 7th and 12th were one word too
  })

  it('every word is shown equally often: over a whole number of cycles, exactly as often as every other', () => {
    const counts = new Map<string, number>()
    for (const w of picks(N * 40)) counts.set(w, (counts.get(w) ?? 0) + 1)
    expect(counts.size).toBe(N)
    expect(new Set(counts.values())).toEqual(new Set([40]))
  })

  it('works for a pool of any size: 1 word (the same every day), 2 (alternating), 3, 7', () => {
    const names = pool.map((w) => w.esWord)
    expect(new Set(picks(10, undefined, only(names.slice(0, 1)))).size).toBe(1)
    const two = picks(10, undefined, only(names.slice(0, 2)))
    for (let i = 1; i < two.length; i++) expect(two[i]).not.toBe(two[i - 1])
    for (const size of [3, 7]) expect(new Set(picks(size, day(100), only(names.slice(0, size)))).size).toBe(size)
  })
})

describe('the same date is the same word for everyone', () => {
  it('all day long: early morning and late night of a local date give the one word', () => {
    const first = pickWordOfTheDay(real, new Date(2026, 9, 12, 0, 1))!.esWord
    expect(pickWordOfTheDay(real, new Date(2026, 9, 12, 23, 59))!.esWord).toBe(first)
    expect(pickWordOfTheDay(real, new Date(2026, 9, 13, 0, 1))!.esWord).not.toBe(first) // and the next local day is another
  })

  it('whatever the user has learned, the order of the words, or what else is in the dictionary', () => {
    const base = picks(30)
    const learned = real.map((w) => ({ ...w, repetitions: 4, nextReview: new Date(2026, 0, 1) }))
    expect(picks(30, undefined, learned)).toEqual(base)
    expect(picks(30, undefined, [...real].reverse())).toEqual(base)
    expect(picks(30, undefined, real.filter((w) => w.rio))).toEqual(base)
  })

  it('wordOfTheDay carries the same pick', () => {
    expect(wordOfTheDay(real, parseSettings({}), day(40))!.word.esWord).toBe(pickWordOfTheDay(real, day(40))!.esWord)
  })
})

describe('the day number', () => {
  it('is the same all of a local day and goes up by exactly one at each local midnight, across months, years and a leap day', () => {
    expect(dayNumber(new Date(2026, 9, 12, 0, 0, 1))).toBe(dayNumber(new Date(2026, 9, 12, 23, 59, 59)))
    for (const [y, m, d] of [[2026, 9, 31], [2026, 11, 31], [2028, 1, 28], [2028, 1, 29], [2026, 2, 28], [2026, 9, 24], [2026, 2, 29]] as const) {
      expect(dayNumber(new Date(y, m, d + 1, 12)) - dayNumber(new Date(y, m, d, 12)), `${y}-${m + 1}-${d}`).toBe(1)
    }
    expect(dayNumber(new Date(1970, 0, 1, 12))).toBe(0)
  })
})

describe('the order', () => {
  it('is a permutation of the pool: nothing lost, nothing twice, and it does not follow the alphabet', () => {
    const order = wordOfTheDayOrder(pool)
    expect(order.map((w) => w.esWord).sort()).toEqual(pool.map((w) => w.esWord).sort())
    expect(order.map((w) => w.esWord)).not.toEqual(pool.map((w) => w.esWord))
  })

  it('does not depend on the order it is given in', () => {
    expect(wordOfTheDayOrder([...pool].reverse()).map((w) => w.esWord)).toEqual(wordOfTheDayOrder(pool).map((w) => w.esWord))
  })

  it('adding a word to the pool puts it somewhere without reshuffling the others', () => {
    const without = wordOfTheDayOrder(pool.slice(1)).map((w) => w.esWord)
    const withAll = wordOfTheDayOrder(pool).map((w) => w.esWord).filter((w) => w !== pool[0].esWord)
    expect(withAll).toEqual(without)
  })
})

describe('words the user has marked as known', () => {
  it('are never shown, on any day', () => {
    const known = pool.slice(0, 5).map((w) => w.esWord)
    for (const w of picks(400, undefined, hide(...known))) expect(known).not.toContain(w)
  })

  it('leave the rest in a cycle of their own: with 3 known, 18 days show 18 different words', () => {
    const known = pool.slice(0, 3).map((w) => w.esWord)
    for (let start = 0; start < 200; start += 13) expect(new Set(picks(N - 3, day(start), hide(...known))).size).toBe(N - 3)
  })

  it('and with everything known there is no word of the day', () => {
    expect(pickWordOfTheDay(hide(...pool.map((w) => w.esWord)), day(5))).toBeNull()
    expect(wordOfTheDay(hide(...pool.map((w) => w.esWord)), parseSettings({}), day(5))).toBeNull()
    expect(pickWordOfTheDay([], day(5))).toBeNull()
  })
})
