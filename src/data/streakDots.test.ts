import { describe, expect, it } from 'vitest'
import { lastDays } from './metrics'
import { DOT_COUNT, STREAK_WINDOW, WEEKDAY_LETTERS, activityDots, streakFromDots, weekdayLetter } from './streakDots'

const MON = new Date(2026, 9, 5, 12) // Monday 5 October 2026

describe('weekday letters (week starts Monday, taken from the date)', () => {
  it('Mon..Sun are M T W T F S S', () => {
    expect(WEEKDAY_LETTERS.join('')).toBe('MTWTFSS')
    const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']
    expect(week.map(weekdayLetter).join('')).toBe('MTWTFSS')
  })

  it('comes from the date itself, wherever it falls (month and year ends, leap day)', () => {
    expect(weekdayLetter('2026-12-31')).toBe('T') // Thursday
    expect(weekdayLetter('2027-01-01')).toBe('F')
    expect(weekdayLetter('2028-02-29')).toBe('T') // Tuesday
    expect(weekdayLetter('2026-10-04')).toBe('S') // Sunday
  })
})

describe('the dots', () => {
  it('seven, six days ago first and today last, with the letters of their own dates', () => {
    const dots = activityDots(MON, new Set(), false)
    expect(dots.map((d) => d.date)).toEqual(lastDays(MON))
    expect(dots.map((d) => d.letter).join('')).toBe('TWTFSSM')
    expect(dots.filter((d) => d.today).map((d) => d.date)).toEqual(['2026-10-05'])
  })

  it('the labels follow the calendar, not the position: another day, another sequence', () => {
    const friday = activityDots(new Date(2026, 9, 9, 12), new Set(), false) // Friday 9 October 2026
    expect(friday.map((d) => d.letter).join('')).toBe('SSMTWTF')
    expect(friday.at(-1)!.letter).toBe('F')
  })

  it('active from the server\'s days; today also from the local row; others never from the local row', () => {
    const dots = activityDots(MON, new Set(['2026-10-03']), true)
    expect(dots.filter((d) => d.active).map((d) => d.date)).toEqual(['2026-10-03', '2026-10-05'])
    expect(activityDots(MON, new Set(), false).some((d) => d.active)).toBe(false)
  })
})

describe('the streak rule, on a one-week window', () => {
  const streak = (active: string[], todayLocal = false) => streakFromDots(activityDots(MON, new Set(active), todayLocal))

  it('consecutive active days ending today', () => {
    expect(streak(['2026-10-05'])).toEqual({ count: 1, atLeast: false })
    expect(streak(['2026-10-05', '2026-10-04', '2026-10-03'])).toEqual({ count: 3, atLeast: false })
  })

  it('…or ending yesterday, while today has no activity yet', () => {
    expect(streak(['2026-10-04', '2026-10-03'])).toEqual({ count: 2, atLeast: false })
    expect(streak(['2026-10-04'])).toEqual({ count: 1, atLeast: false })
  })

  it('a gap stops the count: only the run touching today (or yesterday) counts', () => {
    expect(streak(['2026-10-05', '2026-10-03', '2026-10-02']).count).toBe(1)
    expect(streak(['2026-10-04', '2026-10-02', '2026-10-01']).count).toBe(1)
  })

  it('a run that ended before yesterday is not a streak any more', () => {
    expect(streak(['2026-10-03', '2026-10-02', '2026-10-01']).count).toBe(0)
    expect(streak([]).count).toBe(0)
  })

  it('today\'s local activity counts even before the server has it', () => {
    expect(streak(['2026-10-04'], true).count).toBe(2)
    expect(streak([], true).count).toBe(1)
  })

  it('every dot active: at least seven (the week cannot show more)', () => {
    expect(streak(lastDays(MON))).toEqual({ count: 7, atLeast: true })
  })

  it('a run that reaches the oldest dot is "at least": the week cannot show what came before it', () => {
    expect(streak(lastDays(MON).slice(0, 6))).toEqual({ count: 6, atLeast: true }) // six days ending yesterday, starting at the oldest dot
    expect(streak(lastDays(MON).slice(1))).toEqual({ count: 6, atLeast: false }) // six days ending today, with an empty dot before them: exactly six
  })

  it('on a one-week window, agreement holds for every one of the 128 patterns: the number is the run of filled dots at the right end', () => {
    for (let mask = 0; mask < 128; mask++) {
      const days = lastDays(MON)
      const dots = activityDots(MON, new Set(days.filter((_, i) => mask & (1 << i))), false)
      expect(streakFromDots(dots).count, `mask ${mask.toString(2).padStart(7, '0')}`).toBe(runAtTheRightEnd(dots.map((d) => d.active)))
    }
  })
})

