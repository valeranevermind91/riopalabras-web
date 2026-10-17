import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { rateWord } from '../data/review'
import { mergeWords } from '../data/words'
import { setLanguage } from '../lib/language'
import { RatingButtons } from '../components/RatingButtons'
import { makeWord } from '../testing/makeWord'
import { MAX_INTERVAL_DAYS, applyReview, formatInterval, previewInterval, type Sm2Card } from './sm2'

const NOW = new Date('2026-10-02T15:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

afterEach(() => setLanguage('en'))

describe('the interval cap', () => {
  it('is nine months: 270 days', () => {
    expect(MAX_INTERVAL_DAYS).toBe(270)
  })

  it('no sequence of ratings produces an interval above it (every sequence of up to 8 Hard/Good/Easy/Again ratings, from several starting cards)', () => {
    const starts: Sm2Card[] = [
      { easeFactor: 2.5, interval: 0, repetitions: 1 },
      { easeFactor: 2.5, interval: 200, repetitions: 9 },
      { easeFactor: 3.5, interval: 269, repetitions: 12 },
      { easeFactor: 1.3, interval: 1, repetitions: 3 },
    ]
    let worst = 0
    let leaves = 0
    const walk = (card: Sm2Card, depth: number) => {
      if (depth === 0) return
      for (const q of [1, 2, 3, 4]) {
        const next = applyReview(card, q, NOW)
        worst = Math.max(worst, next.interval)
        leaves++
        walk(next, depth - 1)
      }
    }
    for (const start of starts) walk(start, 8)
    expect(leaves).toBeGreaterThan(100_000)
    expect(worst).toBeLessThanOrEqual(MAX_INTERVAL_DAYS)
    // ...and the walk does reach the cap, so the bound above is not vacuous.
    expect(worst).toBe(MAX_INTERVAL_DAYS)
  })

  it('keeps nextReview within the cap too: never further than 270 days after the rating', () => {
    const card: Sm2Card = { easeFactor: 3, interval: 260, repetitions: 15 }
    for (const q of [2, 3, 4]) expect(applyReview(card, q, NOW).nextReview.getTime() - NOW.getTime()).toBeLessThanOrEqual(MAX_INTERVAL_DAYS * DAY_MS)
  })

  it('a word at the cap rated Easy stays at the cap (and Good too; Hard too, being 1.2×)', () => {
    const atCap: Sm2Card = { easeFactor: 2.5, interval: MAX_INTERVAL_DAYS, repetitions: 10 }
    expect(applyReview(atCap, 4, NOW).interval).toBe(MAX_INTERVAL_DAYS)
    expect(applyReview(atCap, 3, NOW).interval).toBe(MAX_INTERVAL_DAYS)
    expect(applyReview(atCap, 2, NOW).interval).toBe(MAX_INTERVAL_DAYS)
    expect(applyReview(atCap, 4, NOW).nextReview.getTime() - NOW.getTime()).toBe(MAX_INTERVAL_DAYS * DAY_MS)
  })

  it('an existing longer interval is left alone until its next review, which brings it under the cap', () => {
    const base = makeWord('viejo', { interval: 0, repetitions: 0, nextReview: null })
    const row = { es_word: 'viejo', ease_factor: 2.5, interval_days: 800, repetitions: 14, next_review: '2028-12-10T03:00:00.000Z' }
    // Loading the stored row does not clamp or reschedule it: only a rating computes a new interval.
    const stored = mergeWords([base], { customWords: [], progress: [row], favorites: [], hidden: [], settings: null }).words[0]
    expect(stored.interval).toBe(800)
    expect(stored.nextReview?.toISOString()).toBe('2028-12-10T03:00:00.000Z')
    // At its next review every positive rating comes under the cap...
    for (const q of [2, 3, 4]) {
      const update = rateWord(stored, q, NOW)
      expect(update.interval).toBe(MAX_INTERVAL_DAYS)
      expect(update.nextReview.getTime()).toBe(NOW.getTime() + MAX_INTERVAL_DAYS * DAY_MS)
    }
    // ...and an Again relearns it as for any word.
    expect(rateWord(stored, 1, NOW).interval).toBe(0)
  })
})

describe('the previews show what the rating writes', () => {
  const cards: Sm2Card[] = [
    { easeFactor: 2.5, interval: 0, repetitions: 1 },
    { easeFactor: 2.5, interval: 6, repetitions: 3 },
    { easeFactor: 2.5, interval: 150, repetitions: 8 },
    { easeFactor: 2.5, interval: 225, repetitions: 9 }, // Good (×2.4) caps, Hard (×1.2) does not
    { easeFactor: 2.5, interval: MAX_INTERVAL_DAYS, repetitions: 10 },
    { easeFactor: 2.5, interval: 800, repetitions: 14 }, // stored from before the cap
    { easeFactor: 1.3, interval: MAX_INTERVAL_DAYS, repetitions: 10 },
  ]

  it('previewInterval equals the interval applyReview and rateWord write, for each of the four buttons, at and around the cap', () => {
    for (const card of cards) {
      for (const q of [1, 2, 3, 4]) {
        const written = rateWord(makeWord('x', card), q, NOW)
        expect(previewInterval(card, q)).toBe(written.interval)
        expect(previewInterval(card, q)).toBe(applyReview(card, q, NOW).interval)
        expect(previewInterval(card, q)).toBeLessThanOrEqual(MAX_INTERVAL_DAYS)
      }
    }
  })

  const labelsOnTheButtons = (card: Sm2Card) => {
    const html = renderToStaticMarkup(createElement(RatingButtons, { word: makeWord('x', card), onRate: () => {} }))
    return [...html.matchAll(/<small class="rate-interval">([^<]*)<\/small>/g)].map((m) => m[1])
  }
  const labelsOfWhatIsWritten = (card: Sm2Card) => [1, 2, 3, 4].map((q) => formatInterval(rateWord(makeWord('x', card), q, NOW).interval))

  it('the labels drawn on the four buttons equal the labels of the intervals the ratings then write, in English and in Russian', () => {
    for (const language of ['en', 'ru'] as const) {
      setLanguage(language)
      for (const card of cards) expect(labelsOnTheButtons(card)).toEqual(labelsOfWhatIsWritten(card))
    }
  })

  it('at the cap the buttons read "9mo" in English and "9 мес" in Russian, straight from the existing formatter', () => {
    const atCap = { easeFactor: 2.5, interval: MAX_INTERVAL_DAYS, repetitions: 10 }
    setLanguage('en')
    expect(labelsOnTheButtons(atCap)).toEqual(['10 min', '9mo', '9mo', '9mo'])
    setLanguage('ru')
    expect(labelsOnTheButtons(atCap)).toEqual(['10 мин', '9 мес', '9 мес', '9 мес'])
  })

  it('a longer stored interval reads as years only where it is the stored one; the buttons never promise it', () => {
    const old = { easeFactor: 2.5, interval: 800, repetitions: 14 }
    expect(formatInterval(old.interval)).toBe('2y')
    expect(labelsOnTheButtons(old).join(' ')).not.toMatch(/\dy/)
  })

  it('every whole number of days a rating can write (1 to the cap) has a label that is days or months, never years', () => {
    for (let d = 1; d <= MAX_INTERVAL_DAYS; d++) expect(formatInterval(d)).toMatch(/^\d+(d|mo)$/)
  })
})
