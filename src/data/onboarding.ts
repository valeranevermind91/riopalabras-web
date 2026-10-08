import { languagesPatch } from './settingsActions'
import type { SettingsPatch, UserSettings } from './types'

// The first-run intro. It is shown once per account: finishing it writes `onboarding_done: true` into the settings blob, and
// from then on only "Run the intro again" in Settings shows it. (The key is new: the Flutter app is frozen and does not read it.)

export const ONBOARDING_KEY = 'onboarding_done'

/** True for an account that has not finished the intro: there is no `onboarding_done: true` in its settings. */
export const needsOnboarding = (settings: Pick<UserSettings, 'raw'>): boolean => settings.raw[ONBOARDING_KEY] !== true

/** What finishing writes: the key, once. Null when it is already there (replaying the intro writes nothing). */
export const finishOnboardingPatch = (settings: Pick<UserSettings, 'raw'>): SettingsPatch | null => (needsOnboarding(settings) ? { [ONBOARDING_KEY]: true } : null)

/** The translation step offers Russian, English or both. */
export type LanguageChoice = 'ru' | 'en' | 'both'
export const LANGUAGE_CHOICES: readonly LanguageChoice[] = ['ru', 'en', 'both']

/** Which choice the current switches amount to. (The Settings rule keeps one of them on, so one of the three always fits.) */
export function languageChoiceOf(settings: Pick<UserSettings, 'showRuTranslation' | 'showEnTranslation'>): LanguageChoice {
  if (settings.showRuTranslation && settings.showEnTranslation) return 'both'
  return settings.showEnTranslation ? 'en' : 'ru'
}

/** The patch for a choice: the same two keys, written together, that the Settings switches write. */
export function languageChoicePatch(settings: Pick<UserSettings, 'showRuTranslation' | 'showEnTranslation'>, choice: LanguageChoice): SettingsPatch {
  const patch = languagesPatch(settings, { ru: choice !== 'en', en: choice !== 'ru' })
  // every choice keeps at least one language on, so there is always a patch
  return patch as SettingsPatch
}
