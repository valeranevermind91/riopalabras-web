import { describe, expect, it } from 'vitest'
import { DEFAULT_DAILY_GOAL, LEGACY_DAILY_GOAL, implicitDailyGoal, parseSettings } from './settings'
import { applySettingsPatch } from './mutations'
import { finishOnboardingPatch, needsOnboarding } from './onboarding'
import { LEARN_BATCH_SIZE, selectLearnBatch } from './learn'
import { makeWord } from '../testing/makeWord'

// The default daily goal is 5 for an account that has not finished the intro, and stays 10 for one that has (it has always had 10). A stored goal is never touched.

const NOW = new Date(2026, 9, 5, 14, 0)

describe('the goal when none is stored', () => {
  it('five before the intro is finished, ten after: the accounts that finished it keep what they have had', () => {
    expect(DEFAULT_DAILY_GOAL).toBe(5)
    expect(LEGACY_DAILY_GOAL).toBe(10)
    expect(parseSettings({}).dailyNewWordLimit).toBe(5)
    expect(parseSettings(null).dailyNewWordLimit).toBe(5)
    expect(parseSettings({ onboarding_done: true }).dailyNewWordLimit).toBe(10)
  })

  it('only a real true counts as a finished intro: anything else is a new account', () => {
    for (const value of [false, 'true', 1, null, {}, undefined]) expect(parseSettings({ onboarding_done: value }).dailyNewWordLimit, JSON.stringify(value)).toBe(5)
    expect(implicitDailyGoal({ onboarding_done: true })).toBe(10)
    expect(implicitDailyGoal({})).toBe(5)
  })

  it('a stored goal is what it is, finished intro or not, whatever it is (0 and 20 too)', () => {
    for (const done of [true, false, undefined]) {
      for (const goal of [0, 1, 5, 7, 10, 15, 20]) {
        const raw = { daily_new_word_limit: goal, ...(done === undefined ? {} : { onboarding_done: done }) }
        expect(parseSettings(raw).dailyNewWordLimit, `${goal} ${done}`).toBe(goal)
      }
    }
  })

  it('a stored value that is not a number is not a goal: the implicit one applies, as before', () => {
    expect(parseSettings({ daily_new_word_limit: '7', onboarding_done: true }).dailyNewWordLimit).toBe(10)
    expect(parseSettings({ daily_new_word_limit: null }).dailyNewWordLimit).toBe(5)
    expect(parseSettings({ daily_new_word_limit: Number.NaN, onboarding_done: true }).dailyNewWordLimit).toBe(10)
  })

  it('reading writes nothing: the blob stays exactly what was stored', () => {
    const blob = { onboarding_done: true, streak_count: 3 }
    expect(parseSettings(blob).raw).toEqual({ onboarding_done: true, streak_count: 3 })
    expect(parseSettings({}).raw).toEqual({})
  })
})

describe('the accounts in the live data, by their shape', () => {
  it('a finished intro with no goal: 10, before and after this change (the 18 accounts that never touched the stepper)', () => {
    expect(parseSettings({ onboarding_done: true, streak_count: 4 }).dailyNewWordLimit).toBe(10)
  })

  it('a goal chosen deliberately (5, 7, 10 or 20): the same number', () => {
    for (const goal of [5, 7, 10, 20]) expect(parseSettings({ onboarding_done: true, daily_new_word_limit: goal }).dailyNewWordLimit).toBe(goal)
  })

  it('a Flutter-era account with a stored goal and no intro flag keeps its goal; with neither, it is new to this app and gets five', () => {
    expect(parseSettings({ daily_new_word_limit: 15 }).dailyNewWordLimit).toBe(15)
    expect(parseSettings({ streak_count: 40 }).dailyNewWordLimit).toBe(5)
  })
})

describe('through the intro: the number on screen is the number kept', () => {
  it('a new account sees 5, finishes without touching the stepper, and has 5 afterwards (not 10, which the key alone would give)', () => {
    let settings = parseSettings({})
    expect(needsOnboarding(settings)).toBe(true)
    expect(settings.dailyNewWordLimit).toBe(5)
    settings = applySettingsPatch(settings, finishOnboardingPatch(settings)!)
    expect(needsOnboarding(settings)).toBe(false)
    expect(settings.dailyNewWordLimit).toBe(5)
    expect(settings.raw.daily_new_word_limit).toBe(5) // written, so nothing depends on the implicit goal any more
  })

  it('a new account that steps to 12 and finishes has 12', () => {
    let settings = parseSettings({})
    settings = applySettingsPatch(settings, { daily_new_word_limit: 12 })
    settings = applySettingsPatch(settings, finishOnboardingPatch(settings)!)
    expect(settings.dailyNewWordLimit).toBe(12)
  })

  it('replaying the intro from Settings writes nothing and keeps the goal, including the implicit 10', () => {
    const settings = parseSettings({ onboarding_done: true })
    expect(finishOnboardingPatch(settings)).toBeNull()
    expect(settings.dailyNewWordLimit).toBe(10)
  })
})

describe('a goal of 5 makes a batch of 5', () => {
  const pool = Array.from({ length: 60 }, (_, i) => makeWord(`palabra${i + 1}`, { rank: i + 1 }))

  it('the first Learn of a new account is five words; a goal of 10 is ten; above 10 the day still splits into batches of 10', () => {
    expect(selectLearnBatch(pool, parseSettings({}), NOW).words).toHaveLength(5)
    expect(selectLearnBatch(pool, parseSettings({ onboarding_done: true }), NOW).words).toHaveLength(10)
    expect(selectLearnBatch(pool, parseSettings({ daily_new_word_limit: 20 }), NOW).words).toHaveLength(LEARN_BATCH_SIZE)
  })
})
