import { learnedState } from '../sm2/sm2'
import { buildBatchRounds, type MatchGroup } from './practice'
import { isInLearnPool, isReviewDue } from './stats'
import { wordKey } from './words'
import type { UserSettings, Word } from './types'
import type { TranslationFlags } from './translations'

/**
 * What Home says once the day's new words are done: which words those were, and what tomorrow brings. Nothing here is stored: both come from the words as they are.
 *
 * The words learned today. Finishing a Learn batch writes, for each word, `learnedState(now)`: one repetition, no interval in days yet, and a first review due at the start
 * of tomorrow in the device's own time. Nothing else produces exactly that (a word that was rated Again is due in minutes, a word learned yesterday and not yet reviewed
 * was due at this midnight, and one that was reviewed has two repetitions), and a word learned today cannot have been reviewed today, because it is not due until tomorrow.
 * So today's words are the visible words that are in that state. Hidden words are left out.
 */
export function learnedTodayKeys(words: readonly Word[], now: Date): Set<string> {
  const firstReview = learnedState(now).nextReview.getTime()
  return new Set(
    words
      .filter((w) => !w.isHidden && w.repetitions === 1 && w.interval === 0 && w.nextReview !== null && w.nextReview.getTime() === firstReview)
      .map((w) => wordKey(w.esWord)),
  )
}

/** The start of tomorrow and of the day after, in the device's own time (field arithmetic, so a daylight-saving change cannot move them). */
function tomorrowWindow(now: Date): { start: Date; end: Date } {
  const start = learnedState(now).nextReview
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1) }
}

/**
 * What tomorrow brings, from the words as they stand: `reviews` are the words whose review falls during tomorrow (a word that comes due later today, such as one rated Again
 * a few minutes ago, is today's, and is left out), `fresh` the new words a day would offer (the daily goal, or fewer when fewer are left). Review is never offered for a word
 * that is not due: this only says how many there will be.
 */
export function tomorrowPreview(words: readonly Word[], settings: Pick<UserSettings, 'dailyNewWordLimit'>, now: Date): { reviews: number; fresh: number } {
  const { start, end } = tomorrowWindow(now)
  const lastMoment = new Date(end.getTime() - 1)
  const reviews = words.filter((w) => w.nextReview !== null && w.nextReview.getTime() >= start.getTime() && w.nextReview.getTime() < end.getTime() && isReviewDue(w, lastMoment)).length
  const fresh = Math.min(words.filter(isInLearnPool).length, settings.dailyNewWordLimit)
  return { reviews, fresh }
}

/**
 * Matching on the words learned today, as the rounds of a batch (the same ones Learn's end screen offers right after a batch): every one of today's words that Matching can use is in
 * a round, and nothing from outside them ever is. Null when Matching cannot run on them (fewer than the minimum, or glosses that collide). Practice only: it counts for nothing and never
 * touches the schedule (Matching's `practice` mode).
 */
export function todayMatchingRounds(words: readonly Word[], settings: TranslationFlags, now: Date, random?: () => number): MatchGroup[] | null {
  return buildBatchRounds(words, learnedTodayKeys(words, now), settings, random)
}
