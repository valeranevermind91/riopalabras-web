import { describe, expect, it } from 'vitest'
import {
  COMMIT_DISTANCE,
  FLICK_MIN_DISTANCE,
  FLICK_VELOCITY,
  MAX_EXIT_MS,
  MIN_EXIT_MS,
  MIN_EXIT_SPEED,
  REDUCED_FADE_MS,
  RESISTANCE,
  decideRelease,
  dragOffset,
  planExit,
  arrivalOf,
  velocityOf,
} from './swipe'

const release = (over: Partial<Parameters<typeof decideRelease>[0]> = {}) => decideRelease({ dx: 0, dy: 0, velocity: 0, canNext: true, canPrevious: true, ...over })

describe('release threshold and direction', () => {
  it('fingers moving left go to the next card, moving right to the previous one', () => {
    expect(release({ dx: -COMMIT_DISTANCE })).toBe('next')
    expect(release({ dx: -200 })).toBe('next')
    expect(release({ dx: COMMIT_DISTANCE })).toBe('previous')
    expect(release({ dx: 200 })).toBe('previous')
  })

  it('below the distance threshold and not a flick, it cancels (the card springs back)', () => {
    expect(release({ dx: -(COMMIT_DISTANCE - 1) })).toBe('cancel')
    expect(release({ dx: COMMIT_DISTANCE - 1 })).toBe('cancel')
    expect(release({ dx: -40, velocity: -0.1 })).toBe('cancel') // slow and short
    expect(release({ dx: 0 })).toBe('cancel')
  })

  it('a quick flick commits from a shorter distance, in the direction it moves', () => {
    expect(release({ dx: -FLICK_MIN_DISTANCE, velocity: -FLICK_VELOCITY })).toBe('next')
    expect(release({ dx: FLICK_MIN_DISTANCE, velocity: FLICK_VELOCITY })).toBe('previous')
    expect(release({ dx: -(FLICK_MIN_DISTANCE - 1), velocity: -2 })).toBe('cancel') // too short even for a flick
    expect(release({ dx: -30, velocity: -(FLICK_VELOCITY - 0.01) })).toBe('cancel') // not fast enough
  })

  it('a flick the other way (the finger came back) does not commit', () => {
    expect(release({ dx: -30, velocity: 1.5 })).toBe('cancel')
    expect(release({ dx: 30, velocity: -1.5 })).toBe('cancel')
  })

  it('a mostly vertical gesture never swipes, however far or fast', () => {
    expect(release({ dx: -80, dy: 120 })).toBe('cancel')
    expect(release({ dx: 90, dy: -200, velocity: 3 })).toBe('cancel')
  })

  it('there is nothing to go to at the ends: it cancels', () => {
    expect(release({ dx: -100, canNext: false })).toBe('cancel')
    expect(release({ dx: 100, canPrevious: false })).toBe('cancel')
    expect(release({ dx: -100, canPrevious: false })).toBe('next') // the other direction is unaffected
    expect(release({ dx: 100, canNext: false })).toBe('previous')
    expect(release({ dx: -30, velocity: -2, canNext: false })).toBe('cancel')
  })
})

describe('velocity', () => {
  it('is px per ms over the last 100 ms, positive rightwards', () => {
    expect(velocityOf([{ t: 0, x: 0 }, { t: 50, x: -25 }, { t: 100, x: -50 }])).toBeCloseTo(-0.5)
    expect(velocityOf([{ t: 0, x: 0 }, { t: 100, x: 80 }])).toBeCloseTo(0.8)
  })

  it('only counts the recent movement: a long hold before a flick does not slow it down', () => {
    expect(velocityOf([{ t: 0, x: 0 }, { t: 880, x: 5 }, { t: 950, x: -20 }, { t: 1000, x: -45 }])).toBeCloseTo(-0.5, 5) // the 120-ms-old sample is outside the window
  })

  it('is 0 without two samples, or without elapsed time', () => {
    expect(velocityOf([])).toBe(0)
    expect(velocityOf([{ t: 0, x: 10 }])).toBe(0)
    expect(velocityOf([{ t: 5, x: 10 }, { t: 5, x: 90 }])).toBe(0)
  })
})

