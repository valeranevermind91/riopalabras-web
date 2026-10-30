import { languagesPatch } from './settingsActions'
import { NEWS_SEEN_KEY, WHATS_NEW, newestNewsAt } from './whatsNew'
import type { SettingsPatch, UserSettings } from './types'

// The first-run intro. It is shown once per account: finishing it writes `onboarding_done: true` into the settings blob, and
// from then on only "Run the intro again" in Settings shows it. (The key is new: the Flutter app is frozen and does not read it.)

export const ONBOARDING_KEY = 'onboarding_done'

/** True for an account that has not finished the intro: there is no `onboarding_done: true` in its settings. */
export const needsOnboarding = (settings: Pick<UserSettings, 'raw'>): boolean => settings.raw[ONBOARDING_KEY] !== true

/**
 * What finishing writes: the key, once, and the daily goal that is on screen, in the same patch, so the account does not depend on an implicit default afterwards
 * (finishing flips the implicit goal from five to ten, see implicitDailyGoal). It also marks the newest "What's new" entry as seen: a new account has no use for the history
 * of an app it has only just met, so it starts with no dot. Null when the intro is already done (replaying it writes nothing).
 */
export const finishOnboardingPatch = (settings: Pick<UserSettings, 'raw' | 'dailyNewWordLimit'>, latestNews: string | null = newestNewsAt(WHATS_NEW)): SettingsPatch | null =>
  needsOnboarding(settings) ? { [ONBOARDING_KEY]: true, daily_new_word_limit: settings.dailyNewWordLimit, ...(latestNews ? { [NEWS_SEEN_KEY]: latestNews } : {}) } : null

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
