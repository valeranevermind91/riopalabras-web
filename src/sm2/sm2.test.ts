import { describe, expect, it } from 'vitest'
import { MAX_INTERVAL_DAYS, RELEARN_MINUTES, RELEARN_MS, applyReview, formatInterval, isAgain, learnedState, previewInterval, type Sm2Card } from './sm2'

const NOW = new Date('2026-10-02T15:00:00.000Z')
const JUST_LEARNED: Sm2Card = { easeFactor: 2.5, interval: 0, repetitions: 1 }

describe('test environment', () => {
  it('runs in America/Montevideo (UTC-3) so the local-midnight tests mean something', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Montevideo')
    expect(new Date(2026, 9, 2, 12).getTimezoneOffset()).toBe(180)
  })
})

describe('first review of a just-learned word', () => {
  it('previews Again Soon, Hard 1d, Good 3d, Easy 3d', () => {
    const labels = [1, 2, 3, 4].map((q) => formatInterval(previewInterval(JUST_LEARNED, q)))
    expect(labels).toEqual(['Soon', '1d', '3d', '3d'])
  })

  it('computes the exact ease factors (Again 2.18, Hard 2.36, Good 2.5, Easy 2.6)', () => {
    const ease = [1, 2, 3, 4].map((q) => applyReview(JUST_LEARNED, q, NOW).easeFactor)
    expect(ease[0]).toBeCloseTo(2.18, 10)
    expect(ease[1]).toBeCloseTo(2.36, 10)
    expect(ease[2]).toBeCloseTo(2.5, 10)
    expect(ease[3]).toBeCloseTo(2.6, 10)
  })
})

