import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import { applySettingsPatch } from './mutations'
import { MAX_DAILY_LIMIT, MIN_DAILY_LIMIT, SESSIONS_NOTE_FROM, clampDailyLimit, dailyLimitPatch, isLastLanguage, isValidLanguages, languagesPatch, setLanguage, stepDailyLimit } from './settingsActions'
import { parseSettings } from './settings'
import type { SettingsPatch, UserSettings } from './types'

describe('the daily goal range (as in the Flutter app: 0 to 20)', () => {
  it('clamps to 0 and 20', () => {
    expect([MIN_DAILY_LIMIT, MAX_DAILY_LIMIT, SESSIONS_NOTE_FROM]).toEqual([0, 20, 16])
    expect([-5, 0, 7, 20, 21, 99].map(clampDailyLimit)).toEqual([0, 0, 7, 20, 20, 20])
  })

  it('a step is one up or down, and nothing at the end of the range', () => {
    expect(dailyLimitPatch(10, 1)).toEqual({ daily_new_word_limit: 11 })
    expect(dailyLimitPatch(10, -1)).toEqual({ daily_new_word_limit: 9 })
    expect(dailyLimitPatch(20, 1)).toBeNull()
    expect(dailyLimitPatch(0, -1)).toBeNull()
    expect(dailyLimitPatch(19, 1)).toEqual({ daily_new_word_limit: 20 })
    expect(dailyLimitPatch(1, -1)).toEqual({ daily_new_word_limit: 0 })
  })

  it('a stored value outside the range (written elsewhere) is brought back by "−" and cannot be raised', () => {
    expect(dailyLimitPatch(25, -1)).toEqual({ daily_new_word_limit: 20 })
    expect(dailyLimitPatch(25, 1)).toBeNull()
    expect(dailyLimitPatch(-3, 1)).toEqual({ daily_new_word_limit: 0 })
  })
})

describe('the translation languages: two switches, one must stay on', () => {
  const s = (ru: boolean, en: boolean) => parseSettings({ show_ru_translation: ru, show_en_translation: en })

  it('the only invalid state is both off', () => {
    expect([isValidLanguages(true, true), isValidLanguages(true, false), isValidLanguages(false, true), isValidLanguages(false, false)]).toEqual([true, true, true, false])
  })

  it('turning off the last language is refused (null); anything else writes both keys together', () => {
    expect(languagesPatch(s(true, false), { ru: false })).toBeNull()
    expect(languagesPatch(s(false, true), { en: false })).toBeNull()
    expect(languagesPatch(s(true, true), { ru: false })).toEqual({ show_ru_translation: false, show_en_translation: true })
    expect(languagesPatch(s(true, false), { en: true })).toEqual({ show_ru_translation: true, show_en_translation: true })
    expect(languagesPatch(s(false, true), { ru: true })).toEqual({ show_ru_translation: true, show_en_translation: true })
  })

  it('knows which switch is the last one on (the one that is disabled)', () => {
    expect([isLastLanguage(s(true, false), 'ru'), isLastLanguage(s(true, false), 'en')]).toEqual([true, false])
    expect([isLastLanguage(s(false, true), 'ru'), isLastLanguage(s(false, true), 'en')]).toEqual([false, true])
    expect([isLastLanguage(s(true, true), 'ru'), isLastLanguage(s(true, true), 'en')]).toEqual([false, false])
  })

  it('the defaults are Russian on, English off, as before: so Russian is the last one on, until English is turned on', () => {
    const defaults = parseSettings(null)
    expect([defaults.showRuTranslation, defaults.showEnTranslation]).toEqual([true, false])
    expect(isLastLanguage(defaults, 'ru')).toBe(true)
  })
})

