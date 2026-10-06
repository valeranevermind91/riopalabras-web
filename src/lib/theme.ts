import type { TelegramWebApp } from './telegram'

/**
 * Theme resolution, kept apart from React so the Settings screen can reuse it later.
 *
 *   choice  system | light | dark  (the user's pick; "system" is the default)
 *   scheme  light | dark           (what is actually shown)
 *
 * "system" follows Telegram's own scheme inside Telegram and the OS preference outside it. Telegram
 * supplies ONLY the scheme: the colours are always the app's own palette (src/tokens.css), so the
 * app looks the same in every Telegram theme. Inside Telegram, the client's header and background
 * are set to the app's page colour for the scheme being shown.
 */

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Scheme = 'light' | 'dark'

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark']
/** The key in the user_settings blob. */
export const THEME_SETTING_KEY = 'theme_preference'
/** localStorage key: the choice before the settings have loaded (and when signed out). */
export const THEME_STORAGE_KEY = 'riopalabras.theme.v1'

export function parseThemeChoice(value: unknown): ThemeChoice | null {
  return value === 'system' || value === 'light' || value === 'dark' ? value : null
}

/** The next choice when the toggle is tapped: system → light → dark → system. */
export function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
  return THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length]
}

/** The settings patch that saves a choice (sent through the write queue like any other settings change). */
export function themePatch(choice: ThemeChoice): Record<string, unknown> {
  return { [THEME_SETTING_KEY]: choice }
}

/** The synced setting wins; before it has loaded (or if it was never set) the local choice stands; otherwise system. */
export function effectiveChoice(settingsChoice: ThemeChoice | null, localChoice: ThemeChoice | null): ThemeChoice {
  return settingsChoice ?? localChoice ?? 'system'
}

export interface ThemeEnv {
  /** Telegram's scheme when running inside Telegram; null outside it. */
  telegramScheme: Scheme | null
  /** The OS preference (prefers-color-scheme). */
  prefersDark: boolean
}

/** The scheme to show: an explicit choice wins; "system" is Telegram's scheme inside Telegram, otherwise the OS preference. */
export function resolveScheme(choice: ThemeChoice, env: ThemeEnv): Scheme {
  if (choice !== 'system') return choice
  if (env.telegramScheme !== null) return env.telegramScheme
  return env.prefersDark ? 'dark' : 'light'
}

/** Inside Telegram means a real session: the stub that telegram-web-app.js defines in a plain browser has no initData. */
export function insideTelegram(webApp: Pick<TelegramWebApp, 'initData'> | null | undefined): boolean {
  return Boolean(webApp?.initData)
}

export function readThemeEnv(
  webApp: Pick<TelegramWebApp, 'initData' | 'colorScheme'> | null | undefined,
  matchMedia: ((query: string) => { matches: boolean }) | undefined = typeof window === 'undefined' ? undefined : window.matchMedia?.bind(window),
): ThemeEnv {
  return {
    telegramScheme: insideTelegram(webApp) ? (webApp!.colorScheme === 'dark' ? 'dark' : 'light') : null,
    prefersDark: matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readStoredChoice(storage: StorageLike | null = defaultStorage()): ThemeChoice | null {
  try {
    return parseThemeChoice(storage?.getItem(THEME_STORAGE_KEY))
  } catch {
    return null
  }
}

export function storeChoice(choice: ThemeChoice, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    // private mode or blocked storage: the choice still works for this session
  }
}

export interface ThemeRoot {
  dataset: Record<string, string | undefined>
  style: { colorScheme?: string }
}

type ThemeWebApp = Pick<TelegramWebApp, 'initData' | 'isVersionAtLeast' | 'setHeaderColor' | 'setBackgroundColor'>

/** The page colour of the scheme just applied, read from the stylesheet (--page in tokens.css), so no colour is written down twice. */
function pageColorOf(): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue('--page').trim()
  } catch {
    return ''
  }
}

/**
 * Puts a scheme on the page: data-theme and the native colour-scheme (form controls, scrollbars),
 * and, inside Telegram (6.1+), the client's header and background colour set to the app's --page so
 * the chrome around the app matches it. `pageColor` is injectable for tests.
 */
export function applyTheme(root: ThemeRoot, scheme: Scheme, webApp: ThemeWebApp | null, pageColor: () => string = pageColorOf): void {
  root.dataset.theme = scheme
  root.style.colorScheme = scheme

  if (insideTelegram(webApp) && webApp!.isVersionAtLeast?.('6.1')) {
    const color = pageColor()
    if (!color) return
    try {
      webApp!.setHeaderColor?.(color)
      webApp!.setBackgroundColor?.(color)
    } catch {
      // the client's chrome colour is a nicety
    }
  }
}
