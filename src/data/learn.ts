import { learnedState } from '../sm2/sm2'
import { newWordsPatch, streakPatch } from './daily'
import { pickBatch, replaceKnown, restoreKnown, type BatchPick } from './learnPick'
import { livePicks, removeKeys, restoreKey, storedIndex } from './learnPicks'
import { splitAtStartRank } from './placement'
import { computeRemainingToday, getLearnPool } from './stats'
import type { ProgressUpdate, SettingsPatch, UserSettings, Word } from './types'
import type { QueueTicket, WriteQueue } from './writeQueue'

export const LEARN_BATCH_SIZE = 10

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
 * from the skipped range below it (see splitAtStartRank, pickBatch). The words the user queued (learn_picks) come first, in the
 * order they were queued; the rest is spread over the next 150 candidates instead of taken from the head of the
 * queue (see pickBatch). Known words are hidden, hence never candidates; only words the user actually learns are
 * counted towards the daily limit (newCount is the batch itself). The queue is only read here: a queued word leaves it
 * when the batch is finished (learnSettingsPatch), never when it is drawn.
 */
export function selectLearnBatch(words: readonly Word[], settings: UserSettings, now: Date): LearnBatch {
  const limit = Math.min(LEARN_BATCH_SIZE, computeRemainingToday(settings, now))
  if (limit <= 0) return withCount(pickBatch([], 0, now))
  const { window, below } = splitAtStartRank(getLearnPool(words), settings.startRank)
  return withCount(pickBatch(window, limit, now, livePicks(words, settings.learnPicks), below))
}

export interface KnownDeps {
  queue: Pick<WriteQueue, 'enqueueHidden' | 'enqueueSettings'>
  /** Optimistic: mirror the hide / un-hide into the in-memory words at once. */
  applyHidden: (esWords: readonly string[], hidden: boolean) => void
  /** The latest settings (read at call time): a queued word that is marked as known leaves learn_picks. */
  getSettings: () => UserSettings
  applySettings: (patch: SettingsPatch) => void
}

const saveQueue = (patch: SettingsPatch | null, deps: Pick<KnownDeps, 'applySettings' | 'queue'>) => {
  if (!patch) return
  deps.applySettings(patch)
  deps.queue.enqueueSettings(patch)
}

/**
 * "Already know it": the word at `index` is hidden for good (it leaves Learn, Review and the practice
 * exercises) through the write queue, and the next candidate takes its place. The batch keeps its size.
 * A queued word also leaves the Learn queue (through the settings lane).
 */
export function markKnown(batch: LearnBatch, index: number, deps: KnownDeps): LearnBatch {
  const word = batch.words[index]
  if (!word) return batch
  deps.applyHidden([word.esWord], true)
  deps.queue.enqueueHidden(word.esWord, true)
  const settings = deps.getSettings()
  const queuedAt = storedIndex(settings, word.esWord)
  saveQueue(queuedAt >= 0 ? removeKeys(settings, [word.esWord]) : null, deps)
  const next = replaceKnown(batch, index)
  const known = next.known.slice()
  known[known.length - 1] = { ...known[known.length - 1], queuedAt: queuedAt >= 0 ? queuedAt : null }
  return withCount({ ...next, known })
}

/** Undo for the last "already know it": the word is shown again (and un-hidden), and back in the queue if it was queued. */
export function undoKnown(batch: LearnBatch, deps: KnownDeps): LearnBatch {
  const last = batch.known[batch.known.length - 1]
  if (!last) return batch
  deps.applyHidden([last.word.esWord], false)
  deps.queue.enqueueHidden(last.word.esWord, false)
  if (last.queuedAt !== null) saveQueue(restoreKey(deps.getSettings(), last.word.esWord, last.queuedAt), deps)
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
 * The settings one finished batch writes: the streak, today's new-word counter and the queue. The words the batch taught
 * leave learn_picks, exactly those (the queued words that did not fit stay, in order); the key is written only when something
 * left it, so a user who never queued anything gets no learn_picks key.
 */
export function learnSettingsPatch(settings: UserSettings, batch: LearnBatch, now: Date): SettingsPatch {
  return {
    ...streakPatch(settings, now),
    ...newWordsPatch(settings, batch.newCount, now),
    ...removeKeys(settings, batch.words.map((w) => w.esWord)),
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
