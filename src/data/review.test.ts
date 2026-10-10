import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '../testing/fakeSupabase'
import { makeWord } from '../testing/makeWord'
import { parseDictionary } from './dictionary'
import { applyProgressUpdates, applySettingsPatch } from './mutations'
import { REVIEW_SESSION_CEILING, REVIEW_SESSION_SIZE, buildReviewSession, createRater, dueWords, overdueMs, rateWord, requeueAgain, shuffle, withUpdate } from './review'
import { seededRandom } from '../lib/random'
import { selectLearnBatch } from './learn'
import { parseSettings } from './settings'
import { computeRemainingToday, computeStats, getLearnPool, isReviewDue, nextDueWithin } from './stats'
import type { ProgressUpdate, SettingsPatch, Word } from './types'
import { createSupabaseWriteQueue, createWriteQueue } from './writeQueue'

const NOW = new Date('2026-10-05T15:00:00.000Z')
const past = new Date('2026-10-04T03:00:00.000Z')
const future = new Date('2026-10-06T03:00:00.000Z')
const learned = (esWord: string, overrides: Partial<Word> = {}) =>
  makeWord(esWord, { repetitions: 1, nextReview: past, ...overrides })

describe('buildReviewSession: which words are due', () => {
  it('includes learned words whose review time has arrived', () => {
    const session = buildReviewSession([learned('a'), learned('b', { repetitions: 4, interval: 9 })], NOW)
    expect(session.map((w) => w.esWord).sort()).toEqual(['a', 'b'])
  })

  it('counts a null nextReview as due, and the exact boundary instant as due', () => {
    const session = buildReviewSession([learned('null', { nextReview: null }), learned('edge', { nextReview: NOW })], NOW)
    expect(session.map((w) => w.esWord).sort()).toEqual(['edge', 'null'])
  })

  it.each([
    ['not yet due', { nextReview: future }],
    ['never learned', { repetitions: 0 }],
    ['hidden', { isHidden: true }],
    ['a non-reviewable part of speech', { pos: 'prep' }],
    ['missing the English translation', { enTranslation: '' }],
    ['missing the Russian translation', { ruTranslation: '   ' }],
    ['not enriched', { isEnriched: false }],
  ] as [string, Partial<Word>][])('excludes a word that is %s', (_label, overrides) => {
    expect(buildReviewSession([learned('x', overrides)], NOW)).toHaveLength(0)
  })

  it('takes at most 20 of a long backlog (the session limit; the rest wait for the next session)', () => {
    const many = Array.from({ length: 700 }, (_, i) => learned(`w${i}`))
    expect(buildReviewSession(many, NOW)).toHaveLength(20)
  })

  it('agrees with the due definition used for the Home count', () => {
    const words = [learned('a'), learned('b', { nextReview: future }), makeWord('c'), learned('d', { isHidden: true })]
    expect(buildReviewSession(words, NOW).map((w) => w.esWord)).toEqual(words.filter((w) => isReviewDue(w, NOW)).map((w) => w.esWord))
  })
})

describe('shuffle', () => {
  const items = Array.from({ length: 50 }, (_, i) => i)

  it('returns a permutation: nothing lost, nothing duplicated', () => {
    for (const random of [Math.random, () => 0, () => 0.999999, () => 0.5]) {
      const out = shuffle(items, random)
      expect(out).toHaveLength(items.length)
      expect([...out].sort((a, b) => a - b)).toEqual(items)
    }
  })

  it('is Fisher–Yates: a pinned random source gives the known permutation', () => {
    expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1])
    expect(shuffle([1, 2, 3, 4], () => 0.999999)).toEqual([1, 2, 3, 4])
  })

  it('actually reorders, and does not touch its input', () => {
    const input = [...items]
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const out = shuffle(input, random)
    expect(out).not.toEqual(items)
    expect(input).toEqual(items)
  })

  it('handles empty and single-element lists', () => {
    expect(shuffle([])).toEqual([])
    expect(shuffle([1])).toEqual([1])
  })
})

