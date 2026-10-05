import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parseSettings } from '../data/settings'
import {
  PALETTE_BG,
  THEME_SETTING_KEY,
  THEME_STORAGE_KEY,
  applyTheme,
  effectiveChoice,
  insideTelegram,
  nextThemeChoice,
  parseThemeChoice,
  readStoredChoice,
  readThemeEnv,
  resolveTheme,
  storeChoice,
  telegramThemeVars,
  themePatch,
  type Scheme,
  type ThemeChoice,
  type ThemeEnv,
  type ThemeRoot,
} from './theme'

const env = (telegramScheme: Scheme | null, prefersDark = false): ThemeEnv => ({ telegramScheme, prefersDark })

describe('resolveTheme', () => {
  it('system inside Telegram follows Telegram, with Telegram as the colour source', () => {
    expect(resolveTheme('system', env('dark'))).toEqual({ scheme: 'dark', source: 'telegram' })
    expect(resolveTheme('system', env('light'))).toEqual({ scheme: 'light', source: 'telegram' })
  })

  it("system inside Telegram ignores the OS preference: the client's scheme is the truth", () => {
    expect(resolveTheme('system', env('light', true))).toEqual({ scheme: 'light', source: 'telegram' })
    expect(resolveTheme('system', env('dark', false))).toEqual({ scheme: 'dark', source: 'telegram' })
  })

  it("system outside Telegram follows the OS preference, with the app's own palette", () => {
    expect(resolveTheme('system', env(null, true))).toEqual({ scheme: 'dark', source: 'palette' })
    expect(resolveTheme('system', env(null, false))).toEqual({ scheme: 'light', source: 'palette' })
  })

  it("an explicit choice outside Telegram is the app's palette in that scheme, whatever the OS says", () => {
    expect(resolveTheme('light', env(null, true))).toEqual({ scheme: 'light', source: 'palette' })
    expect(resolveTheme('dark', env(null, false))).toEqual({ scheme: 'dark', source: 'palette' })
  })

  it("an explicit choice inside Telegram uses Telegram's colours when it matches the client, the app's palette when it does not", () => {
    expect(resolveTheme('dark', env('dark'))).toEqual({ scheme: 'dark', source: 'telegram' })
    expect(resolveTheme('light', env('light'))).toEqual({ scheme: 'light', source: 'telegram' })
    expect(resolveTheme('light', env('dark'))).toEqual({ scheme: 'light', source: 'palette' }) // light in a dark client: Telegram's dark colours would be wrong
    expect(resolveTheme('dark', env('light'))).toEqual({ scheme: 'dark', source: 'palette' })
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
  function fakeRoot() {
    const vars = new Map<string, string>()
    const root: ThemeRoot = {
      dataset: {},
      style: { setProperty: (n, v) => void vars.set(n, v), removeProperty: (n) => vars.delete(n) },
    }
    return { root, vars }
  }
  const params = { bg_color: '#212121', text_color: '#ffffff', hint_color: '#aaaaaa', secondary_bg_color: '#181818', accent_text_color: undefined }
  const webApp = (extra: Record<string, unknown> = {}) => ({ initData: 'x', themeParams: params, isVersionAtLeast: () => true, setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), ...extra })

  it('turns themeParams into --tg-* variables, skipping empty ones', () => {
    expect(telegramThemeVars(params)).toEqual([
      ['--tg-bg-color', '#212121'],
      ['--tg-text-color', '#ffffff'],
      ['--tg-hint-color', '#aaaaaa'],
      ['--tg-secondary-bg-color', '#181818'],
    ])
  })

  it("with Telegram as the source: sets the scheme, Telegram's colours, and lets the client keep its own header", () => {
    const { root, vars } = fakeRoot()
    const w = webApp()
    applyTheme(root, { scheme: 'dark', source: 'telegram' }, w)
    expect(root.dataset).toMatchObject({ theme: 'dark', themeSource: 'telegram' })
    expect(root.style.colorScheme).toBe('dark')
    expect(vars.get('--tg-bg-color')).toBe('#212121')
    expect(w.setHeaderColor).toHaveBeenCalledWith('bg_color')
    expect(w.setBackgroundColor).toHaveBeenCalledWith('bg_color')
  })

  it("with the palette as the source: no Telegram colours (earlier ones are removed), and Telegram's header follows the app's page colour", () => {
    const { root, vars } = fakeRoot()
    const w = webApp()
    applyTheme(root, { scheme: 'dark', source: 'telegram' }, w) // first Telegram's dark colours…
    expect(vars.size).toBe(4)
    applyTheme(root, { scheme: 'light', source: 'palette' }, w) // …then the user forces light
    expect(vars.size).toBe(0)
    expect(root.dataset).toMatchObject({ theme: 'light', themeSource: 'palette' })
    expect(w.setHeaderColor).toHaveBeenLastCalledWith(PALETTE_BG.light)
    expect(w.setBackgroundColor).toHaveBeenLastCalledWith(PALETTE_BG.light)
  })

  it('outside Telegram there is no Telegram at all to talk to', () => {
    const { root, vars } = fakeRoot()
    applyTheme(root, { scheme: 'light', source: 'palette' }, null)
    expect(root.dataset).toMatchObject({ theme: 'light', themeSource: 'palette' })
    expect(vars.size).toBe(0)
  })

  it('does not touch the header in a client older than 6.1, and survives a header call that throws', () => {
    const { root } = fakeRoot()
    const old = webApp({ isVersionAtLeast: () => false })
    applyTheme(root, { scheme: 'light', source: 'palette' }, old)
    expect(old.setHeaderColor).not.toHaveBeenCalled()
    const throwing = webApp({ setHeaderColor: () => { throw new Error('boom') } })
    expect(() => applyTheme(root, { scheme: 'light', source: 'palette' }, throwing)).not.toThrow()
  })

  it('does nothing to the header for the stub Telegram object in a plain browser (no initData)', () => {
    const { root } = fakeRoot()
    const stub = webApp({ initData: '' })
    applyTheme(root, { scheme: 'light', source: 'palette' }, stub)
    expect(stub.setHeaderColor).not.toHaveBeenCalled()
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
          const expected = resolveTheme((choice ?? 'system') as ThemeChoice, readThemeEnv(tg as never, () => ({ matches: osDark }))).scheme
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
