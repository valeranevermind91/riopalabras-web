import { applyReview, type Quality } from '../sm2/sm2'
import { localDateKey } from './dates'
import { streakPatch } from './daily'
import type { MetricsRecorder } from './metrics'
import { isReviewDue } from './stats'
import { wordKey } from './words'
import type { ProgressUpdate, SettingsPatch, UserSettings, Word } from './types'

/** Fisher–Yates. `random` is injectable so tests can pin the order. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** A session takes at most this many words from the due list. (If 20 turns out wrong, change the number: there is no setting for it.) */
export const REVIEW_SESSION_SIZE = 20
/**
 * A session never holds more cards than this, re-queues included: if a user keeps rating Again, the session ends here and the words still relearning
 * simply come due later. It exists only so a bad session cannot grow without end; nothing on screen mentions it.
 */
export const REVIEW_SESSION_CEILING = 40

/** The words that are due right now: what the Home tile counts, and what sessions are drawn from. */
export const dueWords = (words: readonly Word[], now: Date): Word[] => words.filter((w) => isReviewDue(w, now))

/**
 * How long past its next_review a word is, in milliseconds. A learned word with no stored next_review has no date to measure (it counts as due,
 * see isReviewDue), so it counts as just due: the words that have waited longest come first.
 */
export const overdueMs = (word: Word, now: Date): number => (word.nextReview === null ? 0 : now.getTime() - word.nextReview.getTime())

/**
 * The cards for one Review session: the REVIEW_SESSION_SIZE words that are most overdue, then shuffled. The cap decides WHICH words, the
 * shuffle decides the ORDER, so a session still reads in a varied order. Words equally overdue (a Learn batch is due all at once) are told apart at
 * random, not by their place in the dictionary. A backlog smaller than the cap is every due word, as before. The result is a snapshot: it is
 * never refreshed mid-session, however the underlying words change (the next session is drawn from what is due then).
 */
export function buildReviewSession(words: readonly Word[], now: Date, random?: () => number, size: number = REVIEW_SESSION_SIZE): readonly Word[] {
  const byOverdue = shuffle(dueWords(words, now), random).sort((a, b) => overdueMs(b, now) - overdueMs(a, now)) // a stable sort: ties stay in their shuffled order
  return Object.freeze(shuffle(byOverdue.slice(0, size), random))
}

/** The word as the rating left it (what the store holds right after): the card a re-queued copy shows is this, not the snapshot taken at the start. */
export function withUpdate(word: Word, update: ProgressUpdate): Word {
  return Object.freeze({ ...word, easeFactor: update.easeFactor, interval: update.interval, repetitions: update.repetitions, nextReview: update.nextReview })
}

/**
 * The session after an Again on the card at `index`: the word, as the rating left it, goes to the very end, so it comes back in the same
 * sitting (however few cards are left, it is last). It is never in the queue twice: a copy still waiting behind `index` is dropped first, so
 * an Again on the copy sends it to the end again instead of piling up. The cards before and at `index` stay as they were. Re-queues do not count
 * against the session's REVIEW_SESSION_SIZE (they are a repeat, not a new word), but the session never holds more than `ceiling` cards: past it the
 * session is returned as it is.
 */
export function requeueAgain(session: readonly Word[], index: number, updated: Word, ceiling: number = REVIEW_SESSION_CEILING): readonly Word[] {
  const key = wordKey(updated.esWord)
  const next = [...session.filter((w, i) => i <= index || wordKey(w.esWord) !== key), updated]
  // At the ceiling the word is not queued again: it keeps its ten minutes and comes due in a later session.
  return next.length > ceiling ? session : Object.freeze(next)
}

/** The SM-2 result of rating a word, shaped for the store and for user_progress. */
export function rateWord(word: Word, quality: Quality, now: Date): ProgressUpdate {
  const next = applyReview(word, quality, now)
  return {
    esWord: word.esWord,
    easeFactor: next.easeFactor,
    interval: next.interval,
    repetitions: next.repetitions,
    nextReview: next.nextReview,
  }
}

export interface RaterDeps {
  /** Optimistic: mirror the new state into the in-memory words right away. */
  applyProgress: (updates: readonly ProgressUpdate[]) => void
  applySettings: (patch: SettingsPatch) => void
  getSettings: () => UserSettings
  queue: {
    enqueueProgress: (update: ProgressUpdate) => void
    enqueueSettings: (patch: SettingsPatch) => void
  }
  /** Optional: today's metrics row. Recording never throws, so it can't stand in the way of a rating. */
  metrics?: Pick<MetricsRecorder, 'recordReviewRating'>
}

/**
 * Handles a rating: applies it to the in-memory store immediately, queues the write, and records the
 * day's streak. The streak is a settings write, so it is sent only when the streak state actually
 * changes — the first rating of a local day — never once per card.
 */
export function createRater(deps: RaterDeps) {
  let streakCheckedFor: string | null = null

  return function rate(word: Word, quality: Quality, now: Date = new Date()): ProgressUpdate {
    const update = rateWord(word, quality, now)
    deps.applyProgress([update])
    deps.queue.enqueueProgress(update)

    const today = localDateKey(now)
    if (streakCheckedFor !== today) {
      streakCheckedFor = today
      const patch = streakPatch(deps.getSettings(), now)
      if (patch) {
        deps.applySettings(patch)
        deps.queue.enqueueSettings(patch)
      }
    }

    // After the streak: the metrics row mirrors today's counters, which the streak write doesn't touch.
    deps.metrics?.recordReviewRating(quality, now)

    return update
  }
}
