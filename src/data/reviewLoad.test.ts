import { describe, expect, it } from 'vitest'
import { seededRandom } from '../lib/random'
import { en } from '../strings'
import { ru } from '../strings.ru'
import { applyReview, learnedState, type Sm2Card } from '../sm2/sm2'

/**
 * The sentence under the daily goal says what a goal means in reviews: every word learned comes back, so ten new words a day is roughly 40 to 60 reviews
 * a day within a couple of months, and five a day is about half. This runs the real scheduler to see whether that is so, so a change to it (the
 * interval cap, FSRS) that makes the sentence untrue fails here, and the sentence gets rewritten with it.
 */
const DAY = 86_400_000

interface Mix {
  again: number
  hard: number
  easy: number
}

/** Reviews done per day, for `days` days, learning `perDay` new words a day. A word rated Again comes back ten minutes later and is rated again (two cards that day). */
function reviewsPerDay(perDay: number, mix: Mix, days: number): number[] {
  const random = seededRandom(11)
  const words: { card: Sm2Card; due: number }[] = []
  const counts: number[] = []
  const start = new Date(2026, 0, 1, 9).getTime()
  for (let day = 0; day < days; day++) {
    const now = start + day * DAY
    let reviews = 0
    for (const word of words) {
      for (let guard = 0; word.due <= now && guard < 10; guard++) {
        reviews++
        const r = random()
        const quality = r < mix.again ? 1 : r < mix.again + mix.hard ? 2 : r < mix.again + mix.hard + mix.easy ? 4 : 3
        const next = applyReview(word.card, quality, new Date(now))
        word.card = { easeFactor: next.easeFactor, interval: next.interval, repetitions: next.repetitions }
        word.due = next.nextReview.getTime()
        if (quality > 1) break
      }
    }
    counts.push(reviews)
    for (let i = 0; i < perDay; i++) {
      const s = learnedState(new Date(now))
      words.push({ card: { easeFactor: s.easeFactor, interval: s.interval, repetitions: s.repetitions }, due: s.nextReview.getTime() })
    }
  }
  return counts
}
const around = (counts: number[], day: number) => counts.slice(day - 5, day + 5).reduce((a, b) => a + b, 0) / 10

const ALL_GOOD: Mix = { again: 0, hard: 0, easy: 0 }
const SOME_LAPSES: Mix = { again: 0.05, hard: 0.1, easy: 0 }

describe('the review load a daily goal makes, by the real scheduler', () => {
  const [low, high] = (en.settings.dailyGoalWhy.match(/(\d+) to (\d+) reviews/) ?? []).slice(1).map(Number)

  it('the English sentence gives a range, and the Russian one the same range', () => {
    expect(low).toBe(40)
    expect(high).toBe(60)
    expect(ru.settings.dailyGoalWhy).toContain(`${low}–${high} повторений`)
  })

  it('at ten new words a day, two months in, the load is the sentence\'s range: about forty when every answer is Good, about sixty with some Hard and Again', () => {
    const best = around(reviewsPerDay(10, ALL_GOOD, 70), 60)
    const typical = around(reviewsPerDay(10, SOME_LAPSES, 70), 60)
    expect(best, 'every answer Good').toBeGreaterThanOrEqual(low * 0.85)
    expect(best).toBeLessThanOrEqual(high)
    expect(typical, 'some Hard and Again').toBeGreaterThanOrEqual(low)
    expect(typical).toBeLessThanOrEqual(high * 1.1)
  })

  it('the load is not flat after that: it keeps rising while the vocabulary grows (so the sentence says "within a couple of months", not "settles")', () => {
    const counts = reviewsPerDay(10, SOME_LAPSES, 130)
    expect(around(counts, 120)).toBeGreaterThan(around(counts, 60))
  })

  it('at five a day the reviews come to about half of ten a day, whatever the answers', () => {
    for (const mix of [ALL_GOOD, SOME_LAPSES]) {
      const ratio = around(reviewsPerDay(5, mix, 70), 60) / around(reviewsPerDay(10, mix, 70), 60)
      expect(ratio).toBeGreaterThan(0.45)
      expect(ratio).toBeLessThan(0.55)
    }
  })
})

describe('what the daily goal says about itself, in both languages', () => {
  it('two sentences: the arithmetic (words come back, ten a day makes this many reviews), and that a smaller goal is a real choice, not a lesser one', () => {
    for (const text of [en.settings.dailyGoalWhy, ru.settings.dailyGoalWhy]) expect(text.match(/[.!?](\s|$)/g)).toHaveLength(2)
    expect(en.settings.dailyGoalWhy).toContain('comes back for review')
    expect(en.settings.dailyGoalWhy).toContain('a real choice, not a lesser one')
    expect(en.settings.dailyGoalWhy).toContain('at five a day the reviews come to about half')
    expect(ru.settings.dailyGoalWhy).toContain('возвращается на повторение')
    expect(ru.settings.dailyGoalWhy).toContain('полноценный выбор, а не уступка')
    expect(ru.settings.dailyGoalWhy).toContain('при пяти словах в день повторений вдвое меньше')
  })

  it('it explains and does not instruct: no "you should", no "we recommend", no "try", and no praise', () => {
    expect(en.settings.dailyGoalWhy).not.toMatch(/\bshould\b|\bmust\b|recommend|\btry\b|best|ideal|great|!/i)
    expect(ru.settings.dailyGoalWhy).not.toMatch(/следует|нужно|рекоменду|попробуйте|лучше|идеальн|отлично|!/i)
  })
})
