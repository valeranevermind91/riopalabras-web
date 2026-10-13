import { localDateKey, localYesterdayKey } from './dates'
import type { SettingsPatch, UserSettings } from './types'

/**
 * The streak's date rule (ported from the Flutter app's StreakService.recordActivityCompleted): same local day → null (nothing to
 * write); last activity yesterday → streak + 1; anything else (never, or a gap) → 1. It says nothing about WHEN a day counts: that is
 * dayPatch, below. The Flutter app is frozen, so the web owns the rule.
 */
export function streakPatch(settings: UserSettings, now: Date): SettingsPatch | null {
  const today = localDateKey(now)
  const last = settings.streakLastActivityDate
  if (last === today) return null

  const count = last === localYesterdayKey(now) ? settings.streakCount + 1 : 1
  return { streak_count: count, streak_last_activity_date: today }
}

/**
 * Port of DailyNewWordService.recordNewWordsIntroduced: adds `delta` to today's counter, lazily
 * restarting from 0 when the stored date isn't today (local). Nothing to write for delta <= 0.
 */
export function newWordsPatch(settings: UserSettings, delta: number, now: Date): SettingsPatch | null {
  if (delta <= 0) return null

  const today = localDateKey(now)
  const base = settings.newWordsLearnedTodayDate === today ? settings.newWordsLearnedTodayCount : 0
  return { new_words_learned_today_count: base + delta, new_words_learned_today_date: today }
}

/** How many new words were introduced today (0 if the stored counter is from another day). */
export function learnedToday(settings: UserSettings, now: Date): number {
  return settings.newWordsLearnedTodayDate === localDateKey(now) ? settings.newWordsLearnedTodayCount : 0
}

/** A day counts for the streak at this many cards done today, in any modes. */
export const STREAK_CARDS = 10

/** Cards done today (0 if the stored counter is from another day). */
export function cardsToday(settings: UserSettings, now: Date): number {
  return settings.cardsDoneTodayDate === localDateKey(now) ? settings.cardsDoneTodayCount : 0
}

/** Whether today has already counted for the streak. */
export const streakCountedToday = (settings: UserSettings, now: Date): boolean => settings.streakLastActivityDate === localDateKey(now)

/**
 * What a card done (or several) writes. A day counts for the streak when EITHER
 *   - 10 cards have been done today, in any modes: a word finished in Learn, a rating in Review, a matched pair in Matching, an answered
 *     question in Cloze ("Already know it" is not a card, and a relearning re-queue is the same card: callers count it once); OR
 *   - everything that was available today has been done: today's new-word goal is reached and no review is due (a light day still counts).
 * The streak is written at the moment the day first qualifies, not at the first activity: until then only the day's card counter is
 * written, and once the day counts nothing is written at all (null), so a long session adds no writes. The date rule is streakPatch's.
 * Existing streaks are not recalculated: the stored streak_count stays as it is and the rule applies from the day it ships.
 *
 * `learnedNow` is today's new-word count as it stands once this event is in (Learn passes its own batch in; the others leave it out), and
 * `nothingDue` whether no review is due once this event is in. `cards` may be 0: an event can complete a light day without being a new card.
 */
export function dayPatch(settings: UserSettings, now: Date, { cards, nothingDue, learnedNow }: { cards: number; nothingDue: boolean; learnedNow?: number }): SettingsPatch | null {
  if (streakCountedToday(settings, now)) return null
  const done = cardsToday(settings, now) + Math.max(0, cards)
  const goalReached = (learnedNow ?? learnedToday(settings, now)) >= settings.dailyNewWordLimit
  // A light day still needs something done: with nothing at all done today, "everything available" is not an achievement.
  const qualifies = done >= STREAK_CARDS || (done > 0 && goalReached && nothingDue)
  if (!qualifies && cards <= 0) return null
  return { cards_done_today_count: done, cards_done_today_date: localDateKey(now), ...(qualifies ? streakPatch(settings, now) : {}) }
}
