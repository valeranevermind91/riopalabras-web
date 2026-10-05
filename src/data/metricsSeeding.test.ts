import { describe, expect, it, vi } from 'vitest'
import { makeUpdate } from '../testing/makeWord'
import { createMetricsRecorder, emptyRow, mergeRows, parseServerRow, type DailyMetricsRow, type MetricsRecorder, type MetricsStore } from './metrics'
import { parseSettings } from './settings'
import { createWriteQueue, type WriteQueue } from './writeQueue'

const DAY = new Date(2026, 9, 5, 14, 0)
const KEY = '2026-10-05'
const NEXT_DAY = new Date(2026, 9, 6, 9, 0)
const row = (over: Partial<DailyMetricsRow> = {}): DailyMetricsRow => ({ ...emptyRow(KEY), ...over })

/** One shared server table; every upsert overwrites the whole row, as Postgres does. */
function server() {
  const rows = new Map<string, DailyMetricsRow>()
  const pushes: DailyMetricsRow[] = []
  const state = { failUpsert: false, failRead: false, readDelay: null as Promise<void> | null, reads: [] as string[] }
  return {
    rows,
    pushes,
    state,
    async upsert(batch: readonly DailyMetricsRow[]) {
      if (state.failUpsert) throw new Error('user_daily_metrics: boom')
      for (const r of batch) {
        pushes.push(r)
        rows.set(r.date, r)
      }
    },
    async read(date: string) {
      state.reads.push(date)
      if (state.readDelay) await state.readDelay
      if (state.failRead) throw new Error('permission denied')
      return rows.get(date) ?? null
    },
  }
}

function memoryStore(initial: DailyMetricsRow | null = null) {
  let stored = initial
  const store: MetricsStore = { load: () => stored, save: (r) => void (stored = r), clear: () => void (stored = null) }
  return { store, get: () => stored }
}

/** A device: its own local row, its own queue, talking to the shared server. */
function device(srv: ReturnType<typeof server>, opts: { local?: DailyMetricsRow | null; seed?: boolean; seedTimeoutMs?: number; settingsRaw?: Record<string, unknown> } = {}) {
  const mem = memoryStore(opts.local ?? null)
  const settings = parseSettings(opts.settingsRaw ?? {})
  const queue: WriteQueue = createWriteQueue(
    { sendProgress: async () => {}, sendSettings: async () => {}, sendMetrics: (rows) => srv.upsert(rows) },
    { retryDelaysMs: [1, 1, 1], metricsRetryDelaysMs: [1, 1], sleep: () => new Promise((r) => setTimeout(r, 1)) },
  )
  const recorder: MetricsRecorder = createMetricsRecorder({
    store: mem.store,
    enqueue: queue.enqueueMetrics,
    getSettings: () => settings,
    ...(opts.seed === false ? {} : { fetchServerRow: (date: string) => srv.read(date) }),
    ...(opts.seedTimeoutMs ? { seedTimeoutMs: opts.seedTimeoutMs } : {}),
  })
  return { mem, queue, recorder, drained: () => vi.waitFor(() => expect(queue.getStatus()).toMatchObject({ unsaved: false, pendingMetrics: 0, metricsRunning: false })) }
}

describe('BUG 1: ratings reach the server when only a metrics row is queued', () => {
  it('Home snapshot, then five reviews with one "Again": the final row is on the server', async () => {
    const srv = server()
    const d = device(srv, { seed: false })
    d.recorder.captureStartOfDaySnapshotIfNeeded({ reviewDue: 12, learnPool: 4640, dailyLimit: 10 }, DAY) // metrics is the ONLY thing queued
    await d.drained()
    expect(srv.rows.get(KEY)).toMatchObject({ learnPool: 4640, dailyLimit: 10, reviewsDone: 0, active: false }) // the snapshot landed, like on the phone

    // five ratings, each with its own progress write queued next to the metrics row
    for (const q of [3, 1, 4, 3, 2]) {
      d.queue.enqueueProgress(makeUpdate(`w${q}${Math.random()}`))
      d.recorder.recordReviewRating(q, DAY)
    }
    await d.drained()

    expect(srv.rows.get(KEY)).toMatchObject({ reviewsDone: 5, reviewsLapsed: 1, active: true, dueAtStart: 12, learnPool: 4640, dailyLimit: 10 })
  })

  it('a metrics row alone in the queue (nothing else, ever) is sent without waiting for anything', async () => {
    const srv = server()
    const d = device(srv, { seed: false })
    d.recorder.recordReviewRating(1, DAY)
    await d.drained()
    expect(srv.rows.get(KEY)).toMatchObject({ reviewsDone: 1, reviewsLapsed: 1, active: true })
    expect(d.queue.getStatus()).toMatchObject({ metricsAttempts: 1, metricsGaveUp: false, metricsError: null })
  })

  it('a rating that arrives while the previous push is still in flight is not left behind', async () => {
    const srv = server()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow = { ...srv, upsert: async (b: readonly DailyMetricsRow[]) => (await gate, srv.upsert(b)) }
    const mem = memoryStore()
    const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {}, sendMetrics: slow.upsert }, { retryDelaysMs: [1], sleep: () => Promise.resolve() })
    const recorder = createMetricsRecorder({ store: mem.store, enqueue: queue.enqueueMetrics, getSettings: () => parseSettings({}) })
    recorder.recordReviewRating(3, DAY) // push 1 in flight, held
    queue.enqueueProgress(makeUpdate('uno'))
    recorder.recordReviewRating(1, DAY) // arrives meanwhile, next to a progress write
    release()
    await vi.waitFor(() => expect(queue.getStatus()).toMatchObject({ unsaved: false, pendingMetrics: 0 }))
    expect(srv.rows.get(KEY)).toMatchObject({ reviewsDone: 2, reviewsLapsed: 1 })
  })
})

