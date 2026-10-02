import { describe, expect, it } from 'vitest'
import { applyReview, formatInterval, learnedState, previewInterval, type Sm2Card } from './sm2'

const NOW = new Date('2026-10-02T15:00:00.000Z')
const JUST_LEARNED: Sm2Card = { easeFactor: 2.5, interval: 0, repetitions: 1 }

describe('test environment', () => {
  it('runs in America/Montevideo (UTC-3) so the local-midnight tests mean something', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Montevideo')
    expect(new Date(2026, 9, 2, 12).getTimezoneOffset()).toBe(180)
  })
})

describe('first review of a just-learned word', () => {
  it('previews Again <1m, Hard 1d, Good 3d, Easy 3d', () => {
    const labels = [1, 2, 3, 4].map((q) => formatInterval(previewInterval(JUST_LEARNED, q)))
    expect(labels).toEqual(['<1m', '1d', '3d', '3d'])
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

  it('a lapse (Again) resets interval and repetitions to 0 and is due immediately', () => {
    const mature: Sm2Card = { easeFactor: 2.5, interval: 40, repetitions: 7 }
    const next = applyReview(mature, 1, NOW)
    expect(next.interval).toBe(0)
    expect(next.repetitions).toBe(0)
    expect(next.easeFactor).toBeCloseTo(2.18, 10)
    expect(next.nextReview.getTime()).toBe(NOW.getTime())
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

  it('Hard never shrinks a 1-day interval below 1 day', () => {
    expect(applyReview({ easeFactor: 2.5, interval: 1, repetitions: 2 }, 2, NOW).interval).toBe(1)
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

  it('clamps intervals to 36500 days', () => {
    const huge: Sm2Card = { easeFactor: 2.5, interval: 30000, repetitions: 20 }
    expect(applyReview(huge, 3, NOW).interval).toBe(36500)
    expect(applyReview(huge, 4, NOW).interval).toBe(36500)
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
    [0, '<1m'],
    [-3, '<1m'],
    [1, '1d'],
    [2, '2d'],
    [29, '29d'],
    [30, '1mo'],
    [45, '2mo'],
    [180, '6mo'],
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
