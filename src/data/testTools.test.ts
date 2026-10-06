import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TestingSection } from '../components/TestingSection'
import { fakeSupabase } from '../testing/fakeSupabase'
import { makeWord } from '../testing/makeWord'
import { createLocalMetricsStore, createMetricsRecorder, emptyRow, type MetricsStore } from './metrics'
import { selectLearnBatch } from './learn'
import { applyProgressUpdates, applySettingsPatch } from './mutations'
import { computeRemainingToday } from './stats'
import { rateWord } from './review'
import { parseSettings } from './settings'
import { DEFAULT_MAKE_DUE, MAX_MAKE_DUE, dueNowUpdates, makeWordsDue, parseMakeDueCount, resetTodayMetrics, resetTodayNewWords, selectWordsToMakeDue } from './testTools'
import type { Word } from './types'
import { createSupabaseWriteQueue } from './writeQueue'

const NOW = new Date('2026-10-05T15:00:00.000Z')
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000)
const learned = (esWord: string, over: Partial<Word> = {}) =>
  makeWord(esWord, { repetitions: 3, interval: 6, easeFactor: 2.3, nextReview: inDays(5), ...over })

const pool = [
  learned('Cerca', { nextReview: inDays(10) }),
  learned('lejos', { nextReview: inDays(3) }),
  learned('mucho', { nextReview: inDays(30) }),
  learned('ya-due', { nextReview: inDays(-2) }), // already due
  learned('null-due', { nextReview: null }), // already due (no schedule)
  learned('now-due', { nextReview: NOW }), // due exactly now
  learned('never', { repetitions: 0, nextReview: inDays(9) }), // not learned
  learned('hidden', { isHidden: true, nextReview: inDays(40) }),
  learned('prep', { pos: 'prep', nextReview: inDays(40) }), // Review never shows it
  learned('no-ru', { ruTranslation: '', nextReview: inDays(40) }),
  learned('raw', { isEnriched: false, nextReview: inDays(40) }),
]

describe('selectWordsToMakeDue', () => {
  it('takes the learned words with the furthest due dates first', () => {
    expect(selectWordsToMakeDue(pool, 2, NOW).map((w) => w.esWord)).toEqual(['mucho', 'Cerca'])
    expect(selectWordsToMakeDue(pool, 10, NOW).map((w) => w.esWord)).toEqual(['mucho', 'Cerca', 'lejos'])
  })

  it('leaves out words that are already due, never-learned, hidden, not reviewable, untranslated or not enriched', () => {
    const all = selectWordsToMakeDue(pool, 50, NOW).map((w) => w.esWord)
    for (const skipped of ['ya-due', 'null-due', 'now-due', 'never', 'hidden', 'prep', 'no-ru', 'raw']) expect(all).not.toContain(skipped)
  })

  it('returns fewer when fewer qualify, and nothing for a count of zero or an empty list', () => {
    expect(selectWordsToMakeDue(pool, 99, NOW)).toHaveLength(3)
    expect(selectWordsToMakeDue(pool, 0, NOW)).toEqual([])
    expect(selectWordsToMakeDue([], 5, NOW)).toEqual([])
  })

  it('does not change the list it was given', () => {
    const copy = [...pool]
    selectWordsToMakeDue(pool, 3, NOW)
    expect(pool).toEqual(copy)
  })
})

describe('only the due date changes', () => {
  it('copies ease, interval and repetitions untouched and sets nextReview to now', () => {
    const chosen = selectWordsToMakeDue(pool, 3, NOW)
    const updates = dueNowUpdates(chosen, NOW)
    expect(updates).toHaveLength(3)
    updates.forEach((u, i) => {
      expect(u).toEqual({ esWord: chosen[i].esWord, easeFactor: chosen[i].easeFactor, interval: chosen[i].interval, repetitions: chosen[i].repetitions, nextReview: NOW })
    })
  })

  it('mirrored into the words, every field except nextReview is identical', () => {
    const chosen = selectWordsToMakeDue(pool, 3, NOW)
    const next = applyProgressUpdates(pool, dueNowUpdates(chosen, NOW))
    for (const word of pool) {
      const after = next.find((w) => w.esWord === word.esWord)!
      if (chosen.includes(word)) {
        expect({ ...after, nextReview: null }).toEqual({ ...word, nextReview: null })
        expect(after.nextReview).toEqual(NOW)
      } else {
        expect(after).toEqual(word)
      }
    }
  })

  it('the next real rating behaves exactly as it would have: same SM-2 result for every rating', () => {
    const [original] = selectWordsToMakeDue(pool, 1, NOW)
    const [pulled] = applyProgressUpdates([original], dueNowUpdates([original], NOW))
    for (const quality of [1, 2, 3, 4]) expect(rateWord(pulled, quality, NOW)).toEqual(rateWord(original, quality, NOW))
  })
})

