import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import { makeUpdate, makeWord } from '../testing/makeWord'
import type { AuthResult } from '../lib/auth'
import type { UserSettings } from './types'
import type { WriteQueue } from './writeQueue'

/**
 * A brand-new user's very first session, from the proxy's signup-path sign-in to the rows on the server, with the
 * REAL supabase-js client talking to a fake that behaves like the live database where it matters: it refuses
 * writes made without a user's session (row-level security) and answers reads made without one with an empty list.
 * Nothing here stubs the queue, the writers or the client.
 */
const TELEGRAM_ID = 424242
const TODAY = new Date('2026-10-06T15:47:00Z')

let server: ReturnType<typeof createFakeServer>

beforeEach(() => {
  vi.stubEnv('VITE_PROXY_URL', 'https://proxy.test')
  vi.resetModules()
  server = createFakeServer({ now: () => TODAY.getTime() })
  vi.stubGlobal('fetch', server.fetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** What App does on launch for this user, in the same order, with the app's own modules. */
async function launch() {
  const { ensureSession } = await import('../lib/auth')
  const { verifiedTelegramId } = await import('../lib/debugGate')
  const { loadOverlay } = await import('./overlay')
  const { parseSettings } = await import('./settings')
  const { mergeWords } = await import('./words')
  const { createSupabaseWriteQueue } = await import('./writeQueue')
  const { createMetricsRecorder, createLocalMetricsStore } = await import('./metrics')
  const { selectLearnBatch, createBatchFinisher } = await import('./learn')
  const { applyProgressUpdates, applySettingsPatch } = await import('./mutations')

  const client: SupabaseClient = server.client()
  const initData = initDataFor(TELEGRAM_ID)
  const auth: AuthResult = await ensureSession(client, initData, TELEGRAM_ID)
  if (auth.status !== 'signed-in') throw new Error(`sign-in failed: ${JSON.stringify(auth)}`)
  void verifiedTelegramId(client) // the Debug gate asks the auth server who this is, for every user, right after sign-in

  const { overlay } = await loadOverlay(client, auth.userId)
  let words = mergeWords(Array.from({ length: 40 }, (_, i) => makeWord(`palabra${i + 1}`, { rank: i + 1 })), overlay).words
  let settings: UserSettings = parseSettings(overlay.settings)
  const getSettings = () => settings
  const queue: WriteQueue = createSupabaseWriteQueue(client, auth.userId, getSettings, {
    retryDelaysMs: [5, 5, 5],
    metricsRetryDelaysMs: [5, 5],
    sendTimeoutMs: 200,
    recoverSession: async () => (await ensureSession(client, initData, TELEGRAM_ID, { force: true })).status === 'signed-in',
  })
  const metrics = createMetricsRecorder({ store: createLocalMetricsStore(auth.userId), enqueue: queue.enqueueMetrics, getSettings })

  const finishBatch = () => {
    const batch = selectLearnBatch(words, settings, TODAY)
    const ticket = createBatchFinisher(batch, {
      queue,
      getSettings,
      applyProgress: (u) => void (words = applyProgressUpdates(words, u) as never),
      applySettings: (p) => void (settings = applySettingsPatch(settings, p)),
      onFinished: () => metrics.markActiveToday(TODAY),
    })()
    return { ticket, batch }
  }
  /** A few Review ratings on words that are not in the batch. */
  const rateSome = (batch: { words: readonly { esWord: string }[] }, count = 2) => {
    const inBatch = new Set(batch.words.map((w) => w.esWord))
    for (const w of words.filter((w) => !inBatch.has(w.esWord)).slice(0, count)) queue.enqueueProgress(makeUpdate(w.esWord))
  }
  return { client, auth, queue, finishBatch, rateSome, userId: auth.userId }
}

const anonWrites = () => server.log.filter((l) => l.method !== 'GET' && l.url.startsWith('/rest/v1/') && l.role !== 'authenticated')
const settled = async (queue: WriteQueue) => {
  await vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false), { timeout: 3000 })
}

describe('a brand-new user, first ever session (the proxy signs them up)', () => {
  it('control: with a usable session a full batch and a few ratings reach the server', async () => {
    const app = await launch()
    const { ticket, batch } = app.finishBatch()
    app.rateSome(batch)
    await settled(app.queue)
    expect(ticket.saved()).toBe(true)
    expect(server.rows('user_progress').length).toBe(12)
    expect(server.rows('user_settings').length).toBe(1)
    expect(anonWrites()).toEqual([])
  })

  it('the auth server does not recognise the new session: nothing is ever sent unauthenticated, the client signs in again and everything arrives', async () => {
    const app = await launch()
    server.break.forgetSessions = true // from its first look at the session, the auth server calls it unknown
    await app.client.auth.getUser() // …which makes supabase-js drop the session it holds
    server.break.forgetSessions = false
    expect((await app.client.auth.getSession()).data.session).toBeNull() // the UI still says "signed in"; the client has nothing

    const { ticket, batch } = app.finishBatch()
    app.rateSome(batch)
    await settled(app.queue)

    expect(anonWrites(), 'a write went out with the anon key').toEqual([])
    expect(ticket.saved()).toBe(true)
    expect(server.rows('user_progress').length).toBe(12)
    expect(server.rows('user_settings').length).toBe(1)
  })

  it('the client cannot get a session back: the rejection is shown at once, not after retries, and nothing goes out unauthenticated', async () => {
    const app = await launch()
    server.break.forgetSessions = true
    await app.client.auth.getUser()
    server.break.proxyDown = true

    const { ticket } = app.finishBatch()
    await vi.waitFor(() => expect(app.queue.getStatus().failed).toBe(true), { timeout: 3000 })
    const status = app.queue.getStatus()
    expect(status.authRejected).toBe(true)
    expect(status.error ?? '').toMatch(/sign/i)
    expect(ticket.saved()).toBe(false)
    expect(anonWrites()).toEqual([])

    // The proxy comes back: Retry (or reopening the app) saves it all.
    server.break.proxyDown = false
    server.break.forgetSessions = false
    expect(await app.queue.retry()).toBe(true)
    expect(ticket.saved()).toBe(true)
    expect(server.rows('user_progress').length).toBe(10)
  })

  it('a write refused by policy while signed in is surfaced at once as a rejection, not retried quietly', async () => {
    const app = await launch()
    server.break.forbidWrites = true
    app.finishBatch()
    await vi.waitFor(() => expect(app.queue.getStatus().failed).toBe(true), { timeout: 3000 })
    const status = app.queue.getStatus()
    expect(status.authRejected).toBe(true)
    expect(server.log.filter((l) => l.url === '/rest/v1/user_progress' && l.method === 'POST').length).toBeLessThanOrEqual(2) // no 3-step backoff burning through the same refusal
  })

  it('a write that never gets an answer is a failure too, not an endless "saving"', async () => {
    const app = await launch()
    server.break.hangWrites = true
    const { ticket } = app.finishBatch()
    await vi.waitFor(() => expect(app.queue.getStatus().failed).toBe(true), { timeout: 4000 })
    expect(ticket.saved()).toBe(false)
    expect(app.queue.getStatus().error ?? '').toMatch(/no answer|timed out/i)
  })

  it('daily metrics refused for authentication are not swallowed silently either', async () => {
    const app = await launch()
    server.break.forbidTable = 'user_daily_metrics'
    app.finishBatch()
    await settled(app.queue)
    await vi.waitFor(() => expect(app.queue.getStatus().authRejected).toBe(true), { timeout: 3000 })
  })
})