describe('applyReview', () => {
  it('increments repetitions on q2..q4', () => {
    for (const q of [2, 3, 4]) {
      expect(applyReview(JUST_LEARNED, q, NOW).repetitions).toBe(2)
    }
  })

  it('Again (a relearning step): one repetition, interval 0, due in ten minutes, the ease factor lowered as before', () => {
    const mature: Sm2Card = { easeFactor: 2.5, interval: 40, repetitions: 7 }
    const next = applyReview(mature, 1, NOW)
    expect(next.interval).toBe(0)
    expect(next.repetitions).toBe(1) // not 0: the word does not go back to new, so it does not go back to Learn
    expect(next.easeFactor).toBeCloseTo(2.18, 10)
    expect(RELEARN_MINUTES).toBe(10)
    expect(next.nextReview.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000)
    expect(next.nextReview.getTime() - NOW.getTime()).toBe(RELEARN_MS)
  })

  it('the lowered ease factor survives: a later rating starts from it (nothing resets it to 2.5)', () => {
    const lapsed = applyReview({ easeFactor: 2.5, interval: 40, repetitions: 7 }, 1, NOW)
    const good = applyReview(lapsed, 3, NOW)
    expect(good.easeFactor).toBeCloseTo(2.18, 10) // Good leaves the ease where it is: the lowered 2.18, not a reset to 2.5
    expect(good.interval).toBe(2) // from the one-day base: 1 × 2.18, rounded
    expect(applyReview(lapsed, 4, NOW).easeFactor).toBeCloseTo(2.28, 10) // Easy raises it from there
  })

  it('a second Again keeps dropping the ease factor, floored at 1.3, and stays a relearning step', () => {
    let card: Sm2Card = { easeFactor: 2.5, interval: 40, repetitions: 7 }
    const seen: number[] = []
    for (let i = 0; i < 8; i++) {
      const next = applyReview(card, 1, NOW)
      expect(next).toMatchObject({ interval: 0, repetitions: 1 })
      seen.push(next.easeFactor)
      card = next
    }
    expect(seen[1]).toBeLessThan(seen[0])
    expect(seen.every((e, i) => i === 0 || e <= seen[i - 1])).toBe(true)
    expect(seen[seen.length - 1]).toBe(1.3)
  })

  it('Hard, Good and Easy from a word that was just rated Again (repetitions 1, interval 0) preview from the one-day base', () => {
    const lapsed = applyReview({ easeFactor: 2.5, interval: 40, repetitions: 7 }, 1, NOW) // ease 2.18
    expect(lapsed).toMatchObject({ interval: 0, repetitions: 1 })
    expect([2, 3, 4].map((q) => previewInterval(lapsed, q))).toEqual([1, 2, 3]) // 1×1.2, 1×2.18, 1×2.28×1.3 (Easy raises the ease to 2.28 first)
    expect([1, 2, 3, 4].map((q) => formatInterval(previewInterval(lapsed, q)))).toEqual(['Soon', '1d', '2d', '3d'])
    expect([2, 3, 4].map((q) => applyReview(lapsed, q, NOW).repetitions)).toEqual([2, 2, 2])
  })

  it('isAgain: only a rating of 1 (or below)', () => {
    expect([0, 1, 2, 3, 4].map(isAgain)).toEqual([true, true, false, false, false])
  })

  it('uses the multipliers: Hard ×1.2, Good ×ease, Easy ×ease×1.3 (rounded)', () => {
    const card: Sm2Card = { easeFactor: 2.5, interval: 10, repetitions: 3 }
    expect(applyReview(card, 2, NOW).interval).toBe(12) // 10 × 1.2
    expect(applyReview(card, 3, NOW).interval).toBe(25) // 10 × 2.5
    expect(applyReview(card, 4, NOW).interval).toBe(34) // 10 × 2.6 × 1.3 = 33.8
  })

  it('rounds halves up like Dart (3 × 2.5 = 7.5 → 8)', () => {
    expect(applyReview({ easeFactor: 2.5, interval: 3, repetitions: 2 }, 3, NOW).interval).toBe(8)
  })

  it('Hard on a 1-day word moves it out to 2 days, and on a 2-day word to 3 (1 × 1.2 and 2 × 1.2 used to round back, and the word came back every day for ever)', () => {
    expect(applyReview({ easeFactor: 2.5, interval: 1, repetitions: 2 }, 2, NOW).interval).toBe(2)
    expect(applyReview({ easeFactor: 2.5, interval: 2, repetitions: 3 }, 2, NOW).interval).toBe(3)
    expect(applyReview({ easeFactor: 1.3, interval: 2, repetitions: 3 }, 2, NOW).interval).toBe(3) // whatever the ease
    expect(applyReview({ easeFactor: 3.4, interval: 1, repetitions: 2 }, 2, NOW).interval).toBe(2)
  })

  it('Good on a 1-day word with an ease under 1.5 moves it out to 2 days (round(1.3) is 1); from 1.5 it was already 2', () => {
    expect(applyReview({ easeFactor: 1.3, interval: 1, repetitions: 2 }, 3, NOW).interval).toBe(2)
    expect(applyReview({ easeFactor: 1.49, interval: 1, repetitions: 2 }, 3, NOW).interval).toBe(2)
    expect(applyReview({ easeFactor: 1.5, interval: 1, repetitions: 2 }, 3, NOW).interval).toBe(2)
  })

  it('a word with no interval in days yet (just learned, or relearning) keeps the one-day base: Hard on it is 1 day, not 2', () => {
    expect(applyReview({ easeFactor: 2.5, interval: 0, repetitions: 1 }, 2, NOW).interval).toBe(1)
    expect(applyReview({ easeFactor: 1.3, interval: 0, repetitions: 1 }, 3, NOW).interval).toBe(1) // round(1.3): its first step, nothing to grow from
    expect(applyReview({ easeFactor: 2.5, interval: 0, repetitions: 1 }, 1, NOW).interval).toBe(0) // and Again is still due in minutes
  })

  it('a person who answers Hard every time sees the word further out each time, not for ever on the same day', () => {
    let card: Sm2Card = { easeFactor: 2.5, interval: 0, repetitions: 1 }
    const days: number[] = []
    for (let i = 0; i < 8; i++) {
      const next = applyReview(card, 2, NOW)
      card = { easeFactor: next.easeFactor, interval: next.interval, repetitions: next.repetitions }
      days.push(next.interval)
    }
    expect(days).toEqual([1, 2, 3, 4, 5, 6, 7, 8]) // and the ease has gone from 2.5 to 1.38 on the way: Good could not have got it out of 1 day before
  })

  it('floors the ease factor at 1.3', () => {
    let card: Sm2Card = { easeFactor: 1.4, interval: 5, repetitions: 3 }
    for (let i = 0; i < 6; i++) {
      const next = applyReview(card, 1, NOW)
      card = { easeFactor: next.easeFactor, interval: next.interval, repetitions: next.repetitions }
      expect(next.easeFactor).toBeGreaterThanOrEqual(1.3)
    }
    expect(card.easeFactor).toBe(1.3)
    expect(applyReview({ easeFactor: 1.3, interval: 4, repetitions: 3 }, 2, NOW).easeFactor).toBe(1.3)
  })

  it('clamps intervals to the cap (270 days; the cap itself is tested in intervalCap.test.ts)', () => {
    const huge: Sm2Card = { easeFactor: 2.5, interval: 30000, repetitions: 20 }
    expect(applyReview(huge, 3, NOW).interval).toBe(270)
    expect(applyReview(huge, 4, NOW).interval).toBe(270)
  })

  it('schedules nextReview exactly interval × 24h after now', () => {
    const next = applyReview({ easeFactor: 2.5, interval: 10, repetitions: 3 }, 3, NOW)
    expect(next.nextReview.getTime() - NOW.getTime()).toBe(25 * 24 * 60 * 60 * 1000)
  })

  it('clamps out-of-range qualities into 1..4', () => {
    expect(applyReview(JUST_LEARNED, 0, NOW)).toEqual(applyReview(JUST_LEARNED, 1, NOW))
    expect(applyReview(JUST_LEARNED, 9, NOW)).toEqual(applyReview(JUST_LEARNED, 4, NOW))
  })

  it('does not mutate its input', () => {
    const card = { ...JUST_LEARNED }
    applyReview(card, 3, NOW)
    expect(card).toEqual(JUST_LEARNED)
  })
})

