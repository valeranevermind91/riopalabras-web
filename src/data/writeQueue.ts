import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyMetricsRow } from './metrics'
import type { ProgressUpdate, SettingsPatch, UserSettings } from './types'
import { wordKey } from './words'
import { upsertDailyMetrics, upsertProgress, writeSettings } from './writes'

export interface QueueSender {
  sendProgress: (updates: readonly ProgressUpdate[]) => Promise<void>
  sendSettings: (patch: SettingsPatch) => Promise<void>
  /** Optional: the best-effort metrics lane is simply off without it. */
  sendMetrics?: (rows: readonly DailyMetricsRow[]) => Promise<void>
}

export interface QueueStatus {
  /** Words whose latest state hasn't reached the server yet. */
  pendingRatings: number
  pendingSettings: boolean
  /** A request is in flight right now. */
  sending: boolean
  /** Automatic retries are exhausted: the UI shows a banner and waits for retry(). */
  failed: boolean
  error: string | null
  /** Anything not yet durably saved (pending, in flight, or failed). Metrics never count: they are best-effort. */
  unsaved: boolean
  /**
   * Automatic retries ran out and nothing has been saved since. Unlike `failed` it stays true
   * during a later single retry attempt, so a banner keyed on it does not flicker; it clears once
   * the queue has drained.
   */
  stuck: boolean
  /** Daily-metrics rows (one per date) waiting in the best-effort lane. */
  pendingMetrics: number
  /** The last metrics send failed (the lane keeps retrying on its own slower schedule). Never affects `failed` or `unsaved`. */
  metricsError: string | null
}

export interface WriteQueue {
  /** Records a word's latest state; an earlier unsent state for the same word is replaced. */
  enqueueProgress: (update: ProgressUpdate) => void
  /** Merges keys into the pending settings patch. */
  enqueueSettings: (patch: SettingsPatch) => void
  /**
   * Records a day's metrics row (the latest row for a date replaces an earlier unsent one). Lowest
   * priority: it is sent only when progress and settings are empty, and its failures are invisible
   * to everything else (no `failed`, no `unsaved`, never blocks flush()).
   */
  enqueueMetrics: (row: DailyMetricsRow) => void
  /** Sends everything now, without sleeping between attempts. Resolves once saved, rejects if it still fails. */
  flush: () => Promise<void>
  /**
   * Retry after a persistent failure (the Retry button, coming back online, the app being shown
   * again): a single attempt, or — if automatic retries are still sleeping — wakes them now. Safe
   * to call repeatedly: it never doubles a request. Resolves true once nothing is left unsent.
   */
  retry: () => Promise<boolean>
  getStatus: () => QueueStatus
  subscribe: (listener: () => void) => () => void
}

