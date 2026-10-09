import type { Word } from './types'
import { isReviewDue } from './stats'
import { RELEARN_MS } from '../sm2/sm2'
import { hasTranslations, isReviewablePos } from './words'

/**
 * Where a word stands, in this precedence: hidden (marked as known or removed); reference-only (it can never enter Learn
 * or Review: a non-reviewable part of speech such as a preposition, or a missing translation); due; established
 * (two or more successful repetitions); learning (one); new (none). A word rated Again keeps one repetition, so it reads as learning ("In
 * progress") while it waits out its ten minutes and as due after: it never goes back to new. (Words an earlier version lapsed to
 * repetitions 0 still read as new, and are in the learn pool: see `hasHistory`.)
 */
export type WordState = 'hidden' | 'reference' | 'due' | 'established' | 'learning' | 'new'

/** The stage a learned word has reached, ignoring whether it is due today: what the row's dot shows. */
export type WordStage = 'new' | 'learning' | 'established'

export function isReferenceOnly(word: Word): boolean {
  return !isReviewablePos(word.pos) || !hasTranslations(word)
}

export function wordState(word: Word, now: Date): WordState {
  if (word.isHidden) return 'hidden'
  if (isReferenceOnly(word)) return 'reference'
  if (isReviewDue(word, now)) return 'due'
  return wordStage(word)
}

export function wordStage(word: Word): WordStage {
  if (word.repetitions >= 2) return 'established'
  if (word.repetitions === 1) return 'learning'
  return 'new'
}

/**
 * A word that reads as new but was learned before: an "Again" rating under the old rule set its repetitions back to 0 and left a stored
 * schedule (next_review) behind, which a word that was never touched does not have. (Today's Again keeps one repetition, so no new word
 * gets here; the ones that did stay as they are, and in the Learned list.)
 */
export function hasHistory(word: Word): boolean {
  return word.repetitions === 0 && word.nextReview !== null
}

/** Has anything been learned or lapsed: the words the "Learned" list shows (hidden ones are in their own list). */
export function hasProgress(word: Word): boolean {
  return word.repetitions > 0 || hasHistory(word)
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
