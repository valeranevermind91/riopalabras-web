import { describe, expect, it, vi } from 'vitest'
import { fakeReadSupabase, httpError, networkError } from '../testing/fakeReadSupabase'
import { createLoadLog } from './loadLog'
import { TableLoadError } from './retry'
import { loadOverlay, recoverTables } from './overlay'

const ROWS = {
  user_words: [{ es_word: 'chévere' }],
  user_progress: [{ es_word: 'casa', ease_factor: 2.5, interval_days: 3, repetitions: 2, next_review: '2026-10-05T03:00:00Z' }],
  user_settings: [{ settings: { daily_new_word_limit: 7 } }],
  user_favorites: [{ es_word: 'casa' }],
  user_hidden_words: [{ es_word: 'perro' }],
}
const setup = () => {
  const fake = fakeReadSupabase(ROWS)
  const log = createLoadLog()
  const sleep = vi.fn(async (ms: number) => void ms)
  return { fake, log, sleep, load: () => loadOverlay(fake.client, 'u1', { log, sleep }) }
}

describe('loadOverlay', () => {
  it('loads all five tables in one go when nothing fails, with no retries logged', async () => {
    const { load, log, sleep } = setup()
    const { overlay, degraded } = await load()
    expect(degraded).toEqual([])
    expect(overlay.customWords).toHaveLength(1)
    expect(overlay.progress[0].es_word).toBe('casa')
    expect(overlay.settings).toEqual({ daily_new_word_limit: 7 })
    expect(overlay.favorites).toEqual(['casa'])
    expect(overlay.hidden).toEqual(['perro'])
    expect(log.snapshot()).toEqual([])
    expect(sleep).not.toHaveBeenCalled()
  })

  it('a transient failure of hidden words at launch is retried and the app loads normally (the case that showed an error)', async () => {
    const { load, fake, log, sleep } = setup()
    fake.script('user_hidden_words', networkError(), httpError(503, 'upstream timeout'))
    const { overlay, degraded } = await load()
    expect(degraded).toEqual([])
    expect(overlay.hidden).toEqual(['perro'])
    expect(fake.count('user_hidden_words')).toBe(4) // two failed attempts, the page, and the empty page that ends the read
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 3000])
    expect(log.snapshot().filter((e) => e.outcome === 'retrying').map((e) => [e.table, e.status, e.message])).toEqual([
      ['user_hidden_words', 503, 'upstream timeout'],
      ['user_hidden_words', 0, 'TypeError: Failed to fetch'],
    ])
  })

  it('degraded mode: hidden words still failing after the retries does not block; the rest loads and the table is reported', async () => {
    const { load, fake, log } = setup()
    fake.script('user_hidden_words', networkError(), networkError(), networkError(), networkError())
    const { overlay, degraded } = await load()
    expect(degraded).toEqual(['user_hidden_words'])
    expect(overlay.hidden).toEqual([])
    expect(overlay.favorites).toEqual(['casa']) // the other non-critical table is unaffected
    expect(overlay.progress).toHaveLength(1)
    expect(overlay.settings).toEqual({ daily_new_word_limit: 7 })
    expect(fake.count('user_hidden_words')).toBe(4)
    expect(log.snapshot()[0]).toMatchObject({ table: 'user_hidden_words', outcome: 'failed', status: 0, message: 'TypeError: Failed to fetch' })
  })

  it('favorites degrade the same way, and both can degrade at once', async () => {
    const { load, fake } = setup()
    for (const table of ['user_favorites', 'user_hidden_words']) fake.script(table, httpError(500), httpError(500), httpError(500), httpError(500))
    const { degraded, overlay } = await load()
    expect(degraded).toEqual(['user_favorites', 'user_hidden_words'])
    expect(overlay.customWords).toHaveLength(1)
  })

  it('a permanent failure of a non-critical table (a policy error) degrades at once, without retries', async () => {
    const { load, fake, sleep } = setup()
    fake.script('user_hidden_words', httpError(403, 'permission denied for table user_hidden_words', '42501'))
    const { degraded } = await load()
    expect(degraded).toEqual(['user_hidden_words'])
    expect(fake.count('user_hidden_words')).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it.each(['user_words', 'user_progress', 'user_settings'])('a critical table (%s) that still fails after the retries fails the load, with the table in the message', async (table) => {
    const { load, fake } = setup()
    fake.script(table, httpError(502, 'bad gateway'), httpError(502, 'bad gateway'), httpError(502, 'bad gateway'), httpError(502, 'still bad'))
    await expect(load()).rejects.toMatchObject({ message: `${table}: still bad`, table, status: 502 })
    await expect(load()).resolves.toBeDefined() // and the next load works again
  })

  it('a critical table that fails once is simply retried', async () => {
    const { load, fake } = setup()
    fake.script('user_progress', networkError())
    const { overlay } = await load()
    expect(overlay.progress).toHaveLength(1)
    expect(fake.count('user_progress')).toBe(3) // the failed attempt, the page, the empty page that ends the read
  })

  it('an auth error (401 / expired JWT) refreshes the session once and retries, even with several tables failing together', async () => {
    const { load, fake } = setup()
    for (const table of Object.keys(ROWS)) fake.script(table, httpError(401, 'JWT expired', 'PGRST301'))
    const { overlay, degraded } = await load()
    expect(degraded).toEqual([])
    expect(overlay.progress).toHaveLength(1)
    expect(fake.state.refreshCalls).toBe(1) // one refresh shared by all five tables
    for (const table of Object.keys(ROWS)) expect(fake.count(table)).toBe(table === 'user_settings' ? 2 : 3) // the failed attempt, then the retry (paged tables also end on an empty page)
  })

  it('if the session cannot be refreshed, a critical table fails with the original error and a non-critical one degrades', async () => {
    const { load, fake } = setup()
    fake.state.refreshError = { message: 'Invalid Refresh Token' }
    fake.script('user_hidden_words', httpError(401, 'JWT expired'))
    const { degraded } = await load()
    expect(degraded).toEqual(['user_hidden_words'])

    const second = setup()
    second.fake.state.refreshError = { message: 'Invalid Refresh Token' }
    second.fake.script('user_progress', httpError(401, 'JWT expired'))
    await expect(second.load()).rejects.toBeInstanceOf(TableLoadError)
  })

  it('reads every page of a big table (1000 rows per request)', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => ({ es_word: `w${i}` }))
    const fake = fakeReadSupabase({ ...ROWS, user_progress: [] })
    // two pages for user_words: 1000 then 500
    fake.script('user_words', { data: many.slice(0, 1000), error: null, status: 200 }, { data: many.slice(1000), error: null, status: 200 })
    const { overlay } = await loadOverlay(fake.client, 'u1', { log: createLoadLog(), sleep: async () => {} })
    expect(overlay.customWords).toHaveLength(1500)
    expect(fake.count('user_words')).toBe(3) // 1000, 500, and the empty page that ends the read
  })

  it('a server that returns at most 500 rows per request (a lower max-rows setting) still gets every row', async () => {
    const many = Array.from({ length: 1300 }, (_, i) => ({ es_word: `w${String(i).padStart(4, '0')}`, ease_factor: 2.5, interval_days: 1, repetitions: 1, next_review: null }))
    const fake = fakeReadSupabase({ ...ROWS, user_progress: many }, { maxRows: 500 })
    const { overlay } = await loadOverlay(fake.client, 'u1', { log: createLoadLog(), sleep: async () => {} })
    expect(overlay.progress).toHaveLength(1300)
    expect(new Set(overlay.progress.map((p) => p.es_word)).size).toBe(1300) // no row twice, none skipped
    expect(fake.count('user_progress')).toBe(4) // 500, 500, 300, and the empty page
  })

  it('stops on the first empty page even when a table has exactly one full page', async () => {
    const exactly = Array.from({ length: 1000 }, (_, i) => ({ es_word: `w${i}` }))
    const fake = fakeReadSupabase({ ...ROWS, user_words: exactly })
    const { overlay } = await loadOverlay(fake.client, 'u1', { log: createLoadLog(), sleep: async () => {} })
    expect(overlay.customWords).toHaveLength(1000)
    expect(fake.count('user_words')).toBe(2)
  })
})

