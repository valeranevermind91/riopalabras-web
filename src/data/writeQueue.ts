import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyMetricsRow } from './metrics'
import type { CustomWordOp, CustomWordRow, ProgressUpdate, SettingsPatch, UserSettings } from './types'
import { isOffline } from '../lib/online'
import { fetchSettings, fetchSettingsRow } from './overlay'
import { fetchServerMetricsRow, mergeRows, parseServerRow } from './metrics'
import { reconcileSettingsPatch } from './restoreRules'
import { parseSettings } from './settings'
import { createQueueStore, type FavoriteOpEntry, type HiddenOpEntry, type QueueSnapshot, type QueueStore } from './queueStore'
import { wordKey } from './words'
import { WriteError, isRejection, upsertDailyMetrics, upsertProgress, writeCustomWords, writeFavoriteWords, writeHiddenWords, writeSettings } from './writes'

/** One word's latest hidden state: hidden = true adds it to user_hidden_words, false removes it. */
export interface HiddenOp {
  /** The word in its dictionary casing (the casing the rows are written with). */
  esWord: string
  hidden: boolean
}

/** One word's latest favourite state: favorite = true adds it to user_favorites, false removes it. */
export interface FavoriteOp {
  esWord: string
  favorite: boolean
}

export interface QueueSender {
  sendProgress: (updates: readonly ProgressUpdate[]) => Promise<void>
  /**
   * `restored` is given only when some of the patch's keys came back from storage after a restart (they are old, and
   * the sender may need to check them against the server, see restoreRules.ts); `queuedAt` is when each key was queued.
   */
  sendSettings: (patch: SettingsPatch, restored?: { keys: ReadonlySet<string>; queuedAt: Readonly<Record<string, number>> }) => Promise<void>
  /** Optional: without it hidden-word changes are not queued at all. Receives the latest state per word. */
  sendHidden?: (ops: readonly HiddenOp[]) => Promise<void>
  /** Optional: without it favourite changes are not queued at all. Receives the latest state per word. */
  sendFavorites?: (ops: readonly FavoriteOp[]) => Promise<void>
  /**
   * Optional: without it custom-word changes are not queued at all. Receives the latest change per word: the saves go out
   * before the settings, the deletes after them (the tombstone in pending_word_deletes has to be on the server first).
   */
  sendWords?: (ops: readonly CustomWordOp[]) => Promise<void>
  /** Optional: the best-effort metrics lane is simply off without it. */
  /** `restoredDates` is given only when some rows came back from storage after a restart (see restoreRules.ts / metrics merge). */
  sendMetrics?: (rows: readonly DailyMetricsRow[], restoredDates?: ReadonlySet<string>) => Promise<void>
  /**
   * Optional: gets a usable session back (refresh, or sign in again). Called once when the server refuses a write
   * for who is asking (401/403, row-level security); true means "try the same write again now".
   */
  recoverAuth?: () => Promise<boolean>
}

export interface QueueStatus {
  /** Words whose latest state hasn't reached the server yet. */
  pendingRatings: number
  pendingSettings: boolean
  /** Hidden-word changes (user_hidden_words) not yet sent. */
  pendingHidden: number
  /** Favourite changes (user_favorites) not yet sent. */
  pendingFavorites: number
  /** Custom-word saves and deletes (user_words) not yet sent. */
  pendingWords: number
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
  /**
   * The server refused a write for who is asking (no session, an expired login, a policy), in any lane, and
   * getting a session back did not help. Retrying the same request cannot fix it: the UI says so at once.
   * Clears when a write is accepted again.
   */
  authRejected: boolean
  /** Entries read back from storage when the app opened (writes a killed webview had not sent). */
  restoredEntries: number
  /** Entries left out on restore because they were older than the staleness limit (7 days), and entries that could not be read. */
  droppedStale: number
  droppedUnreadable: number
}

/** What restore() found in storage. */
export interface RestoreReport {
  restored: number
  droppedStale: number
  droppedUnreadable: number
}

