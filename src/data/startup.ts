import { isOffline } from '../lib/online'
import { customWordFromRow } from './words'
import type { ProgressUpdate, SettingsPatch, UserSettings, Word } from './types'
import type { PendingWrites, RestoreReport, WriteQueue } from './writeQueue'

/** How long opening the app waits for restored writes to reach the server before it loads the user's state anyway. */
export const RESTORE_FLUSH_WAIT_MS = 8000

const inProgress = new WeakMap<WriteQueue, Promise<RestoreReport>>()

/**
 * The first thing the app does once the user is known, BEFORE it reads the user's state back: restore what a killed
 * webview had queued and not sent, and send it. That way the server already has those writes when the state is loaded,
 * and the UI never shows data that is about to be overwritten.
 *
 * Waits for the send, but only up to `waitMs` (a dead network must not keep the app closed: the load has its own
 * retries). Whatever is still unsent after that stays queued, and `mirrorPending` puts it into the loaded state.
 * One run per queue; repeated calls (a remounted effect) share it.
 */
export function restoreAndFlush(queue: WriteQueue, { waitMs = RESTORE_FLUSH_WAIT_MS }: { waitMs?: number } = {}): Promise<RestoreReport> {
  let run = inProgress.get(queue)
  if (!run) {
    run = (async () => {
      const report = queue.restore()
      // Nothing to wait for with no network either: the restored writes are queued and shown, and go out when it is back.
      if (report.restored === 0 || isOffline()) return report
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs)
      })
      try {
        await Promise.race([queue.flush().catch(() => {}), timeout])
      } finally {
        clearTimeout(timer)
      }
      return report
    })()
    inProgress.set(queue, run)
  }
  return run
}

export interface PendingTargets {
  applyProgress: (updates: readonly ProgressUpdate[]) => void
  applySettings: (patch: SettingsPatch) => void
  applyHidden: (esWords: readonly string[], hidden: boolean) => void
  applyFavorite: (esWords: readonly string[], favorite: boolean) => void
  /** Without these, custom-word changes still waiting are not shown (nothing else depends on them). */
  upsertCustomWord?: (word: Word) => void
  removeCustomWord?: (esWord: string) => void
}

/**
 * Writes still waiting after the restore (the network was down, the session was refused) are the user's latest state:
 * show them in the loaded data instead of the older copy the server returned. Same optimistic mirroring the screens do.
 */
export function mirrorPending(pending: PendingWrites, targets: PendingTargets): void {
  if (pending.progress.length > 0) targets.applyProgress(pending.progress)
  if (pending.settings && Object.keys(pending.settings).length > 0) targets.applySettings(pending.settings)
  const hide = pending.hidden.filter((op) => op.hidden).map((op) => op.esWord)
  const show = pending.hidden.filter((op) => !op.hidden).map((op) => op.esWord)
  if (hide.length > 0) targets.applyHidden(hide, true)
  if (show.length > 0) targets.applyHidden(show, false)
  const like = pending.favorites.filter((op) => op.favorite).map((op) => op.esWord)
  const unlike = pending.favorites.filter((op) => !op.favorite).map((op) => op.esWord)
  if (like.length > 0) targets.applyFavorite(like, true)
  if (unlike.length > 0) targets.applyFavorite(unlike, false)
  for (const op of pending.words) {
    if (op.kind === 'save') targets.upsertCustomWord?.(customWordFromRow(op.row))
    else targets.removeCustomWord?.(op.esWord)
  }
}

/**
 * Where the write queue gets the loaded settings from. The queue exists before the user's state has loaded (it has to,
 * to send what a killed webview left behind), so it asks through this: null until the state is there, and writes that
 * need the settings blob then read the server's own copy instead.
 */
export function createSettingsSource() {
  let current: () => UserSettings | null = () => null
  return {
    read: (): UserSettings | null => current(),
    use: (read: (() => UserSettings | null) | null) => {
      current = read ?? (() => null)
    },
  }
}
