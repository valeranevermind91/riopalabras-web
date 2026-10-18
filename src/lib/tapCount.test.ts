import { describe, expect, it } from 'vitest'
import { DEBUG_UNLOCK_GAP_MS, DEBUG_UNLOCK_TAPS, createTapCounter } from './tapCount'

/** A counter on a clock the test moves by hand. */
function counter(taps = DEBUG_UNLOCK_TAPS, gapMs = DEBUG_UNLOCK_GAP_MS) {
  let t = 1_000_000
  const c = createTapCounter({ taps, gapMs, now: () => t })
  return { ...c, advance: (ms: number) => void (t += ms), tapAfter: (ms: number) => ((t += ms), c.tap()) }
}

describe('the tap counter behind the version row', () => {
  it('is seven taps, each within a second and a half of the one before', () => {
    expect(DEBUG_UNLOCK_TAPS).toBe(7)
    expect(DEBUG_UNLOCK_GAP_MS).toBe(1500)
  })

  it('answers true on the seventh tap and on no tap before it', () => {
    const c = counter()
    const answers = Array.from({ length: 7 }, () => c.tapAfter(300))
    expect(answers).toEqual([false, false, false, false, false, false, true])
  })

  it('starts again after it answers: the eighth tap is the first of the next seven', () => {
    const c = counter()
    for (let i = 0; i < 7; i++) c.tapAfter(100)
    expect(Array.from({ length: 6 }, () => c.tapAfter(100))).toEqual([false, false, false, false, false, false])
    expect(c.tapAfter(100)).toBe(true) // the seventh since
  })

  it('a pause longer than the gap starts the count over', () => {
    const c = counter()
    for (let i = 0; i < 6; i++) c.tapAfter(200)
    expect(c.tapAfter(DEBUG_UNLOCK_GAP_MS + 1)).toBe(false) // the sixth tap was not followed in time: this is the first of a new count
    for (let i = 0; i < 5; i++) expect(c.tapAfter(200)).toBe(false)
    expect(c.tapAfter(200)).toBe(true) // seven since the pause
  })

  it('a gap of exactly the limit still counts', () => {
    const c = counter(3, 1000)
    c.tapAfter(0)
    c.tapAfter(1000)
    expect(c.tapAfter(1000)).toBe(true)
  })

  it('slow taps never get there, however many', () => {
    const c = counter()
    for (let i = 0; i < 40; i++) expect(c.tapAfter(DEBUG_UNLOCK_GAP_MS + 500)).toBe(false)
  })

  it('reset forgets the taps so far', () => {
    const c = counter(3, 1000)
    c.tapAfter(0)
    c.tapAfter(100)
    c.reset()
    expect(c.tapAfter(100)).toBe(false)
    expect(c.tapAfter(100)).toBe(false)
    expect(c.tapAfter(100)).toBe(true)
  })
})
