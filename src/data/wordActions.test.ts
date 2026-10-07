import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import { makeUpdate, makeWord } from '../testing/makeWord'
import { applyFavoriteFlag, applyHiddenFlag } from './mutations'
import { createQueueStore, storageKeyFor, type StorageLike } from './queueStore'
import { createWriteQueue, type QueueSender } from './writeQueue'

const NOW = Date.parse('2026-10-06T15:00:00Z')

function memoryStorage() {
  const items = new Map<string, string>()
  const storage: StorageLike & { items: Map<string, string> } = { items, getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) }
  return storage
}

describe('applyFavoriteFlag', () => {
  const words = [makeWord('casa'), makeWord('perro', { isFavorite: true })]
  it('sets and clears the flag by the one matching key (case and spaces ignored), leaving the rest alone', () => {
    const on = applyFavoriteFlag(words, [' CASA '], true)
    expect(on.map((w) => w.isFavorite)).toEqual([true, true])
    expect(applyFavoriteFlag(on, ['perro'], false).map((w) => w.isFavorite)).toEqual([true, false])
  })
  it('hands back the same list when nothing changes', () => {
    expect(applyFavoriteFlag(words, ['perro'], true)).toBe(words)
    expect(applyFavoriteFlag(words, ['nada'], true)).toBe(words)
    expect(applyFavoriteFlag(words, [], true)).toBe(words)
  })
  it('does not touch hiding, and hiding does not touch it (bringing a word back keeps its star and its progress)', () => {
    const word = makeWord('casa', { isFavorite: true, isHidden: true, repetitions: 3 })
    const back = applyHiddenFlag([word], ['casa'], false)[0]
    expect(back).toMatchObject({ isFavorite: true, isHidden: false, repetitions: 3 })
  })
})

