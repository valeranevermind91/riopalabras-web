import { strings } from '../strings'

// Port of Word.applyReview / previewIntervalDays and the Learn "first interval" rule from the
// Flutter app, except for the Again rating: the Flutter app sent a lapsed word back to new, this one relearns it (see applyReview).
// Pure: callers pass `now`, nothing here reads the clock.

export interface Sm2Card {
  easeFactor: number
  /** Days. 0 means "not yet scheduled in days" (just learned, or relearning after an Again). */
  interval: number
  repetitions: number
}

export interface Sm2State extends Sm2Card {
  nextReview: Date
}

/** Plain integer rating: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy. */
export type Quality = number

export const DEFAULT_EASE = 2.5
export const MIN_EASE = 1.3
export const MAX_INTERVAL_DAYS = 36500
/** An Again brings the word back after this long (and the Review session brings it back at its end, sooner). */
export const RELEARN_MINUTES = 10

const DAY_MS = 24 * 60 * 60 * 1000
export const RELEARN_MS = RELEARN_MINUTES * 60 * 1000

function clampQuality(quality: Quality): number {
  return Math.min(4, Math.max(1, Math.round(quality)))
}

function clampInterval(days: number): number {
  return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(days)))
}

/** Whether a rating is an Again (anything at or below 1). */
export const isAgain = (quality: Quality): boolean => clampQuality(quality) <= 1

/**
 * The SM-2 step. An Again is a relearning step, not a reset to new: the word keeps one repetition (so it stays in Review's world, out of the
 * Learn pool, and takes no slot of the day's new words), the interval is 0 days, it is due again in RELEARN_MINUTES, and the ease factor drops as
 * it always did and stays lowered. The next Hard / Good / Easy then starts from the one-day base a word at interval 0 always has.
 */
export function applyReview(card: Sm2Card, quality: Quality, now: Date): Sm2State {
  const q = clampQuality(quality)
  const miss = 4 - q
  const easeFactor = Math.max(MIN_EASE, card.easeFactor + (0.1 - miss * (0.08 + miss * 0.02)))

  let interval: number
  let repetitions: number

  if (q <= 1) {
    interval = 0
    repetitions = 1
  } else {
    repetitions = card.repetitions + 1
    const base = card.interval === 0 ? 1 : card.interval
    if (q === 2) interval = clampInterval(base * 1.2)
    else if (q === 3) interval = clampInterval(base * easeFactor)
    else interval = clampInterval(base * easeFactor * 1.3)
  }

  // Duration-style (n × 24h) like Flutter's Duration(days:), not calendar-day arithmetic. An Again is due in minutes, not days.
  const wait = q <= 1 ? RELEARN_MS : interval * DAY_MS
  return { easeFactor, interval, repetitions, nextReview: new Date(now.getTime() + wait) }
}

/** The interval (days) a rating would produce — what the rating buttons preview. */
export function previewInterval(card: Sm2Card, quality: Quality): number {
  return applyReview(card, quality, new Date(0)).interval
}

export function formatInterval(days: number): string {
  const t = strings.interval
  if (days <= 0) return t.minutes(RELEARN_MINUTES) // only an Again previews no days
  if (days < 30) return t.days(days)
  if (days < 365) return t.months(Math.round(days / 30))
  return t.years(Math.round(days / 365))
}

/**
 * What finishing a Learn batch writes for each word: introduced (repetitions 1) but not yet
 * reviewed, due at the start of tomorrow in the device's LOCAL time. Persisted via toISOString().
 */
export function learnedState(now: Date): Sm2State {
  return {
    easeFactor: DEFAULT_EASE,
    interval: 0,
    repetitions: 1,
    // Field arithmetic: Date normalizes month/year overflow and DST can't land it on the wrong day.
    nextReview: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
  }
}
