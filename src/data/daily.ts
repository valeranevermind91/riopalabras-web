import { localDateKey, localYesterdayKey } from './dates'
import type { SettingsPatch, UserSettings } from './types'

/**
 * Port of StreakService.recordActivityCompleted: same local day → null (nothing to write); last
 * activity yesterday → streak + 1; anything else (never, or a gap) → 1.
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
