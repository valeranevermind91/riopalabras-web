import type { TranslationFlags } from '../data/translations'

/** The three states the two switches can be in (both off is not allowed in the UI). */
export const RU_ONLY: TranslationFlags = { showRuTranslation: true, showEnTranslation: false }
export const EN_ONLY: TranslationFlags = { showRuTranslation: false, showEnTranslation: true }
export const BOTH: TranslationFlags = { showRuTranslation: true, showEnTranslation: true }

/** The flags for a single language, for tests that used to pass "ru" or "en". */
export const flagsFor = (lang: 'ru' | 'en'): TranslationFlags => (lang === 'ru' ? RU_ONLY : EN_ONLY)
