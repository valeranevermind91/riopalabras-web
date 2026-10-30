import { describe, expect, it } from 'vitest'
import { WHATS_NEW, newestNewsAt } from './whatsNew'
import { LANGUAGE_CHOICES, ONBOARDING_KEY, finishOnboardingPatch, languageChoiceOf, languageChoicePatch, needsOnboarding } from './onboarding'
import { applySettingsPatch } from './mutations'
import { parseSettings } from './settings'
import { isValidLanguages, languagesPatch } from './settingsActions'

describe('who sees the intro', () => {
  it('an account with no onboarding_done key does (a fresh one, or no settings row at all)', () => {
    expect(needsOnboarding(parseSettings(null))).toBe(true)
    expect(needsOnboarding(parseSettings({}))).toBe(true)
    expect(needsOnboarding(parseSettings({ daily_new_word_limit: 12, streak_count: 4 }))).toBe(true) // other keys do not count
  })

  it('an account with onboarding_done: true does not', () => {
    expect(needsOnboarding(parseSettings({ [ONBOARDING_KEY]: true }))).toBe(false)
    expect(needsOnboarding(parseSettings({ daily_new_word_limit: 12, onboarding_done: true }))).toBe(false)
  })

  it('only a real true counts: anything else is an intro not finished', () => {
    for (const value of [false, 'true', 1, null, {}]) expect(needsOnboarding(parseSettings({ onboarding_done: value })), JSON.stringify(value)).toBe(true)
  })

  it('the key is onboarding_done', () => {
    expect(ONBOARDING_KEY).toBe('onboarding_done')
  })
})

describe('finishing', () => {
  const LATEST = '2026-10-29T23:03'

  it('writes onboarding_done: true, the daily goal that is on screen, and that the news up to now is read, and nothing else', () => {
    expect(finishOnboardingPatch(parseSettings({ daily_new_word_limit: 12 }), LATEST)).toEqual({ onboarding_done: true, daily_new_word_limit: 12, whats_new_seen: LATEST })
  })

  it('with no goal stored, the goal it writes is the default of five: finishing flips the implicit goal to ten, so it must be written down', () => {
    const fresh = parseSettings({})
    expect(fresh.dailyNewWordLimit).toBe(5)
    const patch = finishOnboardingPatch(fresh, LATEST)!
    expect(patch).toEqual({ onboarding_done: true, daily_new_word_limit: 5, whats_new_seen: LATEST })
    expect(applySettingsPatch(fresh, patch).dailyNewWordLimit).toBe(5) // five after finishing, not the ten the key alone would give
    expect(parseSettings({ onboarding_done: true }).dailyNewWordLimit).toBe(10) // that is the blob the old intro left: the key alone
  })

  it('a goal chosen in the intro is the one written: the stepper\'s value, not the default', () => {
    const stepped = applySettingsPatch(parseSettings({}), { daily_new_word_limit: 8 })
    expect(finishOnboardingPatch(stepped, LATEST)).toEqual({ onboarding_done: true, daily_new_word_limit: 8, whats_new_seen: LATEST })
  })

  it('a goal of 0 chosen in the intro is written as 0, not replaced by a default', () => {
    expect(finishOnboardingPatch(parseSettings({ daily_new_word_limit: 0 }), LATEST)).toEqual({ onboarding_done: true, daily_new_word_limit: 0, whats_new_seen: LATEST })
  })

  it('writes it once: with the key there, finishing (a replay, or a second tap) writes nothing', () => {
    const first = parseSettings({ some_other_key: 1 })
    const patch = finishOnboardingPatch(first)!
    const after = applySettingsPatch(first, patch)
    expect(finishOnboardingPatch(after)).toBeNull()
    expect(needsOnboarding(after)).toBe(false)
    expect(after.raw.some_other_key).toBe(1) // the other keys survive
  })

  it('a new account starts with the news as it stands read: the newest entry the file has is the watermark, so nothing about the past is shown as new', () => {
    const patch = finishOnboardingPatch(parseSettings({}))!
    expect(patch.whats_new_seen).toBe(newestNewsAt(WHATS_NEW))
    expect(patch.whats_new_seen).toBe(WHATS_NEW[0].at) // the file is newest first
    expect(parseSettings(applySettingsPatch(parseSettings({}), patch).raw).whatsNewSeen).toBe(WHATS_NEW[0].at)
  })

  it('with no entries at all there is nothing to mark: the key is left out rather than written empty', () => {
    expect(finishOnboardingPatch(parseSettings({}), null)).toEqual({ onboarding_done: true, daily_new_word_limit: 5 })
  })
})

describe('the translation step writes what the Settings switches write', () => {
  const both = parseSettings({})

  it('both is the default: nothing stored, both languages shown', () => {
    expect(languageChoiceOf(both)).toBe('both')
  })

  it('each choice is the same pair of keys the switches write, for the same state', () => {
    expect(languageChoicePatch(both, 'ru')).toEqual({ show_ru_translation: true, show_en_translation: false })
    expect(languageChoicePatch(both, 'en')).toEqual({ show_ru_translation: false, show_en_translation: true })
    expect(languageChoicePatch(both, 'both')).toEqual({ show_ru_translation: true, show_en_translation: true })
    // identical to what turning a switch off (or on) in Settings writes
    expect(languageChoicePatch(both, 'en')).toEqual(languagesPatch(both, { ru: false }))
    expect(languageChoicePatch(parseSettings({ show_en_translation: false }), 'both')).toEqual(languagesPatch(parseSettings({ show_en_translation: false }), { en: true }))
  })

  it('every choice leaves at least one language on', () => {
    for (const choice of LANGUAGE_CHOICES) {
      const patch = languageChoicePatch(both, choice)
      expect(isValidLanguages(patch.show_ru_translation as boolean, patch.show_en_translation as boolean)).toBe(true)
    }
  })

  it('reads the current switches back as one of the three, so a replay opens on what is set', () => {
    for (const choice of LANGUAGE_CHOICES) expect(languageChoiceOf(applySettingsPatch(both, languageChoicePatch(both, choice)))).toBe(choice)
    expect(languageChoiceOf(parseSettings({ show_ru_translation: false }))).toBe('en') // an explicit false, e.g. set elsewhere
    expect(languageChoiceOf(parseSettings({ show_en_translation: false }))).toBe('ru')
  })
})
