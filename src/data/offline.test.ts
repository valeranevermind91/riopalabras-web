import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import { makeUpdate, makeWord } from '../testing/makeWord'
import { createQueueStore, type StorageLike } from './queueStore'
import { restoreAndFlush } from './startup'
import { showUnsavedNotice } from './useQueueStatus'
import { createWriteQueue, type WriteQueue } from './writeQueue'

/**
 * The write path with the network gone: nothing a user does waits on it. (The screens themselves are driven in a real
 * browser in src/lib/offline.browser.test.ts; here the queue, the session checks and the startup restore.)
 */
const NOW = Date.parse('2026-10-06T15:00:00Z')

function memoryStorage() {
  const items = new Map<string, string>()
  const storage: StorageLike & { items: Map<string, string> } = { items, getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) }
  return storage
}

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

async function signedInApp() {
  const { ensureSession } = await import('../lib/auth')
  const { createSupabaseWriteQueue } = await import('./writeQueue')
  const { createBatchFinisher, selectLearnBatch } = await import('./learn')
  const { createRater } = await import('./review')
  const { parseSettings } = await import('./settings')
  const { applyProgressUpdates, applySettingsPatch } = await import('./mutations')
  const client = server.client()
  const initData = initDataFor(5)
  const auth = await ensureSession(client, initData, 5)
  if (auth.status !== 'signed-in') throw new Error('sign-in failed')
  const storage = memoryStorage()
  let words = Array.from({ length: 40 }, (_, i) => makeWord(`palabra${i + 1}`, { rank: i + 1 })) as ReturnType<typeof applyProgressUpdates> extends infer W ? W : never
  let settings = parseSettings({ daily_new_word_limit: 10 })
  const queue = createSupabaseWriteQueue(client, auth.userId, () => settings, {
    store: createQueueStore(auth.userId, storage, () => NOW),
    now: () => NOW,
    retryDelaysMs: [1, 1, 1],
    metricsRetryDelaysMs: [1],
    sleep: async () => {},
    sendTimeoutMs: 1000,
    recoverSession: async () => {
      const r = await ensureSession(client, initData, 5, { force: true })
      if (r.status === 'error' && r.network) return 'unreachable'
      return r.status === 'signed-in'
    },
  })
  const deps = {
    applyProgress: (u: Parameters<typeof applyProgressUpdates>[1]) => void (words = applyProgressUpdates(words, u)),
    applySettings: (p: Parameters<typeof applySettingsPatch>[1]) => void (settings = applySettingsPatch(settings, p)),
    getSettings: () => settings,
  }
  const rate = createRater({ ...deps, queue })
  const learn = () => {
    const batch = selectLearnBatch(words, settings, new Date(NOW))
    return { batch, ticket: createBatchFinisher(batch, { ...deps, queue })() }
  }
  return { client, auth, queue, storage, rate, learn, words: () => words, settings: () => settings }
}

const noWriteWentOut = () => server.log.filter((l) => l.method !== 'GET' && l.url.startsWith('/rest/v1/'))
const failed = (q: WriteQueue) => vi.waitFor(() => expect(q.getStatus().failed).toBe(true), { timeout: 3000 })

