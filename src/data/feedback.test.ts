import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import { fakeSupabase } from '../testing/fakeSupabase'
import {
  COUNT_FROM,
  FEEDBACK_TABLE,
  MAX_MESSAGE,
  buildReport,
  checkMessage,
  feedbackContext,
  insertFeedback,
  newFeedbackId,
  sendFeedback,
  showsCount,
  telegramPlatform,
  toFeedbackRow,
  type FeedbackContext,
  type FeedbackReport,
} from './feedback'

const context: FeedbackContext = { appVersion: '0ad8e01', uiLanguage: 'ru', screen: 'word', platform: 'android' }
const ID = '3f1c2b7e-0000-4000-8000-000000000001'
const wordReport = (over: Partial<FeedbackReport> = {}): FeedbackReport => {
  const built = buildReport({ id: ID, kind: 'word', esWord: 'chévere', text: 'The translation is wrong', context })
  if (!built.ok) throw new Error('fixture')
  return { ...built.report, ...over }
}

describe('the message', () => {
  it('is trimmed, and an empty one (or only spaces and line breaks) is refused', () => {
    expect(checkMessage('  hola \n')).toEqual({ ok: true, message: 'hola' })
    for (const empty of ['', '   ', '\n\t \n']) expect(checkMessage(empty)).toEqual({ ok: false, problem: 'empty' })
  })

  it('holds up to 2000 characters, counted after trimming, and not one more', () => {
    expect(MAX_MESSAGE).toBe(2000)
    expect(checkMessage('a'.repeat(2000)).ok).toBe(true)
    expect(checkMessage(` ${'a'.repeat(2000)} `).ok).toBe(true) // the spaces are not part of it
    expect(checkMessage('a'.repeat(2001))).toEqual({ ok: false, problem: 'too-long' })
  })

  it('the count is shown from nine tenths of the limit', () => {
    expect(COUNT_FROM).toBe(1800)
    expect([0, 1799].map(showsCount)).toEqual([false, false])
    expect([1800, 2000].map(showsCount)).toEqual([true, true])
  })
})