/** What is still waiting to be sent, for mirroring into the UI's in-memory state before the server has it. */
export interface PendingWrites {
  progress: ProgressUpdate[]
  hidden: HiddenOpEntry[]
  favorites: FavoriteOpEntry[]
  settings: SettingsPatch | null
  words: CustomWordOp[]
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
  /** Favourites or un-favourites a word (user_favorites), the same way: the latest state per word wins. */
  enqueueFavorite: (esWord: string, favorite: boolean) => void
  /**
   * Saves a custom word (an upsert on (user_id, es_word) with the row exactly as given). The latest change per word wins:
   * a save after a delete that has not been sent turns it into a plain save, and the other way round.
   */
  enqueueCustomWord: (row: CustomWordRow) => void
  /**
   * Deletes a custom word by its STORED casing; `tombstone` is the lowercased key that pending_word_deletes holds for it
   * (the caller puts it in the settings patch, which goes out first; see WriteQueueOptions.onWordsDeleted for the clearing).
   */
  enqueueCustomDelete: (esWord: string) => void
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
  /**
   * Reads back what an earlier run of the app had queued and not sent (see queueStore.ts), drops what is older than
   * the staleness limit, merges the rest in (anything already queued in this run wins) and starts sending it. Once
   * per queue; later calls return zeros. Safe without storage.
   */
  restore: () => RestoreReport
  /** Writes the pending contents to storage now (they are also written on every change). For pagehide / visibilitychange. */
  persistNow: () => void
  /** A copy of everything still waiting to be sent. */
  pending: () => PendingWrites
}

export interface WriteQueueOptions {
  /** Waits between automatic attempts; once exhausted the queue reports `failed`. */
  retryDelaysMs?: readonly number[]
  /** Max words per upsert request. */
  chunkSize?: number
  /** Waits between attempts of the metrics lane; once exhausted it idles until the next enqueue or retry(). */
  metricsRetryDelaysMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
  /** A request that has not answered after this long counts as failed (the retries and the banner follow), instead of "saving" forever. */
  sendTimeoutMs?: number
  /** Where the pending contents are kept so they survive the app being killed. Without it the queue is memory-only. */
  store?: QueueStore
  /** The clock used to stamp entries (epoch ms). */
  now?: () => number
  /**
   * Called after custom-word deletes reached the server, with their tombstone keys. Returns the settings patch that clears
   * those tombstones (queued at once, behind the delete), or null when there is nothing to clear.
   */
  onWordsDeleted?: (tombstones: readonly string[]) => SettingsPatch | null
}