describe('makeWordsDue goes through the write queue', () => {
  const setup = () => {
    const fake = fakeSupabase()
    const settings = parseSettings({})
    const queue = createSupabaseWriteQueue(fake.client, 'user-1', () => settings, { retryDelaysMs: [] })
    const applied: string[][] = []
    const deps = { signedIn: true, words: pool, count: 2, now: NOW, applyProgress: (u: readonly { esWord: string }[]) => void applied.push(u.map((x) => x.esWord)), queue }
    return { ...fake, queue, applied, deps }
  }

  it('queues one progress write per word with the SM-2 columns unchanged, and reports the words', async () => {
    const h = setup()
    const report = makeWordsDue(h.deps)
    expect(report.words).toEqual(['mucho', 'Cerca'])
    expect(report.message).toBe('2 words set due: mucho, Cerca')
    expect(h.applied).toEqual([['mucho', 'Cerca']]) // mirrored once, optimistically

    await h.queue.flush()
    const rows = h.calls.filter((c) => c.table === 'user_progress').flatMap((c) => c.rows as Record<string, unknown>[])
    expect(rows.map((r) => r.es_word).sort()).toEqual(['Cerca', 'mucho']) // original casing
    for (const row of rows) {
      expect(row).toMatchObject({ user_id: 'user-1', ease_factor: 2.3, interval_days: 6, repetitions: 3, next_review: NOW.toISOString() })
    }
  })

  it('says how many were available when fewer than asked', () => {
    const h = setup()
    expect(makeWordsDue({ ...h.deps, count: 9 }).message).toBe('3 words set due (only 3 available, 9 asked): mucho, Cerca, lejos')
    expect(makeWordsDue({ ...setup().deps, count: 1 }).message).toBe('1 word set due: mucho')
  })

  it('does nothing when nothing qualifies', () => {
    const h = setup()
    const report = makeWordsDue({ ...h.deps, words: [learned('due', { nextReview: inDays(-1) })] })
    expect(report.words).toEqual([])
    expect(report.message).toContain('nothing was changed')
    expect(h.applied).toEqual([])
    expect(h.queue.getStatus().pendingRatings).toBe(0)
  })

  it('does nothing unless signed in', () => {
    const h = setup()
    const enqueueProgress = vi.fn()
    const report = makeWordsDue({ ...h.deps, signedIn: false, queue: { enqueueProgress } })
    expect(report).toEqual({ words: [], message: 'Not signed in: nothing was changed.' })
    expect(enqueueProgress).not.toHaveBeenCalled()
    expect(h.applied).toEqual([])
  })
})

describe('parseMakeDueCount', () => {
  it('accepts whole numbers from 1 to the maximum and nothing else', () => {
    expect(parseMakeDueCount(String(DEFAULT_MAKE_DUE))).toBe(5)
    expect(parseMakeDueCount(' 12 ')).toBe(12)
    expect(parseMakeDueCount(String(MAX_MAKE_DUE))).toBe(MAX_MAKE_DUE)
    for (const bad of ['', '0', '-3', '2.5', 'abc', String(MAX_MAKE_DUE + 1), '1e2']) expect(parseMakeDueCount(bad), bad).toBeNull()
  })
})

