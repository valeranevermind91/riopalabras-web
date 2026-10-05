import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '../testing/fakeSupabase'
import { makeWord } from '../testing/makeWord'
import { createBatchFinisher, type LearnBatch } from './learn'
import {
  createLocalMetricsStore,
  createMetricsRecorder,
  emptyRow,
  fetchServerMetricsRow,
  parseStoredRow,
  rowForToday,
  shouldSnapshot,
  type DailyMetricsRow,
  type MetricsStore,
} from './metrics'
import { applyProgressUpdates, applySettingsPatch } from './mutations'
import { createRater } from './review'
import { parseSettings } from './settings'
import type { Word } from './types'
import { createSupabaseWriteQueue } from './writeQueue'

const DAY1 = new Date(2026, 9, 4, 14, 30) // local (America/Montevideo)
const DAY2 = new Date(2026, 9, 5, 9, 0)
const KEY1 = '2026-10-04'
const KEY2 = '2026-10-05'

function memoryStore(initial: DailyMetricsRow | null = null) {
  let row = initial
  const store: MetricsStore = { load: () => row, save: (r) => void (row = r), clear: () => void (row = null) }
  return { store, get: () => row }
}

/** A recorder wired to a real write queue over the fake Supabase, the way App builds it. */
function app(options: { store?: MetricsStore; settingsRaw?: Record<string, unknown> } = {}) {
  const fake = fakeSupabase()
  let settings = parseSettings(options.settingsRaw ?? { streak_count: 3, streak_last_activity_date: KEY1 })
  const queue = createSupabaseWriteQueue(fake.client, 'user-1', () => settings, { retryDelaysMs: [1, 1, 1], metricsRetryDelaysMs: [1, 1] })
  const mem = memoryStore()
  const store = options.store ?? mem.store
  const recorder = createMetricsRecorder({ store, enqueue: queue.enqueueMetrics, getSettings: () => settings })
  let words: readonly Word[] = []
  return {
    ...fake,
    queue,
    recorder,
    mem,
    getSettings: () => settings,
    applySettings: (patch: Record<string, unknown>) => (settings = applySettingsPatch(settings, patch)),
    getWords: () => words,
    setWords: (w: readonly Word[]) => (words = w),
    metricsCalls: () => fake.calls.filter((c) => c.table === 'user_daily_metrics'),
    progressCalls: () => fake.calls.filter((c) => c.table === 'user_progress'),
    drained: () => vi.waitFor(() => expect(queue.getStatus()).toMatchObject({ unsaved: false, pendingMetrics: 0 })),
  }
}

describe('pure helpers', () => {
  it('rowForToday keeps today\'s row and starts a fresh zeroed one for a stale date', () => {
    const today = { ...emptyRow(KEY1), reviewsDone: 4 }
    expect(rowForToday(KEY1, today)).toBe(today)
    expect(rowForToday(KEY2, today)).toEqual(emptyRow(KEY2))
    expect(rowForToday(KEY1, null)).toEqual(emptyRow(KEY1))
  })

  it('shouldSnapshot: yes for a new day or a row without a snapshot, never once taken', () => {
    expect(shouldSnapshot(KEY1, null)).toBe(true)
    expect(shouldSnapshot(KEY2, { ...emptyRow(KEY1), dueAtStart: 5 })).toBe(true)
    expect(shouldSnapshot(KEY1, emptyRow(KEY1))).toBe(true)
    expect(shouldSnapshot(KEY1, { ...emptyRow(KEY1), dueAtStart: 0 })).toBe(false) // zero is a real snapshot
  })

  it('parseStoredRow accepts a good row and rejects or repairs malformed ones', () => {
    expect(parseStoredRow({ ...emptyRow(KEY1), reviewsDone: 3, dueAtStart: 8, active: true })).toMatchObject({ reviewsDone: 3, dueAtStart: 8, active: true })
    expect(parseStoredRow(null)).toBeNull()
    expect(parseStoredRow({ date: 'yesterday' })).toBeNull()
    expect(parseStoredRow({ date: KEY1, reviewsDone: -3, dueAtStart: 'x', active: 'yes' })).toEqual(emptyRow(KEY1))
  })
})

describe('local store', () => {
  const storage = () => {
    const data = new Map<string, string>()
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) }
  }

  it('survives a reload: a new store on the same storage sees the saved row, per user', () => {
    const s = storage()
    createLocalMetricsStore('u1', s).save({ ...emptyRow(KEY1), reviewsDone: 7 })
    expect(createLocalMetricsStore('u1', s).load()?.reviewsDone).toBe(7)
    expect(createLocalMetricsStore('u2', s).load()).toBeNull()
  })

  it('treats corrupt data as nothing stored, and falls back to memory when storage throws', () => {
    const s = storage()
    s.setItem('riopalabras.dailyMetrics.v1.u1', '{not json')
    expect(createLocalMetricsStore('u1', s).load()).toBeNull()

    const broken = createLocalMetricsStore('u1', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => broken.save({ ...emptyRow(KEY1), reviewsDone: 2 })).not.toThrow()
    expect(broken.load()?.reviewsDone).toBe(2)
    expect(createLocalMetricsStore('u1', null).load()).toBeNull()
  })
})