describe('formatInterval', () => {
  it.each([
    [0, 'Soon'],
    [-3, 'Soon'],
    [1, '1d'],
    [2, '2d'],
    [29, '29d'],
    [30, '1mo'],
    [45, '2mo'],
    [180, '6mo'],
    [269, '9mo'],
    [270, '9mo'],
    [364, '12mo'],
    [365, '1y'],
    [730, '2y'],
    [36500, '100y'],
  ])('%i days → %s', (days, label) => {
    expect(formatInterval(days)).toBe(label)
  })
})

describe('learnedState', () => {
  it('writes repetitions 1, interval 0, ease 2.5', () => {
    const s = learnedState(new Date(2026, 9, 2, 14, 30))
    expect(s.repetitions).toBe(1)
    expect(s.interval).toBe(0)
    expect(s.easeFactor).toBe(2.5)
  })

  it('is due at tomorrow LOCAL midnight, persisted as UTC (Montevideo = UTC-3)', () => {
    const s = learnedState(new Date(2026, 9, 2, 14, 30))
    expect(s.nextReview.toISOString()).toBe('2026-10-03T03:00:00.000Z')
  })

  it('late in the evening local time still means the next local day, not the UTC one', () => {
    // 23:30 local on Oct 2 is already Oct 3 02:30 UTC; "tomorrow" must still be Oct 3 local midnight.
    const s = learnedState(new Date(2026, 9, 2, 23, 30))
    expect(s.nextReview.toISOString()).toBe('2026-10-03T03:00:00.000Z')
  })

  it('just after local midnight is still "tomorrow" relative to the new local day', () => {
    const s = learnedState(new Date(2026, 9, 3, 0, 5))
    expect(s.nextReview.toISOString()).toBe('2026-10-04T03:00:00.000Z')
  })

  it('rolls over month and year ends', () => {
    expect(learnedState(new Date(2026, 9, 31, 10)).nextReview.toISOString()).toBe('2026-11-01T03:00:00.000Z')
    expect(learnedState(new Date(2026, 11, 31, 10)).nextReview.toISOString()).toBe('2027-01-01T03:00:00.000Z')
    expect(learnedState(new Date(2028, 1, 28, 10)).nextReview.toISOString()).toBe('2028-02-29T03:00:00.000Z')
  })

  it('always lands exactly on a local midnight of the next calendar day', () => {
    const s = learnedState(new Date(2026, 5, 15, 18, 45, 12, 345))
    expect(s.nextReview.getFullYear()).toBe(2026)
    expect(s.nextReview.getMonth()).toBe(5)
    expect(s.nextReview.getDate()).toBe(16)
    expect([s.nextReview.getHours(), s.nextReview.getMinutes(), s.nextReview.getSeconds(), s.nextReview.getMilliseconds()]).toEqual([0, 0, 0, 0])
  })
})

