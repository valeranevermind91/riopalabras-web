import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyMetricsRow } from './metrics'
import type { ProgressUpdate, SettingsPatch, UserSettings } from './types'
import { wordKey } from './words'
import { upsertDailyMetrics, upsertProgress, writeHiddenWords, writeSettings } from './writes'

/** One word's latest hidden state: hidden = true adds it to user_hidden_words, false removes it. */
export interface HiddenOp {
  /** The word in its dictionary casing (the casing the rows are written with). */
  esWord: string
  hidden: boolean
}

export interface QueueSender {
  sendProgress: (updates: readonly ProgressUpdate[]) => Promise<void>
  sendSettings: (patch: SettingsPatch) => Promise<void>
  /** Optional: without it hidden-word changes are not queued at all. Receives the latest state per word. */
  sendHidden?: (ops: readonly HiddenOp[]) => Promise<void>
  /** Optional: the best-effort metrics lane is simply off without it. */
  sendMetrics?: (rows: readonly DailyMetricsRow[]) => Promise<void>
}

export interface QueueStatus {
  /** Words whose latest state hasn't reached the server yet. */
  pendingRatings: number
  pendingSettings: boolean
  /** Hidden-word changes (user_hidden_words) not yet sent. */
  pendingHidden: number
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
  /** The metrics lane is running right now (sending, or sleeping before a retry). */
  metricsRunning: boolean
  /** Metrics send attempts so far in this session, successful or not. */
  metricsAttempts: number
  /** ISO time of the last metrics send attempt / the last one that succeeded; null if none yet. */
  metricsLastAttemptAt: string | null
  metricsLastSuccessAt: string | null
  /** The lane used up its retries and is idle until the next enqueue or retry(). */
  metricsGaveUp: boolean
  /** Metrics rows are waiting only because progress or settings are still unsent (the lane goes last, by design). */
  metricsWaitingForProgress: boolean
}

/** What enqueueBatch hands back: asks whether everything that batch queued has reached the server. */
export interface QueueTicket {
  /** True once every word of the batch (or a newer state of it) and the batch's settings patch are saved. */
  saved: () => boolean
}

export interface WriteQueue {
  /** Records a word's latest state; an earlier unsent state for the same word is replaced. */
  enqueueProgress: (update: ProgressUpdate) => void
  /** Merges keys into the pending settings patch. */
  enqueueSettings: (patch: SettingsPatch) => void
  /**
   * Hides or un-hides a word (user_hidden_words). The latest state per word wins, so "mark as known"
   * followed by "undo" before anything is sent leaves one idempotent removal, never a stuck row.
   */
  enqueueHidden: (esWord: string, hidden: boolean) => void
  /**
   * A finished Learn batch: its words and its settings patch (streak, new-word counter) queued
   * together, in one step, so the drain never sees one without the other. Progress is always sent
   * before settings and a failing progress write stops the drain, so the counter can never reach
   * the server ahead of the words. The patch must hold absolute values, never increments: a retry
   * after a request that actually succeeded then writes the same value again instead of counting twice.
   */
  enqueueBatch: (updates: readonly ProgressUpdate[], patch: SettingsPatch) => QueueTicket
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
  const hiddenOps = new Map<string, HiddenOp>()
  // Batch tickets: the update objects still unsent, and the settings version the batch needs saved.
  interface TicketState {
    updates: Set<ProgressUpdate>
    settingsVersion: number | null
  }
  const tickets = new Set<TicketState>()
  let settingsVersion = 0 // bumped by every enqueued patch
  let settingsSavedVersion = 0 // highest version a successful settings request covered

  let draining: Promise<void> | null = null
  let sending = false
  let failed = false
  let stuck = false
  let metricsRun: Promise<void> | null = null
  let metricsFailures = 0
  let metricsError: string | null = null
  let metricsAttempts = 0
  let metricsLastAttemptAt: string | null = null
  let metricsLastSuccessAt: string | null = null
  let metricsGaveUp = false
  let lastError: string | null = null
  let consecutiveFailures = 0
  let wakeBackoff: (() => void) | null = null
  // Set by flush()/retry(): the current drain stops sleeping between attempts.
  let hurried = false

  const listeners = new Set<() => void>()

  const hasPending = () => progress.size > 0 || hiddenOps.size > 0 || settings !== null

  const computeStatus = (): QueueStatus => ({
    pendingRatings: progress.size,
    pendingSettings: settings !== null,
    pendingHidden: hiddenOps.size,
    sending,
    failed,
    error: lastError,
    unsaved: progress.size > 0 || hiddenOps.size > 0 || settings !== null || sending,
    stuck,
    pendingMetrics: metrics.size,
    metricsError,
    metricsRunning: metricsRun !== null,
    metricsAttempts,
    metricsLastAttemptAt,
    metricsLastSuccessAt,
    metricsGaveUp,
    metricsWaitingForProgress: metrics.size > 0 && hasPending(),
  })
  let status = computeStatus()

