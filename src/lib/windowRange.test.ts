import { describe, expect, it } from 'vitest'
import { windowRange } from './windowRange'

describe('windowRange', () => {
  it('at the top: the rows in view plus the overscan below', () => {
    expect(windowRange(0, 640, 72, 4753, 6)).toEqual({ start: 0, end: 9 + 6 })
  })
  it('scrolled: from the first visible row less the overscan, to the last visible row plus it', () => {
    // top edge in row 100, bottom edge at 7200+640 = row 108.9 → 109
    expect(windowRange(7200, 640, 72, 4753, 6)).toEqual({ start: 94, end: 115 })
  })
  it('never leaves the list', () => {
    expect(windowRange(0, 640, 72, 5, 6)).toEqual({ start: 0, end: 5 })
    expect(windowRange(4753 * 72, 640, 72, 4753, 6)).toEqual({ start: 4753 - 6, end: 4753 })
    expect(windowRange(-50, 640, 72, 100, 6).start).toBe(0)
  })
  it('an empty list has no window', () => {
    expect(windowRange(0, 640, 72, 0)).toEqual({ start: 0, end: 0 })
  })
  it('the number of rows rendered does not depend on the size of the list', () => {
    const rendered = (count: number) => { const { start, end } = windowRange(100_000, 640, 72, count); return end - start }
    expect(rendered(4753)).toBe(rendered(100_000))
    expect(rendered(4753)).toBeLessThan(30)
  })
})