describe('a full Learn batch and several ratings with the network refused', () => {
  it('the actions return at once, apply in memory and leave every write in the queue (and on disk)', async () => {
    const app = await signedInApp()
    server.break.networkDown = true // the network drops

    // Not a promise anywhere: these are plain calls, finished when they return.
    const { batch, ticket } = app.learn()
    const inBatch = new Set(batch.words.map((w) => w.esWord))
    const others = app.words().filter((w) => !inBatch.has(w.esWord)).slice(0, 4)
    for (const w of others) app.rate(w, 3)

    expect(app.words().filter((w) => w.repetitions > 0).length).toBe(14) // 10 learned + 4 reviewed, already in memory
    expect(app.settings().newWordsLearnedTodayCount).toBe(10)
    expect(ticket.saved()).toBe(false)
    expect(app.queue.getStatus()).toMatchObject({ pendingRatings: 14, pendingSettings: true, unsaved: true })
    expect(app.storage.items.size).toBe(1) // saved on the device as well
    expect(app.queue.pending().progress).toHaveLength(14)
  })

  it('the queue retries by itself, then reports offline through the unsaved-progress notice, not as a refusal, and sends everything when the network is back', async () => {
    const app = await signedInApp()
    server.break.networkDown = true
    const { ticket } = app.learn()
    app.rate(app.words()[39]!, 3)
    await failed(app.queue)

    const status = app.queue.getStatus()
    expect(status.authRejected).toBe(false) // "no network" is not "the sign-in was refused"
    expect(status.stuck).toBe(true) // the notice shows
    expect(noWriteWentOut()).toEqual([])

    server.break.networkDown = false
    expect(await app.queue.retry()).toBe(true)
    expect(ticket.saved()).toBe(true)
    expect(server.rows('user_progress').length).toBe(11)
    expect(server.rows('user_settings').length).toBe(1)
    expect(app.storage.items.size).toBe(0)
  })

  it('the same when the network drops mid-session: what was sent stays sent, the rest waits', async () => {
    const app = await signedInApp()
    app.rate(app.words()[38]!, 3)
    await vi.waitFor(() => expect(app.queue.getStatus().unsaved).toBe(false))
    expect(server.rows('user_progress').length).toBe(1)

    server.break.networkDown = true
    app.learn()
    app.rate(app.words()[39]!, 4)
    await failed(app.queue)
    expect(app.queue.getStatus().authRejected).toBe(false)
    expect(server.rows('user_progress').length).toBe(1)

    server.break.networkDown = false
    expect(await app.queue.retry()).toBe(true)
    expect(server.rows('user_progress').length).toBe(12)
  })
})

