import { DEFAULT_EASE, RELEARN_MS } from '../sm2/sm2'
import { safeLocalStorage, type StorageLike } from './queueStore'
import type { Word } from './types'
import { wordKey } from './words'

// The review log: an append-only history of every answer, for a statistics screen and for fitting a scheduler (FSRS) to the user's own
// history. It is NOT telemetry: a scheduler that learns from it needs every row, in order, with what was true at the moment of the answer.
//
// This module owns the log. The screens call it; nothing else builds a row. A row is queued through the write queue (see writeQueue.ts: the
// log lane), which keeps it on the device until the server has it, replays it after a restart, and never lets a failure reach the UI.
//
// Only Review ratings are real scheduling events: they are the only answers that change a word's SM-2 state. The other modes are logged too
// (a scheduler may want to know a word was seen, or got wrong, in a game) but they are marked with their mode, they change nothing, and
// their `rating` is a stand-in (see the mode notes below), not a judgement the user made about how well they remembered.

export const REVIEW_LOG_TABLE = 'review_log'

export type LogMode = 'review' | 'learn' | 'matching' | 'cloze' | 'practice'
export type LogState = 'new' | 'learning' | 'review' | 'relearning'

/** One row of the log as the app holds it (camelCase); writes.ts turns it into the table's columns. The user id is added when it is sent. */
export interface ReviewLogEntry {
  /** Generated here, once, so a retry (or a replay after a restart) can never make a second row: the insert ignores a repeated id. */
  readonly id: string
  /** The word in its stored casing, as progress rows carry it. */
  readonly esWord: string
  /** When the answer was given (ISO 8601). */
  readonly reviewedAt: string
  /** 1 Again, 2 Hard, 3 Good, 4 Easy. For Review, what the user pressed. For the other modes a stand-in: see the helpers below. */
  readonly rating: number
  readonly mode: LogMode
  /** What the word was BEFORE the answer, from its progress row. */
  readonly stateBefore: LogState
  /** Days since the word's previous review, to the best of what is known (see previousReviewAt); 0 for a new word; null when it cannot be told. */
  readonly elapsedDays: number | null
  /**
   * Days the word is scheduled out. Review: the interval the rating gave (0 only for the ten-minute step after an Again, which really is due the same
   * day). Learn: 1, the next local day, which is what finishing a batch schedules. Matching and Cloze schedule nothing, so this is the word's own interval
   * as it stood before the answer, or null when it has none (a word not yet reviewed has no interval in days). Never 0 as a stand-in: 0 would say "due today".
   */
  readonly scheduledDays: number | null
  readonly intervalAfter: number
  readonly easeAfter: number
  readonly repetitionsAfter: number
  /** The sitting this answer belongs to: Review session, Learn batch, Matching group, Cloze session. */
  readonly sessionId: string | null
  /** Milliseconds from the card being shown to the answer, where the screen has that naturally; null otherwise (never a guess). */
  readonly durationMs: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000

// ---- what the word was -------------------------------------------------------------------------------------------------------------

/**
 * The learning state of a word before an answer, from its progress row:
 *   new         never learned (repetitions 0)
 *   review      has an interval of at least a day: a word that is being reviewed
 *   learning    introduced by Learn and not rated since: repetitions 1, interval 0, and the ease the app gives a new word
 *   relearning  after an Again: repetitions 1, interval 0, and an ease that has been lowered
 * The last two share repetitions and interval; only the ease tells them apart (an Again always lowers it, Learn never touches it). A word whose
 * ease has come back to exactly the default by rating Easy before lapsing would read "learning": that is possible and rare.
 */
export function stateBefore(card: Pick<Word, 'repetitions' | 'interval' | 'easeFactor'>): LogState {
  if (card.repetitions <= 0) return 'new'
  if (card.interval > 0) return 'review'
  return Math.abs(card.easeFactor - DEFAULT_EASE) < 1e-9 ? 'learning' : 'relearning'
}

/**
 * When the word was last reviewed, as an epoch time, or null when there is none. Where it comes from, best source first:
 *  - a rated word ('review', 'relearning'): its next_review was set as the rating time plus its interval (plus ten minutes after an Again), so
 *    the rating time is next_review minus that. EXACT, to the millisecond, and it is the word's own synced row, so it holds across devices.
 *  - a word Learn introduced and nobody has reviewed ('learning'): its next_review is the start of the next local day, so the moment it was
 *    introduced is not stored. The start of the day it was introduced is a lower bound of it. If this device logged the Learn row (it keeps that
 *    time until the word's first review: `learnedAtMs`), the later of the two is used, which is exact. Otherwise this is an APPROXIMATION
 *    (the introduction was somewhere in that day, up to 24 hours later), and it applies only to a word's first review after Learn: for words that
 *    were learned before the log existed, or on another device.
 *  - a learned word with no stored next_review: only `learnedAtMs`, if known; otherwise null (unknown, never guessed).
 */
export function previousReviewAt(word: Pick<Word, 'repetitions' | 'interval' | 'easeFactor' | 'nextReview'>, learnedAtMs?: number | null): number | null {
  const state = stateBefore(word)
  if (state === 'new') return null
  const next = word.nextReview
  if (!next) return learnedAtMs ?? null
  if (state === 'review') return next.getTime() - word.interval * DAY_MS
  if (state === 'relearning') return next.getTime() - RELEARN_MS
  // learning: next is the local midnight after the introduction (field arithmetic, as learnedState made it)
  const startOfLearnDay = new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1).getTime()
  return learnedAtMs != null ? Math.max(startOfLearnDay, learnedAtMs) : startOfLearnDay
}