describe('what the controls write: the same keys, through the settings lane, kept in the stored blob', () => {
  const NOW = Date.parse('2026-10-07T12:00:00Z')
  let server: ReturnType<typeof createFakeServer>
  beforeEach(() => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.test')
    vi.resetModules()
    server = createFakeServer({ now: () => NOW })
    vi.stubGlobal('fetch', server.fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  /** A signed-in user whose stored blob is `blob`, with the in-memory settings the screen reads. */
  async function user(blob: Record<string, unknown>) {
    const { ensureSession } = await import('../lib/auth')
    const { createSupabaseWriteQueue } = await import('./writeQueue')
    const client = server.client()
    const auth = await ensureSession(client, initDataFor(11), 11)
    if (auth.status !== 'signed-in') throw new Error('sign-in failed')
    server.tables.set('user_settings', [{ user_id: auth.userId, settings: blob, updated_at: new Date(NOW - 3600_000).toISOString() }])
    let settings: UserSettings = parseSettings(blob)
    const queue = createSupabaseWriteQueue(client, auth.userId, () => settings, { retryDelaysMs: [1, 1, 1], sleep: async () => {}, store: undefined })
    const deps = { getSettings: () => settings, applySettings: (p: SettingsPatch) => void (settings = applySettingsPatch(settings, p)), queue }
    const stored = () => server.rows('user_settings')[0].settings as Record<string, unknown>
    const idle = () => vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))
    return { deps, stored, idle, current: () => settings, queue }
  }

  it('a user who had a daily goal of 10 still has 10 until they change it', async () => {
    const u = await user({ daily_new_word_limit: 10, learn_picks: ['x'] })
    expect(u.current().dailyNewWordLimit).toBe(10)
    expect(u.stored().daily_new_word_limit).toBe(10)
    expect(u.queue.getStatus().unsaved).toBe(false) // opening the screen writes nothing
  })

  it('the stepper writes daily_new_word_limit to the stored settings, one step at a time, keeping every other key', async () => {
    const u = await user({ daily_new_word_limit: 10, learn_picks: ['x'], theme_preference: 'dark', streak_count: 4 })
    expect(stepDailyLimit(1, u.deps)).toBe(true)
    await u.idle()
    expect(u.stored()).toEqual({ daily_new_word_limit: 11, learn_picks: ['x'], theme_preference: 'dark', streak_count: 4 })
    expect(stepDailyLimit(-1, u.deps)).toBe(true)
    expect(stepDailyLimit(-1, u.deps)).toBe(true)
    await u.idle()
    expect(u.stored().daily_new_word_limit).toBe(9)
  })

  it('two quick taps both count (each step starts from the latest value)', async () => {
    const u = await user({ daily_new_word_limit: 10 })
    stepDailyLimit(1, u.deps)
    stepDailyLimit(1, u.deps)
    await u.idle()
    expect(u.stored().daily_new_word_limit).toBe(12)
  })

  it('clamps at 20: the stored value stops there and the extra tap writes nothing', async () => {
    const u = await user({ daily_new_word_limit: 18 })
    expect([stepDailyLimit(1, u.deps), stepDailyLimit(1, u.deps), stepDailyLimit(1, u.deps), stepDailyLimit(1, u.deps)]).toEqual([true, true, false, false])
    await u.idle()
    expect(u.stored().daily_new_word_limit).toBe(20)
    expect(u.current().dailyNewWordLimit).toBe(20)
  })

  it('clamps at 0: the stored value stops there too', async () => {
    const u = await user({ daily_new_word_limit: 1 })
    expect([stepDailyLimit(-1, u.deps), stepDailyLimit(-1, u.deps)]).toEqual([true, false])
    await u.idle()
    expect(u.stored().daily_new_word_limit).toBe(0)
  })

  it('the language switches write show_ru_translation and show_en_translation together, and the last one on cannot go off', async () => {
    const u = await user({ show_ru_translation: true, show_en_translation: false, daily_new_word_limit: 10 })
    expect(setLanguage('ru', false, u.deps)).toBe(false) // Russian is the only one on: refused
    expect(u.queue.getStatus().unsaved).toBe(false)
    expect(setLanguage('en', true, u.deps)).toBe(true) // both on
    await u.idle()
    expect(u.stored()).toMatchObject({ show_ru_translation: true, show_en_translation: true, daily_new_word_limit: 10 })

    expect(setLanguage('ru', false, u.deps)).toBe(true) // English stays
    await u.idle()
    expect(u.stored()).toMatchObject({ show_ru_translation: false, show_en_translation: true })
    expect(setLanguage('en', false, u.deps)).toBe(false) // now English is the last one
    expect(u.stored()).toMatchObject({ show_ru_translation: false, show_en_translation: true }) // untouched
  })

  it('the settings blob has no key for the controls that are not touched: nothing else is added', async () => {
    const u = await user({ daily_new_word_limit: 10 })
    stepDailyLimit(1, u.deps)
    await u.idle()
    expect(Object.keys(u.stored()).sort()).toEqual(['daily_new_word_limit'])
  })
})
