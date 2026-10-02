import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '../testing/fakeSupabase'
import { makeWord } from '../testing/makeWord'
import { parseDictionary } from './dictionary'
import { applyProgressUpdates, applySettingsPatch } from './mutations'
import { buildReviewSession, createRater, rateWord, shuffle } from './review'
import { parseSettings } from './settings'
import { getLearnPool, isReviewDue } from './stats'
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

  it('has no size cap', () => {
    const many = Array.from({ length: 700 }, (_, i) => learned(`w${i}`))
    expect(buildReviewSession(many, NOW)).toHaveLength(700)
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
    expect(after.find((w) => w.esWord === 'a')?.repetitions).toBe(0)
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

  it('Again: repetitions 0, interval 0, ease lowered, due right now', () => {
    const u = rateWord(justLearned, 1, NOW)
    expect(u).toMatchObject({ esWord: 'Hacienda', interval: 0, repetitions: 0 })
    expect(u.easeFactor).toBeCloseTo(2.18, 10)
    expect(u.nextReview.getTime()).toBe(NOW.getTime())
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
    expect(u).toMatchObject({ interval: 0, repetitions: 0 })
  })

  it('keeps the word\'s original dictionary casing', () => {
    expect(rateWord(learned('Hacienda'), 3, NOW).esWord).toBe('Hacienda')
  })

  it('"Again" moves the word out of the due set and back into the Learn pool as new', () => {
    const word = learned('a')
    const [after] = applyProgressUpdates([word], [rateWord(word, 1, NOW)])
    expect(isReviewDue(after, NOW)).toBe(false)
    expect(getLearnPool([after]).map((w) => w.esWord)).toEqual(['a'])
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
      1: { ease: 2.18, interval: 0, reps: 0, next: '2026-10-05T15:00:00.000Z' },
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
