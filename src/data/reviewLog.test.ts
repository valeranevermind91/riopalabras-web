import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { applyReview, learnedState } from '../sm2/sm2'
import { makeWord } from '../testing/makeWord'
import { createRater, rateWord } from './review'
import { buildLogEntry, createLearnedAtStore, createReviewLog, elapsedDays, newId, previousReviewAt, stateBefore, type LearnedAtStore, type ReviewLogEntry } from './reviewLog'
import type { ProgressUpdate, Word } from './types'

const DAY = 86_400_000
const MIN = 60_000
// Montevideo, UTC-3 (the tests run in that zone): noon on 5 October 2026 there.
const T0 = new Date('2026-10-05T15:00:00.000Z')

/** The word as the progress row holds it after a rating at `at`. */
const after = (card: Parameters<typeof applyReview>[0], quality: number, at: Date): Word => {
  const s = applyReview(card, quality, at)
  return makeWord('casa', { interval: s.interval, easeFactor: s.easeFactor, repetitions: s.repetitions, nextReview: s.nextReview })
}
const reviewing = (interval = 6, reps = 3) => makeWord('casa', { interval, repetitions: reps, easeFactor: 2.5, nextReview: new Date(T0.getTime() + interval * DAY) })

function memoryStorage() {
  const items = new Map<string, string>()
  return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) }
}

function collecting(overrides: { learnedAt?: LearnedAtStore; newId?: () => string } = {}) {
  const rows: ReviewLogEntry[] = []
  let n = 0
  const log = createReviewLog({ enqueue: (e) => void rows.push(e), learnedAt: overrides.learnedAt ?? createLearnedAtStore('u', memoryStorage()), newId: overrides.newId ?? (() => `id-${++n}`) })
  return { log, rows }
}

describe('the state of a word before an answer, from its progress row', () => {
  it.each([
    ['never learned', { repetitions: 0, interval: 0, easeFactor: 2.5 }, 'new'],
    ['introduced by Learn, not rated since', { repetitions: 1, interval: 0, easeFactor: 2.5 }, 'learning'],
    ['after an Again: one repetition, no interval, a lowered ease', { repetitions: 1, interval: 0, easeFactor: 2.18 }, 'relearning'],
    ['an interval of a day or more', { repetitions: 2, interval: 3, easeFactor: 2.5 }, 'review'],
    ['a long interval', { repetitions: 9, interval: 120, easeFactor: 1.3 }, 'review'],
  ] as const)('%s is "%s"', (_, card, expected) => {
    expect(stateBefore(card)).toBe(expected)
  })

  it('what the app really writes is classified as it should be: Learn, then Again, then Good', () => {
    const learned = learnedState(T0)
    expect(stateBefore(learned)).toBe('learning')
    const lapsed = after(learned, 1, T0)
    expect(stateBefore(lapsed)).toBe('relearning')
    const back = after(lapsed, 3, T0)
    expect(stateBefore(back)).toBe('review')
    expect(stateBefore(after(reviewing(), 1, T0))).toBe('relearning') // a lapse from review is relearning too
  })
})

