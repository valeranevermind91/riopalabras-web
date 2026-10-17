import { describe, expect, it } from 'vitest'
import { MAX_CARD_MS, createCardTimer } from './cardTimer'

function timer(initiallyHidden = false) {
  const env = { t: 1000, hidden: initiallyHidden }
  return { env, timer: createCardTimer({ now: () => env.t, hidden: () => env.hidden }) }
}

describe('the time on a card', () => {
  it('is the milliseconds from the card appearing to the answer', () => {
    const { env, timer: card } = timer()
    card.start()
    env.t += 4321
    expect(card.stop()).toBe(4321)
  })

  it('is rounded to whole milliseconds', () => {
    const { env, timer: card } = timer()
    card.start()
    env.t += 1500.6
    expect(card.stop()).toBe(1501)
  })

  it('is null, never a number, if the app was away at any point in between (hidden, or Telegram deactivated it)', () => {
    const { env, timer: card } = timer()
    card.start()
    env.t += 5000
    card.interrupt() // the page went hidden, or the Mini App was deactivated
    env.t += 2000 // and came back
    expect(card.stop()).toBeNull()
  })

  it('is null for a card that appeared while the page was already hidden', () => {
    const { env, timer: card } = timer(true)
    card.start()
    env.t += 3000
    expect(card.stop()).toBeNull()
  })

  it('an interruption belongs to the card it happened on: the next card is timed afresh and is fine', () => {
    const { env, timer: card } = timer()
    card.start()
    card.interrupt()
    env.t += 1000
    expect(card.stop()).toBeNull()
    card.start()
    env.t += 2500
    expect(card.stop()).toBe(2500)
    card.interrupt() // between cards (nothing is being timed): changes nothing for the next one
    card.start()
    env.t += 700
    expect(card.stop()).toBe(700)
  })

  it('is null, NOT clamped to the limit, when it comes to more than a minute: a clamped value would look real', () => {
    expect(MAX_CARD_MS).toBe(60_000)
    for (const over of [60_001, 61_000, 130_814, 3_600_000]) {
      const { env, timer: card } = timer()
      card.start()
      env.t += over
      expect(card.stop(), String(over)).toBeNull()
    }
  })

  it('a minute exactly, and anything under it, is kept as it is', () => {
    for (const ms of [0, 1, 59_999, 60_000]) {
      const { env, timer: card } = timer()
      card.start()
      env.t += ms
      expect(card.stop(), String(ms)).toBe(ms)
    }
  })

  it('is null when no card was being timed (stop twice, or without a start), and a clock that went backwards is null, not negative', () => {
    const { env, timer: card } = timer()
    expect(card.stop()).toBeNull()
    card.start()
    env.t += 100
    expect(card.stop()).toBe(100)
    expect(card.stop()).toBeNull() // already read
    card.start()
    env.t -= 50
    expect(card.stop()).toBeNull()
  })
})