  const notify = () => {
    status = computeStatus()
    for (const listener of listeners) listener()
  }


  // A newer state for a word replaces the unsent one; a batch waiting on the old state now waits for the newer one.
  const putProgress = (update: ProgressUpdate) => {
    const key = wordKey(update.esWord)
    const old = progress.get(key)
    if (old && old !== update) {
      for (const ticket of tickets) {
        if (ticket.updates.delete(old)) ticket.updates.add(update)
      }
    }
    progress.set(key, update)
  }
  const putSettings = (patch: SettingsPatch) => {
    settings = { ...settings, ...patch }
    return ++settingsVersion
  }

  // All progress first (including anything queued while earlier chunks were in flight), then settings.
  async function sendOnce() {
    while (progress.size > 0) {
      const chunk = [...progress.values()].slice(0, chunkSize)
      await sender.sendProgress(chunk)
      // Only forget what was actually sent: a newer state for the same word stays queued.
      for (const sent of chunk) {
        const key = wordKey(sent.esWord)
        if (progress.get(key) === sent) progress.delete(key)
        for (const ticket of tickets) ticket.updates.delete(sent)
      }
      for (const ticket of tickets) if (ticket.updates.size === 0) tickets.delete(ticket) // fully sent: only its settings part (a version number) is left to check
      notify()
    }

    if (hiddenOps.size > 0) {
      const ops = [...hiddenOps.values()]
      await sender.sendHidden?.(ops)
      // Only forget what was sent: a newer state for the same word stays queued.
      for (const sent of ops) if (hiddenOps.get(wordKey(sent.esWord)) === sent) hiddenOps.delete(wordKey(sent.esWord))
      notify()
    }

    if (settings) {
      const sent = settings
      const sentVersion = settingsVersion // every patch merged into `sent` has a version <= this
      await sender.sendSettings(sent)
      if (settings === sent) settings = null
      settingsSavedVersion = Math.max(settingsSavedVersion, sentVersion)
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
    metricsGaveUp = false
    // Yields to progress and settings: if they show up (or are stuck failing), the lane stops and is re-kicked after the next drain.
    while (send && metrics.size > 0 && !hasPending()) {
      const rows = [...metrics.values()]
      metricsAttempts++
      metricsLastAttemptAt = new Date().toISOString()
      try {
        await send(rows)
        // Only forget what was sent: a newer row for the same date stays queued.
        for (const sent of rows) if (metrics.get(sent.date) === sent) metrics.delete(sent.date)
        metricsFailures = 0
        metricsError = null
        metricsLastSuccessAt = new Date().toISOString()
        notify()
      } catch (err) {
        metricsError = messageOf(err)
        notify()
        if (metricsFailures >= metricsDelays.length) {
          metricsGaveUp = true
          return
        }
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
        // A row that arrived (or a drain that ended) while this run was winding down must not be left waiting.
        if (!metricsGaveUp) kickMetrics()
      })
    notify()
  }

  function kick() {
    if (draining || failed || !hasPending()) return
    draining = drain().finally(() => {
      draining = null
      hurried = false
      // Something was queued in the instant between the drain's last look and this cleanup: don't leave it waiting.
      if (hasPending() && !failed) kick()
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
      if (!metricsRun) {
        metricsFailures = 0
        metricsGaveUp = false
      }
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
      putProgress(update)
      notify()
      kick()
    },

    enqueueSettings(patch) {
      putSettings(patch)
      notify()
      kick()
    },

    enqueueHidden(esWord, hidden) {
      if (!sender.sendHidden) return
      hiddenOps.set(wordKey(esWord), { esWord, hidden })
      notify()
      kick()
    },

    enqueueBatch(updates, patch) {
      const state: TicketState = { updates: new Set(), settingsVersion: null }
      tickets.add(state) // registered first, so a word that appears twice in the batch hands its ticket to the newer state
      for (const update of updates) {
        putProgress(update)
        state.updates.add(update)
      }
      if (Object.keys(patch).length > 0) state.settingsVersion = putSettings(patch)
      if (state.updates.size === 0) tickets.delete(state)
      notify()
      kick() // once, after both parts are queued
      return {
        saved: () => state.updates.size === 0 && (state.settingsVersion === null || settingsSavedVersion >= state.settingsVersion),
      }
    },

    enqueueMetrics(row) {
      metrics.set(row.date, row)
      if (!metricsRun) {
        metricsFailures = 0 // a new row after the lane gave up starts a fresh round of attempts
        metricsGaveUp = false
      }
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
      sendHidden: (ops) => writeHiddenWords(client, userId, ops),
      sendMetrics: (rows) => upsertDailyMetrics(client, userId, rows),
    },
    options,
  )
}