const DEFAULT_SEND_TIMEOUT_MS = 20_000
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
  const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS
  const nowMs = options.now ?? Date.now
  const store = options.store

  // Nothing waits for a request forever: a request that stays silent is a failure like any other. (The late
  // answer, if it ever comes, is harmless: every write here is an idempotent upsert or delete.)
  const within = <T>(request: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const silent = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer after ${sendTimeoutMs} ms`)), sendTimeoutMs)
    })
    request.catch(() => {})
    return Promise.race([request, silent]).finally(() => clearTimeout(timer))
  }

  const progress = new Map<string, ProgressUpdate>()
  let settings: SettingsPatch | null = null
  const metrics = new Map<string, DailyMetricsRow>()
  const hiddenOps = new Map<string, HiddenOp>()
  const favoriteOps = new Map<string, FavoriteOp>()
  const wordOps = new Map<string, CustomWordOp>()
  // When each pending state was queued (the objects themselves are the keys), for the staleness rule on restore.
  const queuedAt = new WeakMap<object, number>()
  let settingsQueuedAt: Record<string, number> = {}
  // Entries that came back from storage and have not been sent yet: the sender checks these against the server first.
  const restoredSettingsKeys = new Set<string>()
  const restoredMetricsDates = new Set<string>()
  // The queue's contents on disk follow its contents: `version` moves whenever they change, and every notify() saves a new version.
  let version = 0
  let savedVersion = 0
  let restoredEntries = 0
  let droppedStale = 0
  let droppedUnreadable = 0
  let restoreDone = false
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
  let metricsRecoveryTried = false
  let lastError: string | null = null
  // The server refused the last progress/settings/hidden write (or metrics write) for who is asking.
  let rejected = false
  let metricsRejected = false
  let recoveryTried = false // getting a session back is attempted once per failure, not on every retry
  let consecutiveFailures = 0
  let wakeBackoff: (() => void) | null = null
  // Set by flush()/retry(): the current drain stops sleeping between attempts.
  let hurried = false

  const listeners = new Set<() => void>()

  const hasPending = () => progress.size > 0 || hiddenOps.size > 0 || favoriteOps.size > 0 || wordOps.size > 0 || settings !== null

  const computeStatus = (): QueueStatus => ({
    pendingRatings: progress.size,
    pendingSettings: settings !== null,
    pendingHidden: hiddenOps.size,
    pendingFavorites: favoriteOps.size,
    pendingWords: wordOps.size,
    sending,
    failed,
    error: lastError,
    unsaved: progress.size > 0 || hiddenOps.size > 0 || favoriteOps.size > 0 || wordOps.size > 0 || settings !== null || sending,
    stuck,
    pendingMetrics: metrics.size,
    metricsError,
    metricsRunning: metricsRun !== null,
    metricsAttempts,
    metricsLastAttemptAt,
    metricsLastSuccessAt,
    metricsGaveUp,
    metricsWaitingForProgress: metrics.size > 0 && hasPending(),
    authRejected: rejected || metricsRejected,
    restoredEntries,
    droppedStale,
    droppedUnreadable,
  })
  let status = computeStatus()

  const snapshot = (): QueueSnapshot => {
    const stamped = <T extends object>(value: T) => ({ value, at: queuedAt.get(value) ?? nowMs() })
    return {
      progress: [...progress.values()].map(stamped),
      hidden: [...hiddenOps.values()].map(stamped),
      favorites: [...favoriteOps.values()].map(stamped),
      settings: settings ? { patch: settings, at: { ...settingsQueuedAt } } : null,
      metrics: [...metrics.values()].map(stamped),
      words: [...wordOps.values()].map(stamped),
    }
  }
  const persist = () => {
    if (!store) return
    savedVersion = version
    store.save(snapshot())
  }

  const notify = () => {
    status = computeStatus()
    if (version !== savedVersion) persist()
    for (const listener of listeners) listener()
  }


  // A newer state for a word replaces the unsent one; a batch waiting on the old state now waits for the newer one.
  const putProgress = (update: ProgressUpdate, at: number = nowMs()) => {
    queuedAt.set(update, at)
    version++
    const key = wordKey(update.esWord)
    const old = progress.get(key)
    if (old && old !== update) {
      for (const ticket of tickets) {
        if (ticket.updates.delete(old)) ticket.updates.add(update)
      }
    }
    progress.set(key, update)
  }
  const putSettings = (patch: SettingsPatch, at: number = nowMs()) => {
    settings = { ...settings, ...patch }
    for (const key of Object.keys(patch)) {
      settingsQueuedAt[key] = at
      restoredSettingsKeys.delete(key) // a value queued in this run is the user's latest word, not a replay
    }
    version++
    return ++settingsVersion
  }

  // All progress first (including anything queued while earlier chunks were in flight), then settings.
  async function sendOnce() {
    while (progress.size > 0) {
      const chunk = [...progress.values()].slice(0, chunkSize)
      await within(sender.sendProgress(chunk))
      // Only forget what was actually sent: a newer state for the same word stays queued.
      for (const sent of chunk) {
        const key = wordKey(sent.esWord)
        if (progress.get(key) === sent) {
          progress.delete(key)
          version++
        }
        for (const ticket of tickets) ticket.updates.delete(sent)
      }
      for (const ticket of tickets) if (ticket.updates.size === 0) tickets.delete(ticket) // fully sent: only its settings part (a version number) is left to check
      notify()
    }

    // Saves go before everything that may refer to the word (its tombstone clearing, its place in the Learn queue).
    const saves = [...wordOps.values()].filter((op) => op.kind === 'save')
    if (saves.length > 0) {
      if (sender.sendWords) await within(sender.sendWords(saves))
      forgetWordOps(saves)
      notify()
    }

    if (hiddenOps.size > 0) {
      const ops = [...hiddenOps.values()]
      if (sender.sendHidden) await within(sender.sendHidden(ops))
      // Only forget what was sent: a newer state for the same word stays queued.
      for (const sent of ops) {
        if (hiddenOps.get(wordKey(sent.esWord)) === sent) {
          hiddenOps.delete(wordKey(sent.esWord))
          version++
        }
      }
      notify()
    }

    if (favoriteOps.size > 0) {
      const ops = [...favoriteOps.values()]
      if (sender.sendFavorites) await within(sender.sendFavorites(ops))
      for (const sent of ops) {
        if (favoriteOps.get(wordKey(sent.esWord)) === sent) {
          favoriteOps.delete(wordKey(sent.esWord))
          version++
        }
      }
      notify()
    }

    if (settings) {
      const sent = settings
      const sentVersion = settingsVersion // every patch merged into `sent` has a version <= this
      const restored = restoredSettingsKeys.size > 0 ? { keys: new Set(restoredSettingsKeys), queuedAt: { ...settingsQueuedAt } } : undefined
      await within(restored ? sender.sendSettings(sent, restored) : sender.sendSettings(sent))
      if (settings === sent) {
        settings = null
        settingsQueuedAt = {}
        restoredSettingsKeys.clear()
        version++
      }
      settingsSavedVersion = Math.max(settingsSavedVersion, sentVersion)
      notify()
    }

    // Deletes go after the settings: the tombstone that stops the Flutter app's pull from bringing the word back is queued
    // with the delete, and has to be on the server before the row is gone. Once the rows are gone the tombstones are cleared.
    const deletes = [...wordOps.values()].filter((op) => op.kind === 'delete')
    if (deletes.length > 0) {
      if (sender.sendWords) await within(sender.sendWords(deletes))
      forgetWordOps(deletes)
      const patch = options.onWordsDeleted?.(deletes.flatMap((op) => (op.kind === 'delete' ? [op.tombstone] : [])))
      if (patch && Object.keys(patch).length > 0) putSettings(patch)
      notify()
    }
  }

  // Only forget what was actually sent: a newer change for the same word stays queued.
  function forgetWordOps(sent: readonly CustomWordOp[]) {
    for (const op of sent) {
      const key = wordKey(op.kind === 'save' ? op.row.es_word : op.esWord)
      if (wordOps.get(key) === op) {
        wordOps.delete(key)
        version++
      }
    }
  }

  const recover = async () => {
    try {
      return (await sender.recoverAuth?.()) ?? false
    } catch {
      return false
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
        rejected = false
        recoveryTried = false
      } catch (err) {
        lastError = messageOf(err)
        sending = false
        if (isRejection(err)) {
          // Refused for who is asking: waiting and sending the same thing again cannot change that. Get a session
          // back once and try again at once; if that does not help, say so now instead of after a run of retries.
          if (!recoveryTried && sender.recoverAuth) {
            recoveryTried = true
            if (await recover()) continue
          }
          rejected = true
          failed = true
          stuck = true
          notify()
          return
        }
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
        const restoredDates = new Set(rows.filter((r) => restoredMetricsDates.has(r.date)).map((r) => r.date))
        await within(restoredDates.size > 0 ? send(rows, restoredDates) : send(rows))
        // Only forget what was sent: a newer row for the same date stays queued.
        for (const sent of rows) {
          if (metrics.get(sent.date) === sent) {
            metrics.delete(sent.date)
            restoredMetricsDates.delete(sent.date)
            version++
          }
        }
        metricsFailures = 0
        metricsError = null
        metricsRejected = false
        metricsRecoveryTried = false
        metricsLastSuccessAt = new Date().toISOString()
        notify()
      } catch (err) {
        metricsError = messageOf(err)
        if (isRejection(err)) {
          // Metrics stay best-effort, but a refusal for who is asking is not a hiccup: it is shown, and not retried in a loop.
          if (!metricsRecoveryTried && sender.recoverAuth) {
            metricsRecoveryTried = true
            if (await recover()) continue
          }
          metricsRejected = true
          metricsGaveUp = true
          notify()
          return
        }
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
    recoveryTried = false // Retry gets one more attempt at getting a session back
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
        metricsRecoveryTried = false
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
      const op = { esWord, hidden }
      queuedAt.set(op, nowMs())
      version++
      hiddenOps.set(wordKey(esWord), op)
      notify()
      kick()
    },

    enqueueFavorite(esWord, favorite) {
      if (!sender.sendFavorites) return
      const op = { esWord, favorite }
      queuedAt.set(op, nowMs())
      version++
      favoriteOps.set(wordKey(esWord), op)
      notify()
      kick()
    },

    enqueueCustomWord(row) {
      if (!sender.sendWords) return
      const op: CustomWordOp = { kind: 'save', row }
      queuedAt.set(op, nowMs())
      version++
      wordOps.set(wordKey(row.es_word), op)
      notify()
      kick()
    },

    enqueueCustomDelete(esWord) {
      if (!sender.sendWords) return
      const op: CustomWordOp = { kind: 'delete', esWord, tombstone: wordKey(esWord) }
      queuedAt.set(op, nowMs())
      version++
      wordOps.set(wordKey(esWord), op)
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
      queuedAt.set(row, nowMs())
      version++
      restoredMetricsDates.delete(row.date)
      metrics.set(row.date, row)
      if (!metricsRun) {
        metricsFailures = 0 // a new row after the lane gave up starts a fresh round of attempts
        metricsGaveUp = false
        metricsRecoveryTried = false
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

    restore() {
      const none: RestoreReport = { restored: 0, droppedStale: 0, droppedUnreadable: 0 }
      if (restoreDone || !store) return none
      restoreDone = true
      const result = store.load()
      if (!result) return none

      let restored = 0
      // Anything queued in this run is newer than what was on disk: it wins, key by key.
      for (const { value, at } of result.snapshot.progress) {
        if (progress.has(wordKey(value.esWord))) continue
        putProgress(value, at)
        restored++
      }
      for (const { value, at } of result.snapshot.hidden) {
        if (hiddenOps.has(wordKey(value.esWord))) continue
        const op = { esWord: value.esWord, hidden: value.hidden }
        queuedAt.set(op, at)
        hiddenOps.set(wordKey(op.esWord), op)
        restored++
      }
      for (const { value, at } of result.snapshot.favorites) {
        if (favoriteOps.has(wordKey(value.esWord))) continue
        const op = { esWord: value.esWord, favorite: value.favorite }
        queuedAt.set(op, at)
        favoriteOps.set(wordKey(op.esWord), op)
        restored++
      }
      for (const { value, at } of result.snapshot.words) {
        const key = wordKey(value.kind === 'save' ? value.row.es_word : value.esWord)
        if (wordOps.has(key)) continue
        queuedAt.set(value, at)
        wordOps.set(key, value)
        restored++
      }
      if (result.snapshot.settings) {
        const { patch, at } = result.snapshot.settings
        for (const key of Object.keys(patch)) {
          if (settings && key in settings) continue
          settings = { ...settings, [key]: patch[key] }
          settingsQueuedAt[key] = at[key]
          restoredSettingsKeys.add(key)
          restored++
        }
      }
      for (const { value, at } of result.snapshot.metrics) {
        if (metrics.has(value.date)) continue
        queuedAt.set(value, at)
        metrics.set(value.date, value)
        restoredMetricsDates.add(value.date)
        restored++
      }

      restoredEntries = restored
      droppedStale = result.droppedStale
      droppedUnreadable = result.droppedUnreadable
      version++ // the stored copy is rewritten without what was dropped
      notify()
      kick()
      kickMetrics()
      return { restored, droppedStale, droppedUnreadable }
    },

    persistNow: persist,

    pending: () => ({
      progress: [...progress.values()],
      hidden: [...hiddenOps.values()].map(({ esWord, hidden }) => ({ esWord, hidden })),
      favorites: [...favoriteOps.values()].map(({ esWord, favorite }) => ({ esWord, favorite })),
      settings: settings ? { ...settings } : null,
      words: [...wordOps.values()],
    }),
  }
}

export interface SupabaseQueueOptions extends WriteQueueOptions {
  /**
   * Gets a usable session back for this user (refresh, or sign in again): true when it did, false when it was refused,
   * 'unreachable' when the auth server could not be reached at all (that is being offline, not a refusal). Without it a
   * missing session is simply reported as a rejection.
   */
  recoverSession?: () => Promise<boolean | 'unreachable'>
}

/** True when the client holds a session for exactly this user (the token it will put on the next request). */
async function holdsSessionFor(client: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data } = await client.auth.getSession()
    return data.session?.user?.id === userId
  } catch {
    return false
  }
}

/**
 * The app's queue: progress goes through upsertProgress, settings through the merge-the-whole-blob write.
 *
 * Every send first checks that the client really holds this user's session. supabase-js does not: with no session it
 * quietly sends the public anon key instead, and the database then refuses the write (or, for a read, answers with an
 * empty list), so an app that only remembers "signed in" looks fine while nothing is ever saved. Here a missing session
 * is recovered once, and if that fails the write is not sent at all and is reported as a rejection.
 */
export function createSupabaseWriteQueue(
  client: SupabaseClient,
  userId: string,
  getSettings: () => UserSettings | null,
  options: SupabaseQueueOptions = {},
): WriteQueue {
  const { recoverSession, ...rest } = options
  // Persisted per signed-in user, so one account's unsent writes are never picked up by another.
  const queueOptions: WriteQueueOptions = { store: createQueueStore(userId), ...rest }
  /** Signs in again: 'yes', 'no' (refused) or 'unreachable' (no network). */
  const recover = async (): Promise<'yes' | 'no' | 'unreachable'> => {
    if (!recoverSession) return 'no'
    const back = await recoverSession()
    if (back === 'unreachable') return 'unreachable'
    return back && (await holdsSessionFor(client, userId)) ? 'yes' : 'no'
  }
  const recoverAuth = async () => (await recover()) === 'yes'
  const signedIn = async <T>(send: () => Promise<T>): Promise<T> => {
    // No network: nothing here can succeed and none of it is a refusal. Fail fast, so the queue's own retries (and, when
    // they run out, the unsaved-progress notice) take over; the writes stay queued and saved on the device.
    if (isOffline()) throw new Error('No connection')
    if (!(await holdsSessionFor(client, userId))) {
      const back = await recover()
      if (back === 'unreachable') throw new Error('The server cannot be reached')
      if (back === 'no') throw new WriteError('session', "You're not signed in on this device", 401, 'NO_SESSION')
    }
    return send()
  }
  return createWriteQueue(
    {
      sendProgress: (updates) => signedIn(() => upsertProgress(client, userId, updates)),
      // Whole-blob write merged from the loaded settings; before they are loaded (writes restored at launch go out first)
      // the base is the server's own copy, so keys this client does not own are still kept.
      sendSettings: (patch, restored) =>
        signedIn(async () => {
          if (!restored) {
            await writeSettings(client, userId, getSettings() ?? parseSettings(await fetchSettings(client, userId)), patch)
            return
          }
          // Some keys are a replay from an earlier run: check them against what the server holds now (restoreRules.ts).
          const server = await fetchSettingsRow(client, userId)
          const { write } = reconcileSettingsPatch(patch, restored.keys, restored.queuedAt, server)
          if (Object.keys(write).length > 0) await writeSettings(client, userId, getSettings() ?? parseSettings(server.blob), write)
        }),
      sendHidden: (ops) => signedIn(() => writeHiddenWords(client, userId, ops)),
      sendFavorites: (ops) => signedIn(() => writeFavoriteWords(client, userId, ops)),
      sendWords: (ops) => signedIn(() => writeCustomWords(client, userId, ops)),
      sendMetrics: (rows, restoredDates) =>
        signedIn(async () => {
          // A row from an earlier run may be behind what another device pushed for that day: merge, never overwrite.
          // (If the server cannot be read, nothing is sent and the row stays queued.)
          const merged = await Promise.all(
            rows.map(async (row) => (restoredDates?.has(row.date) ? (mergeRows(row, parseServerRow(await fetchServerMetricsRow(client, userId, row.date))) ?? row) : row)),
          )
          await upsertDailyMetrics(client, userId, merged)
        }),
      recoverAuth,
    },
    queueOptions,
  )
}