/** The streak read off a picture of filled/empty days: skip an empty last day (today is still open), then count filled days leftwards. */
function runAtTheRightEnd(filled: boolean[]): number {
  let i = filled.length - 1
  if (i >= 0 && !filled[i]) i--
  let run = 0
  while (i >= 0 && filled[i]) {
    run++
    i--
  }
  return run
}

describe('the streak over the 30-day window (the week of dots is its last seven days)', () => {
  const days = lastDays(MON, STREAK_WINDOW)
  const streak = (active: string[], todayLocal = false) => streakFromDots(activityDots(MON, new Set(active), todayLocal, STREAK_WINDOW))
  const lastN = (n: number, skipToday = false) => days.slice(STREAK_WINDOW - n - (skipToday ? 1 : 0), STREAK_WINDOW - (skipToday ? 1 : 0))

  it('the window is thirty days, the dots seven', () => {
    expect(STREAK_WINDOW).toBe(30)
    expect(DOT_COUNT).toBe(7)
    expect(days).toHaveLength(30)
    expect(days.at(-1)).toBe('2026-10-05')
    expect(days[0]).toBe('2026-09-06')
    expect(activityDots(MON, new Set(), false, STREAK_WINDOW).slice(-DOT_COUNT).map((d) => d.date)).toEqual(lastDays(MON))
  })

  it('a long streak is its true length, not capped at the week', () => {
    expect(streak(lastN(8))).toEqual({ count: 8, atLeast: false })
    expect(streak(lastN(12))).toEqual({ count: 12, atLeast: false })
    expect(streak(lastN(29))).toEqual({ count: 29, atLeast: false }) // an empty day (the 30th) before it: exactly 29
  })

  it('…also ending yesterday, while today is still open', () => {
    expect(streak(lastN(15, true))).toEqual({ count: 15, atLeast: false })
  })

  it('only a run that reaches the 30-day edge is "at least": thirty active days read "30+"', () => {
    expect(streak(lastN(30))).toEqual({ count: 30, atLeast: true })
    expect(streak(lastN(29))).toEqual({ count: 29, atLeast: false })
    expect(streak(lastN(29, true))).toEqual({ count: 29, atLeast: true }) // ending yesterday and starting at the edge: 29, at least
  })

  it('a gap anywhere stops the run, however long the older one was', () => {
    const run = lastN(20)
    const withGap = run.filter((d) => d !== days[STREAK_WINDOW - 6]) // a missed day five days ago
    expect(streak(withGap)).toEqual({ count: 5, atLeast: false })
  })

  it('an old run that does not touch today or yesterday is no streak', () => {
    expect(streak(days.slice(0, 20)).count).toBe(0)
  })

  /** True when the filled run on screen touches the left edge of the week, so the number may include days off screen. */
  const runLeavesTheWeek = (dots: ReturnType<typeof activityDots>) => {
    const tail = runAtTheRightEnd(dots.map((d) => d.active))
    return tail === dots.length || (!dots.at(-1)!.active && tail === dots.length - 1)
  }

  it('agrees with the dots: a run that ends inside the week is shown exactly; one that leaves the week is longer than what is drawn', () => {
    let seed = 11
    const rng = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
    for (let run = 0; run < 3000; run++) {
      const density = rng()
      const window = activityDots(MON, new Set(days.filter(() => rng() < density)), rng() < 0.3, STREAK_WINDOW)
      const { count, atLeast } = streakFromDots(window)
      expect(count).toBe(runAtTheRightEnd(window.map((d) => d.active)))
      const dots = window.slice(-DOT_COUNT)
      const tail = runAtTheRightEnd(dots.map((d) => d.active))
      if (runLeavesTheWeek(dots)) expect(count).toBeGreaterThanOrEqual(tail)
      else expect(count).toBe(tail) // the drawn dots show the whole run
      // "at least" only when the run reaches the 30-day edge
      expect(atLeast).toBe(count > 0 && count === STREAK_WINDOW - (window.at(-1)!.active ? 0 : 1))
    }
  })

  it('every pattern of the last week agrees with the picture (all 128), whatever the older days hold', () => {
    for (let mask = 0; mask < 128; mask++) {
      const week = days.slice(-7).filter((_, i) => mask & (1 << i))
      const label = `mask ${mask.toString(2).padStart(7, '0')}`
      const alone = activityDots(MON, new Set(week), false, STREAK_WINDOW)
      const shown = streakFromDots(alone)
      expect(shown.count, label).toBe(runAtTheRightEnd(alone.slice(-7).map((d) => d.active)))
      const withOlder = activityDots(MON, new Set([...week, ...days.slice(0, 20)]), false, STREAK_WINDOW)
      if (runLeavesTheWeek(withOlder.slice(-7))) expect(streakFromDots(withOlder).count, label).toBeGreaterThanOrEqual(shown.count)
      else expect(streakFromDots(withOlder).count, label).toBe(shown.count) // a gap inside the week ends the run there, whatever came before
    }
  })
})
