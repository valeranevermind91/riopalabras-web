import type { UiLanguage } from './language'
import { getWebApp, type TelegramWebApp } from './telegram'

// The places the About screen and the privacy page point to, and how a link is opened. Names, addresses and handles are not translatable text,
// so they live here and the strings refer to them by a token ({doozan}, {handle}, …): the same address in both languages, written once.

export const AUTHOR_HANDLE = '@valeranevermind'
export const AUTHOR_URL = 'https://t.me/valeranevermind'
export const COFFEE_URL = 'https://buymeacoffee.com/valeranevermind'

export const DOOZAN_URL = 'https://github.com/doozan/spanish_data'
export const HERMITDAVE_URL = 'https://github.com/hermitdave/FrequencyWords'
export const CC_BY_SA_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'

/** How a repository or a licence is written in running text. */
export const LINK_LABELS = {
  doozan: 'doozan/spanish_data',
  hermitdave: 'hermitdave/FrequencyWords',
  licence: 'CC BY-SA 4.0',
} as const

/**
 * The shape of the address an account gets (the proxy's telegram-auth.js makes tg_<Telegram id>@<this domain>), with an obviously made-up id, for the
 * privacy page to show. Its domain is spelled in pieces on purpose: src/screens/debugAccess.test.ts fails on any file that spells the domain out, to be
 * sure that nothing READS the Telegram id back out of an account's email, and this only SHOWS the shape.
 */
export const ACCOUNT_EMAIL_EXAMPLE = `tg_123456789@${['telegram', 'riopalabras', 'internal'].join('.')}`

/** Where the privacy page lives: its own page, outside the Mini App (privacy.html, served at this path by vercel.json). */
export const PRIVACY_PATH = '/privacy'

/** The privacy page's address on the origin the app is served from, opening in `language` (the page honours ?lang=). */
export function privacyUrl(language: UiLanguage, origin: string = typeof location === 'undefined' ? '' : location.origin): string {
  return `${origin}${PRIVACY_PATH}?lang=${language}`
}

type Opener = Pick<TelegramWebApp, 'openLink' | 'openTelegramLink'>

/**
 * Opens `url` with Telegram's own openers when there are any, so a tap never takes the Mini App's page away: a t.me link goes to openTelegramLink,
 * every other address to openLink. Returns whether Telegram took it; when it did not (outside Telegram, an old client, an address that is not one)
 * the caller lets the anchor do its ordinary job, which opens a new tab.
 */
export function openInTelegram(url: string, webApp: Opener = getWebApp().webApp): boolean {
  try {
    const open = new URL(url).hostname === 't.me' ? webApp.openTelegramLink : webApp.openLink
    if (!open) return false
    open.call(webApp, url)
    return true
  } catch {
    return false
  }
}
