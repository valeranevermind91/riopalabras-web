import { describe, expect, it, vi } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { STREAK_CARDS, cardsToday, dayPatch, streakCountedToday } from './daily'
import { nothingDueNow, recordCards } from './dayCards'
import { batchOf, learnSettingsPatch, markKnown, selectLearnBatch, type KnownDeps } from './learn'
import { applyProgressUpdates, applySettingsPatch } from './mutations'
import { recordPracticeCards } from './practice'
import { createRater, rateWord } from './review'
import { parseSettings } from './settings'
import type { SettingsPatch, UserSettings, Word } from './types'

// When a day counts for the streak: 10 cards in any modes, or everything that was available. The streak is written the moment the day first
// qualifies, not at the first activity; the date rule (today / yesterday / a gap) is the old one; existing streaks are not recalculated.

const NOW = new Date(2026, 9, 5, 14, 0)
const TODAY = '2026-10-05'
const YESTERDAY = '2026-10-04'
const due = new Date(2026, 9, 4, 3, 0)
const dueWord = (name: string, over: Partial<Word> = {}) => makeWord(name, { repetitions: 2, interval: 3, nextReview: due, ...over })
const streakKeys = (p: SettingsPatch) => 'streak_count' in p || 'streak_last_activity_date' in p

/** A small app: settings and words that change as events are applied, and every patch the events wrote. */
function app(raw: Record<string, unknown> = {}, initialWords: readonly Word[] = []) {
  let settings: UserSettings = parseSettings({ daily_new_word_limit: 10, streak_count: 4, streak_last_activity_date: YESTERDAY, ...raw })
  let words = initialWords
  const written: SettingsPatch[] = []
  const deps = {
    getSettings: () => settings,
    applySettings: (p: SettingsPatch) => void (settings = applySettingsPatch(settings, p)),
    getWords: () => words,
    queue: { enqueueSettings: (p: SettingsPatch) => void written.push(p) },
  }
  const rater = createRater({
    ...deps,
    applyProgress: (updates) => void (words = applyProgressUpdates(words, updates)),
    queue: { ...deps.queue, enqueueProgress: () => {} },
  })
  return { deps, rater, written, settings: () => settings, words: () => words, streakWrites: () => written.filter(streakKeys) }
}

describe('the bar: 10 cards', () => {
  it('9 cards do not count the day and 10 do', () => {
    const a = app()
    recordCards(a.deps, 9, NOW)
    expect(a.streakWrites()).toEqual([])
    expect(a.settings()).toMatchObject({ cardsDoneTodayCount: 9, streakCount: 4, streakLastActivityDate: YESTERDAY })
    expect(streakCountedToday(a.settings(), NOW)).toBe(false)
    recordCards(a.deps, 1, NOW)
    expect(a.streakWrites()).toEqual([{ cards_done_today_count: 10, cards_done_today_date: TODAY, streak_count: 5, streak_last_activity_date: TODAY }])
    expect(streakCountedToday(a.settings(), NOW)).toBe(true)
    expect(STREAK_CARDS).toBe(10)
  })

  it('the streak is written at the moment the day first qualifies, not at the first activity: until then only the card counter is written', () => {
    const a = app()
    for (let i = 0; i < 9; i++) recordCards(a.deps, 1, NOW)
    expect(a.written).toHaveLength(9)
    for (const patch of a.written) expect(Object.keys(patch).sort()).toEqual(['cards_done_today_count', 'cards_done_today_date'])
  })

  it('a mixed ten across all four modes counts: Learn, Review, Matching and Cloze each add their cards', () => {
    const a = app({}, [dueWord('a'), dueWord('b'), dueWord('c'), dueWord('later1', { nextReview: new Date(2026, 9, 9) })])
    // Learn: a batch of two words finished
    const learnBatch = batchOf([makeWord('n1', { rank: 1 }), makeWord('n2', { rank: 2 })])
    a.deps.applySettings(learnSettingsPatch(a.settings(), learnBatch, NOW, nothingDueNow(a.deps.getWords, NOW)))
    expect(a.settings().cardsDoneTodayCount).toBe(2)
    // Review: three ratings
    for (const name of ['a', 'b', 'c']) a.rater(a.words().find((w) => w.esWord === name)!, 3, NOW)
    expect(a.settings().cardsDoneTodayCount).toBe(5)
    // Matching: three matched pairs
    recordPracticeCards({ ...a.deps, metrics: null }, 3, NOW)
    expect(a.settings().cardsDoneTodayCount).toBe(8)
    // Cloze: two answered questions, the last one makes ten
    recordPracticeCards({ ...a.deps, metrics: null }, 1, NOW)
    expect(a.settings().streakLastActivityDate).toBe(YESTERDAY) // nine so far
    recordPracticeCards({ ...a.deps, metrics: null }, 1, NOW)
    expect(a.settings()).toMatchObject({ cardsDoneTodayCount: 10, streakCount: 5, streakLastActivityDate: TODAY })
  })

  it('once the day counts, nothing more is written for it: no counter, no streak', () => {
    const a = app()
    recordCards(a.deps, 10, NOW)
    const writes = a.written.length
    for (let i = 0; i < 30; i++) recordCards(a.deps, 1, NOW)
    expect(a.written).toHaveLength(writes)
    expect(dayPatch(a.settings(), NOW, { cards: 5, nothingDue: true })).toBeNull()
  })
})

