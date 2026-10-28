import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import { createMetricsRecorder, emptyRow, mergeRows, parseServerRow, parseStoredRow, type DailyMetricsRow, type MetricsStore } from './metrics'
import { createQueueStore, type StorageLike } from './queueStore'
import { parseSettings } from './settings'
import { toMetricsRow } from './writes'

// user_daily_metrics.learn_cards_seen: the furthest Learn card the person reached that day. A counter that only goes up, written with the rest of the day's summary; until
// sql/user_daily_metrics_learn_cards_seen.sql has been run, the summary must still arrive without it.

const DAY = new Date(2026, 9, 27, 14, 0)
const KEY = '2026-10-27'
const row = (over: Partial<DailyMetricsRow> = {}): DailyMetricsRow => ({ ...emptyRow(KEY), ...over })

function recorder(initial: DailyMetricsRow | null = null) {
  let local = initial
  const store: MetricsStore = { load: () => local, save: (r) => void (local = r), clear: () => void (local = null) }
  const sent: DailyMetricsRow[] = []
  const rec = createMetricsRecorder({ store, enqueue: (r) => void sent.push(r), getSettings: () => parseSettings({ new_words_learned_today_count: 0 }) })
  return { rec, sent, local: () => local }
}

describe('the recorder', () => {
  it('starts a day at 0 and raises it to the furthest card reached, and sends the row when it rises', () => {
    const r = recorder()
    expect(r.rec.today(DAY)).toBeNull()
    r.rec.noteLearnCardsSeen(1, DAY)
    expect(r.rec.today(DAY)).toMatchObject({ date: KEY, learnCardsSeen: 1 })
    r.rec.noteLearnCardsSeen(7, DAY)
    expect(r.rec.today(DAY)?.learnCardsSeen).toBe(7)
    expect(r.sent.map((s) => s.learnCardsSeen)).toEqual([1, 7])
  })

  it('never goes down: going back to an earlier card, or the same card again, changes and sends nothing', () => {
    const r = recorder()
    r.rec.noteLearnCardsSeen(5, DAY)
    r.rec.noteLearnCardsSeen(3, DAY)
    r.rec.noteLearnCardsSeen(5, DAY)
    expect(r.rec.today(DAY)?.learnCardsSeen).toBe(5)
    expect(r.sent).toHaveLength(1)
  })

  it('ignores what is not a card position, and does not throw on it', () => {
    const r = recorder()
    for (const bad of [0, -2, NaN]) r.rec.noteLearnCardsSeen(bad, DAY)
    expect(r.rec.today(DAY)).toBeNull()
    expect(r.sent).toHaveLength(0)
    r.rec.noteLearnCardsSeen(2.9, DAY)
    expect(r.rec.today(DAY)?.learnCardsSeen).toBe(2)
  })

  it('counts a new day from nothing', () => {
    const r = recorder(row({ learnCardsSeen: 9 }))
    r.rec.noteLearnCardsSeen(1, new Date(2026, 9, 28, 9, 0))
    expect(r.rec.today(new Date(2026, 9, 28, 9, 0))).toMatchObject({ date: '2026-10-28', learnCardsSeen: 1 })
  })

  it('leaves the other figures of the day as they are', () => {
    const r = recorder(row({ reviewsDone: 4, dueAtStart: 12, learnPool: 4000, dailyLimit: 10, active: true }))
    r.rec.noteLearnCardsSeen(3, DAY)
    expect(r.rec.today(DAY)).toMatchObject({ reviewsDone: 4, dueAtStart: 12, learnPool: 4000, dailyLimit: 10, learnCardsSeen: 3 })
  })
})