describe("reset today's metrics row", () => {
  const key = '2026-10-05'
  const memory = (row = { ...emptyRow(key), reviewsDone: 9, reviewsLapsed: 2, dueAtStart: 7, active: true }) => {
    let stored: typeof row | null = row
    const store: MetricsStore = { load: () => stored, save: (r) => void (stored = r as typeof row), clear: () => void (stored = null) }
    return { store, get: () => stored }
  }

  it('clears the stored row and queues a zeroed row for the same date', () => {
    const mem = memory()
    const enqueue = vi.fn()
    const recorder = createMetricsRecorder({ store: mem.store, enqueue, getSettings: () => parseSettings({}) })
    const out = resetTodayMetrics({ signedIn: true, metrics: recorder, now: new Date(2026, 9, 5, 12) })
    expect(out.ok).toBe(true)
    expect(out.message).toContain(key)
    expect(mem.get()).toBeNull()
    expect(enqueue).toHaveBeenCalledWith(emptyRow(key)) // zeros, no snapshot: Home retakes it
    expect(recorder.today(new Date(2026, 9, 5, 12))).toBeNull()
  })

  it('counting starts again from zero afterwards', () => {
    const mem = memory()
    const recorder = createMetricsRecorder({ store: mem.store, enqueue: () => {}, getSettings: () => parseSettings({}) })
    const now = new Date(2026, 9, 5, 12)
    recorder.resetToday(now)
    recorder.recordReviewRating(3, now)
    expect(mem.get()).toMatchObject({ reviewsDone: 1, reviewsLapsed: 0, dueAtStart: null })
  })

  it('empties the real localStorage key, not just memory', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) }
    const store = createLocalMetricsStore('u1', storage)
    store.save({ ...emptyRow(key), reviewsDone: 4 })
    expect(data.size).toBe(1)
    store.clear()
    expect(data.size).toBe(0)
    expect(store.load()).toBeNull()
  })

  it('does nothing unless signed in, and reports a failure instead of throwing', () => {
    const mem = memory()
    const enqueue = vi.fn()
    const recorder = createMetricsRecorder({ store: mem.store, enqueue, getSettings: () => parseSettings({}) })
    expect(resetTodayMetrics({ signedIn: false, metrics: recorder }).ok).toBe(false)
    expect(resetTodayMetrics({ signedIn: true, metrics: null }).ok).toBe(false)
    expect(mem.get()).not.toBeNull()
    expect(enqueue).not.toHaveBeenCalled()

    const broken = createMetricsRecorder({ store: { load: () => null, save: () => {}, clear: () => { throw new Error('storage gone') } }, enqueue, getSettings: () => parseSettings({}) })
    expect(resetTodayMetrics({ signedIn: true, metrics: broken })).toEqual({ ok: false, message: 'Could not reset the metrics row.' })
  })
})

describe('TestingSection', () => {
  const render = (props: Partial<Parameters<typeof TestingSection>[0]>) =>
    renderToStaticMarkup(createElement(TestingSection, { signedIn: false, data: null, queue: null, metrics: null, ...props }))
  const queue = { enqueueProgress: () => {} } as never
  const data = { words: pool, applyProgress: () => {}, applySettings: () => {}, getSettings: () => parseSettings({}) } as never
  const metrics = { resetToday: () => null }

  it('is clearly marked as a testing tool', () => {
    expect(render({})).toContain('Testing tools: these change your real progress and metrics.')
    expect(render({})).toContain('<h2>Testing</h2>')
  })

  it('has every button disabled and says to sign in when signed out', () => {
    const html = render({ signedIn: false, data, queue, metrics })
    expect(html).toContain('Sign in to use them.')
    expect(html.match(/disabled=""/g)?.length).toBe(3)
  })

  it('enables them all when signed in with data, the queue and the recorder', () => {
    const html = render({ signedIn: true, data, queue, metrics })
    expect(html).not.toContain('Sign in to use them.')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('value="5"') // the default count
  })

  it('stays disabled while the data or the queue are not ready, even when signed in', () => {
    expect(render({ signedIn: true, data: null, queue, metrics }).match(/disabled=""/g)?.length).toBe(2) // Make due and the new-words reset need the data
    expect(render({ signedIn: true, data, queue: null, metrics: null }).match(/disabled=""/g)?.length).toBe(3)
  })
})