/** Days from the previous review to `now`: 0 for a new word, null when there is no way to tell, never negative (a clock set back reads 0). */
export function elapsedDays(word: Pick<Word, 'repetitions' | 'interval' | 'easeFactor' | 'nextReview'>, now: Date, learnedAtMs?: number | null): number | null {
  if (stateBefore(word) === 'new') return 0
  const previous = previousReviewAt(word, learnedAtMs)
  if (previous === null) return null
  return Math.round(Math.max(0, now.getTime() - previous) / DAY_MS * 1e6) / 1e6
}

const clampRating = (rating: number): number => Math.min(4, Math.max(1, Math.round(rating)))

// ---- the exact introduction time, kept only until the word's first review --------------------------------------------------------------

const LEARNED_AT_PREFIX = 'riopalabras.reviewLog.learnedAt.v1.'
/** A word learned and never reviewed for this long is forgotten (a word is due the day after it is learned; this is only abandoned ones). */
const LEARNED_AT_MAX_AGE_MS = 60 * DAY_MS

/**
 * The moment Learn introduced each word that has not been reviewed yet, on this device (localStorage, per user). Its only use is to make
 * elapsed_days exact for a word's first review after Learn (see previousReviewAt). An entry is removed at the word's first review row, so it only
 * ever holds the words waiting for their first review. Best effort throughout: without storage the first review after Learn is approximate.
 */
export interface LearnedAtStore {
  get: (key: string) => number | undefined
  set: (key: string, at: number) => void
  forget: (key: string) => void
}

export function createLearnedAtStore(userId: string, storage: StorageLike | null = safeLocalStorage(), now: () => number = Date.now): LearnedAtStore {
  const storageKey = `${LEARNED_AT_PREFIX}${userId}`
  let map: Map<string, number> | null = null
  const load = (): Map<string, number> => {
    if (map) return map
    map = new Map()
    try {
      const raw = storage?.getItem(storageKey)
      const parsed: unknown = raw ? JSON.parse(raw) : null
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const cutoff = now() - LEARNED_AT_MAX_AGE_MS
        for (const [key, at] of Object.entries(parsed)) if (typeof at === 'number' && Number.isFinite(at) && at >= cutoff) map.set(key, at)
      }
    } catch {
      // unreadable: start empty, the approximation stands in
    }
    return map
  }
  const save = () => {
    try {
      if (!storage || !map) return
      if (map.size === 0) storage.removeItem(storageKey)
      else storage.setItem(storageKey, JSON.stringify(Object.fromEntries(map)))
    } catch {
      // storage full or blocked
    }
  }
  return {
    get: (key) => load().get(key),
    set(key, at) {
      load().set(key, at)
      save()
    },
    forget(key) {
      if (load().delete(key)) save()
    },
  }
}

// ---- building a row ----------------------------------------------------------------------------------------------------------------------

/** The word's state after the answer: the new SM-2 state for a Review rating, or what it already was when the answer changes nothing. */
export interface AfterState {
  interval: number
  easeFactor: number
  repetitions: number
}

export interface BuildInput {
  id: string
  word: Word
  mode: LogMode
  rating: number
  after: AfterState
  scheduledDays: number | null
  sessionId: string | null
  durationMs: number | null
  now: Date
  learnedAtMs?: number | null
}

