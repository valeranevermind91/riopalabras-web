import { strings } from '../strings'
import { lastDays } from './metrics'

// Home's week of dots: which of the last days user_daily_metrics says were active. (The streak NUMBER is not derived from
// these: it is the stored streak in the settings, see computeStreak.)

/** The weekday letter of a local `YYYY-MM-DD` date (taken from the date itself, never from "today"). */
export function weekdayLetter(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const jsDay = new Date(y, m - 1, d).getDay() // 0 = Sunday
  return strings.home.weekdays[(jsDay + 6) % 7] // one letter per weekday, Monday first, in the interface language
}

export interface Dot {
  date: string
  letter: string
  active: boolean
  today: boolean
}

/** Days shown as dots. */
export const DOT_COUNT = 7

/**
 * The last `count` days (default: the week of dots), oldest first and today last. A day is active when the
 * server's rows say so; today is also active when this device's own row for today does (the server may not have it yet).
 */
export function activityDots(now: Date, active: ReadonlySet<string>, todayActiveLocally: boolean, count: number = DOT_COUNT): Dot[] {
  const days = lastDays(now, count)
  return days.map((date, i) => ({
    date,
    letter: weekdayLetter(date),
    active: active.has(date) || (i === days.length - 1 && todayActiveLocally),
    today: i === days.length - 1,
  }))
}
