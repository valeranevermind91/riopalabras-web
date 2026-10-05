import type { SupabaseClient } from '@supabase/supabase-js'
import { learnedToday } from './daily'
import { localDateKey } from './dates'
import type { UserSettings } from './types'

/**
 * One local calendar day of recommendation-system metrics: the same row the Flutter app's
 * DailyMetricsService accumulated and pushed to user_daily_metrics. Not recorded (Flutter did not
 * record them either): a ratings breakdown and time spent.
 */
export interface DailyMetricsRow {
  /** Local calendar date, YYYY-MM-DD (never UTC). */
  readonly date: string
  /** Brand-new words introduced today, mirrored from the daily counter in settings. */
  readonly newWords: number
  readonly reviewsDone: number
  /** Reviews rated 1 ("Again"). */
  readonly reviewsLapsed: number
  /** Review-due count, learn pool size and daily limit as seen the first time Home loaded that day. Null until then. */
  readonly dueAtStart: number | null
  readonly learnPool: number | null
  readonly dailyLimit: number | null
  /** Any real activity today: a review rating or a finished Learn batch. */
  readonly active: boolean
}

export interface StartOfDaySnapshot {
  readonly reviewDue: number
  readonly learnPool: number
  readonly dailyLimit: number
}

export function emptyRow(date: string): DailyMetricsRow {
  return { date, newWords: 0, reviewsDone: 0, reviewsLapsed: 0, dueAtStart: null, learnPool: null, dailyLimit: null, active: false }
}

/** The stored row if it is for today, otherwise a fresh zeroed one (a stale date counts as empty). */
export function rowForToday(todayKey: string, stored: DailyMetricsRow | null): DailyMetricsRow {
  return stored && stored.date === todayKey ? stored : emptyRow(todayKey)
}

/** Whether the once-per-day snapshot still has to be captured: never overwrite the value taken at the start of the day. */
export function shouldSnapshot(todayKey: string, stored: DailyMetricsRow | null): boolean {
  return stored?.date !== todayKey || stored.dueAtStart === null
}

const int = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback)
const nullableInt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)

/** Validates what came out of storage; anything malformed is treated as "nothing stored". */
export function parseStoredRow(raw: unknown): DailyMetricsRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return null
  return {
    date: r.date,
    newWords: int(r.newWords, 0),
    reviewsDone: int(r.reviewsDone, 0),
    reviewsLapsed: int(r.reviewsLapsed, 0),
    dueAtStart: nullableInt(r.dueAtStart),
    learnPool: nullableInt(r.learnPool),
    dailyLimit: nullableInt(r.dailyLimit),
    active: r.active === true,
  }
}

const isEmptyRow = (r: DailyMetricsRow) =>
  r.newWords === 0 && r.reviewsDone === 0 && r.reviewsLapsed === 0 && !r.active && r.dueAtStart === null && r.learnPool === null && r.dailyLimit === null

const sameRow = (a: DailyMetricsRow, b: DailyMetricsRow) =>
  a.date === b.date &&
  a.newWords === b.newWords &&
  a.reviewsDone === b.reviewsDone &&
  a.reviewsLapsed === b.reviewsLapsed &&
  a.active === b.active &&
  a.dueAtStart === b.dueAtStart &&
  a.learnPool === b.learnPool &&
  a.dailyLimit === b.dailyLimit

/** A user_daily_metrics record as the server returns it (snake_case) → a row; null when it is not usable. */
export function parseServerRow(raw: Record<string, unknown> | null): DailyMetricsRow | null {
  if (!raw) return null
  return parseStoredRow({
    date: raw.date,
    newWords: raw.new_words,
    reviewsDone: raw.reviews_done,
    reviewsLapsed: raw.reviews_lapsed,
    dueAtStart: raw.due_at_start,
    learnPool: raw.learn_pool,
    dailyLimit: raw.daily_limit,
    active: raw.active,
  })
}

/**
 * Two devices (or a device and its own earlier session) each hold part of a day. Counters only
 * move forward (the larger value wins), `active` is OR-ed, and a start-of-day snapshot already set
 * on the server is kept: the first snapshot of the day is the true one. Null when neither has a row.
 */
export function mergeRows(local: DailyMetricsRow | null, server: DailyMetricsRow | null): DailyMetricsRow | null {
  if (!local && !server) return null
  const a = local ?? server!
  const b = server ?? local!
  return {
    date: a.date,
    newWords: Math.max(a.newWords, b.newWords),
    reviewsDone: Math.max(a.reviewsDone, b.reviewsDone),
    reviewsLapsed: Math.max(a.reviewsLapsed, b.reviewsLapsed),
    dueAtStart: server?.dueAtStart ?? local?.dueAtStart ?? null,
    learnPool: server?.learnPool ?? local?.learnPool ?? null,
    dailyLimit: server?.dailyLimit ?? local?.dailyLimit ?? null,
    active: a.active || b.active,
  }
}

