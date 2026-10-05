import { onTelegramActivated, setClosingConfirmation } from '../lib/telegram'
import { createBackgroundRetrier, type Retrier } from './recovery'
import type { WriteQueue } from './writeQueue'

/**
 * Telegram's closing confirmation follows the queue: on while anything is unsaved (pending, in
 * flight or failed), off once it has drained. Metrics never count. Returns the unbind, which also
 * switches the confirmation off.
 */
export function bindClosingConfirmation(queue: WriteQueue, set: (enabled: boolean) => void = (enabled) => setClosingConfirmation(enabled)): () => void {
  let on = false
  const sync = () => {
    const wanted = queue.getStatus().unsaved
    if (wanted === on) return
    on = wanted
    set(wanted)
  }
  sync()
  const unsubscribe = queue.subscribe(sync)
  return () => {
    unsubscribe()
    if (on) set(false)
    on = false
  }
}

export interface ReconnectSources {
  /** Defaults to window: 'online'. */
  online?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  /** Defaults to document: 'visibilitychange' (only counts when the page becomes visible). */
  document?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
  /** Defaults to Telegram's 'activated' event. */
  activated?: (callback: () => void) => () => void
}

/**
 * Runs `onTrigger` when the connection is back or the app is shown again, so queued writes and the
 * degraded-data retrier go now instead of waiting for their next backoff step. Returns the unbind.
 */
export function bindReconnectTriggers(onTrigger: () => void, sources: ReconnectSources = {}): () => void {
  const online = sources.online ?? window
  const doc = sources.document ?? document
  const activated = sources.activated ?? onTelegramActivated

  const onOnline = () => onTrigger()
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') onTrigger()
  }
  online.addEventListener('online', onOnline)
  doc.addEventListener('visibilitychange', onVisibility)
  const offActivated = activated(onTrigger)

  return () => {
    online.removeEventListener('online', onOnline)
    doc.removeEventListener('visibilitychange', onVisibility)
    offActivated()
  }
}

/**
 * While the queue is stuck (automatic retries ran out), keep trying in the background — 15s, 30s,
 * 60s, then every 2 minutes — one attempt at a time, until it drains. The Home banner says
 * "Retrying…", and this is what makes that true.
 */
export function bindStuckRetry(queue: WriteQueue, makeRetrier: (run: () => Promise<boolean>) => Retrier = (run) => createBackgroundRetrier({ run })): () => void {
  const retrier = makeRetrier(() => queue.retry())
  let active = false
  const sync = () => {
    const stuck = queue.getStatus().stuck
    if (stuck === active) return
    active = stuck
    if (stuck) retrier.start()
    else retrier.stop()
  }
  sync()
  const unsubscribe = queue.subscribe(sync)
  return () => {
    unsubscribe()
    retrier.stop()
  }
}

/** What "we are back" means for the app's retriers: the write queue sends now, and the degraded user-data retrier tries now. */
export function retryEverything(parts: { queue: WriteQueue | null; retryDegraded: (() => void) | undefined }): void {
  void parts.queue?.retry()
  parts.retryDegraded?.()
}
