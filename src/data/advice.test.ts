import { afterEach, describe, expect, it } from 'vitest'
import { setLanguage } from '../lib/language'
import { strings } from '../strings'
import { makeWord } from '../testing/makeWord'
import { homeAdvice, primaryTile, type HomeAdvice } from './advice'
import { REVIEW_SESSION_SIZE, buildReviewSession } from './review'

// What Home says to do today: five states from three numbers, in the Flutter app's priority.

afterEach(() => setLanguage('en'))

/** A session size no test count reaches: the first part of the line on its own, without the "per session" part. */
const ALL = 1_000_000

const advise = (reviewDue: number, learnPool: number, remainingToday: number) => homeAdvice({ reviewDue, learnPool, remainingToday })

describe('the five states, from hand-made numbers', () => {
  it('anything due comes first, whatever else is true', () => {
    expect(advise(3, 5, 5)).toBe('reviewFirst')
    expect(advise(1, 0, 0)).toBe('reviewFirst') // even with an empty pool and a spent allowance
    expect(advise(250, 4000, 10)).toBe('reviewFirst') // and however many: more than one session's worth is still just "review first"
  })

  it('nothing due, new words waiting, room in the allowance: learn new', () => {
    expect(advise(0, 4, 10)).toBe('learnNew')
    expect(advise(0, 1, 1)).toBe('learnNew')
  })

  it('nothing due, new words waiting, the allowance exactly spent: done for today', () => {
    expect(advise(0, 4, 0)).toBe('allDoneToday')
  })

  it('nothing due, no new words, room in the allowance: the pool is empty', () => {
    expect(advise(0, 0, 10)).toBe('poolEmpty')
    expect(advise(0, 0, 1)).toBe('poolEmpty')
  })

  it('nothing due, no new words and the allowance spent: all clear (not "done for today": there is no tomorrow\'s batch to come back for)', () => {
    expect(advise(0, 0, 0)).toBe('allClear')
  })

  it('every one of the five states is reachable, and each input maps to exactly one', () => {
    const seen = new Set<HomeAdvice>()
    for (const due of [0, 1, 40]) for (const pool of [0, 1, 500]) for (const left of [0, 1, 10]) seen.add(advise(due, pool, left))
    expect([...seen].sort()).toEqual(['allClear', 'allDoneToday', 'learnNew', 'poolEmpty', 'reviewFirst'])
  })

  it('uses the raw pool and the raw allowance, never their minimum: a pool of 4 with the allowance spent is "done for today", not "pool empty"', () => {
    expect(advise(0, 4, 0)).not.toBe(advise(0, 0, 0))
    expect(advise(0, 4, 0)).toBe('allDoneToday')
  })
})

describe('the primary tile follows the state', () => {
  it('Review for review first, Learn for learn new, and neither for the other three', () => {
    expect(primaryTile('reviewFirst')).toBe('review')
    expect(primaryTile('learnNew')).toBe('learn')
    for (const quiet of ['allDoneToday', 'poolEmpty', 'allClear'] as const) expect(primaryTile(quiet)).toBeNull()
  })

  it('is never Cloze, and Matching only at the end of the day (below): practice is not advice for any other state', () => {
    for (const state of ['reviewFirst', 'learnNew', 'allDoneToday', 'poolEmpty', 'allClear'] as const) {
      expect(['review', 'learn', null]).toContain(primaryTile(state)) // the usual call: never a practice tile
      expect(['review', 'learn', 'matching', null]).toContain(primaryTile(state, true))
    }
  })

  it('at the end of the day, with practice to do on today\'s words, Matching is the one primary tile, and only then', () => {
    expect(primaryTile('allDoneToday', true)).toBe('matching')
    expect(primaryTile('allDoneToday', false)).toBeNull() // nothing to practise on: the state stays quiet
    expect(primaryTile('allDoneToday')).toBeNull()
    // practice never outranks what is due or what can still be learned, and the other quiet states stay quiet
    for (const state of ['reviewFirst', 'learnNew', 'poolEmpty', 'allClear'] as const) expect(primaryTile(state, true)).toBe(primaryTile(state))
  })
})

