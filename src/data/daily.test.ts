import { describe, expect, it } from 'vitest'
import { learnedToday, newWordsPatch, streakPatch } from './daily'
import { parseSettings } from './settings'

const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)

describe('streakPatch', () => {
  it('is a no-op when activity was already recorded today', () => {
    const s = parseSettings({ streak_count: 4, streak_last_activity_date: '2026-10-02' })
    expect(streakPatch(s, noon(2026, 10, 2))).toBeNull()
  })

  it('increments when the last activity was yesterday', () => {
    const s = parseSettings({ streak_count: 4, streak_last_activity_date: '2026-10-01' })
    expect(streakPatch(s, noon(2026, 10, 2))).toEqual({ streak_count: 5, streak_last_activity_date: '2026-10-02' })
  })

  it('restarts at 1 after a gap, or when there is no history', () => {
    const gap = parseSettings({ streak_count: 9, streak_last_activity_date: '2026-09-29' })
    expect(streakPatch(gap, noon(2026, 10, 2))).toEqual({ streak_count: 1, streak_last_activity_date: '2026-10-02' })
    expect(streakPatch(parseSettings(null), noon(2026, 10, 2))).toEqual({
      streak_count: 1,
      streak_last_activity_date: '2026-10-02',
    })
  })

  it('treats yesterday correctly across month and year boundaries', () => {
    const feb = parseSettings({ streak_count: 2, streak_last_activity_date: '2026-02-28' })
    expect(streakPatch(feb, noon(2026, 3, 1))?.streak_count).toBe(3)
    const dec = parseSettings({ streak_count: 6, streak_last_activity_date: '2026-12-31' })
    expect(streakPatch(dec, noon(2027, 1, 1))?.streak_count).toBe(7)
    const leap = parseSettings({ streak_count: 1, streak_last_activity_date: '2028-02-29' })
    expect(streakPatch(leap, noon(2028, 3, 1))?.streak_count).toBe(2)
  })

  it('uses the LOCAL date: 23:30 in Montevideo is still the same local day although it is the next UTC day', () => {
    const lateEvening = new Date(2026, 9, 2, 23, 30) // 2026-10-03T02:30Z
    expect(lateEvening.toISOString()).toBe('2026-10-03T02:30:00.000Z')
    const s = parseSettings({ streak_count: 3, streak_last_activity_date: '2026-10-01' })
    expect(streakPatch(s, lateEvening)).toEqual({ streak_count: 4, streak_last_activity_date: '2026-10-02' })
  })
})

describe('newWordsPatch', () => {
  it('adds to today\'s counter', () => {
    const s = parseSettings({ new_words_learned_today_count: 4, new_words_learned_today_date: '2026-10-02' })
    expect(newWordsPatch(s, 6, noon(2026, 10, 2))).toEqual({
      new_words_learned_today_count: 10,
      new_words_learned_today_date: '2026-10-02',
    })
  })

  it('restarts from 0 when the stored date is another day (lazy reset)', () => {
    const s = parseSettings({ new_words_learned_today_count: 9, new_words_learned_today_date: '2026-10-01' })
    expect(newWordsPatch(s, 3, noon(2026, 10, 2))).toEqual({
      new_words_learned_today_count: 3,
      new_words_learned_today_date: '2026-10-02',
    })
  })

  it('starts fresh when nothing was ever stored', () => {
    expect(newWordsPatch(parseSettings(null), 10, noon(2026, 10, 2))).toEqual({
      new_words_learned_today_count: 10,
      new_words_learned_today_date: '2026-10-02',
    })
  })

  it('is a no-op for zero or negative deltas', () => {
    expect(newWordsPatch(parseSettings(null), 0, noon(2026, 10, 2))).toBeNull()
    expect(newWordsPatch(parseSettings(null), -2, noon(2026, 10, 2))).toBeNull()
  })

  it('uses the local date, not UTC', () => {
    const patch = newWordsPatch(parseSettings(null), 1, new Date(2026, 9, 2, 23, 30))
    expect(patch?.new_words_learned_today_date).toBe('2026-10-02')
  })
})

describe('learnedToday', () => {
  it('reads the counter only for today', () => {
    const s = parseSettings({ new_words_learned_today_count: 7, new_words_learned_today_date: '2026-10-02' })
    expect(learnedToday(s, noon(2026, 10, 2))).toBe(7)
    expect(learnedToday(s, noon(2026, 10, 3))).toBe(0)
  })
})