describe('buildReviewSession: snapshot', () => {
  it('is not refreshed mid-session: rating words (or changing the store) never alters it', () => {
    const words = [learned('a'), learned('b'), learned('c')]
    const session = buildReviewSession(words, NOW)
    const before = session.map((w) => `${w.esWord}:${w.repetitions}`)

    // The store moves on: a is rated Again, b rated Good, a brand-new word becomes due.
    const after = applyProgressUpdates([...words, learned('d')], [rateWord(words[0], 1, NOW), rateWord(words[1], 3, NOW)])

    expect(session.map((w) => `${w.esWord}:${w.repetitions}`)).toEqual(before)
    expect(session).toHaveLength(3)
    expect(after.find((w) => w.esWord === 'a')?.repetitions).toBe(1) // rated Again: relearning, not back to new
    expect(buildReviewSession(after, NOW)).not.toHaveLength(3) // a fresh build ("Refresh") does see the change
  })

  it('is frozen and independent of the input array', () => {
    const words = [learned('a'), learned('b')]
    const session = buildReviewSession(words, NOW)
    expect(Object.isFrozen(session)).toBe(true)
    words.pop()
    expect(session).toHaveLength(2)
  })
})

describe('rateWord: exact result of each rating on a just-learned word', () => {
  const justLearned = learned('Hacienda', { easeFactor: 2.5, interval: 0, repetitions: 1, nextReview: past })
  const day = 24 * 60 * 60 * 1000

  it('Again: repetitions 1, interval 0, ease lowered, due in ten minutes', () => {
    const u = rateWord(justLearned, 1, NOW)
    expect(u).toMatchObject({ esWord: 'Hacienda', interval: 0, repetitions: 1 })
    expect(u.easeFactor).toBeCloseTo(2.18, 10)
    expect(u.nextReview.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000)
  })

  it('Hard: 1 day', () => {
    const u = rateWord(justLearned, 2, NOW)
    expect(u).toMatchObject({ interval: 1, repetitions: 2 })
    expect(u.easeFactor).toBeCloseTo(2.36, 10)
    expect(u.nextReview.getTime()).toBe(NOW.getTime() + day)
  })

  it('Good: 3 days, ease unchanged', () => {
    const u = rateWord(justLearned, 3, NOW)
    expect(u).toMatchObject({ interval: 3, repetitions: 2, easeFactor: 2.5 })
    expect(u.nextReview.getTime()).toBe(NOW.getTime() + 3 * day)
  })

  it('Easy: 3 days, ease raised', () => {
    const u = rateWord(justLearned, 4, NOW)
    expect(u).toMatchObject({ interval: 3, repetitions: 2 })
    expect(u.easeFactor).toBeCloseTo(2.6, 10)
    expect(u.nextReview.getTime()).toBe(NOW.getTime() + 3 * day)
  })

  it('Again floors the ease factor at 1.3', () => {
    const u = rateWord(learned('x', { easeFactor: 1.3, interval: 20, repetitions: 6 }), 1, NOW)
    expect(u.easeFactor).toBe(1.3)
    expect(u).toMatchObject({ interval: 0, repetitions: 1 })
  })

  it('keeps the word\'s original dictionary casing', () => {
    expect(rateWord(learned('Hacienda'), 3, NOW).esWord).toBe('Hacienda')
  })

  it('"Again" keeps the word out of the Learn pool: not due for ten minutes, due after, and never new', () => {
    const word = learned('a')
    const [after] = applyProgressUpdates([word], [rateWord(word, 1, NOW)])
    expect(isReviewDue(after, NOW)).toBe(false)
    expect(isReviewDue(after, new Date(NOW.getTime() + 10 * 60 * 1000 - 1))).toBe(false)
    expect(isReviewDue(after, new Date(NOW.getTime() + 10 * 60 * 1000))).toBe(true) // due again at ten minutes
    expect(getLearnPool([after])).toHaveLength(0)
    expect(after.repetitions).toBe(1)
  })

  it('Good/Easy/Hard keep the word learned and schedule it into the future', () => {
    for (const q of [2, 3, 4]) {
      const word = learned('a')
      const [after] = applyProgressUpdates([word], [rateWord(word, q, NOW)])
      expect(after.repetitions).toBe(2)
      expect(isReviewDue(after, NOW)).toBe(false)
      expect(getLearnPool([after])).toHaveLength(0)
    }
  })
})

