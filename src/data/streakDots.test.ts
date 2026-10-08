import { describe, expect, it } from 'vitest'
import { lastDays } from './metrics'
import { WEEKDAY_LETTERS, activityDots, weekdayLetter } from './streakDots'

const MON = new Date(2026, 9, 5, 12) // Monday 5 October 2026

describe('weekday letters (week starts Monday, taken from the date)', () => {
  it('Mon..Sun are M T W T F S S', () => {
    expect(WEEKDAY_LETTERS.join('')).toBe('MTWTFSS')
    const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']
    expect(week.map(weekdayLetter).join('')).toBe('MTWTFSS')
  })

  it('comes from the date itself, wherever it falls (month and year ends, leap day)', () => {
    expect(weekdayLetter('2026-12-31')).toBe('T') // Thursday
    expect(weekdayLetter('2027-01-01')).toBe('F')
    expect(weekdayLetter('2028-02-29')).toBe('T') // Tuesday
    expect(weekdayLetter('2026-10-04')).toBe('S') // Sunday
  })
})

describe('the dots', () => {
  it('seven, six days ago first and today last, with the letters of their own dates', () => {
    const dots = activityDots(MON, new Set(), false)
    expect(dots.map((d) => d.date)).toEqual(lastDays(MON))
    expect(dots.map((d) => d.letter).join('')).toBe('TWTFSSM')
    expect(dots.filter((d) => d.today).map((d) => d.date)).toEqual(['2026-10-05'])
  })

  it('the labels follow the calendar, not the position: another day, another sequence', () => {
    const friday = activityDots(new Date(2026, 9, 9, 12), new Set(), false) // Friday 9 October 2026
    expect(friday.map((d) => d.letter).join('')).toBe('SSMTWTF')
    expect(friday.at(-1)!.letter).toBe('F')
  })

  it('active from the server\'s days; today also from the local row; others never from the local row', () => {
    const dots = activityDots(MON, new Set(['2026-10-03']), true)
    expect(dots.filter((d) => d.active).map((d) => d.date)).toEqual(['2026-10-03', '2026-10-05'])
    expect(activityDots(MON, new Set(), false).some((d) => d.active)).toBe(false)
  })
})

describe('the dots are not a streak', () => {
  it('the module no longer computes a streak from them: the number is the stored one (computeStreak)', async () => {
    const mod = await import('./streakDots')
    expect(Object.keys(mod).sort()).toEqual(['DOT_COUNT', 'WEEKDAY_LETTERS', 'activityDots', 'weekdayLetter'])
  })
})
