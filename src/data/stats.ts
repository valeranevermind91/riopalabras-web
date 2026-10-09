import { localDateKey, localYesterdayKey } from './dates'
import type { UserSettings, Word } from './types'
import { compareByRank, hasTranslations, isReviewablePos } from './words'

export interface Stats {
  total: number
  learned: number
  reviewDue: number
  learnPool: number
  newToLearn: number
  favorites: number
  hidden: number
  custom: number
  streak: number
  dailyLimit: number
  remainingToday: number
}

/** A learned word whose scheduled review has arrived. The repetitions gate is load-bearing: never-learned words have no schedule. */
export function isReviewDue(word: Word, now: Date): boolean {
  if (word.isHidden || word.repetitions <= 0) return false
  if (!isReviewablePos(word.pos) || !word.isEnriched || !hasTranslations(word)) return false
  // A learned word with no stored next_review has no schedule to wait for, so it counts as due.
  return word.nextReview === null || word.nextReview.getTime() <= now.getTime()
}

/**
 * When the first learned word that is not due yet comes due, if that is within `withinMs`: a word rated Again waits ten minutes, and the counts
 * (computed from the time they were asked) would otherwise stay as they were until something else changed them. Null when nothing is that close.
 */
export function nextDueWithin(words: readonly Word[], now: Date, withinMs: number): Date | null {
  let soonest: Date | null = null
  for (const word of words) {
    if (word.isHidden || word.repetitions <= 0 || word.nextReview === null) continue
    if (isReviewDue(word, now) || word.nextReview.getTime() - now.getTime() > withinMs) continue
    if (soonest === null || word.nextReview < soonest) soonest = word.nextReview
  }
  return soonest
}

export function isInLearnPool(word: Word): boolean {
  return (
    !word.isHidden &&
    word.isEnriched &&
    word.repetitions === 0 &&
    isReviewablePos(word.pos) &&
    hasTranslations(word)
  )
}

/** Never-learned words, most common first (rank ascending). */
export function getLearnPool(words: readonly Word[]): Word[] {
  return words.filter(isInLearnPool).sort(compareByRank)
}

export function computeRemainingToday(settings: UserSettings, now: Date): number {
  const learnedToday =
    settings.newWordsLearnedTodayDate === localDateKey(now) ? settings.newWordsLearnedTodayCount : 0
  return Math.max(0, settings.dailyNewWordLimit - learnedToday)
}

/** The stored streak, but 0 once a local day has been missed. */
export function computeStreak(settings: UserSettings, now: Date): number {
  const last = settings.streakLastActivityDate
  if (last === localDateKey(now) || last === localYesterdayKey(now)) return settings.streakCount
  return 0
}

export function computeStats(words: readonly Word[], settings: UserSettings, now: Date): Stats {
  const learnPool = words.filter(isInLearnPool).length
  const remainingToday = computeRemainingToday(settings, now)

  return {
    total: words.length,
    learned: words.filter((w) => w.repetitions > 0).length,
    reviewDue: words.filter((w) => isReviewDue(w, now)).length,
    learnPool,
    newToLearn: Math.min(learnPool, remainingToday),
    favorites: words.filter((w) => w.isFavorite).length,
    hidden: words.filter((w) => w.isHidden).length,
    custom: words.filter((w) => w.isCustom).length,
    streak: computeStreak(settings, now),
    dailyLimit: settings.dailyNewWordLimit,
    remainingToday,
  }
}