describe('the exact user_progress rows the four ratings send', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the documented columns, original casing and UTC timestamps for each rating', async () => {
    const expected: Record<number, { ease: number; interval: number; reps: number; next: string }> = {
      1: { ease: 2.18, interval: 0, reps: 1, next: '2026-10-05T15:10:00.000Z' },
      2: { ease: 2.36, interval: 1, reps: 2, next: '2026-10-06T15:00:00.000Z' },
      3: { ease: 2.5, interval: 3, reps: 2, next: '2026-10-08T15:00:00.000Z' },
      4: { ease: 2.6, interval: 3, reps: 2, next: '2026-10-08T15:00:00.000Z' },
    }

    for (const q of [1, 2, 3, 4]) {
      const fake = fakeSupabase()
      const settings = parseSettings({ streak_count: 1, streak_last_activity_date: '2026-10-05' })
      const queue = createSupabaseWriteQueue(fake.client, 'user-1', () => settings)
      const rate = createRater({ applyProgress: () => {}, applySettings: () => {}, getSettings: () => settings, queue })

      rate(learned('Hacienda'), q, NOW)
      await queue.flush()

      expect(fake.calls).toHaveLength(1) // streak already recorded today → no settings write
      const [call] = fake.calls
      expect(call.table).toBe('user_progress')
      expect(call.options).toEqual({ onConflict: 'user_id,es_word' })
      const [row] = call.rows as Record<string, unknown>[]
      const e = expected[q]
      expect(row).toMatchObject({
        user_id: 'user-1',
        es_word: 'Hacienda',
        interval_days: e.interval,
        repetitions: e.reps,
        next_review: e.next,
        updated_at: '2026-10-05T15:00:00.000Z',
      })
      expect(row.ease_factor).toBeCloseTo(e.ease, 10)
    }
  })
})

describe('createRater', () => {
  function setup(rawSettings: Record<string, unknown>) {
    let settings = parseSettings(rawSettings)
    const applied: ProgressUpdate[] = []
    const progress: ProgressUpdate[] = []
    const patches: SettingsPatch[] = []
    const queue = {
      enqueueProgress: (u: ProgressUpdate) => progress.push(u),
      enqueueSettings: (p: SettingsPatch) => patches.push(p),
    }
    const rater = () =>
      createRater({
        applyProgress: (updates) => applied.push(...updates),
        applySettings: (patch) => {
          settings = applySettingsPatch(settings, patch)
        },
        getSettings: () => settings,
        queue,
      })
    return { rater, applied, progress, patches, getSettings: () => settings }
  }

  it('applies the rating to the store and queues the write — the same update, immediately', () => {
    const s = setup({ streak_last_activity_date: '2026-10-05', streak_count: 2 })
    const update = s.rater()(learned('a'), 3, NOW)
    expect(s.applied).toEqual([update])
    expect(s.progress).toEqual([update])
  })

  it('writes the streak once for the first rating of the day, not once per card', () => {
    const s = setup({ streak_count: 4, streak_last_activity_date: '2026-10-04' })
    const rate = s.rater()
    for (let i = 0; i < 25; i++) rate(learned(`w${i}`), 3, NOW)

    expect(s.progress).toHaveLength(25)
    expect(s.patches).toEqual([{ streak_count: 5, streak_last_activity_date: localDay(NOW) }])
    expect(s.getSettings().streakCount).toBe(5)
  })

  it('a second session on the same day writes nothing more', () => {
    const s = setup({ streak_count: 4, streak_last_activity_date: '2026-10-04' })
    s.rater()(learned('a'), 3, NOW)
    s.rater()(learned('b'), 3, NOW)
    expect(s.patches).toHaveLength(1)
  })

  it('starts the streak at 1 after a gap, and writes again on a new day', () => {
    const s = setup({ streak_count: 9, streak_last_activity_date: '2026-09-20' })
    const rate = s.rater()
    rate(learned('a'), 3, NOW)
    expect(s.patches[0]).toMatchObject({ streak_count: 1 })

    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
    rate(learned('b'), 3, tomorrow)
    expect(s.patches).toHaveLength(2)
    expect(s.patches[1]).toMatchObject({ streak_count: 2 })
  })

  it('uses the LOCAL day: 23:30 and 00:30 local are different streak days', () => {
    const s = setup({ streak_count: 3, streak_last_activity_date: '2026-10-04' })
    const rate = s.rater()
    rate(learned('a'), 3, new Date(2026, 9, 5, 23, 30))
    rate(learned('b'), 3, new Date(2026, 9, 5, 23, 59))
    expect(s.patches).toHaveLength(1)
    rate(learned('c'), 3, new Date(2026, 9, 6, 0, 30))
    expect(s.patches).toHaveLength(2)
  })

  it('goes through a real queue: ratings and one streak write reach the server, once each', async () => {
    const fake = fakeSupabase()
    let settings = parseSettings({ streak_count: 4, streak_last_activity_date: '2026-10-04', learn_picks: ['ser'] })
    const queue = createSupabaseWriteQueue(fake.client, 'user-1', () => settings)
    const rate = createRater({
      applyProgress: () => {},
      applySettings: (patch) => {
        settings = applySettingsPatch(settings, patch)
      },
      getSettings: () => settings,
      queue,
    })
    for (let i = 0; i < 12; i++) rate(learned(`w${i}`), 3, NOW)
    await queue.flush()

    const progressRows = fake.calls.filter((c) => c.table === 'user_progress').flatMap((c) => c.rows as unknown[])
    expect(progressRows).toHaveLength(12)
    const settingsWrites = fake.calls.filter((c) => c.table === 'user_settings')
    expect(settingsWrites).toHaveLength(1)
    expect((settingsWrites[0].rows as { settings: Record<string, unknown> }).settings).toMatchObject({
      streak_count: 5,
      learn_picks: ['ser'],
    })
  })

  it('updates the store before any request completes (optimistic)', () => {
    const sent: ProgressUpdate[][] = []
    const never = new Promise<void>(() => {})
    const queue = createWriteQueue({ sendProgress: (u) => (sent.push([...u]), never), sendSettings: () => never })
    const applied: ProgressUpdate[] = []
    const rate = createRater({
      applyProgress: (u) => applied.push(...u),
      applySettings: () => {},
      getSettings: () => parseSettings({ streak_last_activity_date: '2026-10-05', streak_count: 1 }),
      queue,
    })
    rate(learned('a'), 3, NOW)
    expect(applied).toHaveLength(1)
    expect(queue.getStatus().unsaved).toBe(true) // still not saved, yet the UI can already move on
  })
})

