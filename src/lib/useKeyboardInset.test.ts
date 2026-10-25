import { describe, expect, it } from 'vitest'
import { KEYBOARD_MIN_PX, keyboardInset, scrollDeltaToClear } from './useKeyboardInset'

describe('keyboardInset: what the on-screen keyboard covers', () => {
  it('is 0 without a visual viewport, and when the page is as tall as what can be seen', () => {
    expect(keyboardInset(800, null)).toBe(0)
    expect(keyboardInset(800, undefined)).toBe(0)
    expect(keyboardInset(800, { height: 800, offsetTop: 0, scale: 1 })).toBe(0)
  })

  it('is the difference between the page and what can be seen, when the keyboard is drawn over the page', () => {
    expect(keyboardInset(800, { height: 500, offsetTop: 0, scale: 1 })).toBe(300)
    // the visible part can also have slid down the page: what is covered is what is below it
    expect(keyboardInset(800, { height: 480, offsetTop: 40, scale: 1 })).toBe(280)
    expect(keyboardInset(667, { height: 347, offsetTop: 0 })).toBe(320) // a scale left out is 1
  })

  it('is 0 for a difference too small to be a keyboard (browser chrome), and for a zoomed page', () => {
    expect(KEYBOARD_MIN_PX).toBe(100)
    expect(keyboardInset(800, { height: 740, offsetTop: 0, scale: 1 })).toBe(0)
    expect(keyboardInset(800, { height: 701, offsetTop: 0, scale: 1 })).toBe(0)
    expect(keyboardInset(800, { height: 700, offsetTop: 0, scale: 1 })).toBe(100)
    expect(keyboardInset(800, { height: 400, offsetTop: 0, scale: 2 })).toBe(0) // pinch-zoomed in: a shorter visual viewport that is no keyboard
  })

  it('is never negative', () => {
    expect(keyboardInset(500, { height: 800, offsetTop: 0, scale: 1 })).toBe(0)
  })
})

describe('scrollDeltaToClear: how far to scroll for something to end above the keyboard', () => {
  it('is how far its bottom, with a margin, is below the last visible line', () => {
    expect(scrollDeltaToClear(700, 500)).toBe(212) // 700 + 12 - 500
    expect(scrollDeltaToClear(700, 500, 0)).toBe(200)
    expect(scrollDeltaToClear(500.4, 500, 0)).toBe(1) // never short by a fraction of a pixel
  })

  it('is 0 when it is already clear', () => {
    expect(scrollDeltaToClear(400, 500)).toBe(0)
    expect(scrollDeltaToClear(488, 500)).toBe(0) // exactly the margin
    expect(scrollDeltaToClear(489, 500)).toBe(1)
  })
})