describe('metrics failures are visible in the queue state (and only there)', () => {
  it('records attempts, times and the last error, and says when the lane gave up', async () => {
    const srv = server()
    srv.state.failUpsert = true
    const d = device(srv, { seed: false })
    d.recorder.recordReviewRating(3, DAY)
    await vi.waitFor(() => expect(d.queue.getStatus().metricsGaveUp).toBe(true))
    const s = d.queue.getStatus()
    expect(s).toMatchObject({ metricsRunning: false, metricsAttempts: 3, metricsError: 'user_daily_metrics: boom', pendingMetrics: 1, metricsLastSuccessAt: null })
    expect(s.metricsLastAttemptAt).not.toBeNull()
    // …and learning was never touched
    expect(s).toMatchObject({ failed: false, stuck: false, unsaved: false })

    srv.state.failUpsert = false
    d.recorder.recordReviewRating(3, DAY) // the next change starts a fresh round
    await d.drained()
    expect(d.queue.getStatus().metricsLastSuccessAt).not.toBeNull()
    expect(srv.rows.get(KEY)).toMatchObject({ reviewsDone: 2 })
  })

  it('says when rows are only waiting for progress to be sent first', async () => {
    const queue = createWriteQueue(
      { sendProgress: async () => { throw new Error('down') }, sendSettings: async () => {}, sendMetrics: async () => {} },
      { retryDelaysMs: [], sleep: () => Promise.resolve() },
    )
    queue.enqueueProgress(makeUpdate('a'))
    queue.enqueueMetrics(row({ reviewsDone: 1 }))
    await vi.waitFor(() => expect(queue.getStatus().failed).toBe(true))
    expect(queue.getStatus()).toMatchObject({ pendingMetrics: 1, metricsWaitingForProgress: true, metricsAttempts: 0, metricsRunning: false })
  })
})

