import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProgressUpdate, SettingsPatch, UserSettings } from './types'
import { wordKey } from './words'
import { upsertProgress, writeSettings } from './writes'

export interface QueueSender {
  sendProgress: (updates: readonly ProgressUpdate[]) => Promise<void>
  sendSettings: (patch: SettingsPatch) => Promise<void>
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
  /** Anything not yet durably saved (pending, in flight, or failed). */
  unsaved: boolean
}

export interface WriteQueue {
  /** Records a word's latest state; an earlier unsent state for the same word is replaced. */
  enqueueProgress: (update: ProgressUpdate) => void
  /** Merges keys into the pending settings patch. */
  enqueueSettings: (patch: SettingsPatch) => void
  /** Sends everything now, without sleeping between attempts. Resolves once saved, rejects if it still fails. */
  flush: () => Promise<void>
  /** User-initiated retry after a persistent failure: a single attempt. Safe to call repeatedly: it never doubles a request. */
  retry: () => void
  getStatus: () => QueueStatus
  subscribe: (listener: () => void) => () => void
}

export interface WriteQueueOptions {
  /** Waits between automatic attempts; once exhausted the queue reports `failed`. */
  retryDelaysMs?: readonly number[]
  /** Max words per upsert request. */
  chunkSize?: number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_RETRY_DELAYS_MS = [1000, 3000, 8000]
const DEFAULT_CHUNK_SIZE = 100

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
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const progress = new Map<string, ProgressUpdate>()
  let settings: SettingsPatch | null = null

  let draining: Promise<void> | null = null
  let sending = false
  let failed = false
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
          notify()
          return
        }
        notify()
        await backoff(delays[consecutiveFailures++])
      } finally {
        sending = false
      }
    }
    notify()
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

    async flush() {
      if (!hasPending() && !draining) return
      if (failed) restart()
      hurry()
      if (!draining) kick()

      while (draining) await draining
      if (hasPending()) throw new Error(lastError ?? 'Could not save')
    },

    retry() {
      if (draining) {
        hurry()
        return
      }
      if (!hasPending()) return
      restart()
      // One attempt only: if the server is still down the banner comes straight back (no hidden retry storm).
      consecutiveFailures = delays.length
      kick()
    },

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
    },
    options,
  )
}
