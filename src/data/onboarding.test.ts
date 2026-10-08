import { describe, expect, it } from 'vitest'
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
  it('writes onboarding_done: true, and nothing else', () => {
    expect(finishOnboardingPatch(parseSettings({ daily_new_word_limit: 12 }))).toEqual({ onboarding_done: true })
  })

  it('writes it once: with the key there, finishing (a replay, or a second tap) writes nothing', () => {
    const first = parseSettings({ some_other_key: 1 })
    const patch = finishOnboardingPatch(first)!
    const after = applySettingsPatch(first, patch)
    expect(finishOnboardingPatch(after)).toBeNull()
    expect(needsOnboarding(after)).toBe(false)
    expect(after.raw.some_other_key).toBe(1) // the other keys survive
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
