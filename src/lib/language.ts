import { useSyncExternalStore } from 'react'
import { getWebApp } from './telegram'

/**
 * The interface language: English or Russian. It is chosen in the intro and in Settings (the `ui_language` key of the settings blob),
 * and until that is read (a cold start, a loading screen) the last one used on this device stands, kept in localStorage like the theme.
 * With nothing chosen anywhere it follows the language Telegram reports. This module holds the current language and tells the app when it
 * changes (`useLanguage`); the text itself is src/strings.ts, which reads it. It does not import strings.
 */

export type UiLanguage = 'en' | 'ru'
export const UI_LANGUAGES: readonly UiLanguage[] = ['en', 'ru']
/** The key in the user_settings blob. */
export const LANGUAGE_SETTING_KEY = 'ui_language'
/** localStorage key: the language before the settings have loaded (and when signed out). */
export const LANGUAGE_STORAGE_KEY = 'riopalabras.language.v1'

export const parseUiLanguage = (value: unknown): UiLanguage | null => (value === 'en' || value === 'ru' ? value : null)

/** 'ru' when Telegram's language starts with "ru", else 'en'. */
export const languageFromCode = (code: string | null | undefined): UiLanguage => (typeof code === 'string' && code.toLowerCase().startsWith('ru') ? 'ru' : 'en')

/**
 * What Telegram says the user's language is, mapped to ours. Read from the WebApp object for this one purpose: it says nothing about
 * who the user is and is never sent anywhere or used for sign-in.
 */
export function telegramLanguage(): UiLanguage {
  try {
    if (typeof window === 'undefined') return 'en'
    return languageFromCode(getWebApp().webApp.initDataUnsafe.user?.language_code)
  } catch {
    return 'en'
  }
}

/** The settings patch that saves a choice (sent through the write queue like any other settings change). */
export const languagePatch = (language: UiLanguage): Record<string, unknown> => ({ [LANGUAGE_SETTING_KEY]: language })

/** The stored choice if there is one, else what Telegram reports. */
export const effectiveLanguage = (stored: UiLanguage | null): UiLanguage => stored ?? telegramLanguage()

function readCached(): UiLanguage | null {
  try {
    return typeof localStorage === 'undefined' ? null : parseUiLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY))
  } catch {
    return null
  }
}

let current: UiLanguage = readCached() ?? telegramLanguage()
const listeners = new Set<() => void>()

function reflect(language: UiLanguage) {
  try {
    if (typeof document !== 'undefined') document.documentElement.lang = language
  } catch {
    // decoration only
  }
}
reflect(current)

export const getLanguage = (): UiLanguage => current

/** Makes this the interface language (and the one this device starts with next time). Everything that reads strings follows. */
export function setLanguage(language: UiLanguage): void {
  if (language === current) return
  current = language
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // storage may be blocked: the language still holds for this run
  }
  reflect(language)
  for (const listener of listeners) listener()
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The current language; the component re-renders when it changes. Put it at the root: everything below it re-renders with it. */
export function useLanguage(): UiLanguage {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage)
}
