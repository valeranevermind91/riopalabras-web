import { applyReview, type Quality } from '../sm2/sm2'
import { recordCards } from './dayCards'
import type { ReviewLog } from './reviewLog'
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
 * A session never holds more cards than this, re-queues included. It is a BACKSTOP: what keeps an Again from looping is that a word returns at most
 * once (see requeueAgain), which already caps a session of REVIEW_SESSION_SIZE words at twice that. The ceiling is the second, independent limit, on
 * the session as a whole: it binds whatever the session's size, and it is what the progress counter's denominator can never pass. Nothing on screen
 * mentions it.
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
 * The session after an Again: the word, as the rating left it, goes to the very end, so it comes back in the same sitting (however few cards
 * are left, it is last). Every card that was in the session stays as it was, so the cursor keeps its place.
 *
 * A word returns AT MOST ONCE. A word is in the session twice at most: once where the session put it, and once as its return. So an Again on a
 * word that is already there twice (the return itself, or a first showing whose return is already waiting) does not queue it again, and the
 * word leaves the session: its rating has already scheduled it ten minutes out, so it comes back on its own, in a later session, and repeating
 * it now would only trap the user. Every word adds at most one card, so a session always ends.
 *
 * Returns do not count against the session's REVIEW_SESSION_SIZE (they are a repeat, not a new word), but the session never holds more than
 * `ceiling` cards, the backstop on the whole session: past it the session is returned as it is, the word keeps its ten minutes, and it comes
 * due in a later session.
 */
export function requeueAgain(session: readonly Word[], updated: Word, ceiling: number = REVIEW_SESSION_CEILING): readonly Word[] {
  const key = wordKey(updated.esWord)
  if (session.filter((w) => wordKey(w.esWord) === key).length >= 2) return session // already back once: it leaves
  const next = [...session, updated]
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
  /** The words as they are now, right after a rating (for "no review is due": a light day counts for the streak). */
  getWords?: () => readonly Word[]
  /** Optional: today's metrics row. Recording never throws, so it can't stand in the way of a rating. */
  metrics?: Pick<MetricsRecorder, 'recordReviewRating'>
  /** Optional: the review log (reviewLog.ts). Each rating becomes one row, after it has been applied and queued; logging never throws. */
  log?: ReviewLog
}

/** What the screen knows about a rating that the rating itself does not: which session it belongs to, and how long the card was in front of the user. */
export interface RatingContext {
  sessionId: string | null
  /** Milliseconds from the card being shown to the rating, or null if the screen cannot tell. */
  durationMs: number | null
}

/**
 * Handles a rating: applies it to the in-memory store immediately, queues the write, and counts the card toward today's streak (a settings
 * write only while the day has not counted yet: see dayPatch). `counted` is false for a card that is a repeat of a word already rated in this
 * session (a relearning re-queue): the same word rated Again and then Good is one card, not two. The rating itself is written either way.
 * With `context` (and a log in the deps) the rating is also written to the review log: one row per rating, a re-queued card's too, because each
 * is a real scheduling event. The log is written AFTER the rating is applied and queued, and nothing in it can stop that.
 */
export function createRater(deps: RaterDeps) {
  return function rate(word: Word, quality: Quality, now: Date = new Date(), counted: boolean = true, context?: RatingContext): ProgressUpdate {
    const update = rateWord(word, quality, now)
    deps.applyProgress([update])
    deps.queue.enqueueProgress(update)
    deps.log?.review({ word, rating: quality, update, sessionId: context?.sessionId ?? null, durationMs: context?.durationMs ?? null, now })

    // After the rating is applied, so "no review is due" sees it.
    recordCards(deps, counted ? 1 : 0, now)

    // The metrics row mirrors today's counters, which the streak does not touch.
    deps.metrics?.recordReviewRating(quality, now)

    return update
  }
}