describe('with the real dictionary', () => {
  const dictionary = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')))

  it('a word learned yesterday is due today, minus function words that are never reviewed', () => {
    const NON_REVIEWABLE = new Set(['art', 'prep', 'conj', 'contraction', 'determiner', 'pron'])
    const firstTwenty = dictionary.slice(0, 20)
    const yesterdayLearned = firstTwenty.map((w) => Object.freeze({ ...w, repetitions: 1, nextReview: past }))
    const session = buildReviewSession([...yesterdayLearned, ...dictionary.slice(20)], NOW)

    const expected = firstTwenty.filter((w) => !NON_REVIEWABLE.has(w.pos)).map((w) => w.esWord)
    expect(expected.length).toBeLessThan(20) // the dictionary's top words really do include function words
    expect(session.map((w) => w.esWord).sort()).toEqual([...expected].sort())
  })
})

function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

describe('an Again re-queues the word at the end of the session', () => {
  const cards = (...names: string[]) => names.map((n) => learned(n))
  const order = (session: readonly Word[]) => session.map((w) => w.esWord)
  const rated = (word: Word, quality = 1) => withUpdate(word, rateWord(word, quality, NOW))

  it('the word, as the rating left it, goes to the very end', () => {
    const session = cards('a', 'b', 'c', 'd', 'e')
    const next = requeueAgain(session, 1, rated(session[1])) // Again on b
    expect(order(next)).toEqual(['a', 'b', 'c', 'd', 'e', 'b'])
    const copy = next[next.length - 1]
    expect(copy).toMatchObject({ repetitions: 1, interval: 0 }) // the state the rating wrote
    expect(copy.easeFactor).toBeCloseTo(2.18, 10) // and its lowered ease, not the snapshot's 2.5
    expect(copy.nextReview?.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000)
    expect(order(session)).toEqual(['a', 'b', 'c', 'd', 'e']) // the session it was given is untouched
    expect(Object.isFrozen(next)).toBe(true)
  })

  it('with fewer than three cards left (or none) it is last anyway', () => {
    const session = cards('a', 'b', 'c', 'd')
    expect(order(requeueAgain(session, 3, rated(session[3])))).toEqual(['a', 'b', 'c', 'd', 'd']) // the last card: the session goes on
    expect(order(requeueAgain(session, 2, rated(session[2])))).toEqual(['a', 'b', 'c', 'd', 'c']) // one card left
    expect(order(requeueAgain(cards('only'), 0, rated(learned('only'))))).toEqual(['only', 'only'])
  })

  it('a second Again on the copy sends it to the end again: it is never in the queue twice', () => {
    const session = cards('a', 'b', 'c')
    let now = requeueAgain(session, 0, rated(session[0])) // a b c a'
    expect(order(now)).toEqual(['a', 'b', 'c', 'a'])
    // b and c are rated Good, nothing is re-queued; then the copy is rated Again
    now = requeueAgain(now, 3, rated(now[3]))
    expect(order(now)).toEqual(['a', 'b', 'c', 'a', 'a']) // the copy at 3 was consumed, one new copy is waiting after it
    expect(order(now).slice(4).filter((n) => n === 'a')).toHaveLength(1) // exactly one copy still to come
    // and the ease keeps dropping from the lowered value, not from the snapshot's
    expect(now[4].easeFactor).toBeLessThan(now[3].easeFactor)
    expect(now[3].easeFactor).toBeLessThan(2.5)
  })

  it('a copy still waiting behind the card is dropped first, so copies cannot pile up', () => {
    const session = [...cards('a', 'b'), learned('a')] // a stray later copy of a
    const next = requeueAgain(session, 0, rated(session[0]))
    expect(order(next)).toEqual(['a', 'b', 'a']) // the stray one went; one new copy at the end
  })

  it('the ease floors at 1.3 however often it is Again', () => {
    let session: readonly Word[] = cards('a', 'b')
    let index = 0
    for (let i = 0; i < 12; i++) {
      session = requeueAgain(session, index, rated(session[index]))
      index = session.length - 1 // the copy is the next card that matters
    }
    expect(session[session.length - 1].easeFactor).toBe(1.3)
    expect(session.filter((w) => w.esWord === 'a').length).toBeGreaterThan(1) // earlier copies are behind us, one is ahead
  })

  it('only Again re-queues: nothing here is called for the other ratings', () => {
    // the screen asks isAgain first; the helper itself always re-queues, so this is the contract: Hard/Good/Easy leave the word in the past
    for (const q of [2, 3, 4]) expect(rateWord(learned('a'), q, NOW).repetitions).toBe(2)
  })
})