describe('the time each star was set (created_at)', () => {
  const STARS = { ...ROWS, user_favorites: [{ es_word: 'Casa', created_at: '2026-10-01T10:00:00Z' }, { es_word: 'perro', created_at: 'not a date' }, { es_word: 'gato' }] }

  it('is read with the favourites, by lowercased key; a row with no usable time simply has none', async () => {
    const fake = fakeReadSupabase(STARS)
    const { overlay } = await loadOverlay(fake.client, 'u1', { log: createLoadLog(), sleep: async () => {} })
    expect(overlay.favorites).toEqual(['Casa', 'perro', 'gato'])
    expect(overlay.favoriteTimes).toEqual({ casa: Date.parse('2026-10-01T10:00:00Z') })
    expect(new Set(fake.selected.user_favorites)).toEqual(new Set(['es_word, created_at'])) // the time is asked for with the word
  })

  it('a database without the column (42703) still loads the favourites, in frequency order instead of oldest first', async () => {
    const fake = fakeReadSupabase(STARS)
    fake.script('user_favorites', httpError(400, 'column user_favorites.created_at does not exist', '42703'))
    const { overlay, degraded } = await loadOverlay(fake.client, 'u1', { log: createLoadLog(), sleep: async () => {} })
    expect(degraded).toEqual([])
    expect(overlay.favorites).toHaveLength(3)
    expect(overlay.favoriteTimes).toEqual({}) // no times, so Learn falls back to frequency order for the stars
    expect(fake.selected.user_favorites.slice(0, 2)).toEqual(['es_word, created_at', 'es_word']) // asked with the time first, then without
  })

  it('comes back from a background retry too', async () => {
    const fake = fakeReadSupabase(STARS)
    const result = await recoverTables(fake.client, 'u1', ['user_favorites'], { log: createLoadLog() })
    expect(result.favoriteTimes).toEqual({ casa: Date.parse('2026-10-01T10:00:00Z') })
  })
})

describe('recoverTables (one background attempt)', () => {
  it('returns the lists that loaded now and the tables that still fail', async () => {
    const fake = fakeReadSupabase(ROWS)
    fake.script('user_hidden_words', networkError())
    const result = await recoverTables(fake.client, 'u1', ['user_favorites', 'user_hidden_words'], { log: createLoadLog() })
    expect(result).toEqual({ favorites: ['casa'], favoriteTimes: {}, failed: ['user_hidden_words'] })
    expect(fake.count('user_hidden_words')).toBe(1) // a single attempt: the caller spaces attempts out

    const again = await recoverTables(fake.client, 'u1', ['user_hidden_words'], { log: createLoadLog() })
    expect(again).toEqual({ hidden: ['perro'], failed: [] })
  })

  it('also refreshes the session once on an auth error', async () => {
    const fake = fakeReadSupabase(ROWS)
    fake.script('user_hidden_words', httpError(401, 'JWT expired'))
    const result = await recoverTables(fake.client, 'u1', ['user_hidden_words'], { log: createLoadLog() })
    expect(result.hidden).toEqual(['perro'])
    expect(fake.state.refreshCalls).toBe(1)
  })
})
