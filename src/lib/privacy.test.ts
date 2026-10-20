import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserLanguage, getLanguage, readStoredLanguage, setLanguage } from './language'
import { PRIVACY_UPDATED, formatPolicyDate, startingLanguage, withLanguage } from './privacy'

afterEach(() => {
  setLanguage('en')
  vi.unstubAllGlobals()
})

describe('the language a page opens in when there is no Telegram to ask', () => {
  it('the browser\'s FIRST preference decides: Russian for anything starting with ru, else English', () => {
    expect(browserLanguage(['ru-RU', 'en'])).toBe('ru')
    expect(browserLanguage(['ru'])).toBe('ru')
    expect(browserLanguage(['en-US', 'ru'])).toBe('en') // asked for English first
    expect(browserLanguage(['es-UY'])).toBe('en')
    expect(browserLanguage(['uk'])).toBe('en')
    expect(browserLanguage([])).toBe('en')
    expect(browserLanguage(undefined)).toBe('en')
  })

  it('the address wins, then what this device last used, then the browser', () => {
    const base = { search: '', stored: null, languages: ['en-US'] }
    expect(startingLanguage(base)).toBe('en')
    expect(startingLanguage({ ...base, languages: ['ru-RU'] })).toBe('ru')
    expect(startingLanguage({ ...base, stored: 'ru' })).toBe('ru') // the device's own choice beats the browser's
    expect(startingLanguage({ ...base, stored: 'en', languages: ['ru-RU'] })).toBe('en')
    expect(startingLanguage({ ...base, search: '?lang=ru', stored: 'en' })).toBe('ru') // the app's link carries its language
    expect(startingLanguage({ ...base, search: '?lang=en', languages: ['ru-RU'], stored: 'ru' })).toBe('en')
  })

  it('an address that asks for a language nobody has is ignored, not obeyed', () => {
    for (const search of ['?lang=es', '?lang=', '?lang=RU', '?x=1', '?lang=ru%00', '?lang[]=ru']) expect(startingLanguage({ search, stored: null, languages: ['en'] }), search).toBe('en')
  })

  it('setting a language without remembering it leaves what the device starts in alone (the privacy page only shows a language)', () => {
    const items = new Map<string, string>()
    const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) }
    vi.stubGlobal('localStorage', storage)
    setLanguage('ru', { remember: false })
    expect(getLanguage()).toBe('ru')
    expect(items.size).toBe(0)
    expect(readStoredLanguage()).toBeNull()
    setLanguage('en')
    setLanguage('ru') // the app's own switch still remembers
    expect(items.get('riopalabras.language.v1')).toBe('ru')
    expect(readStoredLanguage()).toBe('ru')
  })
})

describe('the address of the page in a language', () => {
  it('sets ?lang= and keeps the rest', () => {
    expect(withLanguage('https://x.test/privacy', 'ru')).toBe('https://x.test/privacy?lang=ru')
    expect(withLanguage('https://x.test/privacy?lang=ru', 'en')).toBe('https://x.test/privacy?lang=en')
    expect(withLanguage('https://x.test/privacy?a=1&lang=en#top', 'ru')).toBe('https://x.test/privacy?a=1&lang=ru#top')
  })
})

describe('the last-updated date', () => {
  it('is a calendar date, written the way each language writes it, and no time zone moves it', () => {
    expect(PRIVACY_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(formatPolicyDate('2026-10-19', 'en')).toBe('19 October 2026')
    expect(formatPolicyDate('2026-10-19', 'ru')).toBe('19 октября 2026 г.')
    expect(formatPolicyDate('2026-01-01', 'en')).toBe('1 January 2026')
    expect(formatPolicyDate('2026-12-31', 'ru')).toBe('31 декабря 2026 г.')
  })

  it('is left as written when it is not a date', () => {
    expect(formatPolicyDate('soon', 'en')).toBe('soon')
  })
})