describe('a word rated Again stays out of Learn and takes no new-word slot', () => {
  const pool = Array.from({ length: 30 }, (_, i) => makeWord(`palabra${String(i + 1).padStart(2, '0')}`, { rank: i + 1 }))
  const due = learned('vieja', { rank: 99, easeFactor: 2.5, interval: 5, repetitions: 3 })
  const settings = parseSettings({ daily_new_word_limit: 10 })

  function rateAgain(words: readonly Word[], word: Word) {
    const patches: SettingsPatch[] = []
    const queued: ProgressUpdate[] = []
    let current = words
    const rate = createRater({
      applyProgress: (updates) => void (current = applyProgressUpdates(current, updates)),
      applySettings: (p) => void patches.push(p),
      getSettings: () => settings,
      queue: { enqueueProgress: (u) => void queued.push(u), enqueueSettings: (p) => void patches.push(p) },
    })
    const update = rate(word, 1, NOW)
    return { words: current, update, patches, queued }
  }

  it('it writes the new triple through the rater: repetitions 1, interval 0, due in ten minutes, the lowered ease', () => {
    const { update, queued } = rateAgain([...pool, due], due)
    expect(update).toMatchObject({ esWord: 'vieja', interval: 0, repetitions: 1 })
    expect(update.easeFactor).toBeCloseTo(2.18, 10)
    expect(update.nextReview.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000)
    expect(queued).toEqual([update])
  })

  it('it is not in the Learn pool afterwards, and the pool is the size it was', () => {
    const before = [...pool, due]
    const { words } = rateAgain(before, due)
    expect(getLearnPool(words).map((w) => w.esWord)).not.toContain('vieja')
    expect(getLearnPool(words)).toHaveLength(getLearnPool(before).length)
    expect(computeStats(words, settings, NOW).learnPool).toBe(30)
  })

  it('it takes no slot of the day: the rating writes nothing to the new-word counter, and Learn offers the same ten', () => {
    const before = [...pool, due]
    const { words, patches } = rateAgain(before, due)
    for (const patch of patches) expect(Object.keys(patch).some((k) => k.startsWith('new_words'))).toBe(false)
    expect(computeRemainingToday(settings, NOW)).toBe(10)
    const batch = selectLearnBatch(words, settings, NOW)
    expect(batch.words).toHaveLength(10)
    expect(batch.words.map((w) => w.esWord)).not.toContain('vieja')
    expect(batch.newCount).toBe(10) // all ten are new words; the lapsed one is not among them
  })

  it('and it is due again after ten minutes, in Review', () => {
    const { words } = rateAgain([...pool, due], due)
    const later = new Date(NOW.getTime() + 10 * 60 * 1000)
    expect(buildReviewSession(words, NOW).map((w) => w.esWord)).not.toContain('vieja')
    expect(buildReviewSession(words, later).map((w) => w.esWord)).toEqual(['vieja'])
  })
})