describe('elapsed_days: days since the word\'s previous review', () => {
  it('a rated word: EXACT to the millisecond, from its own row (next_review minus the interval it was given)', () => {
    const word = after({ easeFactor: 2.5, interval: 3, repetitions: 2 }, 3, T0) // rated Good at T0: interval 8, due T0 + 8 days
    expect(word.interval).toBe(8)
    expect(previousReviewAt(word)).toBe(T0.getTime())
    expect(elapsedDays(word, new Date(T0.getTime() + 8 * DAY + 3 * 3_600_000))).toBe(8.125)
    expect(elapsedDays(word, new Date(T0.getTime() + 5 * DAY))).toBe(5) // reviewed early: the real gap, not the scheduled one
    expect(elapsedDays(word, new Date(T0.getTime() + 20 * DAY + 1))).toBeCloseTo(20 + 1 / DAY, 6)
  })

  it('a word after an Again: exact too (next_review is ten minutes after the rating)', () => {
    const lapsed = after({ easeFactor: 2.5, interval: 8, repetitions: 3 }, 1, T0)
    expect(previousReviewAt(lapsed)).toBe(T0.getTime())
    expect(elapsedDays(lapsed, new Date(T0.getTime() + 4 * MIN))).toBeCloseTo(4 / 1440, 6)
    expect(elapsedDays(lapsed, new Date(T0.getTime() + 10 * MIN))).toBeCloseTo(10 / 1440, 6)
  })

  it('a word Learn introduced, no exact time known: an APPROXIMATION, the start of that local day, so it can only overstate (by up to a day)', () => {
    const learnedAt = new Date('2026-10-05T23:00:00.000Z') // 20:00 in Montevideo
    const word = makeWord('casa', { ...learnedState(learnedAt) })
    expect(stateBefore(word)).toBe('learning')
    const midnight = new Date(2026, 9, 5).getTime() // the start of the day it was learned, local
    expect(previousReviewAt(word)).toBe(midnight)
    const reviewedAt = new Date('2026-10-06T12:00:00.000Z') // 09:00 next day
    const truth = (reviewedAt.getTime() - learnedAt.getTime()) / DAY
    const approx = elapsedDays(word, reviewedAt)!
    expect(approx).toBeGreaterThanOrEqual(truth) // never understates
    expect(approx - truth).toBeLessThan(1) // and is off by less than a day
  })

  it('the same word with the exact introduction time (the Learn row this device logged): exact', () => {
    const learnedAt = new Date('2026-10-05T23:00:00.000Z')
    const word = makeWord('casa', { ...learnedState(learnedAt) })
    const reviewedAt = new Date('2026-10-06T12:00:00.000Z')
    expect(elapsedDays(word, reviewedAt, learnedAt.getTime())).toBe(Math.round(((reviewedAt.getTime() - learnedAt.getTime()) / DAY) * 1e6) / 1e6) // 13 hours, to the microday
    // an exact time older than the start of that day cannot make it worse than the lower bound: the later of the two is used
    expect(previousReviewAt(word, new Date(2026, 9, 4).getTime())).toBe(new Date(2026, 9, 5).getTime())
  })

  it('a new word has had no review: 0, not unknown', () => {
    expect(elapsedDays(makeWord('casa'), T0)).toBe(0)
  })

  it('a learned word with no stored next_review cannot be told (null, never a guess), unless the introduction time is known', () => {
    const word = makeWord('casa', { repetitions: 2, interval: 3, nextReview: null })
    expect(elapsedDays(word, T0)).toBeNull()
    expect(elapsedDays(word, new Date(T0.getTime() + DAY), T0.getTime())).toBe(1)
  })

  it('a clock set back reads 0, never a negative number of days', () => {
    expect(elapsedDays(reviewing(), new Date(T0.getTime() - 3 * DAY))).toBe(0)
  })
})

describe('a log row', () => {
  const word = makeWord('Casa', { repetitions: 2, interval: 3, easeFactor: 2.5, nextReview: new Date(T0.getTime() + 3 * DAY) })

  it('has every field, from what was true before and what the answer made true', () => {
    const update = rateWord(word, 3, new Date(T0.getTime() + 3 * DAY + 2 * MIN))
    const entry = buildLogEntry({ id: 'abc', word, mode: 'review', rating: 3, after: update, scheduledDays: update.interval, sessionId: 's-1', durationMs: 4321.6, now: new Date(T0.getTime() + 3 * DAY + 2 * MIN) })
    expect(entry).toEqual({
      id: 'abc',
      esWord: 'Casa', // the stored casing
      reviewedAt: new Date(T0.getTime() + 3 * DAY + 2 * MIN).toISOString(),
      rating: 3,
      mode: 'review',
      stateBefore: 'review',
      elapsedDays: Math.round(((3 * DAY + 2 * MIN) / DAY) * 1e6) / 1e6,
      scheduledDays: 8,
      intervalAfter: 8,
      easeAfter: 2.5,
      repetitionsAfter: 3,
      sessionId: 's-1',
      durationMs: 4322,
    })
  })

  it('a rating outside 1 to 4 is held to it, and a duration that is not a number is null, not a guess', () => {
    const base = { id: 'a', word, mode: 'review' as const, after: { interval: 1, easeFactor: 2.5, repetitions: 3 }, scheduledDays: 1, sessionId: null, now: T0 }
    expect(buildLogEntry({ ...base, rating: 9, durationMs: null }).rating).toBe(4)
    expect(buildLogEntry({ ...base, rating: -2, durationMs: null }).rating).toBe(1)
    expect(buildLogEntry({ ...base, rating: 2.6, durationMs: null }).rating).toBe(3)
    expect(buildLogEntry({ ...base, rating: 3, durationMs: null }).durationMs).toBeNull()
    expect(buildLogEntry({ ...base, rating: 3, durationMs: Number.NaN }).durationMs).toBeNull()
    expect(buildLogEntry({ ...base, rating: 3, durationMs: -5 }).durationMs).toBe(0)
  })
})