describe('what is collected', () => {
  it('the platform is the short name Telegram gives; anything else (a user agent, nothing) is "unknown"', () => {
    expect(telegramPlatform({ platform: 'android' })).toBe('android')
    expect(telegramPlatform({ platform: 'TDesktop' })).toBe('tdesktop')
    expect(telegramPlatform({ platform: 'macos' })).toBe('macos')
    expect(telegramPlatform({})).toBe('unknown')
    expect(telegramPlatform({ platform: '' })).toBe('unknown')
    expect(telegramPlatform({ platform: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36' })).toBe('unknown')
    expect(telegramPlatform({ platform: 'x'.repeat(40) })).toBe('unknown')
  })

  it('the build version, the interface language, the screen and the platform are all filled in', () => {
    vi.stubGlobal('window', { Telegram: { WebApp: { initData: 'x', initDataUnsafe: {}, platform: 'ios' } } })
    try {
      const c = feedbackContext('settings')
      expect(c.appVersion).toMatch(/\S/)
      expect(['en', 'ru']).toContain(c.uiLanguage)
      expect(c.screen).toBe('settings')
      expect(c.platform).toBe('ios')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a context can be named, for a screen that knows better', () => {
    expect(feedbackContext('word', { platform: 'weba', appVersion: 'abc' })).toMatchObject({ screen: 'word', platform: 'weba', appVersion: 'abc' })
  })

  it('ids are new each time', () => {
    const ids = new Set(Array.from({ length: 50 }, newFeedbackId))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('the report', () => {
  it('a word report carries the word', () => {
    const built = buildReport({ id: ID, kind: 'word', esWord: 'chévere', text: ' bad ', context })
    expect(built).toEqual({ ok: true, report: { ...context, id: ID, kind: 'word', esWord: 'chévere', message: 'bad' } })
  })

  it('a general message does not: whatever word the caller names, es_word stays empty', () => {
    const built = buildReport({ id: ID, kind: 'general', esWord: 'chévere', text: 'hello', context: { ...context, screen: 'settings' } })
    expect(built).toMatchObject({ ok: true, report: { kind: 'general', esWord: null } })
    if (built.ok) expect(toFeedbackRow('u1', built.report).es_word).toBeNull()
  })

  it('and the row itself never holds a word for a general message, even from a report built by hand', () => {
    expect(toFeedbackRow('user-1', wordReport({ kind: 'general', esWord: 'chévere' })).es_word).toBeNull()
  })

  it('an empty or over-long text makes no report', () => {
    expect(buildReport({ id: ID, kind: 'general', esWord: null, text: '  ', context })).toEqual({ ok: false, problem: 'empty' })
    expect(buildReport({ id: ID, kind: 'general', esWord: null, text: 'a'.repeat(2001), context })).toEqual({ ok: false, problem: 'too-long' })
  })

  it('the row is exactly the table\'s columns: the id, the user, the kind, the word, the text and the four context fields; no user agent, no time, no status', () => {
    const row = toFeedbackRow('user-1', wordReport())
    expect(row).toEqual({
      id: ID,
      user_id: 'user-1',
      kind: 'word',
      es_word: 'chévere',
      message: 'The translation is wrong',
      app_version: '0ad8e01',
      ui_language: 'ru',
      screen: 'word',
      platform: 'android',
    })
    expect(Object.keys(row).sort()).toEqual(['app_version', 'es_word', 'id', 'kind', 'message', 'platform', 'screen', 'ui_language', 'user_id'])
  })
})

describe('sending', () => {
  it('is one insert that skips a duplicate id (the table takes no update), into feedback', async () => {
    const fake = fakeSupabase('user-1')
    await insertFeedback(fake.client, 'user-1', wordReport())
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].table).toBe(FEEDBACK_TABLE)
    expect(fake.calls[0].rows).toEqual(toFeedbackRow('user-1', wordReport()))
    expect(fake.calls[0].options).toEqual({ onConflict: 'id', ignoreDuplicates: true })
  })

  it('a signed-out user (no client, or no user) gets "unavailable" and nothing breaks', async () => {
    expect(await sendFeedback(wordReport(), { client: null, userId: null })).toEqual({ ok: false, reason: 'unavailable' })
    expect(await sendFeedback(wordReport(), { client: fakeSupabase().client, userId: null })).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('a failed send is a result, not an error, and says it failed', async () => {
    const fake = fakeSupabase('user-1')
    fake.failures[FEEDBACK_TABLE] = 1
    expect(await sendFeedback(wordReport(), { client: fake.client, userId: 'user-1' })).toEqual({ ok: false, reason: 'failed' })
    expect(await sendFeedback(wordReport(), { client: fake.client, userId: 'user-1' })).toEqual({ ok: true }) // the next try goes
  })

  it('a try that takes too long counts as failed', async () => {
    const hang = { from: () => ({ upsert: () => new Promise(() => {}) }) } as never
    expect(await sendFeedback(wordReport(), { client: hang, userId: 'user-1', timeoutMs: 20 })).toEqual({ ok: false, reason: 'timeout' })
  })

  it('a refused session is recovered and the send is tried once more; with no way back it fails', async () => {
    const refused = { error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 }
    const results = [refused, { error: null, status: 201 }]
    const client = { from: () => ({ upsert: async () => results.shift() }) } as never
    const recoverSession = vi.fn(async () => true)
    expect(await sendFeedback(wordReport(), { client, userId: 'user-1', recoverSession })).toEqual({ ok: true })
    expect(recoverSession).toHaveBeenCalledTimes(1)

    const again = { from: () => ({ upsert: async () => refused }) } as never
    expect(await sendFeedback(wordReport(), { client: again, userId: 'user-1', recoverSession: async () => false })).toEqual({ ok: false, reason: 'failed' })
    expect(await sendFeedback(wordReport(), { client: again, userId: 'user-1' })).toEqual({ ok: false, reason: 'failed' })
  })
})

describe('through the real client and a table that takes inserts only', () => {
  let server: ReturnType<typeof createFakeServer>
  beforeEach(() => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.test')
    vi.resetModules()
    server = createFakeServer({ now: () => Date.parse('2026-10-18T12:00:00Z') })
    vi.stubGlobal('fetch', server.fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  async function signedIn() {
    const { ensureSession } = await import('../lib/auth')
    const client = server.client()
    const auth = await ensureSession(client, initDataFor(5), 5)
    if (auth.status !== 'signed-in') throw new Error('sign-in failed')
    return { client, userId: auth.userId }
  }

  it('a word report arrives as one row with every column', async () => {
    const { client, userId } = await signedIn()
    expect(await sendFeedback(wordReport(), { client, userId })).toEqual({ ok: true })
    expect(server.rows(FEEDBACK_TABLE)).toEqual([toFeedbackRow(userId, wordReport())])
  })

  it('sending the same report again (a retry after an answer was lost) leaves one row; a changed text with a new id is a second report', async () => {
    const { client, userId } = await signedIn()
    await sendFeedback(wordReport(), { client, userId })
    expect(await sendFeedback(wordReport(), { client, userId })).toEqual({ ok: true })
    expect(server.rows(FEEDBACK_TABLE)).toHaveLength(1)
    await sendFeedback(wordReport({ id: '3f1c2b7e-0000-4000-8000-000000000002', message: 'Edited' }), { client, userId })
    expect(server.rows(FEEDBACK_TABLE)).toHaveLength(2)
  })

  it('a table that is not there is a failed send, nothing more', async () => {
    const { client, userId } = await signedIn()
    server.break.missingTable = FEEDBACK_TABLE
    expect(await sendFeedback(wordReport(), { client, userId })).toEqual({ ok: false, reason: 'failed' })
  })

  it('a session the server refuses is a failed send too', async () => {
    const { client, userId } = await signedIn()
    server.break.forbidTable = FEEDBACK_TABLE
    expect(await sendFeedback(wordReport(), { client, userId })).toEqual({ ok: false, reason: 'failed' })
  })
})
