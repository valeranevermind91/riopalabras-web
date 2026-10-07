import type { SettingsPatch, UserSettings } from './types'

/** The daily goal's range, as in the Flutter app (DailyNewWordService): 0 to 20 new words a day. */
export const MIN_DAILY_LIMIT = 0
export const MAX_DAILY_LIMIT = 20
/** From this goal up the day is split into Learn sessions of 10, and Settings says so. */
export const SESSIONS_NOTE_FROM = 16

export const clampDailyLimit = (value: number): number => Math.min(MAX_DAILY_LIMIT, Math.max(MIN_DAILY_LIMIT, Math.round(value)))

/** The patch for a goal one step away, or null when the step would leave the range (the button is off there). */
export function dailyLimitPatch(current: number, delta: 1 | -1): SettingsPatch | null {
  if ((delta > 0 && current >= MAX_DAILY_LIMIT) || (delta < 0 && current <= MIN_DAILY_LIMIT)) return null
  return { daily_new_word_limit: clampDailyLimit(current + delta) }
}

/** At least one translation language must stay on: the only invalid state is both off (as in Flutter's TranslationLanguageService). */
export const isValidLanguages = (showRu: boolean, showEn: boolean): boolean => showRu || showEn

/**
 * The patch for turning one translation language on or off, or null when that would turn off the last one. Both keys are
 * written, as the Flutter app does, so the pair always sits in the blob together.
 */
export function languagesPatch(settings: Pick<UserSettings, 'showRuTranslation' | 'showEnTranslation'>, change: { ru?: boolean; en?: boolean }): SettingsPatch | null {
  const showRu = change.ru ?? settings.showRuTranslation
  const showEn = change.en ?? settings.showEnTranslation
  if (!isValidLanguages(showRu, showEn)) return null
  return { show_ru_translation: showRu, show_en_translation: showEn }
}

/** Whether this language is the only one on, and so cannot be turned off. */
export function isLastLanguage(settings: Pick<UserSettings, 'showRuTranslation' | 'showEnTranslation'>, which: 'ru' | 'en'): boolean {
  const on = which === 'ru' ? settings.showRuTranslation : settings.showEnTranslation
  const other = which === 'ru' ? settings.showEnTranslation : settings.showRuTranslation
  return on && !other
}

export interface SettingsDeps {
  /** The latest settings (read at the moment of the change, so two quick taps both count). */
  getSettings: () => UserSettings
  applySettings: (patch: SettingsPatch) => void
  queue: { enqueueSettings: (patch: SettingsPatch) => void }
}

/** Applies a settings patch at once and sends it through the write queue, as every other settings change does. */
export function saveSetting(patch: SettingsPatch, deps: Pick<SettingsDeps, 'applySettings' | 'queue'>): void {
  deps.applySettings(patch)
  deps.queue.enqueueSettings(patch)
}

/** One step on the daily goal; false when it is already at the end of the range. */
export function stepDailyLimit(delta: 1 | -1, deps: SettingsDeps): boolean {
  const patch = dailyLimitPatch(deps.getSettings().dailyNewWordLimit, delta)
  if (!patch) return false
  saveSetting(patch, deps)
  return true
}

/** Turns a translation language on or off; false when refused (it is the last one on). */
export function setLanguage(which: 'ru' | 'en', on: boolean, deps: SettingsDeps): boolean {
  const patch = languagesPatch(deps.getSettings(), which === 'ru' ? { ru: on } : { en: on })
  if (!patch) return false
  saveSetting(patch, deps)
  return true
}