describe('BUG 2: a device with an empty local row never overwrites another device with zeros', () => {
  it('the desktop opens with nothing local after the phone did five reviews: the server keeps all five, and the desktop continues from them', async () => {
    const srv = server()
    const phone = device(srv)
    phone.recorder.captureStartOfDaySnapshotIfNeeded({ reviewDue: 12, learnPool: 4640, dailyLimit: 10 }, DAY)
    for (const q of [3, 1, 4, 3, 2]) phone.recorder.recordReviewRating(q, DAY)
    await phone.drained()
    await phone.recorder.seedToday(DAY)
    expect(srv.rows.get(KEY)).toMatchObject({ reviewsDone: 5, reviewsLapsed: 1, active: true })

    const desktop = device(srv, { local: null })
    await desktop.recorder.seedToday(DAY) // the app opens
    expect(desktop.mem.get()).toMatchObject({ reviewsDone: 5, reviewsLapsed: 1, active: true }) // seeded from the server
    desktop.recorder.captureStartOfDaySnapshotIfNeeded({ reviewDue: 3, learnPool: 3900, dailyLimit: 12 }, DAY) // Home on the desktop
    desktop.recorder.recordReviewRating(3, DAY)
    await desktop.drained()

    expect(srv.rows.get(KEY)).toMatchObject({ reviewsDone: 6, reviewsLapsed: 1, active: true })
    // at no point did the server see a row with fewer reviews than the phone had already sent
    const doneOverTime = srv.pushes.map((r) => r.reviewsDone)
    expect(doneOverTime).toEqual([...doneOverTime].sort((a, b) => a - b))
    expect(Math.min(...doneOverTime.slice(doneOverTime.indexOf(5)))).toBeGreaterThanOrEqual(5)
  })

  it('the exact observed failure: opening Home on the desktop first would have written zeros; now it writes nothing worse than the server has', async () => {
    const srv = server()
    srv.rows.set(KEY, row({ reviewsDone: 5, reviewsLapsed: 1, active: true, newWords: 4, dueAtStart: 12, learnPool: 4640, dailyLimit: 10 }))
    const desktop = device(srv, { local: null })
    // Home mounts and takes its snapshot immediately, before the read returns
    desktop.recorder.captureStartOfDaySnapshotIfNeeded({ reviewDue: 9, learnPool: 4000, dailyLimit: 10 }, DAY)
    await desktop.recorder.seedToday(DAY)
    await desktop.drained()
    expect(srv.rows.get(KEY)).toEqual(row({ reviewsDone: 5, reviewsLapsed: 1, active: true, newWords: 4, dueAtStart: 12, learnPool: 4640, dailyLimit: 10 }))
  })

  it('changes made before the server read returns are held back, then pushed merged, never as a zero-based row', async () => {
    const srv = server()
    srv.rows.set(KEY, row({ reviewsDone: 5, reviewsLapsed: 1, active: true }))
    let release!: () => void
    srv.state.readDelay = new Promise<void>((r) => (release = r))
    const desktop = device(srv, { local: null })
    desktop.recorder.recordReviewRating(3, DAY) // the read is still pending
    await new Promise((r) => setTimeout(r, 15))
    expect(srv.pushes).toHaveLength(0) // nothing pushed while the server row is unknown
    expect(desktop.mem.get()).toMatchObject({ reviewsDone: 1 }) // but the rating is kept locally

    release()
    await desktop.recorder.seedToday(DAY)
    await desktop.drained()
    expect(srv.rows.get(KEY)).toMatchObject({ reviewsDone: 5, reviewsLapsed: 1, active: true }) // max(1, 5): not zero, and not lower
    expect(srv.pushes.every((r) => r.reviewsDone >= 5)).toBe(true)
  })

  it('counters only move forward: the larger value wins per counter, active is OR-ed', async () => {
    const srv = server()
    srv.rows.set(KEY, row({ newWords: 2, reviewsDone: 9, reviewsLapsed: 0, active: false }))
    const d = device(srv, { local: row({ newWords: 5, reviewsDone: 3, reviewsLapsed: 2, active: true }) })
    await d.recorder.seedToday(DAY)
    await d.drained()
    const expected = row({ newWords: 5, reviewsDone: 9, reviewsLapsed: 2, active: true })
    expect(d.mem.get()).toEqual(expected)
    expect(srv.rows.get(KEY)).toEqual(expected)
  })

  it('a lost push heals itself: the phone reopens with 5 locally while the server still shows zeros, and the 5 are pushed', async () => {
    const srv = server()
    srv.rows.set(KEY, row({ learnPool: 4640, dailyLimit: 10 })) // what the observed server row looked like
    const phone = device(srv, { local: row({ newWords: 0, reviewsDone: 5, reviewsLapsed: 1, active: true, dueAtStart: 12, learnPool: 4640, dailyLimit: 10 }) })
    await phone.recorder.seedToday(DAY)
    await phone.drained()
    expect(srv.rows.get(KEY)).toMatchObject({ reviewsDone: 5, reviewsLapsed: 1, active: true })
  })

  it('the start-of-day snapshot already on the server is kept, and Home does not snapshot over it', async () => {
    const srv = server()
    srv.rows.set(KEY, row({ dueAtStart: 12, learnPool: 4640, dailyLimit: 10 }))
    const d = device(srv, { local: null })
    await d.recorder.seedToday(DAY)
    d.recorder.captureStartOfDaySnapshotIfNeeded({ reviewDue: 3, learnPool: 3900, dailyLimit: 12 }, DAY) // later in the day, worked-down numbers
    d.recorder.recordReviewRating(3, DAY)
    await d.drained()
    expect(srv.rows.get(KEY)).toMatchObject({ dueAtStart: 12, learnPool: 4640, dailyLimit: 10, reviewsDone: 1 })
  })

  it('a local snapshot is kept when the server has none, and a server snapshot of 0 counts as set', () => {
    expect(mergeRows(row({ dueAtStart: 7, learnPool: 100, dailyLimit: 10 }), row())).toMatchObject({ dueAtStart: 7, learnPool: 100, dailyLimit: 10 })
    expect(mergeRows(row({ dueAtStart: 7 }), row({ dueAtStart: 0 }))?.dueAtStart).toBe(0)
  })

  it('nothing to say: an empty local row and no server row push nothing', async () => {
    const srv = server()
    const d = device(srv, { local: null })
    await d.recorder.seedToday(DAY)
    await d.drained()
    expect(srv.pushes).toHaveLength(0)
    expect(d.mem.get()).toBeNull()
  })

  it('if the server already has everything, nothing is pushed again', async () => {
    const srv = server()
    srv.rows.set(KEY, row({ reviewsDone: 9, active: true, newWords: 1 }))
    const d = device(srv, { local: row({ reviewsDone: 3, active: true }) })
    await d.recorder.seedToday(DAY)
    await d.drained()
    expect(srv.pushes).toHaveLength(0)
    expect(d.mem.get()).toMatchObject({ reviewsDone: 9, newWords: 1 })
  })
})