describe('the wording', () => {
  const a = () => strings.home.advice

  it('English', () => {
    expect(a().allDoneToday).toBe('Done for today')
    expect(a().poolEmpty).toBe('No new words left — add your own, or practise')
    expect(a().allClear).toBe('All caught up')
    expect(a().reviewFirst(40, ALL)).toBe('Review first — 40 words are waiting')
    expect(a().learnNew(10)).toBe('Nothing to review — 10 new words ready')
  })

  it('Russian', () => {
    setLanguage('ru')
    expect(a().allDoneToday).toBe('На сегодня всё')
    expect(a().poolEmpty).toBe('Новые слова закончились — добавьте свои или потренируйтесь')
    expect(a().allClear).toBe('Всё повторено')
    expect(a().reviewFirst(40, ALL)).toBe('Сначала повторение — ждут 40 слов')
    expect(a().learnNew(10)).toBe('Повторять нечего — можно изучить 10 новых слов')
  })

  it('English plurals for 1, 2, 5 and 21: the verb and the noun follow the number', () => {
    expect([1, 2, 5, 21].map((n) => a().reviewFirst(n, ALL))).toEqual([
      'Review first — 1 word is waiting',
      'Review first — 2 words are waiting',
      'Review first — 5 words are waiting',
      'Review first — 21 words are waiting',
    ])
    expect([1, 2, 5, 21].map(a().learnNew)).toEqual([
      'Nothing to review — 1 new word ready',
      'Nothing to review — 2 new words ready',
      'Nothing to review — 5 new words ready',
      'Nothing to review — 21 new words ready',
    ])
  })

  it('Russian plurals for 1, 2, 5 and 21: ждет 1 слово, ждут 2 слова, ждут 5 слов, ждет 21 слово (and the same for the new words)', () => {
    setLanguage('ru')
    expect([1, 2, 5, 21].map((n) => a().reviewFirst(n, ALL))).toEqual([
      'Сначала повторение — ждет 1 слово',
      'Сначала повторение — ждут 2 слова',
      'Сначала повторение — ждут 5 слов',
      'Сначала повторение — ждет 21 слово',
    ])
    expect([1, 2, 5, 21].map(a().learnNew)).toEqual([
      'Повторять нечего — можно изучить 1 новое слово',
      'Повторять нечего — можно изучить 2 новых слова',
      'Повторять нечего — можно изучить 5 новых слов',
      'Повторять нечего — можно изучить 21 новое слово',
    ])
  })

  it('also right at the awkward Russian counts: 11, 12, 14, 22, 25, 101, 111', () => {
    setLanguage('ru')
    const noun = (n: number) => a().reviewFirst(n, ALL).split(' ').slice(-1)[0]
    const verb = (n: number) => a().reviewFirst(n, ALL).split(' ')[3]
    expect([11, 12, 14, 22, 25, 101, 111].map(noun)).toEqual(['слов', 'слов', 'слов', 'слова', 'слов', 'слово', 'слов'])
    expect([11, 12, 14, 22, 25, 101, 111].map(verb)).toEqual(['ждут', 'ждут', 'ждут', 'ждут', 'ждут', 'ждет', 'ждут'])
  })

  it('never mentions reviews when none are due (the Flutter app\'s "or catch up on reviews" with nothing to review)', () => {
    // A line may say that nothing is left ("Nothing to review", «Повторять нечего», «Всё повторено»); it may not send anyone to a review.
    for (const language of ['en', 'ru'] as const) {
      setLanguage(language)
      for (const text of [a().allDoneToday, a().poolEmpty, a().allClear, a().learnNew(5)]) expect(text.toLowerCase().replace('nothing to review', '').replace('повторять нечего', '').replace('всё повторено', '')).not.toMatch(/review|catch up|повтор/)
    }
  })
})

