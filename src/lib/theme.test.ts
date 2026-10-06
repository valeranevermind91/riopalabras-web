import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parseSettings } from '../data/settings'
import {
  THEME_SETTING_KEY,
  THEME_STORAGE_KEY,
  applyTheme,
  effectiveChoice,
  insideTelegram,
  nextThemeChoice,
  parseThemeChoice,
  readStoredChoice,
  readThemeEnv,
  resolveScheme,
  storeChoice,
  themePatch,
  type Scheme,
  type ThemeChoice,
  type ThemeEnv,
  type ThemeRoot,
} from './theme'

const env = (telegramScheme: Scheme | null, prefersDark = false): ThemeEnv => ({ telegramScheme, prefersDark })

describe('resolveScheme', () => {
  it('system inside Telegram follows Telegram\'s scheme', () => {
    expect(resolveScheme('system', env('dark'))).toBe('dark')
    expect(resolveScheme('system', env('light'))).toBe('light')
  })

  it("system inside Telegram ignores the OS preference: the client's scheme is the truth", () => {
    expect(resolveScheme('system', env('light', true))).toBe('light')
    expect(resolveScheme('system', env('dark', false))).toBe('dark')
  })

  it('system outside Telegram follows the OS preference', () => {
    expect(resolveScheme('system', env(null, true))).toBe('dark')
    expect(resolveScheme('system', env(null, false))).toBe('light')
  })

  it('an explicit choice is what is shown, whatever Telegram or the OS say', () => {
    for (const telegram of [null, 'light', 'dark'] as const) {
      for (const osDark of [false, true]) {
        expect(resolveScheme('light', env(telegram, osDark))).toBe('light')
        expect(resolveScheme('dark', env(telegram, osDark))).toBe('dark')
      }
    }
  })
})

describe('the Telegram environment', () => {
  it('is Telegram only with a real session: the stub in a plain browser (no initData) does not count, whatever scheme it reports', () => {
    expect(insideTelegram({ initData: 'query_id=1&user=%7B%7D&hash=x' })).toBe(true)
    expect(insideTelegram({ initData: '' })).toBe(false)
    expect(insideTelegram(null)).toBe(false)
    expect(readThemeEnv({ initData: '', colorScheme: 'dark' }, () => ({ matches: false })).telegramScheme).toBeNull()
    expect(readThemeEnv({ initData: 'x', colorScheme: 'dark' }, () => ({ matches: false })).telegramScheme).toBe('dark')
    expect(readThemeEnv({ initData: 'x', colorScheme: 'light' }, () => ({ matches: true })).telegramScheme).toBe('light')
  })

  it('reads the OS preference from prefers-color-scheme, and defaults to light when it cannot', () => {
    const asked: string[] = []
    expect(readThemeEnv(null, (q) => (asked.push(q), { matches: true })).prefersDark).toBe(true)
    expect(asked).toEqual(['(prefers-color-scheme: dark)'])
    expect(readThemeEnv(null, undefined).prefersDark).toBe(false)
  })
})

describe('the choice: cycling, parsing, precedence', () => {
  it('cycles system → light → dark → system', () => {
    expect(nextThemeChoice('system')).toBe('light')
    expect(nextThemeChoice('light')).toBe('dark')
    expect(nextThemeChoice('dark')).toBe('system')
  })

  it('accepts only the three values', () => {
    for (const ok of ['system', 'light', 'dark']) expect(parseThemeChoice(ok)).toBe(ok)
    for (const bad of ['auto', 'Dark', '', null, undefined, 1, {}]) expect(parseThemeChoice(bad)).toBeNull()
  })

  it('the synced setting wins; before it loads the local choice stands; otherwise system', () => {
    expect(effectiveChoice('dark', 'light')).toBe('dark')
    expect(effectiveChoice(null, 'light')).toBe('light')
    expect(effectiveChoice(null, null)).toBe('system')
    expect(effectiveChoice('system', 'dark')).toBe('system') // an explicit "system" on another device is a choice too
  })
})

