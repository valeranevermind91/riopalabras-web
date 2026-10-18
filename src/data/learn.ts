import { learnedState } from '../sm2/sm2'
import type { ReviewLog } from './reviewLog'
import { dayPatch, learnedToday, newWordsPatch } from './daily'
import { nothingDueNow } from './dayCards'
import { pickBatch, replaceKnown, restoreKnown, type BatchPick } from './learnPick'
import { splitAtStartRank } from './placement'
import { waitingStars } from './starred'
import { computeRemainingToday, getLearnPool } from './stats'
import type { ProgressUpdate, SettingsPatch, UserSettings, Word } from './types'
import { wordKey } from './words'
import type { QueueTicket, WriteQueue } from './writeQueue'

export const LEARN_BATCH_SIZE = 10

/** How long "Undo" is offered after "Already know it" (it also goes the moment the user moves to another card). */
export const UNDO_WINDOW_MS = 5000

export interface LearnBatch extends BatchPick {
  /** Words in the batch that were never learned before — fixed when the batch is built, so a retry can't recount. */
  readonly newCount: number
}

/** A batch of exactly these words (no window behind it): what a screen or a test holds when the words are already decided. */
export function batchOf(words: readonly Word[]): LearnBatch {
  return {
    words,
    newCount: words.filter((w) => w.repetitions === 0).length,
    strata: words.map((_, i) => i),
    window: words,
    windowStrata: words.map((_, i) => i),
    reserve: [],
    overflow: [],
    known: [],
    dayKey: '',
    size: words.length,
    lowWindow: [],
    lowStrata: [],
    lowSize: 0,
  }
}

const withCount = (pick: BatchPick): LearnBatch => ({ ...pick, newCount: pick.words.filter((w) => w.repetitions === 0).length })

/**
 * Next Learn batch: min(10, remainingToday) new words, mostly from the start rank on when the placement test set one, with about 30% of the filler
 * from the skipped range below it (see splitAtStartRank, pickBatch). The words the user starred (set to "learn sooner") lead it, oldest star first, up to
 * 70% of the batch (starredSlots); the rest is spread over the next 150 candidates instead of taken from the head of the queue (see pickBatch), with the
 * below-start share and the Rioplatense guarantee taken of those slots. Known words are hidden, hence never candidates; only words the user actually
 * learns are counted towards the daily limit (newCount is the batch itself). The stars are only read here: a star goes when the word is learned
 * (createBatchFinisher) or marked as known (markKnown), never when it is only drawn.
 */
export function selectLearnBatch(words: readonly Word[], settings: UserSettings, now: Date): LearnBatch {
  const limit = Math.min(LEARN_BATCH_SIZE, computeRemainingToday(settings, now))
  if (limit <= 0) return withCount(pickBatch([], 0, now))
  const { window, below } = splitAtStartRank(getLearnPool(words), settings.startRank)
  return withCount(pickBatch(window, limit, now, waitingStars(words), below))
}

export interface KnownDeps {
  queue: Pick<WriteQueue, 'enqueueHidden' | 'enqueueFavorite'>
  /** Optimistic: mirror the hide / un-hide into the in-memory words at once. */
  applyHidden: (esWords: readonly string[], hidden: boolean) => void
  /** Optimistic: mirror a star cleared / put back into the in-memory words at once. */
  applyFavorite: (esWords: readonly string[], favorite: boolean) => void
}

const setStar = (esWord: string, on: boolean, deps: Pick<KnownDeps, 'applyFavorite' | 'queue'>) => {
  deps.applyFavorite([esWord], on)
  deps.queue.enqueueFavorite(esWord, on)
}

/**
 * "Already know it": the word at `index` is hidden for good (it leaves Learn, Review and the practice
 * exercises) through the write queue, and the next candidate takes its place. The batch keeps its size.
 * A starred word also loses its star (a star means "waiting", and this word is not any more); Undo gives it back.
 */
export function markKnown(batch: LearnBatch, index: number, deps: KnownDeps): LearnBatch {
  const word = batch.words[index]
  if (!word) return batch
  deps.applyHidden([word.esWord], true)
  deps.queue.enqueueHidden(word.esWord, true)
  const next = replaceKnown(batch, index)
  if (next.known[next.known.length - 1].wasStarred) setStar(word.esWord, false, deps)
  return withCount(next)
}

