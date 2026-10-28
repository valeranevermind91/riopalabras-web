import { DEFAULT_EASE, learnedState } from '../sm2/sm2'
import type { ReviewLog } from './reviewLog'
import { dayPatch, learnedToday, newWordsPatch, uncountPatch } from './daily'
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

export function learnProgressUpdates(batch: Pick<LearnBatch, 'words'>, now: Date): ProgressUpdate[] {
  const state = learnedState(now)
  return batch.words.map((word) => ({
    esWord: word.esWord,
    easeFactor: state.easeFactor,
    interval: state.interval,
    repetitions: state.repetitions,
    nextReview: state.nextReview,
  }))
}

/** What a counted word goes back to when it is taken out again (hidden right after it was reached): a word nobody has learned. */
export function unlearnedUpdates(words: readonly Word[], now: Date): ProgressUpdate[] {
  return words.map((word) => ({ esWord: word.esWord, easeFactor: DEFAULT_EASE, interval: 0, repetitions: 0, nextReview: now }))
}

/**
 * The settings the words counted in one step write: today's new-word counter, the day's cards and (the moment the day first qualifies) the streak. The words are cards
 * done (a word replaced by "Already know it" is not in the batch, and is not a card). `nothingDue`: no review is due once they are in (see dayPatch). The words' stars are
 * cleared by the keeper, not here: they are not settings.
 */
export function learnSettingsPatch(settings: UserSettings, batch: Pick<LearnBatch, 'words' | 'newCount'>, now: Date, nothingDue: boolean = false): SettingsPatch {
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
  /** Called after every step that counted or took back words (the counters are current). Must not throw. */
  onKept?: () => void
  /** Called once, when the batch is finished, after everything is applied and queued (so today's counters are current). Must not throw. */
  onFinished?: () => void
  /** Optional: the review log, and the id of this batch's session. Each word the batch introduces becomes one row (mode 'learn'). */
  log?: ReviewLog
  sessionId?: string | null
}

export interface BatchKeeper {
  /** The person has reached the card at `index` of the batch as it is now: that word is counted as learned, if it was not already. */
  reach: (batch: LearnBatch, index: number) => void
  /** "Finish batch": every word of the batch is counted (those reached already are), and the ticket of the batch's last write is returned. A second call returns the same one. */
  finish: (batch: LearnBatch) => QueueTicket
  /** The words counted so far, by key. */
  kept: () => ReadonlySet<string>
}

/**
 * A batch is counted as it is read, not when it is finished: a word counts the moment its card is reached (progress due tomorrow like any learned word, the day's
 * counters, a log row), so seven cards read are seven words kept, and the daily goal says "3 more today" instead of starting the ten over. Each step hands the write
 * queue what it counted, once, with ONE settings patch of absolute values computed from the settings as they are then, so a retry, even after a request that did
 * succeed on the server, writes the same numbers again and never counts a word twice. The queue sends progress before settings and stops at a failing progress write.
 *
 * What counts is decided by the words IN the batch and the ones reached, not by positions: a word that is hidden right after it was reached ("Already know it") is no
 * longer in the batch, so it is taken back out (its progress goes back to a word nobody has learned, the counters go down by one; its log row stays, as the log is a
 * history), and the word that takes its place is counted when it is reached; Undo brings the word back, and counts it again. A word is logged once per batch.
 */
export function createBatchKeeper(deps: FinishDeps): BatchKeeper {
  const seen = new Set<string>() // keys of the words the person has reached
  const kept = new Map<string, Word>() // the words counted now, as drawn
  const logged = new Set<string>()
  let last: QueueTicket | null = null
  let finished: QueueTicket | null = null

  const keep = (words: readonly Word[]) => {
    const now = new Date()
    const counted = { words, newCount: words.filter((w) => w.repetitions === 0).length }
    const updates = learnProgressUpdates(counted, now)
    const patch = learnSettingsPatch(deps.getSettings(), counted, now, nothingDueNow(deps.getWords, now)) // before applySettings: it is computed from the counters as they are now

    deps.applyProgress(updates)
    if (Object.keys(patch).length > 0) deps.applySettings(patch)
    last = deps.queue.enqueueBatch(updates, patch)
    for (const word of words) kept.set(wordKey(word.esWord), word)
    // A star means "waiting": the words counted are not any more, so they lose it (read from the words as they are now, not as the batch was drawn).
    const current = new Map((deps.getWords?.() ?? []).map((w) => [wordKey(w.esWord), w.isFavorite] as const))
    const cleared = words.filter((w) => current.get(wordKey(w.esWord)) ?? w.isFavorite).map((w) => w.esWord)
    if (cleared.length > 0) {
      deps.applyFavorite?.(cleared, false)
      for (const esWord of cleared) deps.queue.enqueueFavorite(esWord, false)
    }
    deps.onKept?.()
  }

  // One log row per word introduced, once per batch, written when the person leaves the word's card (or finishes), never while it is the card in front of them: a word
  // marked "already known" on arrival is not a rating, and must not have been logged as one by then. Their state before is read from the batch's own words (new).
  const flushLog = (current: string | null) => {
    const now = new Date()
    const fresh = [...kept.values()].filter((w) => !logged.has(wordKey(w.esWord)) && wordKey(w.esWord) !== current)
    for (const word of fresh) logged.add(wordKey(word.esWord))
    if (fresh.length > 0) deps.log?.learned(fresh, learnedState(now), deps.sessionId ?? null, now)
  }

  const unkeep = (words: readonly Word[]) => {
    const now = new Date()
    const updates = unlearnedUpdates(words, now)
    const patch = uncountPatch(deps.getSettings(), words.length, now) ?? {}
    deps.applyProgress(updates)
    if (Object.keys(patch).length > 0) deps.applySettings(patch)
    last = deps.queue.enqueueBatch(updates, patch)
    for (const word of words) kept.delete(wordKey(word.esWord))
    deps.onKept?.()
  }

  const settle = (batch: LearnBatch, current: string | null) => {
    const inBatch = new Map(batch.words.map((w) => [wordKey(w.esWord), w] as const))
    const dropped = [...kept.keys()].filter((key) => !inBatch.has(key)).map((key) => kept.get(key)!)
    const added = [...seen].filter((key) => inBatch.has(key) && !kept.has(key)).map((key) => inBatch.get(key)!)
    if (dropped.length > 0) unkeep(dropped)
    if (added.length > 0) keep(added)
    flushLog(current)
  }

  return {
    reach(batch, index) {
      const word = batch.words[index]
      if (!word || finished) return
      seen.add(wordKey(word.esWord))
      settle(batch, wordKey(word.esWord))
    },
    finish(batch) {
      if (finished) return finished
      for (const word of batch.words) seen.add(wordKey(word.esWord))
      settle(batch, null)
      finished = last ?? deps.queue.enqueueBatch([], {})
      deps.onFinished?.()
      return finished
    },
    kept: () => new Set(kept.keys()),
  }
}

/**
 * Finishing a batch hands the write queue everything at once: progress for every word and ONE settings patch (streak + today's new-word counter), computed here, once,
 * from the settings as they are now and the batch snapshot (see createBatchKeeper, which this is a single step of). Returns a function safe against double taps: the first
 * call queues the batch, later calls just return the same ticket.
 */
export function createBatchFinisher(batch: LearnBatch, deps: FinishDeps): () => QueueTicket {
  const keeper = createBatchKeeper(deps)
  return () => keeper.finish(batch)
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
