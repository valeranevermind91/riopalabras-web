import type { Word } from './types'
import { isReviewDue } from './stats'
import { hasTranslations, isReviewablePos } from './words'

/**
 * Where a word stands, in this precedence: hidden (marked as known or removed); reference-only (it can never enter Learn
 * or Review: a non-reviewable part of speech such as a preposition, or a missing translation); due; established
 * (two or more successful repetitions); learning (one); new (none). A word that lapsed (rated Again after being learned)
 * has no repetitions and reads as new, which is right: it is back in the learn pool. See `hasHistory`.
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
 * A word that reads as new but was learned before: an "Again" rating set its repetitions back to 0 and left a stored
 * schedule (next_review) behind, which a word that was never touched does not have. The detail screen explains it.
 */
export function hasHistory(word: Word): boolean {
  return word.repetitions === 0 && word.nextReview !== null
}

/** Has anything been learned or lapsed: the words the "Learned" list shows (hidden ones are in their own list). */
export function hasProgress(word: Word): boolean {
  return word.repetitions > 0 || hasHistory(word)
}
