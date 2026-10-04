import { describe, expect, it } from 'vitest'
import { applyFlagLists, applyProgressUpdates, applySettingsPatch } from './mutations'
import { parseSettings } from './settings'
import type { Word } from './types'

function word(esWord: string, rank: number, overrides: Partial<Word> = {}): Word {
  return Object.freeze({
    esWord,
    esRioplatense: null,
    rio: null,
    fallbackExample: null,
    enTranslation: 'x',
    ruTranslation: 'y',
    exampleSentence: '',
    exampleTranslationEn: '',
    exampleTranslationRu: '',
    wordFormInExample: null,
    isRioplatenseVariant: false,
    pos: 'n',
    frequency: 1000 - rank,
    rank,
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: null,
    isFavorite: false,
    isHidden: false,
    isCustom: false,
    isEnriched: true,
    ...overrides,
  })
}

describe('applyProgressUpdates', () => {
  const words = [word('casa', 1), word('Hacienda', 2), word('perro', 3)]
  const due = new Date('2026-10-03T03:00:00.000Z')

  it('updates matching words, case-insensitively, keeping order and other words by reference', () => {
    const next = applyProgressUpdates(words, [
      { esWord: 'hacienda', easeFactor: 2.5, interval: 0, repetitions: 1, nextReview: due },
    ])
    expect(next.map((w) => w.esWord)).toEqual(['casa', 'Hacienda', 'perro'])
    expect(next[0]).toBe(words[0])
    expect(next[2]).toBe(words[2])
    expect(next[1]).toMatchObject({ repetitions: 1, interval: 0, easeFactor: 2.5, nextReview: due, esWord: 'Hacienda' })
  })

  it('does not mutate the input list or its words', () => {
    applyProgressUpdates(words, [{ esWord: 'casa', easeFactor: 2, interval: 3, repetitions: 4, nextReview: due }])
    expect(words[0].repetitions).toBe(0)
  })

  it('returns frozen words', () => {
    const next = applyProgressUpdates(words, [{ esWord: 'casa', easeFactor: 2, interval: 3, repetitions: 4, nextReview: due }])
    expect(Object.isFrozen(next[0])).toBe(true)
    expect(Object.isFrozen(next)).toBe(true)
  })

  it('returns the same list when there is nothing to apply, and ignores unknown words', () => {
    expect(applyProgressUpdates(words, [])).toBe(words)
    const next = applyProgressUpdates(words, [{ esWord: 'zzz', easeFactor: 2, interval: 3, repetitions: 4, nextReview: due }])
    expect(next.every((w, i) => w === words[i])).toBe(true)
  })
})

describe('applySettingsPatch', () => {
  it('merges over the blob, re-parses typed fields and keeps unknown keys', () => {
    const settings = parseSettings({ daily_new_word_limit: 12, learn_picks: ['ser'], some_future_key: { a: 1 } })
    const next = applySettingsPatch(settings, { streak_count: 5, streak_last_activity_date: '2026-10-02' })
    expect(next.streakCount).toBe(5)
    expect(next.streakLastActivityDate).toBe('2026-10-02')
    expect(next.dailyNewWordLimit).toBe(12)
    expect(next.learnPicks).toEqual(['ser'])
    expect(next.raw).toEqual({
      daily_new_word_limit: 12,
      learn_picks: ['ser'],
      some_future_key: { a: 1 },
      streak_count: 5,
      streak_last_activity_date: '2026-10-02',
    })
  })

  it('does not mutate the previous settings', () => {
    const settings = parseSettings({ streak_count: 1 })
    applySettingsPatch(settings, { streak_count: 2 })
    expect(settings.streakCount).toBe(1)
    expect(settings.raw).toEqual({ streak_count: 1 })
  })
})

describe('applyFlagLists (favorites / hidden words recovered in the background)', () => {
  const words = [word('casa', 1), word('Perro', 2), word('gato', 3)]

  it('marks the listed words by key, case-insensitively, and leaves the others and the input untouched', () => {
    const next = applyFlagLists(words, { favorites: ['CASA'], hidden: ['perro', 'orphan'] })
    expect(next.map((w) => [w.esWord, w.isFavorite, w.isHidden])).toEqual([
      ['casa', true, false],
      ['Perro', false, true],
      ['gato', false, false],
    ])
    expect(next[2]).toBe(words[2]) // unchanged words keep their identity
    expect(words.every((w) => !w.isFavorite && !w.isHidden)).toBe(true)
  })

  it('returns the same list when there is nothing to apply, and never un-marks a word', () => {
    expect(applyFlagLists(words, {})).toBe(words)
    expect(applyFlagLists(words, { favorites: [], hidden: [] })).toBe(words)
    const flagged = [word('casa', 1, { isFavorite: true, isHidden: true })]
    expect(applyFlagLists(flagged, { favorites: ['otra'] })[0].isHidden).toBe(true)
    expect(applyFlagLists(flagged, { favorites: ['casa'] })[0]).toBe(flagged[0]) // already flagged: the same word object
  })
})