describe('a Review rating writes exactly one row, with the right fields', () => {
  it('through the rater: one row per rating, after the rating was applied and queued', () => {
    const { log, rows } = collecting()
    const order: string[] = []
    const rate = createRater({
      applyProgress: () => void order.push('applied'),
      applySettings: () => {},
      getSettings: () => ({ cardsDoneTodayCount: 0, cardsDoneTodayDate: null, streakLastActivityDate: null, newWordsLearnedTodayDate: null, newWordsLearnedTodayCount: 0, dailyNewWordLimit: 10, streakCount: 0, raw: {} }) as never,
      queue: { enqueueProgress: () => void order.push('queued'), enqueueSettings: () => {} },
      log: { ...log, review: (input) => (order.push('logged'), log.review(input)) },
    })
    const word = makeWord('casa', { repetitions: 2, interval: 3, easeFactor: 2.5, nextReview: new Date(T0.getTime() + 3 * DAY) })
    const at = new Date(T0.getTime() + 3 * DAY + 90_000)
    const update = rate(word, 3, at, true, { sessionId: 'sess', durationMs: 2500 })
    expect(order.slice(0, 3)).toEqual(['applied', 'queued', 'logged'])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'id-1',
      esWord: 'casa',
      reviewedAt: at.toISOString(),
      rating: 3,
      mode: 'review',
      stateBefore: 'review',
      scheduledDays: update.interval,
      intervalAfter: update.interval,
      easeAfter: update.easeFactor,
      repetitionsAfter: 3,
      sessionId: 'sess',
      durationMs: 2500,
    })
    expect(rows[0].elapsedDays).toBeCloseTo(3 + 90 / 86400, 5)
  })

  it('an Again is a row of its own, with its ten-minute step (scheduled 0 days, one repetition, a lowered ease)', () => {
    const { log, rows } = collecting()
    const word = makeWord('casa', { repetitions: 4, interval: 12, easeFactor: 2.5, nextReview: new Date(T0.getTime() + 12 * DAY) })
    log.review({ word, rating: 1, update: rateWord(word, 1, T0), sessionId: 's', durationMs: 900, now: T0 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rating: 1, stateBefore: 'review', scheduledDays: 0, intervalAfter: 0, repetitionsAfter: 1 })
    expect(rows[0].easeAfter).toBeCloseTo(2.18, 10)
  })

  it('the rater logs nothing without a log, and a row with no context carries no session and no duration', () => {
    const word = makeWord('casa', { repetitions: 2, interval: 3, nextReview: new Date(T0.getTime() + 3 * DAY) })
    const deps = { applyProgress: () => {}, applySettings: () => {}, getSettings: () => ({ raw: {} }) as never, queue: { enqueueProgress: () => {}, enqueueSettings: () => {} } }
    expect(() => createRater(deps)(word, 3, T0)).not.toThrow()
    const { log, rows } = collecting()
    createRater({ ...deps, log })(word, 3, T0)
    expect(rows[0]).toMatchObject({ sessionId: null, durationMs: null })
  })
})