describe('persistence', () => {
  const storage = () => {
    const data = new Map<string, string>()
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
  }

  it('stores and reads the choice in localStorage', () => {
    const s = storage()
    expect(readStoredChoice(s)).toBeNull()
    storeChoice('dark', s)
    expect(s.data.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(readStoredChoice(s)).toBe('dark')
  })

  it('ignores a corrupt stored value and survives blocked storage', () => {
    const s = storage()
    s.data.set(THEME_STORAGE_KEY, 'purple')
    expect(readStoredChoice(s)).toBeNull()
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(readStoredChoice(blocked)).toBeNull()
    expect(() => storeChoice('light', blocked)).not.toThrow()
    expect(readStoredChoice(null)).toBeNull()
    expect(() => storeChoice('light', null)).not.toThrow()
  })

  it('the choice is saved to user_settings as theme_preference, through a settings patch', () => {
    expect(themePatch('dark')).toEqual({ [THEME_SETTING_KEY]: 'dark' })
    expect(THEME_SETTING_KEY).toBe('theme_preference')
  })

  it('is read back from user_settings, with unknown keys untouched and a missing or bad value meaning "not set"', () => {
    expect(parseSettings({ theme_preference: 'light', learn_picks: ['a'] }).themeChoice).toBe('light')
    expect(parseSettings({ theme_preference: 'light', learn_picks: ['a'] }).raw).toMatchObject({ learn_picks: ['a'] })
    expect(parseSettings({}).themeChoice).toBeNull()
    expect(parseSettings({ theme_preference: 'neon' }).themeChoice).toBeNull()
    expect(parseSettings(null).themeChoice).toBeNull()
  })
})

describe('applyTheme', () => {
  const fakeRoot = (): ThemeRoot & { setProperty: ReturnType<typeof vi.fn> } => {
    const setProperty = vi.fn()
    // a style object with a trap: the app must never set a colour variable from Telegram
    const store: Record<string, unknown> = {}
    const style = new Proxy(store, { get: (t, k) => (k === 'setProperty' ? setProperty : t[k as string]), set: (t, k, v) => ((t[k as string] = v), true) })
    return { dataset: {}, style, setProperty } as never
  }
  const webApp = (extra: Record<string, unknown> = {}) => ({ initData: 'x', isVersionAtLeast: () => true, setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), ...extra })

  it('puts the scheme on the page and on the native colour-scheme', () => {
    const root = fakeRoot()
    applyTheme(root, 'dark', null)
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
    applyTheme(root, 'light', null)
    expect(root.dataset.theme).toBe('light')
    expect(root.style.colorScheme).toBe('light')
  })

  it("never takes colours from Telegram: no CSS variable is set, even with themeParams present", () => {
    const root = fakeRoot()
    applyTheme(root, 'dark', { ...webApp(), themeParams: { bg_color: '#212121', text_color: '#ffffff' } } as never, () => 'x')
    expect(root.setProperty).not.toHaveBeenCalled()
    expect(root.dataset.themeSource).toBeUndefined()
  })

  it("inside Telegram the client's header and background are set to the app's page colour for that scheme", () => {
    const root = fakeRoot()
    const w = webApp()
    applyTheme(root, 'dark', w, () => '#0e1618')
    expect(w.setHeaderColor).toHaveBeenLastCalledWith('#0e1618')
    expect(w.setBackgroundColor).toHaveBeenLastCalledWith('#0e1618')
    applyTheme(root, 'light', w, () => '#f6f4f0')
    expect(w.setHeaderColor).toHaveBeenLastCalledWith('#f6f4f0')
  })

  it('outside Telegram there is no Telegram to talk to', () => {
    const asked = vi.fn(() => '#f6f4f0')
    applyTheme(fakeRoot(), 'light', null, asked)
    expect(asked).not.toHaveBeenCalled()
  })

  it('does not touch the header in a client older than 6.1, for the stub without initData, or when the colour is unknown, and survives a throwing header call', () => {
    const old = webApp({ isVersionAtLeast: () => false })
    applyTheme(fakeRoot(), 'light', old, () => '#f6f4f0')
    expect(old.setHeaderColor).not.toHaveBeenCalled()

    const stub = webApp({ initData: '' })
    applyTheme(fakeRoot(), 'light', stub, () => '#f6f4f0')
    expect(stub.setHeaderColor).not.toHaveBeenCalled()

    const unknown = webApp()
    applyTheme(fakeRoot(), 'light', unknown, () => '')
    expect(unknown.setHeaderColor).not.toHaveBeenCalled()

    const throwing = webApp({ setHeaderColor: () => { throw new Error('boom') } })
    expect(() => applyTheme(fakeRoot(), 'light', throwing, () => '#f6f4f0')).not.toThrow()
  })
})

describe('the first-paint script in index.html agrees with resolveTheme', () => {
  const html = readFileSync('index.html', 'utf8')
  const script = /<!-- theme-bootstrap[^>]*-->\s*<script>([\s\S]*?)<\/script>/.exec(html)![1]

  function run(stored: string | null, telegram: { initData: string; colorScheme: string } | null, osDark: boolean): string | null {
    let attribute: string | null = null
    new Function('localStorage', 'window', 'document', script)(
      { getItem: () => stored },
      { Telegram: telegram ? { WebApp: telegram } : undefined, matchMedia: () => ({ matches: osDark }) },
      { documentElement: { setAttribute: (_n: string, v: string) => (attribute = v) } },
    )
    return attribute
  }

  it('picks the same scheme for every combination of choice, Telegram and OS', () => {
    for (const choice of [null, 'system', 'light', 'dark'] as const) {
      for (const tg of [null, { initData: '', colorScheme: 'dark' }, { initData: 'x', colorScheme: 'dark' }, { initData: 'x', colorScheme: 'light' }]) {
        for (const osDark of [false, true]) {
          const expected = resolveScheme((choice ?? 'system') as ThemeChoice, readThemeEnv(tg as never, () => ({ matches: osDark })))
          expect(run(choice, tg, osDark), `${choice} ${JSON.stringify(tg)} os-dark:${osDark}`).toBe(expected)
        }
      }
    }
  })

  it('survives blocked storage (it just falls back to Telegram / the OS)', () => {
    let attribute: string | null = null
    new Function('localStorage', 'window', 'document', script)(
      { getItem: () => { throw new Error('blocked') } },
      { matchMedia: () => ({ matches: true }) },
      { documentElement: { setAttribute: (_n: string, v: string) => (attribute = v) } },
    )
    expect(attribute).toBe('dark') // no stored choice readable: the OS preference decides
  })
})