describe('a rating always moves a word that has an interval out, and changes nothing else', () => {
  // every interval below the cap, every ease the scheduler can reach (1.30 to 3.50 in hundredths), every rating but Again
  const eases = Array.from({ length: 221 }, (_, i) => (130 + i) / 100)
  const intervals = Array.from({ length: MAX_INTERVAL_DAYS - 1 }, (_, i) => i + 1)
  // the scheduler as it was before the floor: round(base × factor), at least one day, at most the cap
  const before = (card: Sm2Card, q: number) => {
    const ease = applyReview(card, q, NOW).easeFactor
    const base = card.interval === 0 ? 1 : card.interval
    const raw = q === 2 ? base * 1.2 : q === 3 ? base * ease : base * ease * 1.3
    return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(raw)))
  }

  it('Hard, Good and Easy each give a word with an interval a longer one (property, over every interval below the cap and every ease)', () => {
    let checked = 0
    for (const interval of intervals)
      for (const easeFactor of eases)
        for (const q of [2, 3, 4]) {
          const next = applyReview({ easeFactor, interval, repetitions: 2 }, q, NOW).interval
          if (next <= interval) throw new Error(`rating ${q} on ${interval} days at ease ${easeFactor} gave ${next}`)
          expect(next).toBeLessThanOrEqual(MAX_INTERVAL_DAYS)
          checked++
        }
    expect(checked).toBe(intervals.length * eases.length * 3)
  })

  it('and the three buttons stay in order: Hard is never longer than Good, nor Good than Easy', () => {
    for (const interval of intervals)
      for (const easeFactor of eases) {
        const [hard, good, easy] = [2, 3, 4].map((q) => applyReview({ easeFactor, interval, repetitions: 2 }, q, NOW).interval)
        if (!(hard <= good && good <= easy)) throw new Error(`${interval} days at ease ${easeFactor}: ${hard} / ${good} / ${easy}`)
      }
  })

  it('it changes only the states that could not grow: everywhere else the interval is what rounding gave, and in those it is exactly one day more', () => {
    const changed: string[] = []
    for (const interval of intervals)
      for (const easeFactor of eases)
        for (const q of [2, 3, 4]) {
          const card = { easeFactor, interval, repetitions: 2 }
          const was = before(card, q)
          const now = applyReview(card, q, NOW).interval
          if (now === was) continue
          expect(now).toBe(interval + 1) // a change is the minimum increment and nothing more
          expect(was).toBeLessThanOrEqual(interval) // and only where the old interval had not grown
          changed.push(`${q === 2 ? 'Hard' : q === 3 ? 'Good' : 'Easy'} at ${interval}`)
        }
    // Hard at 1 and 2 days (221 eases each) and Good at 1 day with ease 1.30 to 1.49 (20 eases): nothing else
    expect(changed.filter((c) => c === 'Hard at 1')).toHaveLength(221)
    expect(changed.filter((c) => c === 'Hard at 2')).toHaveLength(221)
    expect(changed.filter((c) => c === 'Good at 1')).toHaveLength(20)
    expect(changed).toHaveLength(221 + 221 + 20)
  })

  it('at the cap a word stays at the cap, and a word stored past it comes under it at its next review', () => {
    for (const q of [2, 3, 4]) {
      expect(applyReview({ easeFactor: 2.5, interval: MAX_INTERVAL_DAYS, repetitions: 9 }, q, NOW).interval).toBe(MAX_INTERVAL_DAYS)
      expect(applyReview({ easeFactor: 2.5, interval: 400, repetitions: 9 }, q, NOW).interval).toBe(MAX_INTERVAL_DAYS)
    }
  })

  it('the buttons preview what would be written, floor included', () => {
    const card: Sm2Card = { easeFactor: 1.3, interval: 1, repetitions: 2 }
    expect([2, 3, 4].map((q) => previewInterval(card, q))).toEqual([2, 2, 2])
    expect([2, 3, 4].map((q) => previewInterval({ easeFactor: 2.5, interval: 2, repetitions: 3 }, q))).toEqual([3, 5, 7])
  })
})