export interface WriteQueueOptions {
  /** Waits between automatic attempts; once exhausted the queue reports `failed`. */
  retryDelaysMs?: readonly number[]
  /** Max words per upsert request. */
  chunkSize?: number
  /** Waits between attempts of the metrics lane; once exhausted it idles until the next enqueue or retry(). */
  metricsRetryDelaysMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_RETRY_DELAYS_MS = [1000, 3000, 8000]
const DEFAULT_CHUNK_SIZE = 100
const DEFAULT_METRICS_RETRY_DELAYS_MS = [5000, 30_000, 120_000]

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Background writer: nothing awaits a network round trip per card. Updates are keyed by word (only
 * the latest state is kept), sent serially (progress first, then settings), retried with backoff,
 * and — if the failure persists — reported through `getStatus()` instead of blocking anyone.
 */
export function createWriteQueue(sender: QueueSender, options: WriteQueueOptions = {}): WriteQueue {
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const metricsDelays = options.metricsRetryDelaysMs ?? DEFAULT_METRICS_RETRY_DELAYS_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const progress = new Map<string, ProgressUpdate>()
  let settings: SettingsPatch | null = null
  const metrics = new Map<string, DailyMetricsRow>()

  let draining: Promise<void> | null = null
  let sending = false
  let failed = false
  let stuck = false
  let metricsRun: Promise<void> | null = null
  let metricsFailures = 0
  let metricsError: string | null = null
  let lastError: string | null = null
  let consecutiveFailures = 0
  let wakeBackoff: (() => void) | null = null
  // Set by flush()/retry(): the current drain stops sleeping between attempts.
  let hurried = false

  const listeners = new Set<() => void>()

  const computeStatus = (): QueueStatus => ({
    pendingRatings: progress.size,
    pendingSettings: settings !== null,
    sending,
    failed,
    error: lastError,
    unsaved: progress.size > 0 || settings !== null || sending,
    stuck,
    pendingMetrics: metrics.size,
    metricsError,
  })
  let status = computeStatus()

  const notify = () => {
    status = computeStatus()
    for (const listener of listeners) listener()
  }

  const hasPending = () => progress.size > 0 || settings !== null

  // All progress first (including anything queued while earlier chunks were in flight), then settings.
  async function sendOnce() {
    while (progress.size > 0) {
      const chunk = [...progress.values()].slice(0, chunkSize)
      await sender.sendProgress(chunk)
      // Only forget what was actually sent: a newer state for the same word stays queued.
      for (const sent of chunk) {
        const key = wordKey(sent.esWord)
        if (progress.get(key) === sent) progress.delete(key)
      }
      notify()
    }

    if (settings) {
      const sent = settings
      await sender.sendSettings(sent)
      if (settings === sent) settings = null
      notify()
    }
  }

  const backoff = (ms: number) =>
    hurried
      ? Promise.resolve()
      : Promise.race([
          sleep(ms),
          new Promise<void>((resolve) => {
            wakeBackoff = resolve
          }),
        ]).finally(() => {
          wakeBackoff = null
        })

  const hurry = () => {
    hurried = true
    wakeBackoff?.()
  }

  async function drain() {
    while (hasPending()) {
      sending = true
      notify()
      try {
        await sendOnce()
        consecutiveFailures = 0
        lastError = null
      } catch (err) {
        lastError = messageOf(err)
        sending = false
        if (consecutiveFailures >= delays.length) {
          failed = true
          stuck = true
          notify()
          return
        }
        notify()
        await backoff(delays[consecutiveFailures++])
      } finally {
        sending = false
      }
    }
    stuck = false
    notify()
    kickMetrics()
  }

  // ---- metrics lane: lowest priority, best effort, invisible to everything else ----
  async function runMetrics() {
    const send = sender.sendMetrics
    // Yields to progress and settings: if they show up (or are stuck failing), the lane stops and is re-kicked after the next drain.
    while (send && metrics.size > 0 && !hasPending()) {
      const rows = [...metrics.values()]
      try {
        await send(rows)
        // Only forget what was sent: a newer row for the same date stays queued.
        for (const sent of rows) if (metrics.get(sent.date) === sent) metrics.delete(sent.date)
        metricsFailures = 0
        metricsError = null
        notify()
      } catch (err) {
        metricsError = messageOf(err)
        notify()
        if (metricsFailures >= metricsDelays.length) return
        await sleep(metricsDelays[metricsFailures++])
      }
    }
  }

  function kickMetrics() {
    if (metricsRun || !sender.sendMetrics || metrics.size === 0 || hasPending()) return
    metricsRun = runMetrics()
      .catch(() => {}) // runMetrics handles its own failures; this is only a safety net
      .finally(() => {
        metricsRun = null
        notify()
      })
  }

  function kick() {
    if (draining || failed) return
    draining = drain().finally(() => {
      draining = null
      hurried = false
    })
  }

  const restart = () => {
    failed = false
    consecutiveFailures = 0
    lastError = null
    notify()
  }

  const settled = async () => {
    while (draining) await draining
    return !hasPending()
  }

  function retry(): Promise<boolean> {
    // Automatic retries are still sleeping: wake them now.
    if (draining && !failed) {
      hurry()
      return settled()
    }
    if (!hasPending()) {
      if (!metricsRun) metricsFailures = 0
      kickMetrics()
      return Promise.resolve(true)
    }
    // The drain that gave up is only just finishing: let it end, then make the single attempt.
    if (draining) return draining.then(() => retry())
    restart()
    // One attempt only: if the server is still down the banner comes straight back (no hidden retry storm).
    consecutiveFailures = delays.length
    kick()
    return settled()
  }

  return {
    enqueueProgress(update) {
      progress.set(wordKey(update.esWord), update)
      notify()
      kick()
    },

    enqueueSettings(patch) {
      settings = { ...settings, ...patch }
      notify()
      kick()
    },

    enqueueMetrics(row) {
      metrics.set(row.date, row)
      if (!metricsRun) metricsFailures = 0 // a new row after the lane gave up starts a fresh round of attempts
      notify()
      kickMetrics()
    },

    async flush() {
      if (!hasPending() && !draining) return
      if (failed) restart()
      hurry()
      if (!draining) kick()

      while (draining) await draining
      if (hasPending()) throw new Error(lastError ?? 'Could not save')
    },

    retry,

    getStatus: () => status,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The app's queue: progress goes through upsertProgress, settings through the merge-the-whole-blob write. */
export function createSupabaseWriteQueue(
  client: SupabaseClient,
  userId: string,
  getSettings: () => UserSettings,
  options?: WriteQueueOptions,
): WriteQueue {
  return createWriteQueue(
    {
      sendProgress: (updates) => upsertProgress(client, userId, updates),
      sendSettings: async (patch) => {
        await writeSettings(client, userId, getSettings(), patch)
      },
      sendMetrics: (rows) => upsertDailyMetrics(client, userId, rows),
    },
    options,
  )
}
