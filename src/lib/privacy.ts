import { browserLanguage, parseUiLanguage, setLanguage, type UiLanguage } from './language'

// The privacy page's small amount of logic, apart from React so a test can drive it.

/**
 * The day the policy was last changed, as a calendar date. Change it whenever the page's text changes in substance: src/screens/Privacy.test.ts fingerprints the
 * text (both languages) next to this date, and fails when one moves without the other. Spelling (е for ё) and spacing are not a change of the policy,
 * so the fingerprint reads the text normalised and the date does not move for them.
 */
export const PRIVACY_UPDATED = '2026-10-30'

/** The date as the reader's language writes it ("19 October 2026" / "19 октября 2026 г."). A calendar date, so no time zone moves it. */
export function formatPolicyDate(iso: string, language: UiLanguage): string {
  const moment = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(moment.getTime())) return iso
  return new Intl.DateTimeFormat(language === 'ru' ? 'ru' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(moment)
}

/**
 * The language the page opens in, with no Telegram hint to go on: the address asks for one (?lang=ru, which the app puts on its link so the page opens in
 * the language the app is in), else the one this device last used, else the browser's first preference.
 */
export function startingLanguage({ search, stored, languages }: { search: string; stored: UiLanguage | null; languages: readonly string[] | undefined }): UiLanguage {
  return parseUiLanguage(new URLSearchParams(search).get('lang')) ?? stored ?? browserLanguage(languages)
}

/** The same address with ?lang= set to `language` (other parts of the query kept), so a reload or a shared link opens in the language shown. */
export function withLanguage(href: string, language: UiLanguage): string {
  const url = new URL(href)
  url.searchParams.set('lang', language)
  return url.toString()
}

/**
 * Switching language on the page: shown and kept in the address (?lang=), not remembered on the device. The page only displays a language; what the
 * app starts in is the app's own business.
 */
export function choosePrivacyLanguage(language: UiLanguage): void {
  setLanguage(language, { remember: false })
  try {
    history.replaceState(null, '', withLanguage(location.href, language))
  } catch {
    // the language still changed on screen
  }
}