describe('a write is attempted whatever the browser says about the network', () => {
  // navigator.onLine is wrong on some devices (it said "offline" on an Android phone with a working network, and every save was refused before any request was made,
  // with no word of why). It is not consulted before a write; a request that cannot be made fails by itself, in milliseconds.
  it('with the browser claiming to be offline the write goes out, is saved, and no notice is raised', async () => {
    const app = await signedInApp()
    vi.stubGlobal('navigator', { onLine: false })
    server.log.length = 0
    app.learn()
    await vi.waitFor(() => expect(app.queue.getStatus().unsaved).toBe(false), { timeout: 3000 })
    expect(noWriteWentOut().length).toBeGreaterThan(0) // requests did leave the app
    expect(server.rows('user_progress').length).toBe(10)
    expect(app.queue.getStatus()).toMatchObject({ stuck: false, failed: false, error: null, lastSaveFailure: null })
    expect(showUnsavedNotice(app.queue.getStatus())).toBe(false)
  })

  it('with the network really down the write fails by itself and takes the usual road: retries, then the notice, a refusal it is not, and the writes stay queued', async () => {
    for (const claim of [true, false]) {
      const app = await signedInApp()
      vi.stubGlobal('navigator', { onLine: claim }) // whatever the browser claims
      server.break.networkDown = true
      app.learn()
      await failed(app.queue)
      const status = app.queue.getStatus()
      expect(status.authRejected).toBe(false)
      expect(status.stuck).toBe(true)
      expect(status.error).not.toBe('No connection') // no refusal made up on the browser's word: the request itself failed
      expect(status.lastSaveFailure).toMatchObject({ step: 'user_progress', status: null })
      expect(showUnsavedNotice(status)).toBe(true) // the notice still appears when writes really are failing
      expect(app.queue.pending().progress.length).toBe(10) // and nothing is lost

      server.break.networkDown = false
      expect(await app.queue.retry()).toBe(true)
      expect(server.rows('user_progress').length).toBeGreaterThan(0)
      server.rows('user_progress').length = 0
      vi.unstubAllGlobals()
      vi.stubGlobal('fetch', server.fetch)
    }
  })

  it('the browser\'s flag is consulted for nothing that sends a write: only to name a failed enrichment request and to skip a wait at app open', () => {
    const consults = readdirSync('src', { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.startsWith('testing'))
      .filter((f) => /\bisOffline\b|navigator\.onLine|\.onLine\b/.test(readFileSync(`src/${f}`, 'utf8')))
      .sort()
    expect(consults).toEqual(['data/enrich.ts', 'data/startup.ts', 'lib/online.ts'])
    expect(readFileSync('src/data/writeQueue.ts', 'utf8')).not.toMatch(/isOffline|onLine/)
  })

  it('a lost session while the auth server cannot be reached is "offline", not "the sign-in was refused"; it signs in again once it can', async () => {
    const app = await signedInApp()
    server.break.forgetSessions = true
    await app.client.auth.getUser() // supabase-js drops its session
    server.break.forgetSessions = false
    server.break.proxyUnreachable = true

    app.learn()
    await failed(app.queue)
    expect(app.queue.getStatus()).toMatchObject({ authRejected: false, error: 'The server cannot be reached' })
    expect(noWriteWentOut()).toEqual([]) // and nothing went out with the anon key

    server.break.proxyUnreachable = false
    expect(await app.queue.retry()).toBe(true)
    expect(server.rows('user_progress').length).toBe(10)
  })

  it('a refusal is still a refusal: the auth server answering "no" is shown as such', async () => {
    const app = await signedInApp()
    server.break.forgetSessions = true
    await app.client.auth.getUser()
    server.break.proxyDown = true // answers, with an error
    app.learn()
    await failed(app.queue)
    expect(app.queue.getStatus().authRejected).toBe(true)
  })
})

describe('opening the app offline with writes left from before', () => {
  it('does not wait for a network that is not there: the restored writes are queued and shown at once', async () => {
    const storage = memoryStorage()
    const dead = createWriteQueue({ sendProgress: () => new Promise(() => {}), sendSettings: async () => {} }, { store: createQueueStore('u1', storage, () => NOW), now: () => NOW, sendTimeoutMs: 2_000_000_000 })
    dead.enqueueProgress(makeUpdate('casa'))

    vi.stubGlobal('navigator', { onLine: false })
    const queue = createWriteQueue({ sendProgress: () => new Promise(() => {}), sendSettings: async () => {} }, { store: createQueueStore('u1', storage, () => NOW), now: () => NOW, sendTimeoutMs: 2_000_000_000 })
    const started = Date.now()
    const report = await restoreAndFlush(queue, { waitMs: 5000 })
    expect(Date.now() - started).toBeLessThan(500)
    expect(report.restored).toBe(1)
    expect(queue.pending().progress.map((u) => u.esWord)).toEqual(['casa'])
  })
})

describe('no screen waits on the queue', () => {
  const screens = readdirSync('src/screens').filter((f) => f.endsWith('.tsx'))
  it('no screen awaits the queue, a ticket, or the network', () => {
    for (const file of screens) {
      const text = readFileSync(`src/screens/${file}`, 'utf8')
      expect(text, file).not.toMatch(/await\s+[^\n]*\bqueue\b/)
      expect(text, file).not.toMatch(/await\s+[^\n]*\bticket\b/)
      expect(text, file).not.toMatch(/\.then\(/)
    }
  })

  it('Learn is done the moment the batch is queued; Review has no "Saving…" screen and nothing asks before leaving', () => {
    const learn = readFileSync('src/screens/Learn.tsx', 'utf8')
    const review = readFileSync('src/screens/Review.tsx', 'utf8')
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(learn).not.toMatch(/disabled=\{phase/)
    expect(learn).not.toMatch(/status\.(failed|unsaved|stuck)/)
    expect(review).not.toMatch(/status\.(failed|unsaved)/)
    expect(review).not.toMatch(/Saving/i)
    expect(review + app).not.toMatch(/LeaveGuard|confirmDialog/)
  })
})