describe('reading the row back', () => {
  it('the stored row: a count, or 0 for a row from before the column, a negative or a word', () => {
    expect(parseStoredRow({ ...emptyRow(KEY), learnCardsSeen: 6 })?.learnCardsSeen).toBe(6)
    const before: Record<string, unknown> = { ...emptyRow(KEY) }
    delete before.learnCardsSeen
    expect(parseStoredRow(before)?.learnCardsSeen).toBe(0)
    expect(parseStoredRow({ ...emptyRow(KEY), learnCardsSeen: -1 })?.learnCardsSeen).toBe(0)
    expect(parseStoredRow({ ...emptyRow(KEY), learnCardsSeen: 'many' })?.learnCardsSeen).toBe(0)
  })

  it('the server row: the column, or 0 for a null (rows from before it was added) and for a database without it', () => {
    const base = { date: KEY, new_words: 0, reviews_done: 0, reviews_lapsed: 0, due_at_start: null, learn_pool: null, daily_limit: null, active: false }
    expect(parseServerRow({ ...base, learn_cards_seen: 8 })?.learnCardsSeen).toBe(8)
    expect(parseServerRow({ ...base, learn_cards_seen: null })?.learnCardsSeen).toBe(0)
    expect(parseServerRow(base)?.learnCardsSeen).toBe(0)
  })

  it('two copies of a day merge to the larger figure, as the other counters do', () => {
    expect(mergeRows(row({ learnCardsSeen: 4 }), row({ learnCardsSeen: 9 }))?.learnCardsSeen).toBe(9)
    expect(mergeRows(row({ learnCardsSeen: 9 }), row({ learnCardsSeen: 4 }))?.learnCardsSeen).toBe(9)
  })

  it('a row with only this figure is not empty, so it is saved and sent', () => {
    const r = recorder()
    r.rec.noteLearnCardsSeen(1, DAY)
    expect(r.local()).not.toBeNull()
  })

  it('a row waiting in the write queue across a reload keeps it (and one saved by an older version reads as 0)', () => {
    const items = new Map<string, string>()
    const storage: StorageLike = { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) }
    const now = Date.parse('2026-10-27T12:00:00Z')
    const store = createQueueStore('u1', storage, () => now)
    const snapshot = (metrics: unknown[]) => ({ progress: [], hidden: [], favorites: [], settings: null, metrics: metrics.map((value) => ({ value, at: now })), log: [], words: [] })
    const readBack = () => store.load()?.snapshot.metrics[0]?.value as DailyMetricsRow | undefined
    store.save(snapshot([row({ learnCardsSeen: 7 })]) as never)
    expect(readBack()?.learnCardsSeen).toBe(7)
    const old: Record<string, unknown> = { ...row() }
    delete old.learnCardsSeen
    store.save(snapshot([old]) as never)
    expect(readBack()?.learnCardsSeen).toBe(0)
  })
})

describe('the row that is written', () => {
  it('carries the figure as learn_cards_seen', () => {
    expect(toMetricsRow('u', row({ learnCardsSeen: 7 }), 'x').learn_cards_seen).toBe(7)
  })
})

describe('against the database, before and after the column', () => {
  let server: ReturnType<typeof createFakeServer>
  beforeEach(() => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.test')
    vi.resetModules()
    server = createFakeServer()
    vi.stubGlobal('fetch', server.fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  async function signedIn() {
    const { ensureSession } = await import('../lib/auth')
    const client = server.client()
    const auth = await ensureSession(client, initDataFor(3), 3)
    if (auth.status !== 'signed-in') throw new Error('sign-in failed')
    return { client, userId: auth.userId }
  }
  const posts = () => server.log.filter((l) => l.url === '/rest/v1/user_daily_metrics' && l.method === 'POST').map((l) => l.status)

  it('with the column: the figure is written with the day', async () => {
    const { client, userId } = await signedIn()
    const { upsertDailyMetrics } = await import('./writes')
    await upsertDailyMetrics(client, userId, [row({ newWords: 7, learnCardsSeen: 7 })])
    expect(server.rows('user_daily_metrics')[0]).toMatchObject({ date: KEY, new_words: 7, learn_cards_seen: 7 })
  })

  it('without the column (the migration not run): refused by name and sent again without it, so the rest of the day is saved', async () => {
    const { client, userId } = await signedIn()
    const { upsertDailyMetrics } = await import('./writes')
    server.break.missingColumn = 'learn_cards_seen'
    await upsertDailyMetrics(client, userId, [row({ newWords: 7, reviewsDone: 2, learnCardsSeen: 7 })])
    expect(posts()[0]).toBe(400)
    expect(posts()).toHaveLength(2)
    expect(server.rows('user_daily_metrics')[0]).toMatchObject({ date: KEY, new_words: 7, reviews_done: 2 })
    expect('learn_cards_seen' in server.rows('user_daily_metrics')[0]).toBe(false)
  })

  it('any other refusal is still a failure, and is not sent a second time', async () => {
    const { client, userId } = await signedIn()
    const { upsertDailyMetrics } = await import('./writes')
    server.break.forbidTable = 'user_daily_metrics'
    await expect(upsertDailyMetrics(client, userId, [row({ learnCardsSeen: 3 })])).rejects.toThrow(/user_daily_metrics/)
    expect(posts()).toHaveLength(1)
  })
})

describe('sql/user_daily_metrics_learn_cards_seen.sql', () => {
  const sql = readFileSync('sql/user_daily_metrics_learn_cards_seen.sql', 'utf8')
  const statements = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--') && l.trim() !== '')
    .join(' ')
    .split(';')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)

  it('is one statement: add the column, nullable, no default, nothing else on it, and safe to run twice', () => {
    expect(statements).toEqual(['alter table public.user_daily_metrics add column if not exists learn_cards_seen integer'])
  })

  it('says it must be run before the version that writes the column is deployed, and that nothing in the repo runs it', () => {
    expect(sql).toMatch(/NOT RUN BY THE REPOSITORY/)
    expect(sql).toMatch(/before .* deploy/i)
  })

  it('names the column the app writes', () => {
    expect(readFileSync('src/data/writes.ts', 'utf8')).toContain('learn_cards_seen')
  })
})
