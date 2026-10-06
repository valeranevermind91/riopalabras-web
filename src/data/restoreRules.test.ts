import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import { makeUpdate } from '../testing/makeWord'
import { localDateKey } from './dates'
import { emptyRow, type DailyMetricsRow } from './metrics'
import { createQueueStore, storageKeyFor, type StorageLike } from './queueStore'
import { reconcileSettingsPatch, type ServerSettings } from './restoreRules'
import { parseSettings } from './settings'
import { computeRemainingToday } from './stats'
import { restoreAndFlush } from './startup'
import { createWriteQueue } from './writeQueue'

const server = (blob: Record<string, unknown>, updatedAt: number | null = null): ServerSettings => ({ blob, updatedAt })
const COUNTER = ['new_words_learned_today_date', 'new_words_learned_today_count'] as const
const STREAK = ['streak_last_activity_date', 'streak_count'] as const
const restoredAll = (patch: Record<string, unknown>) => new Set(Object.keys(patch))
const reconcile = (patch: Record<string, unknown>, blob: Record<string, unknown>, opts: { restored?: Set<string>; queuedAt?: number; updatedAt?: number | null } = {}) =>
  reconcileSettingsPatch(patch, opts.restored ?? restoredAll(patch), Object.fromEntries(Object.keys(patch).map((k) => [k, opts.queuedAt ?? 0])), server(blob, opts.updatedAt ?? null))

