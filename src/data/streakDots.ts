import { lastDays } from './metrics'

// Home's week of dots and the streak number that goes with them. The number is derived from the dots,
// so the two can never disagree.

/** One letter per weekday, Monday first (Mon..Sun). */
export const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

/** The weekday letter of a local `YYYY-MM-DD` date (taken from the date itself, never from "today"). */
export function weekdayLetter(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const jsDay = new Date(y, m - 1, d).getDay() // 0 = Sunday
  return WEEKDAY_LETTERS[(jsDay + 6) % 7]
}

export interface Dot {
  date: string
  letter: string
  active: boolean
  today: boolean
}

/** Days shown as dots. */
export const DOT_COUNT = 7
/** Days read from the server for the streak: a streak that reaches the far edge of this window is shown as "30+". */
export const STREAK_WINDOW = 30

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

export interface DotStreak {
  /** Consecutive active days ending today (or yesterday, while today is still to come). */
  count: number
  /** The run reaches the oldest day that was read, so it may be longer: shown as "30+". */
  atLeast: boolean
}

/**
 * The streak of a run of days: consecutive active days ending today, or yesterday while today has no activity
 * yet. Pass the whole 30-day window; the week of dots is just its last seven entries, so the number and the
 * dots always agree. "At least" only when the run touches the oldest day of the window.
 */
export function streakFromDots(dots: readonly Dot[]): DotStreak {
  let end = dots.length - 1
  if (end >= 0 && !dots[end].active) end -= 1 // today is still open: the run may end yesterday
  let count = 0
  for (let i = end; i >= 0 && dots[i].active; i--) count++
  return { count, atLeast: count > 0 && end - count + 1 === 0 }
}