describe('the light day: everything that was available was done', () => {
  it('the goal reached and nothing due counts a day with fewer than 10 cards: three due words, the goal met, the last one rated', () => {
    const a = app({ daily_new_word_limit: 5, new_words_learned_today_count: 5, new_words_learned_today_date: TODAY }, [dueWord('a'), dueWord('b'), dueWord('c')])
    const get = (name: string) => a.words().find((w) => w.esWord === name)!
    a.rater(get('a'), 3, NOW)
    a.rater(get('b'), 3, NOW)
    expect(a.streakWrites()).toEqual([]) // one review is still due
    a.rater(get('c'), 3, NOW) // the third: nothing is due
    expect(a.streakWrites()).toEqual([expect.objectContaining({ cards_done_today_count: 3, streak_count: 5, streak_last_activity_date: TODAY })])
  })

  it('a Learn batch that reaches the goal with no review due counts the day', () => {
    const a = app({ daily_new_word_limit: 3 })
    const batch = batchOf([makeWord('n1'), makeWord('n2'), makeWord('n3')])
    expect(learnSettingsPatch(a.settings(), batch, NOW, true)).toMatchObject({ cards_done_today_count: 3, streak_count: 5 })
    expect(learnSettingsPatch(a.settings(), batch, NOW, false)).not.toHaveProperty('streak_count') // a review is still due
  })

  it('the goal NOT reached does not count the day, even with nothing due', () => {
    const a = app({ daily_new_word_limit: 10 }, [dueWord('a')])
    a.rater(a.words()[0], 3, NOW) // the only due word: nothing due now, but 0 of 10 new words learned
    expect(a.streakWrites()).toEqual([])
    expect(a.settings().cardsDoneTodayCount).toBe(1)
  })

  it('the goal reached but a review still due does not count the day', () => {
    const a = app({ daily_new_word_limit: 5, new_words_learned_today_count: 5, new_words_learned_today_date: TODAY }, [dueWord('a'), dueWord('b'), dueWord('c')])
    a.rater(a.words()[0], 3, NOW)
    a.rater(a.words()[1], 3, NOW)
    expect(a.streakWrites()).toEqual([])
  })

  it('a day with nothing done is not "everything done": no cards, no light-day count (the goal is 0 and nothing is due)', () => {
    const a = app({ daily_new_word_limit: 0 })
    expect(recordCards(a.deps, 0, NOW)).toBe(false)
    expect(a.written).toEqual([])
    expect(dayPatch(a.settings(), NOW, { cards: 0, nothingDue: true })).toBeNull()
  })

  it('without the words (getWords absent) the light day cannot hold: only the ten-card half counts', () => {
    const a = app({ daily_new_word_limit: 1, new_words_learned_today_count: 1, new_words_learned_today_date: TODAY })
    const deps = { ...a.deps, getWords: undefined }
    recordCards(deps, 3, NOW)
    expect(a.streakWrites()).toEqual([])
    expect(nothingDueNow(undefined, NOW)).toBe(false)
  })
})

