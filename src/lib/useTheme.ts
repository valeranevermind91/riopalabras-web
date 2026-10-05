import { useCallback, useEffect, useRef, useState } from 'react'
import type { UserSettings } from '../data/types'
import { getWebApp } from './telegram'
import {
  applyTheme,
  effectiveChoice,
  insideTelegram,
  nextThemeChoice,
  readStoredChoice,
  readThemeEnv,
  resolveTheme,
  storeChoice,
  type ResolvedTheme,
  type ThemeChoice,
} from './theme'

export interface UseTheme {
  choice: ThemeChoice
  resolved: ResolvedTheme
  set: (choice: ThemeChoice) => void
  /** system → light → dark → system. */
  cycle: () => void
}

/**
 * The page's theme. `settings` is null until the user's settings have loaded; `persist` saves a
 * choice to them (App wires it to the write queue), and is null while that is not possible.
 * Before the settings load, and when signed out, the choice lives in localStorage.
 */
export function useTheme(settings: Pick<UserSettings, 'themeChoice'> | null, persist: ((choice: ThemeChoice) => void) | null): UseTheme {
  const [local, setLocal] = useState<ThemeChoice | null>(() => readStoredChoice())
  const [env, setEnv] = useState(() => readThemeEnv(getWebApp().webApp))
  const settingsChoice = settings?.themeChoice ?? null
  const choice = effectiveChoice(settingsChoice, local)
  const resolved = resolveTheme(choice, env)

  useEffect(() => {
    const { webApp } = getWebApp()
    applyTheme(document.documentElement, resolved, insideTelegram(webApp) ? webApp : null)
  }, [resolved.scheme, resolved.source, env]) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the OS (outside Telegram) and the client's own theme changes (inside it).
  useEffect(() => {
    const refresh = () => setEnv(readThemeEnv(getWebApp().webApp))
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    query?.addEventListener?.('change', refresh)
    const { webApp } = getWebApp()
    webApp.onEvent?.('themeChanged', refresh)
    return () => {
      query?.removeEventListener?.('change', refresh)
      webApp.offEvent?.('themeChanged', refresh)
    }
  }, [])

  // The synced setting wins over what this device remembered (see effectiveChoice); keep localStorage in step with it,
  // so the next launch starts in the right theme before the settings have loaded.
  useEffect(() => {
    if (settingsChoice !== null) storeChoice(settingsChoice)
  }, [settingsChoice])

  // A choice made before the settings were available (signed out, or still loading) is saved once they are.
  const migrated = useRef(false)
  useEffect(() => {
    if (migrated.current || !persist || !settings || settingsChoice !== null || local === null || local === 'system') return
    migrated.current = true
    persist(local)
  }, [persist, settings, settingsChoice, local])

  const set = useCallback(
    (next: ThemeChoice) => {
      setLocal(next)
      storeChoice(next)
      persist?.(next)
    },
    [persist],
  )
  const cycle = useCallback(() => set(nextThemeChoice(choice)), [set, choice])

  return { choice, resolved, set, cycle }
}
