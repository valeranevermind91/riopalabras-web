import { learnedState } from '../sm2/sm2'
import { newWordsPatch, streakPatch } from './daily'
import { headword } from './headword'
import { computeRemainingToday, getLearnPool } from './stats'
import type { ProgressUpdate, SettingsPatch, UserSettings, Word } from './types'
import type { QueueStatus, QueueTicket, WriteQueue } from './writeQueue'

export const LEARN_BATCH_SIZE = 10

export interface LearnBatch {
  readonly words: readonly Word[]
  /** Words in the batch that were never learned before — fixed when the batch is built, so a retry can't recount. */
  readonly newCount: number
}

/**
 * Next Learn batch: min(10, remainingToday) words from the pool in rank order. Two words that
 * would show the same headword never share a batch; the skipped one stays in the pool for a later
 * batch, and scanning continues until the batch is full. learn_picks are ignored for now.
 */
export function selectLearnBatch(words: readonly Word[], settings: UserSettings, now: Date): LearnBatch {
  const limit = Math.min(LEARN_BATCH_SIZE, computeRemainingToday(settings, now))
  const batch: Word[] = []
  const used = new Set<string>()

  if (limit > 0) {
    for (const word of getLearnPool(words)) {
      const key = headword(word).text.toLowerCase()
      if (used.has(key)) continue
      used.add(key)
      batch.push(word)
      if (batch.length >= limit) break
    }
  }

  return { words: batch, newCount: batch.filter((w) => w.repetitions === 0).length }
}

export function learnProgressUpdates(batch: LearnBatch, now: Date): ProgressUpdate[] {
  const state = learnedState(now)
  return batch.words.map((word) => ({
    esWord: word.esWord,
    easeFactor: state.easeFactor,
    interval: state.interval,
    repetitions: state.repetitions,
    nextReview: state.nextReview,
  }))
}

export function learnSettingsPatch(settings: UserSettings, batch: LearnBatch, now: Date): SettingsPatch {
  return {
    ...streakPatch(settings, now),
    ...newWordsPatch(settings, batch.newCount, now),
  }
}

export interface FinishDeps {
  queue: Pick<WriteQueue, 'enqueueBatch'>
  /** Always the latest settings (read at call time, not captured). */
  getSettings: () => UserSettings
  /** Optimistic: mirror the new state into the in-memory words / settings right away, as Review does. */
  applyProgress: (updates: readonly ProgressUpdate[]) => void
  applySettings: (patch: SettingsPatch) => void
  /** Called once, after the batch is applied and queued (so today's counters are current). Must not throw. */
  onFinished?: () => void
}

/**
 * Finishing a batch hands the write queue everything at once: progress for every word and ONE
 * settings patch (streak + today's new-word counter), computed here, once, from the settings as
 * they are now and the batch snapshot. The patch holds absolute values, so a retry — even after a
 * request that did succeed on the server — writes the same numbers again and never counts the
 * batch twice. The queue sends progress before settings and stops at a failing progress write, so
 * the counter cannot land ahead of the words; what the screen waits for is the returned ticket.
 *
 * Returns a function safe against double taps: the first call queues the batch, later calls just
 * return the same ticket.
 */
export function createBatchFinisher(batch: LearnBatch, deps: FinishDeps): () => QueueTicket {
  let ticket: QueueTicket | null = null

  return () => {
    if (ticket) return ticket
    const now = new Date()
    const updates = learnProgressUpdates(batch, now)
    const patch = learnSettingsPatch(deps.getSettings(), batch, now) // before applySettings: it is computed from the pre-batch counter

    deps.applyProgress(updates)
    if (Object.keys(patch).length > 0) deps.applySettings(patch)
    ticket = deps.queue.enqueueBatch(updates, patch)
    deps.onFinished?.()
    return ticket
  }
}

export type LearnPhase = 'reading' | 'saving' | 'error' | 'done'

/**
 * What the Learn screen shows after "Finish batch", derived from the queue instead of its own
 * state: still sending → saving; the queue gave up (automatic retries ran out) and this batch is
 * not saved → error (Retry); batch saved → done. Before the batch is finished it is just reading.
 */
export function learnPhase(ticket: QueueTicket | null, status: Pick<QueueStatus, 'failed'>): LearnPhase {
  if (!ticket) return 'reading'
  if (ticket.saved()) return 'done'
  return status.failed ? 'error' : 'saving'
}