describe('a Review session writes the day\'s metrics row', () => {
  it('counts every rating and every "Again" as a lapse, and pushes ONE row through the queue with the exact columns', async () => {
    const a = app({ settingsRaw: { streak_count: 3, streak_last_activity_date: KEY1, new_words_learned_today_count: 4, new_words_learned_today_date: KEY1 } })
    const rate = createRater({ applyProgress: () => {}, applySettings: a.applySettings, getSettings: a.getSettings, queue: a.queue, metrics: a.recorder })
    const words = ['uno', 'dos', 'tres', 'cuatro', 'cinco'].map((w) => makeWord(w, { repetitions: 2, interval: 3, nextReview: new Date(2026, 9, 3) }))
    ;[3, 1, 4, 1, 2].forEach((q, i) => rate(words[i], q, DAY1))
    await a.drained()

    expect(a.recorder.today(DAY1)).toEqual({ date: KEY1, newWords: 4, reviewsDone: 5, reviewsLapsed: 2, dueAtStart: null, learnPool: null, dailyLimit: null, active: true })
    const calls = a.metricsCalls()
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls.length).toBeLessThanOrEqual(2) // five ratings, not five requests
    expect(calls.at(-1)?.options).toEqual({ onConflict: 'user_id,date' })
    expect(calls.at(-1)?.rows).toEqual([
      { user_id: 'user-1', date: KEY1, new_words: 4, reviews_done: 5, reviews_lapsed: 2, due_at_start: null, learn_pool: null, daily_limit: null, active: true, updated_at: expect.any(String) },
    ])
    expect(a.progressCalls().flatMap((c) => c.rows as unknown[])).toHaveLength(5)
  })

  it('sends metrics only after progress and settings', async () => {
    const a = app()
    const rate = createRater({ applyProgress: () => {}, applySettings: a.applySettings, getSettings: a.getSettings, queue: a.queue, metrics: a.recorder })
    rate(makeWord('uno', { repetitions: 1, nextReview: new Date(2026, 9, 3) }), 3, DAY1)
    await a.drained()
    const tables = a.calls.map((c) => c.table)
    expect(tables.at(-1)).toBe('user_daily_metrics')
    expect(tables.indexOf('user_daily_metrics')).toBeGreaterThan(tables.lastIndexOf('user_progress'))
  })

  it('keeps counting across a reload (same store, new recorder) and starts fresh the next local day', () => {
    const mem = memoryStore()
    const settings = parseSettings({})
    const make = () => createMetricsRecorder({ store: mem.store, enqueue: () => {}, getSettings: () => settings })

    make().recordReviewRating(3, DAY1)
    make().recordReviewRating(1, DAY1) // "reopened the Mini App"
    expect(mem.get()).toMatchObject({ date: KEY1, reviewsDone: 2, reviewsLapsed: 1 })

    make().recordReviewRating(3, DAY2)
    expect(mem.get()).toMatchObject({ date: KEY2, reviewsDone: 1, reviewsLapsed: 0 })
  })
})

describe('a Learn session writes the day\'s metrics row', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(DAY1)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks the day active and mirrors the new-word counter when the batch is queued (once), and pushes the row after the batch lands', async () => {
    const a = app({ settingsRaw: { streak_count: 3, streak_last_activity_date: '2026-10-03', new_words_learned_today_count: 2, new_words_learned_today_date: KEY1 } })
    const batch: LearnBatch = { words: ['uno', 'dos', 'tres'].map((w, i) => makeWord(w, { rank: i + 1 })), newCount: 3 }
    a.setWords(batch.words)
    const finish = createBatchFinisher(batch, {
      queue: a.queue,
      getSettings: a.getSettings,
      applyProgress: (updates) => a.setWords(applyProgressUpdates(a.getWords(), updates)),
      applySettings: a.applySettings,
      onFinished: () => a.recorder.markActiveToday(),
    })

    expect(a.recorder.today(DAY1)).toBeNull() // nothing before the batch is finished
    finish()
    finish() // a double tap records nothing more
    expect(a.recorder.today(DAY1)).toMatchObject({ date: KEY1, newWords: 5, reviewsDone: 0, active: true }) // 2 earlier + 3 new
    await a.drained()

    const tables = a.calls.map((c) => c.table)
    expect(tables.slice(0, 2)).toEqual(['user_progress', 'user_settings'])
    expect(tables.at(-1)).toBe('user_daily_metrics') // lowest priority: after the batch
    expect(a.metricsCalls().at(-1)?.rows).toEqual([
      { user_id: 'user-1', date: KEY1, new_words: 5, reviews_done: 0, reviews_lapsed: 0, due_at_start: null, learn_pool: null, daily_limit: null, active: true, updated_at: expect.any(String) },
    ])
  })
})