describe('the other modes', () => {
  const learnedWord = makeWord('casa', { repetitions: 2, interval: 3, easeFactor: 2.3, nextReview: new Date(T0.getTime() + 3 * DAY) })

  it('Learn: a row per word introduced, "new" before, the stand-in rating 3, due tomorrow (1 day) with the state Learn writes', () => {
    const { log, rows } = collecting()
    log.learned([makeWord('a'), makeWord('b')], learnedState(T0), 'batch-1', T0)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).toMatchObject({ mode: 'learn', rating: 3, stateBefore: 'new', elapsedDays: 0, scheduledDays: 1, intervalAfter: 0, easeAfter: 2.5, repetitionsAfter: 1, sessionId: 'batch-1', durationMs: null })
    }
    expect(rows.map((r) => r.esWord)).toEqual(['a', 'b'])
  })

  it('Matching and Cloze: nothing is scheduled and the word is unchanged, so the "after" columns repeat what it is; right is 3, wrong or retried is 1', () => {
    const { log, rows } = collecting()
    log.practice({ word: learnedWord, mode: 'matching', correct: true, sessionId: 'g', durationMs: null, now: T0 })
    log.practice({ word: learnedWord, mode: 'cloze', correct: false, sessionId: 'c', durationMs: 7000, now: T0 })
    expect(rows.map((r) => [r.mode, r.rating, r.durationMs])).toEqual([['matching', 3, null], ['cloze', 1, 7000]])
    for (const row of rows) expect(row).toMatchObject({ stateBefore: 'review', scheduledDays: 0, intervalAfter: 3, easeAfter: 2.3, repetitionsAfter: 2 })
  })

  it('only Review rows are scheduling events: the others are marked, and say they changed nothing', () => {
    const { log, rows } = collecting()
    log.review({ word: learnedWord, rating: 3, update: rateWord(learnedWord, 3, T0), sessionId: 's', durationMs: 1, now: T0 })
    log.practice({ word: learnedWord, mode: 'cloze', correct: true, sessionId: 's', durationMs: 1, now: T0 })
    const [review, practice] = rows
    expect(review.mode).toBe('review')
    expect(review.intervalAfter).not.toBe(learnedWord.interval) // the rating changed the schedule
    expect(practice.mode).toBe('cloze')
    expect(practice.intervalAfter).toBe(learnedWord.interval) // the answer did not
  })
})

describe('the exact introduction time, kept only until the word\'s first review', () => {
  it('a Learn row makes the first review after it exact, and that review clears it', () => {
    const storage = memoryStorage()
    const { log, rows } = collecting({ learnedAt: createLearnedAtStore('u', storage) })
    const learnedAt = new Date('2026-10-05T23:00:00.000Z') // 20:00 local
    log.learned([makeWord('casa')], learnedState(learnedAt), 's', learnedAt)
    expect(storage.items.size).toBe(1)

    const word = makeWord('casa', { ...learnedState(learnedAt) })
    const reviewedAt = new Date('2026-10-06T12:00:00.000Z')
    log.review({ word, rating: 3, update: rateWord(word, 3, reviewedAt), sessionId: 's2', durationMs: null, now: reviewedAt })
    expect(rows[1].elapsedDays).toBe(Math.round(((reviewedAt.getTime() - learnedAt.getTime()) / DAY) * 1e6) / 1e6) // exact
    expect(storage.items.size).toBe(0) // nothing kept for it any more: its own row says when it was last reviewed
  })

  it('survives a restart of the app (it is on the device), and an old entry is forgotten', () => {
    const storage = memoryStorage()
    const first = createLearnedAtStore('u', storage, () => T0.getTime())
    first.set('casa', T0.getTime())
    expect(createLearnedAtStore('u', storage, () => T0.getTime() + DAY).get('casa')).toBe(T0.getTime())
    expect(createLearnedAtStore('u', storage, () => T0.getTime() + 61 * DAY).get('casa')).toBeUndefined()
    expect(createLearnedAtStore('another-user', storage).get('casa')).toBeUndefined()
  })

  it('without storage, or with unreadable storage, the log still works (the first review after Learn is then approximate)', () => {
    const broken = { getItem: () => 'not json', setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('blocked') } }
    const store = createLearnedAtStore('u', broken)
    expect(() => store.set('a', 1)).not.toThrow()
    expect(store.get('a')).toBe(1)
    expect(() => store.forget('a')).not.toThrow()
    expect(createLearnedAtStore('u', null).get('a')).toBeUndefined()
  })
})