/**
 * Where the day's accumulated row lives between sessions (the web stand-in for Flutter's Hive box).
 * The Mini App reloads from scratch on every open and the server is never read back, so without
 * this a counter would restart at 0 and overwrite the day's earlier total.
 */
export interface MetricsStore {
  load: () => DailyMetricsRow | null
  save: (row: DailyMetricsRow) => void
  /** Forgets the stored row (testing tool: start the day from zero). */
  clear: () => void
}

/** localStorage-backed, one key per user holding the latest day's row; falls back to memory when storage is unavailable. */
export function createLocalMetricsStore(userId: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safeLocalStorage()): MetricsStore {
  const key = `riopalabras.dailyMetrics.v1.${userId}`
  let memory: DailyMetricsRow | null = null
  return {
    load() {
      try {
        const raw = storage?.getItem(key)
        if (raw) return parseStoredRow(JSON.parse(raw))
      } catch {
        // unreadable storage or corrupt JSON: fall through to the in-memory copy
      }
      return memory
    },
    clear() {
      memory = null
      try {
        storage?.removeItem(key)
      } catch {
        // nothing more can be done: the in-memory copy is already gone
      }
    },
    save(row) {
      memory = row
      try {
        storage?.setItem(key, JSON.stringify(row))
      } catch {
        // storage full or blocked: the in-memory copy still covers this session
      }
    },
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export interface MetricsRecorderDeps {
  store: MetricsStore
  /** Hands the updated row to the write queue's metrics lane. */
  enqueue: (row: DailyMetricsRow) => void
  /** Latest settings (for today's new-word counter). */
  getSettings: () => UserSettings
  /**
   * Reads one day's row from the server. Used only to seed the local row (see seedToday), never for
   * app logic. Without it there is no seeding and every push is the local row alone.
   */
  fetchServerRow?: (date: string) => Promise<DailyMetricsRow | null>
  /** How long a seeding read may take before the local row is used as it is. */
  seedTimeoutMs?: number
}

export type SeedState = 'idle' | 'reading' | 'merged' | 'failed' | 'skipped'

export interface SeedStatus {
  state: SeedState
  detail: string | null
}

export interface MetricsRecorder {
  /** Once per Review rating; `quality` 1 is a lapse. */
  recordReviewRating: (quality: number, now?: Date) => void
  /** A finished Learn batch (call after its settings were applied, so the new-word counter is current). */
  markActiveToday: (now?: Date) => void
  /** Home: the start-of-day snapshot, captured once per day. */
  captureStartOfDaySnapshotIfNeeded: (snapshot: StartOfDaySnapshot, now?: Date) => void
  /** Today's accumulated row as recorded on this device, or null if nothing was recorded today. */
  today: (now?: Date) => DailyMetricsRow | null
  /**
   * Testing tool: forgets today's local row and queues a zeroed row for the same date (an upsert
   * that overwrites the server's copy), so the day can be re-tested from nothing. Returns the
   * zeroed row, or null if it could not be done. The start-of-day snapshot is retaken the next time Home shows.
   */
  resetToday: (now?: Date) => DailyMetricsRow | null
  /**
   * Reads today's server row once and merges it into the local row (see mergeRows), then pushes the
   * merged row if the server was missing something. Until it settles, changes are kept locally and
   * not pushed, so a device with an empty row can never overwrite another device's counts. If the
   * read fails or times out, the local row carries on as before. Once per date; later calls share the first.
   */
  seedToday: (now?: Date) => Promise<void>
  seedStatus: (now?: Date) => SeedStatus
}

/**
 * Port of DailyMetricsService. Recording is strictly best-effort: whatever goes wrong here (storage,
 * settings not loaded, the queue) is swallowed, so a metrics problem can never stop a rating or a
 * Learn batch.
 */
export function createMetricsRecorder(deps: MetricsRecorderDeps): MetricsRecorder {
  const timeoutMs = deps.seedTimeoutMs ?? 8000
  interface Seed {
    state: SeedState
    detail: string | null
    promise: Promise<void>
    cancelled: boolean
  }
  const seeds = new Map<string, Seed>()

  const readServer = async (date: string): Promise<DailyMetricsRow | null> => {
    const read = deps.fetchServerRow!(date)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer after ${timeoutMs} ms`)), timeoutMs)
    })
    try {
      return await Promise.race([read, timeout])
    } finally {
      clearTimeout(timer)
      read.catch(() => {}) // a late failure after the timeout is not an unhandled rejection
    }
  }

  const startSeed = (date: string): Seed | null => {
    if (!deps.fetchServerRow) return null
    const existing = seeds.get(date)
    if (existing) return existing

    const seed: Seed = { state: 'reading', detail: null, promise: Promise.resolve(), cancelled: false }
    seeds.set(date, seed)
    seed.promise = (async () => {
      let server: DailyMetricsRow | null = null
      let failure: string | null = null
      try {
        server = await readServer(date)
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err)
      }
      if (seed.cancelled) return
      try {
        const stored = deps.store.load()
        const local = stored && stored.date === date ? stored : null
        if (failure !== null) {
          // Carry on with the local row, as before seeding existed: push what was held back.
          seed.state = 'failed'
          seed.detail = failure
          if (local) deps.enqueue(local)
          return
        }
        const merged = mergeRows(local, server)
        if (merged) deps.store.save(merged)
        seed.state = 'merged'
        seed.detail = server ? 'server row merged into the local row' : 'no server row yet'
        // Push only when the server is missing something and there is something to say.
        if (merged && !isEmptyRow(merged) && !(server && sameRow(merged, server))) deps.enqueue(merged)
      } catch (err) {
        seed.state = 'failed'
        seed.detail = err instanceof Error ? err.message : String(err)
      }
    })()
    return seed
  }

  const update = (now: Date, change: (row: DailyMetricsRow) => DailyMetricsRow) => {
    try {
      const todayKey = localDateKey(now)
      const seed = startSeed(todayKey) // the first change of a day on this device also seeds, if opening the app did not already
      const next = change(rowForToday(todayKey, deps.store.load()))
      deps.store.save(next)
      if (seed?.state !== 'reading') deps.enqueue(next) // while the server row is being read, the merge pushes
    } catch {
      // never let metrics interfere with learning
    }
  }
  const newWordsNow = (now: Date, fallback: number): number => {
    try {
      return learnedToday(deps.getSettings(), now)
    } catch {
      return fallback
    }
  }

  return {
    recordReviewRating(quality, now = new Date()) {
      update(now, (row) => ({
        ...row,
        reviewsDone: row.reviewsDone + 1,
        reviewsLapsed: row.reviewsLapsed + (quality === 1 ? 1 : 0),
        newWords: newWordsNow(now, row.newWords),
        active: true,
      }))
    },

    markActiveToday(now = new Date()) {
      update(now, (row) => ({ ...row, newWords: newWordsNow(now, row.newWords), active: true }))
    },

    captureStartOfDaySnapshotIfNeeded(snapshot, now = new Date()) {
      try {
        if (!shouldSnapshot(localDateKey(now), deps.store.load())) return
      } catch {
        return
      }
      update(now, (row) => ({ ...row, dueAtStart: snapshot.reviewDue, learnPool: snapshot.learnPool, dailyLimit: snapshot.dailyLimit }))
    },

    resetToday(now = new Date()) {
      try {
        const key = localDateKey(now)
        const zeroed = emptyRow(key)
        // The reset is the truth for today: never merge the server's old counts back in.
        const seed = seeds.get(key)
        if (seed) {
          seed.cancelled = true
          seed.state = 'skipped'
          seed.detail = 'reset by hand'
        } else {
          seeds.set(key, { state: 'skipped', detail: 'reset by hand', promise: Promise.resolve(), cancelled: true })
        }
        deps.store.clear()
        deps.enqueue(zeroed)
        return zeroed
      } catch {
        return null
      }
    },

    seedToday(now = new Date()) {
      return startSeed(localDateKey(now))?.promise ?? Promise.resolve()
    },

    seedStatus(now = new Date()) {
      const seed = seeds.get(localDateKey(now))
      return seed ? { state: seed.state, detail: seed.detail } : { state: 'idle', detail: null }
    },

    today(now = new Date()) {
      try {
        const stored = deps.store.load()
        return stored && stored.date === localDateKey(now) ? stored : null
      } catch {
        return null
      }
    },
  }
}

/** Debug only: one on-demand look at what the server holds for a day. Nothing in the app reads this table for its own logic. */
export async function fetchServerMetricsRow(client: SupabaseClient, userId: string, date: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await client.from('user_daily_metrics').select('*').eq('user_id', userId).eq('date', date).maybeSingle()
  if (error) throw new Error(`user_daily_metrics: ${error.message}`)
  return (data as Record<string, unknown> | null) ?? null
}