describe('favourites and bring-back go through the write queue', () => {
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

  async function app() {
    const { ensureSession } = await import('../lib/auth')
    const { createSupabaseWriteQueue } = await import('./writeQueue')
    const client = server.client()
    const auth = await ensureSession(client, initDataFor(8), 8)
    if (auth.status !== 'signed-in') throw new Error('sign-in failed')
    const storage = memoryStorage()
    const queue = createSupabaseWriteQueue(client, auth.userId, () => null, { store: createQueueStore(auth.userId, storage, () => NOW), now: () => NOW, retryDelaysMs: [1, 1, 1], sleep: async () => {} })
    return { queue, storage, userId: auth.userId }
  }
  const idle = (q: { getStatus: () => { unsaved: boolean } }) => vi.waitFor(() => expect(q.getStatus().unsaved).toBe(false))
  const favourites = () => server.rows('user_favorites').map((r) => r.es_word)
  const hidden = () => server.rows('user_hidden_words').map((r) => r.es_word)

  it('a favourite is an upsert into user_favorites for this user, and un-favouriting deletes it', async () => {
    const a = await app()
    a.queue.enqueueFavorite('casa', true)
    await idle(a.queue)
    expect(server.rows('user_favorites')).toEqual([{ user_id: a.userId, es_word: 'casa' }])

    a.queue.enqueueFavorite('casa', false)
    await idle(a.queue)
    expect(favourites()).toEqual([])
  })

  it('the latest state per word wins: favourite then un-favourite before anything is sent leaves nothing on the server', async () => {
    const a = await app()
    server.break.networkDown = true // nothing can be sent yet
    a.queue.enqueueFavorite('casa', true)
    a.queue.enqueueFavorite('casa', false)
    a.queue.enqueueFavorite('perro', true)
    expect(a.queue.getStatus().pendingFavorites).toBe(2) // one entry per word
    expect(a.queue.pending().favorites).toEqual([{ esWord: 'casa', favorite: false }, { esWord: 'perro', favorite: true }])

    server.break.networkDown = false
    expect(await a.queue.retry()).toBe(true)
    expect(favourites()).toEqual(['perro'])
  })

  it('bringing a hidden word back deletes its row in user_hidden_words, through the existing hidden lane; hiding again adds it', async () => {
    const a = await app()
    a.queue.enqueueHidden('siete', true)
    a.queue.enqueueHidden('ocho', true)
    await idle(a.queue)
    expect(hidden().sort()).toEqual(['ocho', 'siete'])

    a.queue.enqueueHidden('siete', false) // "Bring back"
    await idle(a.queue)
    expect(hidden()).toEqual(['ocho'])

    a.queue.enqueueHidden('siete', true)
    await idle(a.queue)
    expect(hidden().sort()).toEqual(['ocho', 'siete'])
  })

  it('an offline favourite is held (and saved on the device) and goes out when the network is back, counted as unsaved meanwhile', async () => {
    const a = await app()
    server.break.networkDown = true
    a.queue.enqueueFavorite('casa', true)
    expect(a.queue.getStatus().unsaved).toBe(true)
    expect(a.storage.items.has(storageKeyFor(a.userId))).toBe(true)
    await vi.waitFor(() => expect(a.queue.getStatus().failed).toBe(true))
    expect(favourites()).toEqual([])

    server.break.networkDown = false
    expect(await a.queue.retry()).toBe(true)
    expect(favourites()).toEqual(['casa'])
    expect(a.storage.items.size).toBe(0)
  })

  it('survives the app being killed: a favourite left in storage is restored and sent by the next run', async () => {
    const a = await app()
    // The dead run: its requests never got an answer, and then the app was killed with these unsent.
    const dead = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {}, sendFavorites: () => new Promise(() => {}) }, { store: createQueueStore(a.userId, a.storage, () => NOW), now: () => NOW, sendTimeoutMs: 2_000_000_000 })
    dead.enqueueFavorite('casa', true)
    dead.enqueueFavorite('perro', false)
    expect(a.storage.items.has(storageKeyFor(a.userId))).toBe(true)

    const { createSupabaseWriteQueue } = await import('./writeQueue')
    const { ensureSession } = await import('../lib/auth')
    const client = server.client()
    const auth = await ensureSession(client, initDataFor(8), 8)
    if (auth.status !== 'signed-in') throw new Error('sign-in failed')
    const next = createSupabaseWriteQueue(client, auth.userId, () => null, { store: createQueueStore(auth.userId, a.storage, () => NOW), now: () => NOW, retryDelaysMs: [1, 1, 1], sleep: async () => {} })
    expect(next.restore().restored).toBe(2)
    await idle(next)
    expect(favourites()).toEqual(['casa'])
  })
})

describe('where favourites sit in the queue', () => {
  const recording = () => {
    const calls: string[] = []
    const sender: QueueSender = {
      sendProgress: async () => void calls.push('progress'),
      sendSettings: async () => void calls.push('settings'),
      sendHidden: async () => void calls.push('hidden'),
      sendFavorites: async () => void calls.push('favorites'),
      sendMetrics: async () => void calls.push('metrics'),
    }
    return { calls, sender }
  }

  it('after progress and hidden words, before settings, and metrics last', async () => {
    const { calls, sender } = recording()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let first = true
    // The first progress send waits at a gate, so everything below is queued before anything else is sent.
    const q = createWriteQueue({ ...sender, sendProgress: async () => { calls.push('progress'); if (first) { first = false; await gate } } }, { sleep: async () => {} })
    q.enqueueProgress(makeUpdate('gato'))
    q.enqueueSettings({ streak_count: 1 })
    q.enqueueFavorite('casa', true)
    q.enqueueHidden('perro', true)
    q.enqueueMetrics({ date: '2026-10-06', newWords: 0, reviewsDone: 1, reviewsLapsed: 0, dueAtStart: null, learnPool: null, dailyLimit: null, active: true })
    release()
    await vi.waitFor(() => expect(q.getStatus().pendingMetrics).toBe(0))
    expect(calls).toEqual(['progress', 'hidden', 'favorites', 'settings', 'metrics'])
  })

  it('without a favourites sender the queue ignores them, like hidden words (nothing is held that could never be sent)', () => {
    const q = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
    q.enqueueFavorite('casa', true)
    expect(q.getStatus().pendingFavorites).toBe(0)
    expect(q.getStatus().unsaved).toBe(false)
  })
})