describe('sessions and ids', () => {
  it('startSession gives a new id each time, and the rows of one session share theirs', () => {
    const rows: ReviewLogEntry[] = []
    const real = createReviewLog({ enqueue: (e) => void rows.push(e), learnedAt: createLearnedAtStore('u', memoryStorage()) })
    const a = real.startSession()
    const b = real.startSession()
    expect(a).not.toBe(b)
    for (const id of [a, b]) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const word = makeWord('casa', { repetitions: 2, interval: 3, nextReview: new Date(T0.getTime() + 3 * DAY) })
    for (let i = 0; i < 4; i++) real.review({ word, rating: 3, update: rateWord(word, 3, T0), sessionId: a, durationMs: null, now: T0 })
    real.review({ word, rating: 3, update: rateWord(word, 3, T0), sessionId: b, durationMs: null, now: T0 })
    expect(new Set(rows.map((r) => r.sessionId))).toEqual(new Set([a, b]))
    expect(rows.filter((r) => r.sessionId === a)).toHaveLength(4)
    expect(new Set(rows.map((r) => r.id)).size).toBe(5) // every row has an id of its own
  })

  it('newId is a v4 UUID with crypto.randomUUID, and still one without it', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    vi.stubGlobal('crypto', undefined)
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    vi.unstubAllGlobals()
    expect(new Set(Array.from({ length: 500 }, () => newId())).size).toBe(500)
  })
})

describe('logging can never get in the way of an answer', () => {
  it('a queue that throws, or a store that throws, does not reach the rating', () => {
    const throwing = createReviewLog({
      enqueue: () => {
        throw new Error('queue exploded')
      },
      learnedAt: { get: () => undefined, set: () => { throw new Error('storage') }, forget: () => { throw new Error('storage') } },
    })
    const word = makeWord('casa', { repetitions: 2, interval: 3, nextReview: new Date(T0.getTime() + 3 * DAY) })
    expect(() => throwing.review({ word, rating: 3, update: rateWord(word, 3, T0), sessionId: 's', durationMs: 1, now: T0 })).not.toThrow()
    expect(() => throwing.learned([word], learnedState(T0), 's', T0)).not.toThrow()
    expect(() => throwing.practice({ word, mode: 'cloze', correct: true, sessionId: 's', durationMs: 1, now: T0 })).not.toThrow()
    // and through the rater: the rating is applied and queued whatever the log does
    const applied: ProgressUpdate[] = []
    const rate = createRater({ applyProgress: (u) => void applied.push(...u), applySettings: () => {}, getSettings: () => ({ raw: {} }) as never, queue: { enqueueProgress: () => {}, enqueueSettings: () => {} }, log: throwing })
    expect(() => rate(word, 3, T0, true, { sessionId: 's', durationMs: 1 })).not.toThrow()
    expect(applied).toHaveLength(1)
  })
})

describe('the wiring: App makes the log once, for a signed-in user, and hands it to the four screens', () => {
  // App is not rendered by any test, and a screen that is not handed the log silently logs nothing, so the wiring is pinned.
  const app = readFileSync('src/App.tsx', 'utf8')

  it('exists only where the queue does (a signed-in user), and goes through the queue', () => {
    expect(app).toMatch(/const reviewLog = useMemo\(\(\) => \(queue && userId \? createReviewLog\(\{ enqueue: queue\.enqueueLog, learnedAt: createLearnedAtStore\(userId\) \}\) : null\)/)
  })

  it('is handed to Learn, Review, Matching and Cloze', () => {
    for (const screen of ['LearnScreen', 'ReviewScreen', 'MatchingScreen', 'ClozeScreen']) expect(app, screen).toMatch(new RegExp(`<${screen}[\\s\\S]*?reviewLog=\\{reviewLog\\}`))
  })

  it('nothing else writes a row: only the log module builds one, and only the queue sends them', () => {
    const files = ['src/screens/Review.tsx', 'src/screens/Learn.tsx', 'src/screens/Matching.tsx', 'src/screens/Cloze.tsx', 'src/data/review.ts', 'src/data/learn.ts', 'src/App.tsx']
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toContain('review_log')
      expect(source, file).not.toContain('insertReviewLog')
      expect(source, file).not.toContain('buildLogEntry')
    }
  })
})
