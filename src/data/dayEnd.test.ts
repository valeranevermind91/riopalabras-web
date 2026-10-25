import { describe, expect, it } from 'vitest'
import { learnedState } from '../sm2/sm2'
import { makeWord } from '../testing/makeWord'
import { BOTH } from '../testing/translationFlags'
import { learnedTodayKeys, todayMatchingRounds, tomorrowPreview } from './dayEnd'
import { wordKey } from './words'
import type { Word } from './types'

const NOON = new Date(2026, 9, 5, 12, 0) // local noon, 5 October 2026
const TOMORROW = new Date(2026, 9, 6) // the start of tomorrow, local: when a word learned today is first due

/** A word as finishing a Learn batch leaves it. */
const learned = (name: string, at: Date = NOON, over: Partial<Word> = {}) => makeWord(name, { ...learnedState(at), rank: 1, ...over })
const keys = (words: readonly Word[], now: Date = NOON) => [...learnedTodayKeys(words, now)].sort()

describe('learnedTodayKeys: the words learned today, found in the words as they are', () => {
  it('a word that finishing a batch just wrote is one, whatever time of day the batch was finished', () => {
    const words = [learned('temprano', new Date(2026, 9, 5, 0, 1)), learned('mediodia', NOON), learned('tarde', new Date(2026, 9, 5, 23, 59))]
    expect(keys(words)).toEqual(['mediodia', 'temprano', 'tarde'].sort())
    expect(learnedState(new Date(2026, 9, 5, 0, 1)).nextReview).toEqual(TOMORROW) // all three have the same first review: tomorrow's first minute
  })

  it('a word is not one when it was learned another day, or has been reviewed, or was rated Again, or is hidden, or was never learned', () => {
    const words = [
      learned('ayer', new Date(2026, 9, 4, 20, 0)), // learned yesterday and not reviewed yet: its first review was this midnight
      makeWord('repasada', { repetitions: 2, interval: 3, nextReview: new Date(2026, 9, 8) }),
      makeWord('otra_vez', { repetitions: 1, interval: 0, nextReview: new Date(NOON.getTime() + 10 * 60_000) }), // rated Again a moment ago: due in minutes
      learned('oculta', NOON, { isHidden: true }),
      makeWord('nueva'),
      learned('hoy'),
    ]
    expect(keys(words)).toEqual(['hoy'])
  })

  it('it takes the whole state, not only the date: a word due at that first minute with a second repetition, or with days on its interval, is not one', () => {
    // nothing the app writes looks like this, but each of the three conditions has to do its own work (a stored row can be anything)
    const words = [
      learned('segunda', NOON, { repetitions: 2 }),
      learned('con_dias', NOON, { interval: 1 }),
      learned('cero', NOON, { repetitions: 0 }),
      learned('hoy'),
    ]
    expect(keys(words)).toEqual(['hoy'])
  })

  it('after midnight yesterday\'s words are not today\'s: their first review has come', () => {
    const words = [learned('hoy', NOON)]
    expect(keys(words, new Date(2026, 9, 5, 23, 59))).toEqual(['hoy'])
    expect(keys(words, new Date(2026, 9, 6, 0, 30))).toEqual([]) // it is the 6th: they are due, and learning today starts again
  })
})

describe('tomorrowPreview: what tomorrow brings', () => {
  const pool = (n: number) => Array.from({ length: n }, (_, i) => makeWord(`nueva${i}`, { rank: 100 + i }))
  const tomorrowAt = (hour: number) => new Date(2026, 9, 6, hour, 0)
  const words = [
    learned('a'), learned('b'), learned('c'), // today's three: due tomorrow
    makeWord('d', { repetitions: 2, interval: 3, nextReview: tomorrowAt(15) }), // an older word, due tomorrow afternoon
    makeWord('e', { repetitions: 2, interval: 8, nextReview: tomorrowAt(23) }),
    makeWord('pasado', { repetitions: 2, interval: 8, nextReview: new Date(2026, 9, 7, 9, 0) }), // the day after: not tomorrow's
    makeWord('borde', { repetitions: 2, interval: 8, nextReview: new Date(2026, 9, 7) }), // exactly the first minute of the day after: that day's, not tomorrow's
    makeWord('otra_vez', { repetitions: 1, interval: 0, nextReview: new Date(NOON.getTime() + 10 * 60_000) }), // later today: today's, not tomorrow's
    makeWord('oculta', { repetitions: 2, interval: 3, nextReview: tomorrowAt(10), isHidden: true }),
    makeWord('articulo', { pos: 'art', repetitions: 2, interval: 3, nextReview: tomorrowAt(10) }), // never reviewed
    ...pool(12),
  ]

  it('counts the reviews that fall during tomorrow, and only those a review would really be offered for', () => {
    expect(tomorrowPreview(words, { dailyNewWordLimit: 10 }, NOON).reviews).toBe(5) // a, b, c, d, e
  })

  it('offers the daily goal in new words, or fewer when fewer are left, or none when the goal is 0', () => {
    expect(tomorrowPreview(words, { dailyNewWordLimit: 10 }, NOON).fresh).toBe(10)
    expect(tomorrowPreview(words, { dailyNewWordLimit: 20 }, NOON).fresh).toBe(12) // only twelve left
    expect(tomorrowPreview(words, { dailyNewWordLimit: 0 }, NOON).fresh).toBe(0)
  })

  it('does not move with the time of day today: the same answer at one minute past midnight and at 23:59', () => {
    for (const now of [new Date(2026, 9, 5, 0, 1), new Date(2026, 9, 5, 23, 59)]) expect(tomorrowPreview(words, { dailyNewWordLimit: 10 }, now).reviews).toBe(5)
  })
})

describe('todayMatchingRounds: Matching on the words learned today', () => {
  const glossed = (name: string, i: number, over: Partial<Word> = {}) => makeWord(name, { ruTranslation: `слово${'абвгдежзиклмн'[i]}`, enTranslation: `word${i}`, ...over })
  const todays = Array.from({ length: 8 }, (_, i) => glossed(`hoy${i}`, i, { ...learnedState(NOON), rank: i + 1 }))
  // older words Matching could use too (learned, not due, with glosses of their own): they must never appear
  const older = Array.from({ length: 6 }, (_, i) => glossed(`antes${i}`, i + 8, { repetitions: 3, interval: 20, nextReview: new Date(2026, 9, 25), rank: 50 + i }))
  const flags = BOTH

  it('has rounds made of today\'s words only, and every one of them is in a round', () => {
    const rounds = todayMatchingRounds([...older, ...todays], flags, NOON)!
    expect(rounds.length).toBeGreaterThan(0)
    const used = new Set(rounds.flatMap((r) => r.items.map((m) => m.id)))
    const today = new Set(todays.map((w) => wordKey(w.esWord)))
    expect([...used].every((id) => today.has(id))).toBe(true) // nothing from outside
    expect(used).toEqual(today) // and all of them
  })

  it('is null when there are too few of today\'s words for Matching to run (it is not offered then)', () => {
    expect(todayMatchingRounds([...older, ...todays.slice(0, 3)], flags, NOON)).toBeNull()
    expect(todayMatchingRounds(older, flags, NOON)).toBeNull() // nothing learned today
  })
})