describe('the end of the day: what was done and what comes next', () => {
  const a = () => strings.home.advice

  it('English: today\'s new words, then tomorrow\'s reviews and new words, each part only when there is something in it', () => {
    expect(a().doneToday(10, 10, 10)).toBe('Today: 10 new words. Tomorrow: 10 reviews and 10 new.')
    expect(a().doneToday(1, 1, 1)).toBe('Today: 1 new word. Tomorrow: 1 review and 1 new.')
    expect(a().doneToday(10, 10, 0)).toBe('Today: 10 new words. Tomorrow: 10 reviews.')
    expect(a().doneToday(10, 0, 8)).toBe('Today: 10 new words. Tomorrow: 8 new words.')
    expect(a().doneToday(5, 0, 0)).toBe('Today: 5 new words.')
    expect(a().practiceToday).toBe('Today\'s words are ready to practise.')
  })

  it('Russian: the same, with the nouns agreeing with the numbers', () => {
    setLanguage('ru')
    expect(a().doneToday(10, 10, 10)).toBe('Сегодня: 10 новых слов. Завтра: 10 повторений и 10 новых.')
    expect(a().doneToday(1, 1, 1)).toBe('Сегодня: 1 новое слово. Завтра: 1 повторение и 1 новое.')
    expect(a().doneToday(2, 2, 2)).toBe('Сегодня: 2 новых слова. Завтра: 2 повторения и 2 новых.')
    expect(a().doneToday(21, 21, 21)).toBe('Сегодня: 21 новое слово. Завтра: 21 повторение и 21 новое.')
    expect(a().doneToday(3, 3, 0)).toBe('Сегодня: 3 новых слова. Завтра: 3 повторения.')
    expect(a().doneToday(5, 0, 8)).toBe('Сегодня: 5 новых слов. Завтра: 8 новых слов.')
    expect(a().practiceToday).toBe('Сегодняшние слова можно потренировать.')
  })

  it('Russian, for every count from 1 to 300: the nouns agree with the number by a hand-written rule (not the library)', () => {
    setLanguage('ru')
    const form = (n: number, one: string, few: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many)
    for (let n = 1; n <= 300; n++) {
      expect(a().doneToday(n, 0, 0), `${n}`).toBe(`Сегодня: ${n} ${form(n, 'новое слово', 'новых слова', 'новых слов')}.`)
      expect(a().doneToday(1, n, n), `${n}`).toBe(`Сегодня: 1 новое слово. Завтра: ${n} ${form(n, 'повторение', 'повторения', 'повторений')} и ${n} ${form(n, 'новое', 'новых', 'новых')}.`)
    }
  })

  it('names reviews only as tomorrow\'s: a forecast, never an offer (the part about today says none, and review is never put first)', () => {
    for (const language of ['en', 'ru'] as const) {
      setLanguage(language)
      const text = a().doneToday(10, 10, 10)
      const [today, ...rest] = text.split(/(?<=\.)\s/)
      expect(today).not.toMatch(/review|повторен/i)
      expect(rest.join(' ')).toMatch(language === 'en' ? /^Tomorrow:/ : /^Завтра:/)
      // and the practice pointer says nothing of reviewing either
      expect(a().practiceToday).not.toMatch(/review|повторен/i)
    }
  })
})

describe('past one session: the line says both numbers (and not before)', () => {
  const line = (n: number) => strings.home.advice.reviewFirst(n, REVIEW_SESSION_SIZE)

  it('a session holds 20 (the number the line quotes is the real one: a session built from more than that has exactly that many words)', () => {
    expect(REVIEW_SESSION_SIZE).toBe(20)
    const due = Array.from({ length: 21 }, (_, i) => makeWord(`w${i}`, { repetitions: 2, nextReview: new Date('2026-10-01T00:00:00Z') }))
    expect(buildReviewSession(due, new Date('2026-10-20T00:00:00Z'))).toHaveLength(REVIEW_SESSION_SIZE)
    expect(buildReviewSession(due.slice(0, 20), new Date('2026-10-20T00:00:00Z'))).toHaveLength(20)
  })

  it('English: 20 or fewer is the line as it was; 21 and more adds "(20 per session)"', () => {
    expect(line(1)).toBe('Review first — 1 word is waiting')
    expect(line(20)).toBe('Review first — 20 words are waiting')
    expect(line(21)).toBe('Review first — 21 words are waiting (20 per session)')
    expect(line(37)).toBe('Review first — 37 words are waiting (20 per session)')
    expect(line(250)).toBe('Review first — 250 words are waiting (20 per session)')
  })

  it('Russian: 20 or fewer is the line as it was; 21 and more adds «, за раз — 20»', () => {
    setLanguage('ru')
    expect(line(1)).toBe('Сначала повторение — ждет 1 слово')
    expect(line(20)).toBe('Сначала повторение — ждут 20 слов')
    expect(line(21)).toBe('Сначала повторение — ждет 21 слово, за раз — 20')
    expect(line(37)).toBe('Сначала повторение — ждут 37 слов, за раз — 20')
    expect(line(250)).toBe('Сначала повторение — ждут 250 слов, за раз — 20')
  })

  it('Russian, for every count from 1 to 1000: the verb and the noun agree with the number by the rule (checked against a hand-written rule, not the library), and the second part is there exactly past 20', () => {
    setLanguage('ru')
    const form = (n: number) => (n % 100 >= 11 && n % 100 <= 14 ? 'many' : n % 10 === 1 ? 'one' : n % 10 >= 2 && n % 10 <= 4 ? 'few' : 'many')
    for (let n = 1; n <= 1000; n++) {
      const f = form(n)
      const expected = `Сначала повторение — ${f === 'one' ? 'ждет' : 'ждут'} ${n} ${f === 'one' ? 'слово' : f === 'few' ? 'слова' : 'слов'}${n > 20 ? ', за раз — 20' : ''}`
      expect(line(n), String(n)).toBe(expected)
    }
  })

  it('English, for every count from 1 to 1000: "is" for one, "are" for the rest, and the second part exactly past 20', () => {
    for (let n = 1; n <= 1000; n++) {
      expect(line(n), String(n)).toBe(`Review first — ${n} ${n === 1 ? 'word is' : 'words are'} waiting${n > 20 ? ' (20 per session)' : ''}`)
    }
  })
})