describe('when the next word comes due', () => {
  const minutes = (m: number) => new Date(NOW.getTime() + m * 60 * 1000)
  const words = [learned('now', { nextReview: NOW }), learned('soon', { nextReview: minutes(4) }), learned('later', { nextReview: minutes(8) }), learned('far', { nextReview: minutes(60) }), learned('hidden', { nextReview: minutes(1), isHidden: true }), makeWord('new', { repetitions: 0, nextReview: minutes(2) })]

  it('is the earliest word that is not due yet and is within the window', () => {
    expect(nextDueWithin(words, NOW, 10 * 60 * 1000)).toEqual(minutes(4)) // not the due one, the far one, the hidden one or the never-learned one
  })

  it('is null when nothing is that close', () => {
    expect(nextDueWithin([learned('far', { nextReview: minutes(60) })], NOW, 10 * 60 * 1000)).toBeNull()
    expect(nextDueWithin([], NOW, 10 * 60 * 1000)).toBeNull()
  })

  it('the Review count does not hold a word until it is due, and counts it from that moment', () => {
    const lapsed = learned('a', { interval: 0, repetitions: 1, nextReview: minutes(10) })
    expect(computeStats([lapsed], parseSettings({}), NOW).reviewDue).toBe(0)
    expect(computeStats([lapsed], parseSettings({}), minutes(10)).reviewDue).toBe(1)
  })
})

