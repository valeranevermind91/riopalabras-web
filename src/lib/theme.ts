import type { TelegramWebApp } from './telegram'

/**
 * Theme resolution, kept apart from React so the Settings screen can reuse it later.
 *
 *   choice  system | light | dark  (the user's pick; "system" is the default)
 *   scheme  light | dark           (what is actually shown)
 *   source  telegram | palette     (where the colours come from)
 *
 * "system" follows Telegram's own scheme inside Telegram and the OS preference outside it. Inside
 * Telegram the colours come from Telegram's themeParams whenever the shown scheme is the client's
 * own scheme, so the app matches the client's chrome. When the user forces the OTHER scheme
 * (light in a dark client), Telegram's colours would be wrong, so the app's own designed palette
 * for that scheme is used instead. Outside Telegram it is always the app's palette.
 */

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Scheme = 'light' | 'dark'
export type ThemeSource = 'telegram' | 'palette'

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

export interface ResolvedTheme {
  scheme: Scheme
  source: ThemeSource
}

export function resolveTheme(choice: ThemeChoice, env: ThemeEnv): ResolvedTheme {
  if (choice === 'system') {
    return env.telegramScheme !== null
      ? { scheme: env.telegramScheme, source: 'telegram' }
      : { scheme: env.prefersDark ? 'dark' : 'light', source: 'palette' }
  }
  return { scheme: choice, source: env.telegramScheme === choice ? 'telegram' : 'palette' }
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

/** The app's own page colour per scheme, used for Telegram's header when the palette (not Telegram) is in charge. Kept equal to --tg-bg-color in index.css (a test checks). */
export const PALETTE_BG: Record<Scheme, string> = { light: '#ffffff', dark: '#17212b' }

export interface ThemeRoot {
  dataset: Record<string, string | undefined>
  style: { setProperty: (name: string, value: string) => void; removeProperty: (name: string) => unknown; colorScheme?: string }
}

type ThemeWebApp = Pick<TelegramWebApp, 'initData' | 'themeParams' | 'isVersionAtLeast' | 'setHeaderColor' | 'setBackgroundColor'>

const appliedVars = new WeakMap<object, string[]>()

/** `--tg-<key>` for every themeParams entry that has a value ("bg_color" → "--tg-bg-color"). */
export function telegramThemeVars(themeParams: Record<string, string | undefined>): [string, string][] {
  return Object.entries(themeParams).flatMap(([key, value]) => (value ? [[`--tg-${key.replace(/_/g, '-')}`, value] as [string, string]] : []))
}

/**
 * Puts a resolved theme on the page: data-theme / data-theme-source and the native colour-scheme
 * always; Telegram's themeParams as --tg-* variables only when Telegram is the source (otherwise
 * the stylesheet's palette for the scheme applies, so any earlier Telegram values are removed);
 * and, inside Telegram, the header and background colours so the client's chrome matches.
 */
export function applyTheme(root: ThemeRoot, resolved: ResolvedTheme, webApp: ThemeWebApp | null): void {
  root.dataset.theme = resolved.scheme
  root.dataset.themeSource = resolved.source
  root.style.colorScheme = resolved.scheme

  for (const name of appliedVars.get(root) ?? []) root.style.removeProperty(name)
  const names: string[] = []
  if (resolved.source === 'telegram' && webApp) {
    for (const [name, value] of telegramThemeVars(webApp.themeParams)) {
      root.style.setProperty(name, value)
      names.push(name)
    }
  }
  appliedVars.set(root, names)

  if (insideTelegram(webApp) && webApp!.isVersionAtLeast?.('6.1')) {
    const color = resolved.source === 'telegram' ? 'bg_color' : PALETTE_BG[resolved.scheme]
    try {
      webApp!.setHeaderColor?.(color)
      webApp!.setBackgroundColor?.(color)
    } catch {
      // the client's chrome colour is a nicety
    }
  }
}
