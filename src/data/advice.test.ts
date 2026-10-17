import { afterEach, describe, expect, it } from 'vitest'
import { setLanguage } from '../lib/language'
import { strings } from '../strings'
import { homeAdvice, primaryTile, type HomeAdvice } from './advice'

// What Home says to do today: five states from three numbers, in the Flutter app's priority.

afterEach(() => setLanguage('en'))

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

  it('is never Matching or Cloze: they are practice, not advice', () => {
    for (const state of ['reviewFirst', 'learnNew', 'allDoneToday', 'poolEmpty', 'allClear'] as const) expect(['review', 'learn', null]).toContain(primaryTile(state))
  })
})

describe('the wording', () => {
  const a = () => strings.home.advice

  it('English', () => {
    expect(a().allDoneToday).toBe('Done for today')
    expect(a().poolEmpty).toBe('No new words left — add your own, or practise')
    expect(a().allClear).toBe('All clear')
    expect(a().reviewFirst(40)).toBe('Review first — 40 words are waiting')
    expect(a().learnNew(10)).toBe('Nothing to review — 10 new words ready')
  })

  it('Russian', () => {
    setLanguage('ru')
    expect(a().allDoneToday).toBe('На сегодня всё')
    expect(a().poolEmpty).toBe('Новые слова закончились — добавьте свои или потренируйтесь')
    expect(a().allClear).toBe('Всё в порядке')
    expect(a().reviewFirst(40)).toBe('Сначала повторение — ждут 40 слов')
    expect(a().learnNew(10)).toBe('Повторять нечего — можно выучить 10 новых слов')
  })

  it('English plurals for 1, 2, 5 and 21: the verb and the noun follow the number', () => {
    expect([1, 2, 5, 21].map(a().reviewFirst)).toEqual([
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

  it('Russian plurals for 1, 2, 5 and 21: ждёт 1 слово, ждут 2 слова, ждут 5 слов, ждёт 21 слово (and the same for the new words)', () => {
    setLanguage('ru')
    expect([1, 2, 5, 21].map(a().reviewFirst)).toEqual([
      'Сначала повторение — ждёт 1 слово',
      'Сначала повторение — ждут 2 слова',
      'Сначала повторение — ждут 5 слов',
      'Сначала повторение — ждёт 21 слово',
    ])
    expect([1, 2, 5, 21].map(a().learnNew)).toEqual([
      'Повторять нечего — можно выучить 1 новое слово',
      'Повторять нечего — можно выучить 2 новых слова',
      'Повторять нечего — можно выучить 5 новых слов',
      'Повторять нечего — можно выучить 21 новое слово',
    ])
  })

  it('also right at the awkward Russian counts: 11, 12, 14, 22, 25, 101, 111', () => {
    setLanguage('ru')
    const noun = (n: number) => a().reviewFirst(n).split(' ').slice(-1)[0]
    const verb = (n: number) => a().reviewFirst(n).split(' ')[3]
    expect([11, 12, 14, 22, 25, 101, 111].map(noun)).toEqual(['слов', 'слов', 'слов', 'слова', 'слов', 'слово', 'слов'])
    expect([11, 12, 14, 22, 25, 101, 111].map(verb)).toEqual(['ждут', 'ждут', 'ждут', 'ждут', 'ждут', 'ждёт', 'ждут'])
  })

  it('never mentions reviews when none are due (the Flutter app\'s "or catch up on reviews" with nothing to review)', () => {
    for (const language of ['en', 'ru'] as const) {
      setLanguage(language)
      for (const text of [a().allDoneToday, a().poolEmpty, a().allClear, a().learnNew(5)]) expect(text.toLowerCase().replace('nothing to review', '').replace('повторять нечего', '')).not.toMatch(/review|catch up|повтор/)
    }
  })
})