describe('the released card keeps going', () => {
  const plan = (over: Partial<Parameters<typeof planExit>[0]> = {}) => planExit({ dx: -80, velocity: -1, width: 360, reducedMotion: false, ...over })

  it('it continues off-screen in the direction it was dragged, starting where the finger let go', () => {
    const left = plan({ dx: -80 })
    expect(left.mode).toBe('translate')
    expect(left.from).toBe(-80)
    expect(left.to).toBeLessThan(-360) // past the left edge
    const right = plan({ dx: 80, velocity: 1 })
    expect(right.from).toBe(80)
    expect(right.to).toBeGreaterThan(360) // past the right edge
  })

  it('it carries the release speed: a faster release leaves sooner, a gentler one later', () => {
    const fast = plan({ velocity: -3 })
    const slow = plan({ velocity: -0.9 })
    expect(fast.duration).toBeLessThan(slow.duration)
    expect(fast.duration).toBeGreaterThanOrEqual(MIN_EXIT_MS)
    expect(slow.duration).toBeLessThanOrEqual(MAX_EXIT_MS)
  })

  it('the speed is the distance left over the release velocity (so the card does not slow down on release)', () => {
    const p = plan({ dx: -100, velocity: -1.2, width: 360 })
    const remaining = Math.abs(p.to - p.from)
    expect(p.duration).toBe(Math.round(Math.min(MAX_EXIT_MS, Math.max(MIN_EXIT_MS, remaining / 1.2))))
  })

  it('a gentle release still leaves at a minimum speed, and the duration stays within bounds', () => {
    const gentle = plan({ velocity: 0 })
    expect(gentle.duration).toBe(Math.round(Math.min(MAX_EXIT_MS, Math.max(MIN_EXIT_MS, Math.abs(gentle.to - gentle.from) / MIN_EXIT_SPEED))))
    for (const velocity of [0, -0.1, -1, -5, -50]) {
      const d = plan({ velocity }).duration
      expect(d).toBeGreaterThanOrEqual(MIN_EXIT_MS)
      expect(d).toBeLessThanOrEqual(MAX_EXIT_MS)
    }
  })

  it('a wider screen means more distance to travel', () => {
    expect(Math.abs(plan({ width: 700 }).to)).toBeGreaterThan(Math.abs(plan({ width: 360 }).to))
  })

  it('with reduced motion it does not travel: a short cross-fade in place', () => {
    const p = plan({ reducedMotion: true })
    expect(p).toEqual({ mode: 'fade', from: 0, to: 0, duration: REDUCED_FADE_MS })
  })
})

describe('the drag follows the finger, with resistance where there is no card', () => {
  it('free where there is a card, a quarter as far where there is not', () => {
    expect(dragOffset(-100, true, false)).toBe(-100)
    expect(dragOffset(100, false, true)).toBe(100)
    expect(dragOffset(-100, false, true)).toBe(-100 * RESISTANCE)
    expect(dragOffset(100, true, false)).toBe(100 * RESISTANCE)
  })
})

describe('the arriving card shares a strip with the leaving one', () => {
  const exit = (dx: number, over: Partial<Parameters<typeof planExit>[0]> = {}) => planExit({ dx, velocity: dx < 0 ? -1 : 1, width: 360, reducedMotion: false, ...over })

  it('swipe left: the old card leaves to the left, so the new one starts to the right of it, one screen plus gutter away', () => {
    const plan = exit(-80)
    const arrival = arrivalOf(plan)!
    expect(plan.to).toBeLessThan(0)
    expect(arrival.from).toBe(-80 + 408)
    expect(arrival.from).toBeGreaterThan(0)
  })

  it('swipe right: the mirror — the new card starts to the left', () => {
    const plan = exit(90)
    const arrival = arrivalOf(plan)!
    expect(plan.to).toBeGreaterThan(0)
    expect(arrival.from).toBe(90 - 408)
    expect(arrival.from).toBeLessThan(0)
  })

  it('the gap to the leaving card is the same at every moment: they only differ by the strip length', () => {
    for (const dx of [-200, -61, 75, 240]) {
      const plan = exit(dx)
      const arrival = arrivalOf(plan)!
      for (const progress of [0, 0.25, 0.5, 1]) {
        const leaving = plan.from + (plan.to - plan.from) * progress
        const arriving = arrival.from * (1 - progress)
        expect(Math.abs(arriving - leaving)).toBeCloseTo(360 + 48, 6)
        expect(Math.sign(arriving - leaving)).toBe(-Math.sign(plan.to))
      }
      expect(arrival.duration).toBe(plan.duration)
    }
  })

  it('reduced motion: no travel at all, just the fade', () => {
    expect(arrivalOf(exit(-80, { reducedMotion: true }))).toBeNull()
  })
})