/** A row, from what was true before and what the answer made true. Pure: nothing here reads the clock or storage. */
export function buildLogEntry(input: BuildInput): ReviewLogEntry {
  const { word, now } = input
  return {
    id: input.id,
    esWord: word.esWord,
    reviewedAt: now.toISOString(),
    rating: clampRating(input.rating),
    mode: input.mode,
    stateBefore: stateBefore(word),
    elapsedDays: elapsedDays(word, now, input.learnedAtMs),
    scheduledDays: input.scheduledDays,
    intervalAfter: input.after.interval,
    easeAfter: input.after.easeFactor,
    repetitionsAfter: input.after.repetitions,
    sessionId: input.sessionId,
    durationMs: input.durationMs !== null && Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs)) : null,
  }
}

// ---- the log ---------------------------------------------------------------------------------------------------------------------------

/** A fresh random id (a v4 UUID): crypto.randomUUID where there is one, else built from crypto.getRandomValues. */
export function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** The schedule a practice answer carries: the word's own interval in days, or null when it has none (interval 0 means "not scheduled in days"). */
export const practiceScheduledDays = (word: Pick<Word, 'interval'>): number | null => (word.interval > 0 ? word.interval : null)

export interface ReviewLog {
  /** A new session id: call it when a sitting starts (a Review session, a Learn batch, a Matching group, a Cloze session) and pass it to every answer in it. */
  startSession: () => string
  /** A Review rating: the one real scheduling event. `update` is what the rating wrote to the word's progress. */
  review: (input: { word: Word; rating: number; update: AfterState; sessionId: string | null; durationMs: number | null; now: Date }) => void
  /**
   * Words introduced by finishing a Learn batch: one row each, state before 'new'. Their rating is the stand-in 3 (seen and accepted: Learn asks no
   * question, so there is nothing to judge), and they are scheduled for tomorrow (scheduled_days 1; interval_after 0, as the word is stored).
   */
  learned: (words: readonly Word[], after: AfterState, sessionId: string | null, now: Date) => void
  /**
   * A matched pair (Matching) or an answered question (Cloze). Nothing is scheduled and the word's state is unchanged, so the "after" columns repeat
   * its current values, and scheduled_days is the interval the word already had (null if it has none: see ReviewLogEntry.scheduledDays). Rating: 3 when
   * it was right at the first try, 1 when it was wrong (Cloze) or needed another try (Matching): a stand-in. Mode 'practice' is Matching on the words of a
   * Learn batch just finished (from the end screen): the same row, told apart so that it can be left out of any fit to the user's own memory.
   */
  practice: (input: { word: Word; mode: 'matching' | 'cloze' | 'practice'; correct: boolean; sessionId: string | null; durationMs: number | null; now: Date }) => void
}

/**
 * The log for one signed-in user. `enqueue` hands a row to the write queue. Logging can never get in the way of an answer: every method
 * swallows its own errors (the rating itself has already been applied and queued by the caller).
 */
export function createReviewLog(deps: { enqueue: (entry: ReviewLogEntry) => void; learnedAt: LearnedAtStore; newId?: () => string }): ReviewLog {
  const idOf = deps.newId ?? newId
  const safely = (work: () => void) => {
    try {
      work()
    } catch {
      // a log row that could not be built is lost; the answer is not
    }
  }

  return {
    startSession: idOf,

    review: ({ word, rating, update, sessionId, durationMs, now }) =>
      safely(() => {
        const key = wordKey(word.esWord)
        deps.enqueue(
          buildLogEntry({ id: idOf(), word, mode: 'review', rating, after: update, scheduledDays: Math.max(0, update.interval), sessionId, durationMs, now, learnedAtMs: deps.learnedAt.get(key) }),
        )
        deps.learnedAt.forget(key) // from here on the word's own row says when it was last reviewed, exactly
      }),

    learned: (words, after, sessionId, now) =>
      safely(() => {
        for (const word of words) {
          deps.enqueue(buildLogEntry({ id: idOf(), word, mode: 'learn', rating: 3, after, scheduledDays: 1, sessionId, durationMs: null, now }))
          deps.learnedAt.set(wordKey(word.esWord), now.getTime())
        }
      }),

    practice: ({ word, mode, correct, sessionId, durationMs, now }) =>
      safely(() => {
        deps.enqueue(
          buildLogEntry({
            id: idOf(),
            word,
            mode,
            rating: correct ? 3 : 1,
            after: { interval: word.interval, easeFactor: word.easeFactor, repetitions: word.repetitions },
            scheduledDays: practiceScheduledDays(word),
            sessionId,
            durationMs,
            now,
            learnedAtMs: deps.learnedAt.get(wordKey(word.esWord)),
          }),
        )
      }),
  }
}