describe('seeding is best effort and happens once per day', () => {
  it('a failed read carries on with the local row, as before: the held-back row is pushed', async () => {
    const srv = server()
    srv.state.failRead = true
    const d = device(srv, { local: null })
    d.recorder.recordReviewRating(1, DAY)
    await d.recorder.seedToday(DAY)
    await d.drained()
    expect(d.recorder.seedStatus(DAY)).toEqual({ state: 'failed', detail: 'permission denied' })
    expect(srv.rows.get(KEY)).toMatchObject({ reviewsDone: 1, reviewsLapsed: 1 })

    d.recorder.recordReviewRating(3, DAY) // later changes push straight away
    await d.drained()
    expect(srv.rows.get(KEY)).toMatchObject({ reviewsDone: 2 })
  })

  it('a read that never answers times out and the local row carries on', async () => {
    const srv = server()
    srv.state.readDelay = new Promise<void>(() => {})
    const d = device(srv, { local: null, seedTimeoutMs: 20 })
    d.recorder.recordReviewRating(3, DAY)
    await d.recorder.seedToday(DAY)
    await d.drained()
    expect(d.recorder.seedStatus(DAY).state).toBe('failed')
    expect(d.recorder.seedStatus(DAY).detail).toContain('no answer')
    expect(srv.rows.get(KEY)).toMatchObject({ reviewsDone: 1 })
  })

  it('a reader that throws synchronously is handled too', async () => {
    const mem = memoryStore()
    const enqueue = vi.fn()
    const recorder = createMetricsRecorder({ store: mem.store, enqueue, getSettings: () => parseSettings({}), fetchServerRow: () => { throw new Error('boom') } })
    expect(() => recorder.recordReviewRating(3, DAY)).not.toThrow()
    await recorder.seedToday(DAY)
    expect(recorder.seedStatus(DAY).state).toBe('failed')
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ reviewsDone: 1 }))
  })

  it('reads once per date however many changes follow, and again on a new day', async () => {
    const srv = server()
    const d = device(srv, { local: null })
    d.recorder.recordReviewRating(3, DAY)
    d.recorder.recordReviewRating(3, DAY)
    await d.recorder.seedToday(DAY)
    d.recorder.markActiveToday(DAY)
    expect(srv.state.reads).toEqual([KEY])

    d.recorder.recordReviewRating(3, NEXT_DAY) // midnight passed with the app open: the local row for the new day is missing
    await d.recorder.seedToday(NEXT_DAY)
    expect(srv.state.reads).toEqual([KEY, '2026-10-06'])
  })

  it('without a reader there is no seeding at all', async () => {
    const srv = server()
    const d = device(srv, { seed: false })
    await d.recorder.seedToday(DAY)
    expect(d.recorder.seedStatus(DAY).state).toBe('idle')
    expect(srv.state.reads).toEqual([])
  })

  it('the reset testing tool wins: old server counts are not merged back into a reset day', async () => {
    const srv = server()
    srv.rows.set(KEY, row({ reviewsDone: 8, reviewsLapsed: 3, active: true }))
    const d = device(srv, { local: row({ reviewsDone: 8, reviewsLapsed: 3, active: true }) })
    d.recorder.resetToday(DAY) // clears local, queues zeros
    d.recorder.recordReviewRating(3, DAY)
    await d.drained()
    expect(srv.rows.get(KEY)).toMatchObject({ reviewsDone: 1, reviewsLapsed: 0 })
    expect(d.recorder.seedStatus(DAY).state).toBe('skipped')
  })
})

describe('parseServerRow', () => {
  it('reads a server record, and refuses one that is not usable', () => {
    expect(parseServerRow({ user_id: 'u', date: KEY, new_words: 3, reviews_done: 5, reviews_lapsed: 1, due_at_start: 12, learn_pool: 4640, daily_limit: 10, active: true, updated_at: 'x' })).toEqual(
      row({ newWords: 3, reviewsDone: 5, reviewsLapsed: 1, dueAtStart: 12, learnPool: 4640, dailyLimit: 10, active: true }),
    )
    expect(parseServerRow({ date: KEY, new_words: 0, reviews_done: 0, reviews_lapsed: 0, due_at_start: null, learn_pool: 4640, daily_limit: 10, active: false })).toEqual(row({ learnPool: 4640, dailyLimit: 10 }))
    expect(parseServerRow(null)).toBeNull()
    expect(parseServerRow({ date: 'garbage' })).toBeNull()
  })
})