describe('start-of-day snapshot (Home)', () => {
  it('is captured once per day and never overwritten by a later, worked-down value', async () => {
    const a = app()
    a.recorder.captureStartOfDaySnapshotIfNeeded({ reviewDue: 12, learnPool: 4000, dailyLimit: 10 }, DAY1)
    a.recorder.recordReviewRating(3, DAY1)
    a.recorder.captureStartOfDaySnapshotIfNeeded({ reviewDue: 11, learnPool: 3990, dailyLimit: 10 }, DAY1) // Home shown again
    await a.drained()

    expect(a.recorder.today(DAY1)).toMatchObject({ dueAtStart: 12, learnPool: 4000, dailyLimit: 10, reviewsDone: 1 })
    expect(a.metricsCalls().at(-1)?.rows).toEqual([
      { user_id: 'user-1', date: KEY1, new_words: 0, reviews_done: 1, reviews_lapsed: 0, due_at_start: 12, learn_pool: 4000, daily_limit: 10, active: true, updated_at: expect.any(String) },
    ])

    a.recorder.captureStartOfDaySnapshotIfNeeded({ reviewDue: 3, learnPool: 3900, dailyLimit: 12 }, DAY2) // next day: a new snapshot
    expect(a.recorder.today(DAY2)).toMatchObject({ date: KEY2, dueAtStart: 3, learnPool: 3900, dailyLimit: 12, active: false })
  })
})

describe('a metrics failure never blocks or degrades learning', () => {
  it('server errors on user_daily_metrics: ratings still save, flush resolves, no banner state, no closing confirmation', async () => {
    const a = app()
    a.failures.user_daily_metrics = 99
    const rate = createRater({ applyProgress: a.setWords as never, applySettings: a.applySettings, getSettings: a.getSettings, queue: a.queue, metrics: a.recorder })
    const out = rate(makeWord('uno', { repetitions: 1, nextReview: new Date(2026, 9, 3) }), 3, DAY1)
    expect(out.esWord).toBe('uno')
    await a.queue.flush()

    expect(a.progressCalls()).toHaveLength(1)
    await vi.waitFor(() => expect(a.queue.getStatus().metricsError).toContain('user_daily_metrics'))
    expect(a.queue.getStatus()).toMatchObject({ failed: false, stuck: false, unsaved: false, pendingRatings: 0 })
  })

  it('a recorder that blows up (storage or queue throws) cannot stop a rating', () => {
    const exploding: MetricsStore = {
      load: () => {
        throw new Error('storage gone')
      },
      save: () => {
        throw new Error('storage gone')
      },
      clear: () => {
        throw new Error('storage gone')
      },
    }
    const settings = parseSettings({})
    const queue = { enqueueProgress: vi.fn(), enqueueSettings: vi.fn() }
    const recorder = createMetricsRecorder({ store: exploding, enqueue: () => { throw new Error('queue gone') }, getSettings: () => settings })
    const rate = createRater({ applyProgress: vi.fn(), applySettings: vi.fn(), getSettings: () => settings, queue, metrics: recorder })

    expect(() => rate(makeWord('uno', { repetitions: 1, nextReview: new Date(2026, 9, 3) }), 1, DAY1)).not.toThrow()
    expect(queue.enqueueProgress).toHaveBeenCalledTimes(1)
    expect(() => recorder.markActiveToday(DAY1)).not.toThrow()
    expect(() => recorder.captureStartOfDaySnapshotIfNeeded({ reviewDue: 1, learnPool: 1, dailyLimit: 1 }, DAY1)).not.toThrow()
    expect(recorder.today(DAY1)).toBeNull()
  })

  it('settings that are not loaded fall back to the row\'s own new-word count instead of failing', () => {
    const mem = memoryStore({ ...emptyRow(KEY1), newWords: 6 })
    const recorder = createMetricsRecorder({
      store: mem.store,
      enqueue: () => {},
      getSettings: () => {
        throw new Error('Settings are not loaded')
      },
    })
    recorder.recordReviewRating(3, DAY1)
    expect(mem.get()).toMatchObject({ newWords: 6, reviewsDone: 1 })
  })
})

describe('Debug: server copy of today\'s row', () => {
  const clientReturning = (result: { data: unknown; error: { message: string } | null }) => {
    const seen: string[][] = []
    const builder = {
      select: () => builder,
      eq: (column: string, value: string) => (seen.push([column, value]), builder),
      maybeSingle: async () => result,
    }
    return { client: { from: () => builder } as never, seen }
  }

  it('reads one row by user and date, and returns null when there is none', async () => {
    const found = clientReturning({ data: { user_id: 'user-1', date: KEY1, reviews_done: 5 }, error: null })
    expect(await fetchServerMetricsRow(found.client, 'user-1', KEY1)).toMatchObject({ reviews_done: 5 })
    expect(found.seen).toEqual([['user_id', 'user-1'], ['date', KEY1]])
    expect(await fetchServerMetricsRow(clientReturning({ data: null, error: null }).client, 'user-1', KEY1)).toBeNull()
  })

  it('throws the server error so the Debug screen can show it', async () => {
    await expect(fetchServerMetricsRow(clientReturning({ data: null, error: { message: 'permission denied' } }).client, 'user-1', KEY1)).rejects.toThrow('permission denied')
  })
})