describe('what is a card', () => {
  it('a word rated Again and then Good is one card, not two (the repeat is not counted)', () => {
    const a = app({}, [dueWord('a')])
    const word = a.words()[0]
    const first = a.rater(word, 1, NOW) // Again: counted
    const repeat = { ...word, easeFactor: first.easeFactor, repetitions: first.repetitions, interval: first.interval, nextReview: first.nextReview }
    a.rater(repeat, 3, NOW, false) // the re-queued copy, rated Good: the same card
    expect(a.settings().cardsDoneTodayCount).toBe(1)
    // both ratings were applied all the same: the word ended up scheduled as rated Good, from the lowered ease
    expect(a.words()[0].repetitions).toBe(2)
  })

  it('a rating that is not a repeat counts: counted defaults to true', () => {
    const a = app({}, [dueWord('a'), dueWord('b')])
    a.rater(a.words()[0], 3, NOW)
    a.rater(a.words()[1], 3, NOW)
    expect(a.settings().cardsDoneTodayCount).toBe(2)
  })

  it('"Already know it" in Learn is not a card: the words marked as known are not counted, only the batch that was finished', () => {
    const pool = Array.from({ length: 10 }, (_, i) => makeWord(`w${i + 1}`, { rank: i + 1 })) // exactly ten: nothing can take a marked word's place
    const a = app()
    let batch = selectLearnBatch(pool, a.settings(), NOW)
    expect(batch.words).toHaveLength(10)
    const known: KnownDeps = { queue: { enqueueHidden: vi.fn(), enqueueSettings: vi.fn() }, applyHidden: vi.fn(), getSettings: a.deps.getSettings, applySettings: a.deps.applySettings }
    for (let i = 0; i < 3; i++) batch = markKnown(batch, 0, known)
    expect(batch.words).toHaveLength(7)
    // marking a word as known writes nothing toward the streak
    expect(known.queue.enqueueSettings).not.toHaveBeenCalled()
    expect(a.settings().cardsDoneTodayCount).toBe(0)
    // finishing the seven counts seven cards: not ten, and not thirteen
    const patch = learnSettingsPatch(a.settings(), batch, NOW)
    expect(patch).toMatchObject({ cards_done_today_count: 7 })
    expect(patch).not.toHaveProperty('streak_count')
  })

  it('a Cloze question that was given up on is not a card (recordPracticeCards with 0 changes nothing)', () => {
    const a = app()
    expect(recordCards(a.deps, 0, NOW)).toBe(false)
    expect(a.written).toEqual([])
  })
})

describe('the date rule is unchanged, and so are existing streaks', () => {
  it('last day today: nothing; yesterday: the count goes up; a gap, or never: it starts again at 1', () => {
    const qualify = (raw: Record<string, unknown>) => dayPatch(parseSettings({ daily_new_word_limit: 10, streak_count: 6, ...raw }), NOW, { cards: 10, nothingDue: false })
    expect(qualify({ streak_last_activity_date: TODAY })).toBeNull()
    expect(qualify({ streak_last_activity_date: YESTERDAY })).toMatchObject({ streak_count: 7, streak_last_activity_date: TODAY })
    expect(qualify({ streak_last_activity_date: '2026-10-02' })).toMatchObject({ streak_count: 1, streak_last_activity_date: TODAY })
    expect(qualify({})).toMatchObject({ streak_count: 1, streak_last_activity_date: TODAY })
  })

  it('an existing streak is not touched by the new rule: below the bar, streak_count and its date stay exactly as stored', () => {
    const a = app({ streak_count: 37, streak_last_activity_date: YESTERDAY })
    recordCards(a.deps, 9, NOW)
    expect(a.settings()).toMatchObject({ streakCount: 37, streakLastActivityDate: YESTERDAY })
    for (const patch of a.written) expect(streakKeys(patch)).toBe(false)
  })

  it('a day already counted under the old rule (one rating, earlier today) is left alone: nothing written, the count not reset', () => {
    const a = app({ streak_count: 12, streak_last_activity_date: TODAY })
    recordCards(a.deps, 3, NOW)
    expect(a.written).toEqual([])
    expect(a.settings()).toMatchObject({ streakCount: 12, streakLastActivityDate: TODAY })
  })

  it('the counter belongs to its day: yesterday\'s cards do not carry into today', () => {
    const a = app({ cards_done_today_count: 9, cards_done_today_date: YESTERDAY })
    expect(cardsToday(a.settings(), NOW)).toBe(0)
    recordCards(a.deps, 1, NOW)
    expect(a.streakWrites()).toEqual([]) // 1 card today, not 10
    expect(a.settings().cardsDoneTodayCount).toBe(1)
  })

  it('rateWord is untouched: the rating itself does not depend on the streak', () => {
    expect(rateWord(dueWord('a'), 3, NOW).repetitions).toBe(3)
  })
})