describe('settings: the daily counter moves forward only', () => {
  it('an old restored counter never resets today: an older date is skipped whole', () => {
    // The phone queued yesterday's counter; meanwhile another device already counted today.
    const r = reconcile({ [COUNTER[0]]: '2026-10-05', [COUNTER[1]]: 10 }, { [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 4 })
    expect(r.write).toEqual({})
    expect(r.skipped.sort()).toEqual([...COUNTER].sort())
  })

  it('a restored counter for a later date than the server\'s is written (the phone is ahead)', () => {
    const r = reconcile({ [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 3 }, { [COUNTER[0]]: '2026-10-05', [COUNTER[1]]: 10 })
    expect(r.write).toEqual({ [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 3 })
  })

  it('on the same date the larger count wins, whichever side has it', () => {
    expect(reconcile({ [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 4 }, { [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 9 }).write).toEqual({ [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 9 })
    expect(reconcile({ [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 9 }, { [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 4 }).write).toEqual({ [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 9 })
  })

  it('with no counter on the server there is nothing to regress: it is written', () => {
    expect(reconcile({ [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 4 }, {}).write).toEqual({ [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 4 })
  })

  it('half a pair cannot be compared and is not written', () => {
    const r = reconcile({ [COUNTER[1]]: 10 }, { [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 4 })
    expect(r.write).toEqual({})
    expect(r.skipped).toEqual([COUNTER[1]])
    const garbage = reconcile({ [COUNTER[0]]: 'yesterday', [COUNTER[1]]: 10 }, { [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 4 })
    expect(garbage.write).toEqual({})
  })

  it('the streak follows the same rule', () => {
    expect(reconcile({ [STREAK[0]]: '2026-10-04', [STREAK[1]]: 2 }, { [STREAK[0]]: '2026-10-06', [STREAK[1]]: 9 }).write).toEqual({})
    expect(reconcile({ [STREAK[0]]: '2026-10-06', [STREAK[1]]: 3 }, { [STREAK[0]]: '2026-10-06', [STREAK[1]]: 5 }).write).toEqual({ [STREAK[0]]: '2026-10-06', [STREAK[1]]: 5 })
    expect(reconcile({ [STREAK[0]]: '2026-10-06', [STREAK[1]]: 6 }, { [STREAK[0]]: '2026-10-05', [STREAK[1]]: 5 }).write).toEqual({ [STREAK[0]]: '2026-10-06', [STREAK[1]]: 6 })
  })

  it('is safe to apply twice (a retry after a request that actually succeeded)', () => {
    const patch = { [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 4 }
    const once = reconcile(patch, { [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 9 }).write
    expect(reconcile(patch, { ...once }).write).toEqual(once)
  })
})

describe('settings: every other restored key is written only if the server has not moved on', () => {
  it('skipped when the server row was written after the entry was queued, written when before, or when the server has no value', () => {
    expect(reconcile({ theme_preference: 'dark' }, { theme_preference: 'light' }, { queuedAt: 1000, updatedAt: 2000 }).write).toEqual({})
    expect(reconcile({ theme_preference: 'dark' }, { theme_preference: 'light' }, { queuedAt: 3000, updatedAt: 2000 }).write).toEqual({ theme_preference: 'dark' })
    expect(reconcile({ theme_preference: 'dark' }, { other: 1 }, { queuedAt: 1000, updatedAt: 2000 }).write).toEqual({ theme_preference: 'dark' })
    expect(reconcile({ theme_preference: 'dark' }, { theme_preference: 'light' }, { queuedAt: 1000, updatedAt: null }).write).toEqual({ theme_preference: 'dark' })
  })
})

describe('settings: only restored keys are second-guessed', () => {
  it('a value queued in this run is written as it is, even an "older" date: it is the user\'s latest action', () => {
    const patch = { [COUNTER[0]]: '2026-10-05', [COUNTER[1]]: 10, theme_preference: 'dark' }
    const r = reconcile(patch, { [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 4, theme_preference: 'light' }, { restored: new Set(), queuedAt: 1, updatedAt: 9 })
    expect(r.write).toEqual(patch)
    expect(r.skipped).toEqual([])
  })
  it('mixed: the restored pair is checked, the fresh key passes', () => {
    const patch = { [COUNTER[0]]: '2026-10-05', [COUNTER[1]]: 10, theme_preference: 'dark' }
    const r = reconcile(patch, { [COUNTER[0]]: '2026-10-06', [COUNTER[1]]: 4 }, { restored: new Set(COUNTER) })
    expect(r.write).toEqual({ theme_preference: 'dark' })
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The same rules through the real queue, the real client and a fake server that holds state from "another device".
// ---------------------------------------------------------------------------------------------------------------
const NOW = Date.parse('2026-10-06T15:00:00Z')
const T_OLD = NOW - 24 * 60 * 60 * 1000

function memoryStorage() {
  const items = new Map<string, string>()
  const storage: StorageLike & { items: Map<string, string> } = {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  }
  return storage
}

describe('an old restored entry arriving after newer state from another device', () => {
  let fake: ReturnType<typeof createFakeServer>
  beforeEach(() => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.test')
    vi.resetModules()
    fake = createFakeServer({ now: () => NOW })
    vi.stubGlobal('fetch', fake.fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  /** The user signs in; their phone's earlier (killed) run left `queue` on disk; another device has written `server`. */
  async function scenario(opts: { killed: (q: ReturnType<typeof createWriteQueue>) => void; serverSettings?: Record<string, unknown>; serverUpdatedAt?: string; serverMetrics?: Record<string, unknown>[] }) {
    const { ensureSession } = await import('../lib/auth')
    const { createSupabaseWriteQueue } = await import('./writeQueue')
    const client = fake.client()
    const initData = initDataFor(7)
    const auth = await ensureSession(client, initData, 7)
    if (auth.status !== 'signed-in') throw new Error('sign-in failed')
    const userId = auth.userId

    const storage = memoryStorage()
    const clockOld = () => T_OLD
    const dead = createWriteQueue(
      { sendProgress: () => new Promise(() => {}), sendSettings: () => new Promise(() => {}), sendMetrics: () => new Promise(() => {}) },
      { store: createQueueStore(userId, storage, clockOld), now: clockOld, sendTimeoutMs: 2_000_000_000 },
    )
    opts.killed(dead)

    if (opts.serverSettings) fake.tables.set('user_settings', [{ user_id: userId, settings: opts.serverSettings, updated_at: opts.serverUpdatedAt ?? new Date(NOW - 3600_000).toISOString() }])
    if (opts.serverMetrics) fake.tables.set('user_daily_metrics', opts.serverMetrics.map((r) => ({ user_id: userId, ...r })))

    const queue = createSupabaseWriteQueue(client, userId, () => null, {
      store: createQueueStore(userId, storage, () => NOW),
      now: () => NOW,
      retryDelaysMs: [1, 1, 1],
      metricsRetryDelaysMs: [1],
      sleep: async () => {},
      sendTimeoutMs: 2000,
      recoverSession: async () => (await ensureSession(client, initData, 7, { force: true })).status === 'signed-in',
    })
    return { queue, storage, userId, blob: () => (fake.rows('user_settings')[0]?.settings ?? null) as Record<string, unknown> | null, metricsRow: (date: string) => fake.rows('user_daily_metrics').find((r) => r.date === date) }
  }

  it('the daily cap cannot be bypassed: yesterday\'s counter replayed after today\'s count from another device leaves today\'s count alone', async () => {
    const s = await scenario({
      killed: (q) => q.enqueueSettings({ new_words_learned_today_date: '2026-10-05', new_words_learned_today_count: 10 }),
      serverSettings: { daily_new_word_limit: 10, new_words_learned_today_date: '2026-10-06', new_words_learned_today_count: 4, theme_preference: 'dark' },
    })
    await restoreAndFlush(s.queue)

    expect(s.blob()).toMatchObject({ new_words_learned_today_date: '2026-10-06', new_words_learned_today_count: 4, theme_preference: 'dark' })
    // What it protects: 6 of today's 10 are still available, not 10 (or 0 learned, as an old date would read).
    const settings = parseSettings(s.blob())
    expect(computeRemainingToday(settings, new Date(2026, 9, 6, 12))).toBe(6)
    expect(s.queue.getStatus().unsaved).toBe(false) // it was handled, not left stuck
    expect(s.storage.items.has(storageKeyFor(s.userId))).toBe(false)
  })

  it('on the same day the higher count wins, so neither device can lower it', async () => {
    const s = await scenario({
      killed: (q) => q.enqueueSettings({ new_words_learned_today_date: '2026-10-06', new_words_learned_today_count: 10, streak_last_activity_date: '2026-10-06', streak_count: 3 }),
      serverSettings: { new_words_learned_today_date: '2026-10-06', new_words_learned_today_count: 4, streak_last_activity_date: '2026-10-06', streak_count: 8 },
    })
    await restoreAndFlush(s.queue)
    expect(s.blob()).toMatchObject({ new_words_learned_today_count: 10, streak_count: 8 })
  })

  it('a restored value from a day the server has not seen yet is written, and keys the patch does not name are untouched', async () => {
    const s = await scenario({
      killed: (q) => q.enqueueSettings({ new_words_learned_today_date: '2026-10-06', new_words_learned_today_count: 5 }),
      serverSettings: { new_words_learned_today_date: '2026-10-05', new_words_learned_today_count: 10, learn_picks: ['x'] },
    })
    await restoreAndFlush(s.queue)
    expect(s.blob()).toEqual({ new_words_learned_today_date: '2026-10-06', new_words_learned_today_count: 5, learn_picks: ['x'] })
  })

  it('another key (the theme) queued before the server row was last written does not win; one queued after does', async () => {
    const stale = await scenario({
      killed: (q) => q.enqueueSettings({ theme_preference: 'light' }),
      serverSettings: { theme_preference: 'dark' },
      serverUpdatedAt: new Date(NOW - 1000).toISOString(), // written after the entry was queued (a day ago)
    })
    await restoreAndFlush(stale.queue)
    expect(stale.blob()).toEqual({ theme_preference: 'dark' })
  })

  it('metrics: an old restored row for another date is merged with the server\'s, not written over it', async () => {
    const old: DailyMetricsRow = { ...emptyRow('2026-10-05'), newWords: 3, reviewsDone: 10, reviewsLapsed: 1, active: true }
    const s = await scenario({
      killed: (q) => q.enqueueMetrics(old),
      serverMetrics: [{ date: '2026-10-05', new_words: 10, reviews_done: 2, reviews_lapsed: 0, due_at_start: 15, learn_pool: 4000, daily_limit: 10, active: false }],
    })
    await restoreAndFlush(s.queue)
    await vi.waitFor(() => expect(s.queue.getStatus().pendingMetrics).toBe(0))
    expect(s.metricsRow('2026-10-05')).toMatchObject({ new_words: 10, reviews_done: 10, reviews_lapsed: 1, due_at_start: 15, learn_pool: 4000, daily_limit: 10, active: true })
  })

  it('metrics: today\'s restored row is merged too (the seeding runs only after this), so it cannot lower another device\'s counts', async () => {
    const today = localDateKey(new Date(NOW))
    const s = await scenario({
      killed: (q) => q.enqueueMetrics({ ...emptyRow(today), reviewsDone: 5, active: true }),
      serverMetrics: [{ date: today, new_words: 0, reviews_done: 20, reviews_lapsed: 3, due_at_start: null, learn_pool: null, daily_limit: null, active: true }],
    })
    await restoreAndFlush(s.queue)
    await vi.waitFor(() => expect(s.queue.getStatus().pendingMetrics).toBe(0))
    expect(s.metricsRow(today)).toMatchObject({ reviews_done: 20, reviews_lapsed: 3 })
  })

  it('metrics: a restored row for a day the server has no row for is simply written', async () => {
    const s = await scenario({ killed: (q) => q.enqueueMetrics({ ...emptyRow('2026-10-04'), newWords: 6, active: true }) })
    await restoreAndFlush(s.queue)
    await vi.waitFor(() => expect(s.queue.getStatus().pendingMetrics).toBe(0))
    expect(s.metricsRow('2026-10-04')).toMatchObject({ new_words: 6, active: true })
  })

  it('metrics: if the server\'s row cannot be read, nothing is sent (no blind overwrite) and the row stays queued and saved', async () => {
    const s = await scenario({
      killed: (q) => q.enqueueMetrics({ ...emptyRow('2026-10-05'), reviewsDone: 10, active: true }),
      serverMetrics: [{ date: '2026-10-05', new_words: 10, reviews_done: 50, reviews_lapsed: 0, due_at_start: null, learn_pool: null, daily_limit: null, active: true }],
    })
    fake.break.failReadsOf = 'user_daily_metrics'
    await restoreAndFlush(s.queue)
    await vi.waitFor(() => expect(s.queue.getStatus().metricsGaveUp).toBe(true))
    expect(s.metricsRow('2026-10-05')).toMatchObject({ reviews_done: 50 }) // untouched
    expect(s.queue.getStatus().pendingMetrics).toBe(1)
    expect(s.storage.items.has(storageKeyFor(s.userId))).toBe(true)
  })

  it('a value queued in the running app after the restore is not treated as a replay', async () => {
    const s = await scenario({
      killed: (q) => q.enqueueSettings({ new_words_learned_today_date: '2026-10-05', new_words_learned_today_count: 10 }),
      serverSettings: { new_words_learned_today_date: '2026-10-06', new_words_learned_today_count: 4 },
    })
    s.queue.restore()
    s.queue.enqueueSettings({ new_words_learned_today_date: '2026-10-06', new_words_learned_today_count: 5 }) // the user just learned a word
    await vi.waitFor(() => expect(s.queue.getStatus().unsaved).toBe(false))
    expect(s.blob()).toMatchObject({ new_words_learned_today_date: '2026-10-06', new_words_learned_today_count: 5 })
  })

  it('progress is replayed as queued: no rule is applied, because user_progress.updated_at cannot be compared (see the report)', async () => {
    const s = await scenario({ killed: (q) => q.enqueueProgress(makeUpdate('casa', { repetitions: 2 })) })
    await restoreAndFlush(s.queue)
    expect(fake.rows('user_progress').map((r) => [r.es_word, r.repetitions])).toEqual([['casa', 2]])
  })
})