describe('the session limit', () => {
  const HOUR = 3_600_000
  const name = (i: number) => `w${String(i).padStart(2, '0')}`
  /** n due words, w01 … : the nth is n hours overdue, so the higher the number the longer it has waited. */
  const backlog = (n: number): Word[] => Array.from({ length: n }, (_, k) => learned(name(k + 1), { rank: k + 1, nextReview: new Date(NOW.getTime() - (k + 1) * HOUR) }))
  const numberOf = (w: Word) => Number(w.esWord.slice(1))
  const overdueOrder = (words: readonly Word[]) => [...words].sort((a, b) => numberOf(b) - numberOf(a)).map((w) => w.esWord)

  /** What the Review screen does with a session: rate each card in turn, an Again re-queuing the word. Returns how many cards were shown. */
  function play(session: readonly Word[], quality: number, words?: { current: readonly Word[] }) {
    let cards = session
    let shown = 0
    for (let i = 0; i < cards.length; i++) {
      shown++
      const word = cards[i]
      const update = rateWord(word, quality, NOW)
      if (words) words.current = applyProgressUpdates(words.current, [update])
      if (quality === 1) cards = requeueAgain(cards, i, withUpdate(word, update))
    }
    return { shown, cards }
  }

  it('the numbers: 20 words a session, at most 40 cards', () => {
    expect(REVIEW_SESSION_SIZE).toBe(20)
    expect(REVIEW_SESSION_CEILING).toBe(40)
  })

  it('a backlog of 50 gives sessions of 20, 20 and 10', () => {
    const words = { current: backlog(50) as readonly Word[] }
    const sizes: number[] = []
    for (let n = 0; n < 5; n++) {
      const session = buildReviewSession(words.current, NOW)
      if (session.length === 0) break
      sizes.push(session.length)
      play(session, 3, words) // all rated Good: out of the due list
    }
    expect(sizes).toEqual([20, 20, 10])
    expect(dueWords(words.current, NOW)).toHaveLength(0)
  })

  it('the 20 chosen are the 20 most overdue, and then the next 20, and the last 10', () => {
    const words = { current: backlog(50) as readonly Word[] }
    const chosen: string[][] = []
    for (let n = 0; n < 3; n++) {
      const session = buildReviewSession(words.current, NOW)
      chosen.push(session.map((w) => w.esWord).sort())
      play(session, 3, words)
    }
    expect(chosen[0]).toEqual(Array.from({ length: 20 }, (_, k) => name(31 + k))) // w31 … w50
    expect(chosen[1]).toEqual(Array.from({ length: 20 }, (_, k) => name(11 + k)))
    expect(chosen[2]).toEqual(Array.from({ length: 10 }, (_, k) => name(1 + k)))
  })

  it('overdue is measured from next_review: a word long past its date beats one just due, whatever its stage or ease', () => {
    const words = [
      learned('recent', { nextReview: new Date(NOW.getTime() - HOUR), repetitions: 1 }),
      learned('longAgo', { nextReview: new Date(NOW.getTime() - 90 * 24 * HOUR), repetitions: 6, interval: 40, easeFactor: 1.3 }),
      ...Array.from({ length: 19 }, (_, k) => learned(`mid${k}`, { nextReview: new Date(NOW.getTime() - (k + 2) * HOUR) })),
    ]
    const session = buildReviewSession(words, NOW).map((w) => w.esWord)
    expect(session).toContain('longAgo')
    expect(session).not.toContain('recent') // the least overdue of 21 is the one left out
    expect(overdueMs(words[1], NOW)).toBe(90 * 24 * HOUR)
    expect(overdueMs(learned('none', { nextReview: null }), NOW)).toBe(0) // no date to measure: counts as just due
  })

  it('their order is shuffled, not strictly by overdue-ness', () => {
    const words = backlog(50)
    const orders = Array.from({ length: 30 }, (_, seed) => buildReviewSession(words, NOW, seededRandom(seed + 1)).map((w) => w.esWord))
    for (const order of orders) expect(order).not.toEqual(overdueOrder(buildReviewSession(words, NOW))) // never the sorted order
    expect(new Set(orders.map((o) => o.join())).size).toBeGreaterThan(25) // and it differs from session to session
    for (const order of orders) expect([...order].sort()).toEqual(Array.from({ length: 20 }, (_, k) => name(31 + k))) // the same 20 whatever the shuffle
    // the most overdue word is not always first
    expect(new Set(orders.map((o) => o[0])).size).toBeGreaterThan(5)
  })

  it('words equally overdue (a Learn batch is due all at once) are told apart at random, not by their place in the dictionary', () => {
    const same = Array.from({ length: 30 }, (_, k) => learned(name(k + 1), { rank: k + 1, nextReview: new Date(NOW.getTime() - HOUR) }))
    const firstTwenty = same.slice(0, 20).map((w) => w.esWord).sort()
    const picks = Array.from({ length: 20 }, (_, seed) => buildReviewSession(same, NOW, seededRandom(seed + 1)).map((w) => w.esWord).sort())
    expect(picks.some((p) => p.join() !== firstTwenty.join())).toBe(true)
    for (const p of picks) expect(new Set(p).size).toBe(20)
  })

  it('a backlog of fewer than 20 is every due word, as it always was', () => {
    for (const n of [1, 7, 19, 20]) {
      const words = backlog(n)
      const session = buildReviewSession(words, NOW, seededRandom(3))
      expect(session.map((w) => w.esWord).sort()).toEqual(words.map((w) => w.esWord).sort())
      expect(Object.isFrozen(session)).toBe(true)
    }
    expect(buildReviewSession([], NOW)).toHaveLength(0)
    const twelve = backlog(12)
    const orders = new Set(Array.from({ length: 20 }, (_, seed) => buildReviewSession(twelve, NOW, seededRandom(seed + 1)).map((w) => w.esWord).join()))
    expect(orders.size).toBeGreaterThan(10) // still shuffled
  })

  it('a re-queued word does not push a due word out of the session: the 20 stay, the copies come after', () => {
    const words = { current: backlog(50) as readonly Word[] }
    const session = buildReviewSession(words.current, NOW)
    let cards = session
    for (let i = 0; i < 5; i++) {
      const update = rateWord(cards[i], 1, NOW)
      words.current = applyProgressUpdates(words.current, [update])
      cards = requeueAgain(cards, i, withUpdate(cards[i], update))
    }
    expect(cards).toHaveLength(25) // 20 words and 5 copies
    expect(cards.slice(0, 20).map((w) => w.esWord)).toEqual(session.map((w) => w.esWord)) // every one of the 20 is still there, in place
    expect(new Set(cards.slice(20).map((w) => w.esWord)).size).toBe(5)
    // and the 5 lapsed words are not in the due list (they wait their ten minutes), so a session drawn now is the 20 most overdue of the rest
    const lapsed = session.slice(0, 5).map((w) => w.esWord)
    const next = buildReviewSession(words.current, NOW)
    expect(next).toHaveLength(20)
    for (const esWord of lapsed) expect(next.map((w) => w.esWord)).not.toContain(esWord)
    for (const w of session.slice(5)) expect(next.map((n) => n.esWord)).toContain(w.esWord) // the 15 not yet rated are still due, and still the most overdue
  })

  it('a session stops at 40 cards when Again is used over and over; the words still relearning simply come due later', () => {
    const words = { current: backlog(50) as readonly Word[] }
    const session = buildReviewSession(words.current, NOW)
    const { shown, cards } = play(session, 1, words)
    expect(shown).toBe(REVIEW_SESSION_CEILING)
    expect(cards).toHaveLength(REVIEW_SESSION_CEILING)
    // nothing is due from those 20 any more: they wait their ten minutes, and then come back
    const lapsed = session.map((w) => w.esWord)
    expect(dueWords(words.current, NOW).map((w) => w.esWord)).not.toEqual(expect.arrayContaining([lapsed[0]]))
    const later = new Date(NOW.getTime() + 10 * 60 * 1000)
    expect(dueWords(words.current, later).map((w) => w.esWord)).toEqual(expect.arrayContaining(lapsed))
  })

  it('the ceiling holds however few words there are: three words rated Again for ever end at 40 cards', () => {
    const { shown, cards } = play(backlog(3), 1)
    expect(shown).toBe(REVIEW_SESSION_CEILING)
    expect(cards).toHaveLength(REVIEW_SESSION_CEILING)
  })

  it('at the ceiling a word is not re-queued, and the session is returned as it is', () => {
    const full = backlog(REVIEW_SESSION_CEILING)
    const word = full[3]
    expect(requeueAgain(full, 3, withUpdate(word, rateWord(word, 1, NOW)))).toBe(full)
    expect(requeueAgain(full, 3, withUpdate(word, rateWord(word, 1, NOW)), 41)).toHaveLength(41) // the ceiling is a parameter, 40 by default
    // a copy still waiting is replaced, not added to, so a session at the ceiling can still send its copy to the end
    const withCopy = [...backlog(39), withUpdate(full[0], rateWord(full[0], 1, NOW))]
    const again = requeueAgain(withCopy, 0, withCopy[39])
    expect(again).toHaveLength(40)
  })

  it('"Continue" draws a fresh session from what is still due, including a word that came due during the last one', () => {
    const later = new Date(NOW.getTime() + 10 * 60 * 1000)
    const words = { current: [...backlog(25), learned('pronta', { rank: 99, nextReview: new Date(NOW.getTime() + 5 * 60 * 1000) })] as readonly Word[] }
    const first = buildReviewSession(words.current, NOW)
    expect(first.map((w) => w.esWord)).not.toContain('pronta') // not due yet
    play(first, 3, words)
    const stillDue = dueWords(words.current, later)
    expect(stillDue.map((w) => w.esWord)).toContain('pronta') // it came due while the session ran
    const next = buildReviewSession(words.current, later)
    expect(next).toHaveLength(6) // the 5 left over and the one that came due
    expect(next.map((w) => w.esWord)).toContain('pronta')
    expect(next.map((w) => w.esWord).filter((n) => n !== 'pronta').sort()).toEqual(['w01', 'w02', 'w03', 'w04', 'w05'])
  })

  it('the count of what is due (the Home tile) is the real total, whatever the session takes', () => {
    const words = backlog(50)
    expect(computeStats(words, parseSettings({}), NOW).reviewDue).toBe(50) // not 20
    expect(dueWords(words, NOW)).toHaveLength(50)
    const after = { current: words as readonly Word[] }
    play(buildReviewSession(words, NOW), 3, after)
    expect(computeStats(after.current, parseSettings({}), NOW).reviewDue).toBe(30)
  })
})