describe("reset today's new words", () => {
  const NOW_LOCAL = new Date(2026, 9, 5, 12, 0)
  const TODAY = '2026-10-05'

  function session(raw: Record<string, unknown>) {
    const fake = fakeSupabase()
    let settings = parseSettings(raw)
    const getSettings = () => settings
    const queue = createSupabaseWriteQueue(fake.client, 'user-1', getSettings, { retryDelaysMs: [], sleep: () => Promise.resolve() })
    const applySettings = (p: Record<string, unknown>) => (settings = applySettingsPatch(settings, p))
    return { fake, queue, getSettings, applySettings, deps: { signedIn: true, getSettings, applySettings, queue, now: NOW_LOCAL } }
  }
  const atLimit = { daily_new_word_limit: 10, new_words_learned_today_count: 10, new_words_learned_today_date: TODAY, streak_count: 6, streak_last_activity_date: TODAY, learn_picks: ['x'] }
  const fresh = Array.from({ length: 40 }, (_, i) => makeWord(`nueva${i}`, { rank: i + 1 }))

  it('clears the count, and says what it did', () => {
    const s = session(atLimit)
    const report = resetTodayNewWords(s.deps)
    expect(report).toEqual({ cleared: 10, message: "Today's new-word count reset from 10 to 0 (limit 10): Learn is available again." })
    expect(s.getSettings().newWordsLearnedTodayCount).toBe(0)
    expect(s.getSettings().newWordsLearnedTodayDate).toBe(TODAY)
  })

  it('Learn is available again: a day that was at the limit has a batch afterwards', () => {
    const s = session(atLimit)
    expect(computeRemainingToday(s.getSettings(), NOW_LOCAL)).toBe(0)
    expect(selectLearnBatch(fresh, s.getSettings(), NOW_LOCAL).words).toHaveLength(0)
    resetTodayNewWords(s.deps)
    expect(computeRemainingToday(s.getSettings(), NOW_LOCAL)).toBe(10)
    expect(selectLearnBatch(fresh, s.getSettings(), NOW_LOCAL).words).toHaveLength(10)
  })

  it('is written through the normal path: one settings write on the queue, with the whole blob and nothing else changed', async () => {
    const s = session(atLimit)
    resetTodayNewWords(s.deps)
    await s.queue.flush()
    const writes = s.fake.calls.filter((c) => c.table === 'user_settings')
    expect(writes).toHaveLength(1)
    expect(writes[0].rows).toMatchObject({ user_id: 'user-1', settings: { new_words_learned_today_count: 0, new_words_learned_today_date: TODAY, streak_count: 6, streak_last_activity_date: TODAY, daily_new_word_limit: 10, learn_picks: ['x'] } })
    expect(s.fake.calls.filter((c) => c.table !== 'user_settings')).toHaveLength(0) // no progress, hidden or metrics write
  })

  it('does not touch the streak, the limit or any progress', () => {
    const s = session(atLimit)
    resetTodayNewWords(s.deps)
    expect(s.getSettings()).toMatchObject({ streakCount: 6, streakLastActivityDate: TODAY, dailyNewWordLimit: 10 })
  })

  it('a count from another day counts as 0 already: nothing to reset, nothing written', async () => {
    const s = session({ ...atLimit, new_words_learned_today_date: '2026-10-04' })
    const report = resetTodayNewWords(s.deps)
    expect(report).toEqual({ cleared: 0, message: "Today's new-word count is already 0 (limit 10): nothing was changed." })
    await s.queue.flush()
    expect(s.fake.calls).toHaveLength(0)
  })

  it('a partial count is cleared too', () => {
    const s = session({ ...atLimit, new_words_learned_today_count: 4 })
    expect(resetTodayNewWords(s.deps).cleared).toBe(4)
    expect(s.getSettings().newWordsLearnedTodayCount).toBe(0)
  })

  it('does nothing unless signed in', async () => {
    const s = session(atLimit)
    const report = resetTodayNewWords({ ...s.deps, signedIn: false })
    expect(report).toEqual({ cleared: 0, message: 'Not signed in: nothing was changed.' })
    expect(s.getSettings().newWordsLearnedTodayCount).toBe(10)
    await s.queue.flush()
    expect(s.fake.calls).toHaveLength(0)
  })

  it('can be repeated: the second time there is nothing left to clear', () => {
    const s = session(atLimit)
    resetTodayNewWords(s.deps)
    expect(resetTodayNewWords(s.deps).cleared).toBe(0)
  })
})