/** Undo for the last "already know it": the word is shown again (and un-hidden), and starred again if it was. */
export function undoKnown(batch: LearnBatch, deps: KnownDeps): LearnBatch {
  const last = batch.known[batch.known.length - 1]
  if (!last) return batch
  deps.applyHidden([last.word.esWord], false)
  deps.queue.enqueueHidden(last.word.esWord, false)
  if (last.wasStarred) setStar(last.word.esWord, true, deps)
  return withCount(restoreKnown(batch))
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

/**
 * The settings one finished batch writes: today's new-word counter, the day's cards and (the moment the day first qualifies) the streak. The batch's
 * words are cards done (a word replaced by "Already know it" is not in the batch, and is not a card). `nothingDue`: no review is due once the batch is in
 * (see dayPatch). The words' stars are cleared by the finisher, not here: they are not settings.
 */
export function learnSettingsPatch(settings: UserSettings, batch: LearnBatch, now: Date, nothingDue: boolean = false): SettingsPatch {
  return {
    ...newWordsPatch(settings, batch.newCount, now),
    ...dayPatch(settings, now, { cards: batch.words.length, nothingDue, learnedNow: learnedToday(settings, now) + batch.newCount }),
  }
}

export interface FinishDeps {
  queue: Pick<WriteQueue, 'enqueueBatch' | 'enqueueFavorite'>
  /** Always the latest settings (read at call time, not captured). */
  getSettings: () => UserSettings
  /** Optimistic: mirror the new state into the in-memory words / settings right away, as Review does. */
  applyProgress: (updates: readonly ProgressUpdate[]) => void
  applySettings: (patch: SettingsPatch) => void
  /** Optimistic: mirror the cleared stars into the in-memory words. Without it only the write is queued. */
  applyFavorite?: (esWords: readonly string[], favorite: boolean) => void
  /** The words as they are now (for "no review is due": a light day counts for the streak). Learn does not change what is due. */
  getWords?: () => readonly Word[]
  /** Called once, after the batch is applied and queued (so today's counters are current). Must not throw. */
  onFinished?: () => void
  /** Optional: the review log, and the id of this batch's session. Each word the batch introduces becomes one row (mode 'learn'). */
  log?: ReviewLog
  sessionId?: string | null
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
    const patch = learnSettingsPatch(deps.getSettings(), batch, now, nothingDueNow(deps.getWords, now)) // before applySettings: it is computed from the pre-batch counter

    deps.applyProgress(updates)
    if (Object.keys(patch).length > 0) deps.applySettings(patch)
    ticket = deps.queue.enqueueBatch(updates, patch)
    // A star means "waiting": the words this batch taught are not any more, so they lose it (read from the words as they are now, not as the batch was drawn).
    const current = new Map((deps.getWords?.() ?? []).map((w) => [wordKey(w.esWord), w.isFavorite] as const))
    const cleared = batch.words.filter((w) => current.get(wordKey(w.esWord)) ?? w.isFavorite).map((w) => w.esWord)
    if (cleared.length > 0) {
      deps.applyFavorite?.(cleared, false)
      for (const esWord of cleared) deps.queue.enqueueFavorite(esWord, false)
    }
    // One row per word introduced, after the batch is queued. Their state before is read from the batch's own words (new), so this is not affected by the
    // update just applied. A word marked "already known" instead is not in the batch and is not a rating: nothing is logged for it.
    deps.log?.learned(batch.words, learnedState(now), deps.sessionId ?? null, now)
    deps.onFinished?.()
    return ticket
  }
}

export type LearnPhase = 'reading' | 'done'

/**
 * What the Learn screen shows: reading until "Finish batch" is pressed, then done, at once. The batch is already
 * applied to the in-memory words and settings, so everything the next screen needs is in memory; the write is the
 * queue's business and is sent when it can be (its progress is `ticket.saved()` and the queue's status, and the
 * unsaved-progress notice reports on it). Nothing on this screen waits for the network.
 */
export function learnPhase(ticket: QueueTicket | null): LearnPhase {
  return ticket ? 'done' : 'reading'
}
