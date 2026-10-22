import type { Word } from './types'
import { isReviewDue } from './stats'
import { RELEARN_MS } from '../sm2/sm2'
import { hasTranslations, isReviewablePos } from './words'

/**
 * The interval, in days, from which a word counts as well learned (Anki calls the same line "mature"). A product constant: the Words filters, the row dots and
 * the detail screen all read it from here, and a test pins its value, so changing it is a decision made on purpose.
 */
export const WELL_LEARNED_DAYS = 21

/**
 * What a word is, for the Words list: a kind, and whether it is due. The kinds are mutually exclusive and decided in this order:
 *   hidden       marked as known (or removed): it is in the Known list and nowhere else
 *   reference    it can never enter Learn or Review (a non-reviewable part of speech, or a missing translation)
 *   new          never studied: repetitions 0 (a stored next_review does not change that: Learn can still teach the word)
 *   learning     studied, interval under WELL_LEARNED_DAYS (a word just seen in Learn has interval 0; a word rated Again goes back to 0)
 *   wellLearned  interval of WELL_LEARNED_DAYS or more
 * `due` is not a kind. It overlaps the stages: a word that is learning or well learned is also due once its next review has arrived, and stays under its
 * stage while it is. `started` is the "Started" list: every word that is not hidden and has been studied (repetitions above 0), reference-only ones included.
 *
 * This is the one definition: the filters, the segment, the row's dot and the detail screen all read it. It is NOT the review log's state vocabulary
 * (new, learning, review, relearning in `LogState`, reviewLog.ts), which describes a word at the moment of an answer and is fixed by the live table's
 * check constraint: the log's "learning" is "repetitions 1, interval 0", this file's `learning` is any studied word under WELL_LEARNED_DAYS.
 */
export type WordKind = 'hidden' | 'reference' | 'new' | 'learning' | 'wellLearned'

export interface WordStatus {
  readonly kind: WordKind
  readonly due: boolean
  readonly started: boolean
}

export function isReferenceOnly(word: Word): boolean {
  return !isReviewablePos(word.pos) || !hasTranslations(word)
}

export function wordStatus(word: Word, now: Date): WordStatus {
  const started = !word.isHidden && word.repetitions > 0
  if (word.isHidden) return { kind: 'hidden', due: false, started }
  if (isReferenceOnly(word)) return { kind: 'reference', due: false, started }
  const due = isReviewDue(word, now)
  if (word.repetitions <= 0) return { kind: 'new', due, started }
  return { kind: word.interval >= WELL_LEARNED_DAYS ? 'wellLearned' : 'learning', due, started }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * When the word is next due, for sorting: only a word that is in the schedule has one (a word rated Again is, in ten minutes). A word an
 * earlier version lapsed back to new and one never learned have none, even though the first still carries the time of its last rating.
 */
export function dueDate(word: Word): Date | null {
  return word.repetitions > 0 ? word.nextReview : null
}

const isStartOfDay = (when: Date) => when.getHours() === 0 && when.getMinutes() === 0 && when.getSeconds() === 0 && when.getMilliseconds() === 0

/**
 * When the word was last reviewed, as far as it can be told: the review time is not stored, but the schedule is
 * (next_review = the review time + the interval), so it is worked back from it. A word at interval 0 is one of two things: just learned
 * (due at the start of the next day, so learned the day before that) or rated Again (due RELEARN_MINUTES after the rating). The first
 * is told by its due time falling exactly on a day boundary. A word whose old-rule lapse left repetitions 0 was due the moment it lapsed.
 * Null for a word never reviewed.
 */
export function lastReviewedAt(word: Word): Date | null {
  if (!word.nextReview) return null
  if (word.repetitions > 0 && word.interval === 0) return new Date(word.nextReview.getTime() - (isStartOfDay(word.nextReview) ? DAY_MS : RELEARN_MS))
  return new Date(word.nextReview.getTime() - word.interval * DAY_MS)
}
