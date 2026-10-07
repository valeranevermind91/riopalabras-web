import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MetricsSection } from '../components/MetricsSection'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import { makeUpdate } from '../testing/makeWord'
import { emptyRow } from './metrics'
import { bindPersistOnHide } from './queueTriggers'
import { MAX_AGE_MS, createQueueStore, storageKeyFor, type StorageLike } from './queueStore'
import { mirrorPending, restoreAndFlush } from './startup'
import type { ProgressUpdate } from './types'
import { createWriteQueue, type QueueSender, type WriteQueue } from './writeQueue'

const T0 = Date.parse('2026-10-06T15:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  const storage: StorageLike & { items: Map<string, string> } = {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  }
  return storage
}

/** A sender that records what it was asked to send, in order, and can be made to hang (a request that never answers). */
function recordingSender(opts: { hang?: boolean } = {}) {
  const calls: string[] = []
  const progress: ProgressUpdate[][] = []
  const settings: Record<string, unknown>[] = []
  const hidden: { esWord: string; hidden: boolean }[][] = []
  const metrics: string[][] = []
  const never = () => new Promise<void>(() => {})
  const sender: QueueSender = {
    sendProgress: async (u) => {
      calls.push('progress')
      progress.push([...u])
      if (opts.hang) return never()
    },
    sendSettings: async (p) => {
      calls.push('settings')
      settings.push(p)
      if (opts.hang) return never()
    },
    sendHidden: async (o) => {
      calls.push('hidden')
      hidden.push([...o])
      if (opts.hang) return never()
    },
    sendMetrics: async (rows) => {
      calls.push('metrics')
      metrics.push(rows.map((r) => r.date))
      if (opts.hang) return never()
    },
  }
  return { sender, calls, progress, settings, hidden, metrics }
}

let clock = T0
const now = () => clock
beforeEach(() => {
  clock = T0
})

/** One run of the app: a queue over the shared storage. */
function open(storage: StorageLike | null, sender: QueueSender, userId = 'user-1') {
  return createWriteQueue(sender, { store: createQueueStore(userId, storage, now), now, retryDelaysMs: [1, 1, 1], sleep: async () => {}, sendTimeoutMs: 2_000_000_000 })
}
const row = (date: string) => ({ ...emptyRow(date), newWords: 3, active: true })

/** Writes queued in a run that is then "killed": nothing was sent (the request never answered), the app just disappears. */
function killedRun(storage: StorageLike, userId = 'user-1') {
  const run = open(storage, recordingSender({ hang: true }).sender, userId)
  run.enqueueProgress(makeUpdate('casa', { repetitions: 2 }))
  run.enqueueProgress(makeUpdate('perro'))
  run.enqueueSettings({ streak_count: 4, new_words_learned_today_count: 10 })
  run.enqueueHidden('gato', true)
  run.enqueueMetrics(row('2026-10-06'))
  return run
}

describe('the queue is saved as it changes', () => {
  it('on every enqueue, before anything is sent, and removed once everything has been accepted', async () => {
    const storage = memoryStorage()
    const queue = open(storage, { sendProgress: async () => {}, sendSettings: async () => {} })
    expect(storage.items.size).toBe(0)
    queue.enqueueProgress(makeUpdate('casa'))
    // saved synchronously with the enqueue, not after the send
    expect(storage.items.has(storageKeyFor('user-1'))).toBe(true)
    await vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))
    expect(storage.items.size).toBe(0)
  })

  it('keeps what is still unsent: a failed send leaves the entry on disk', async () => {
    const storage = memoryStorage()
    const queue = open(storage, {
      sendProgress: async () => {
        throw new Error('offline')
      },
      sendSettings: async () => {},
    })
    queue.enqueueProgress(makeUpdate('casa'))
    await vi.waitFor(() => expect(queue.getStatus().failed).toBe(true))
    const saved = JSON.parse(storage.items.get(storageKeyFor('user-1'))!)
    expect(saved.progress.map((e: { value: { esWord: string } }) => e.value.esWord)).toEqual(['casa'])
    expect(saved.progress[0].at).toBe(T0)
  })

  it('persistNow, and pagehide / visibilitychange to hidden, write the contents again (but a visible page does not)', () => {
    const calls: string[] = []
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
    const unbind = bindPersistOnHide({ persistNow: () => calls.push('saved') }, { window: win as never, document: doc as never })
    win.dispatchEvent(new Event('pagehide'))
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(calls).toEqual(['saved'])
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(calls).toEqual(['saved', 'saved'])
    unbind()
    win.dispatchEvent(new Event('pagehide'))
    expect(calls).toHaveLength(2)

    const storage = memoryStorage()
    const queue = open(storage, recordingSender({ hang: true }).sender)
    queue.enqueueProgress(makeUpdate('casa'))
    storage.items.clear() // something wiped it behind our back
    queue.persistNow()
    expect(storage.items.has(storageKeyFor('user-1'))).toBe(true)
  })

  it('the app saves on hide: it binds the hide triggers next to the other queue triggers', () => {
    expect(readFileSync('src/App.tsx', 'utf8')).toMatch(/bindPersistOnHide\(queue\)/)
  })
})

describe('after the app is killed', () => {
  it('writes queued in the dead run are sent on the next open, every lane, and the storage is emptied once they are accepted', async () => {
    const storage = memoryStorage()
    killedRun(storage) // the old run is gone: only the storage is left

    const next = recordingSender()
    const queue = open(storage, next.sender)
    const report = queue.restore()
    expect(report).toEqual({ restored: 6, droppedStale: 0, droppedUnreadable: 0 }) // 2 words, 2 settings keys, 1 hidden, 1 metrics row
    await vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))
    await vi.waitFor(() => expect(queue.getStatus().pendingMetrics).toBe(0))

    expect(next.progress.flat().map((u) => u.esWord).sort()).toEqual(['casa', 'perro'])
    expect(next.progress.flat().find((u) => u.esWord === 'casa')).toMatchObject({ repetitions: 2 })
    expect(next.progress.flat()[0].nextReview).toBeInstanceOf(Date) // dates come back as dates, not strings
    expect(next.settings).toEqual([{ streak_count: 4, new_words_learned_today_count: 10 }])
    expect(next.hidden).toEqual([[{ esWord: 'gato', hidden: true }]])
    expect(next.metrics).toEqual([['2026-10-06']])
    expect(storage.items.size).toBe(0)
  })

  it('a restored queue still sends progress, then hidden words, then settings, then metrics last', async () => {
    const storage = memoryStorage()
    killedRun(storage)
    const next = recordingSender()
    const queue = open(storage, next.sender)
    queue.restore()
    await vi.waitFor(() => expect(queue.getStatus().pendingMetrics).toBe(0))
    expect(next.calls).toEqual(['progress', 'hidden', 'settings', 'metrics'])
  })

  it('a restored queue still dedupes: a state queued in this run beats the stored one for the same word, and so does a newer one afterwards', async () => {
    const storage = memoryStorage()
    killedRun(storage) // casa: repetitions 2
    const next = recordingSender()
    const queue = open(storage, next.sender)
    queue.enqueueProgress(makeUpdate('casa', { repetitions: 5 })) // rated again before the restore got to run
    queue.restore()
    queue.enqueueProgress(makeUpdate('perro', { repetitions: 9 })) // and a newer one for a restored word
    await vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))

    const sent = next.progress.flat()
    expect(sent.filter((u) => u.esWord === 'casa')).toHaveLength(1)
    expect(sent.find((u) => u.esWord === 'casa')).toMatchObject({ repetitions: 5 })
    expect(sent.filter((u) => u.esWord === 'perro')).toHaveLength(1)
    expect(sent.find((u) => u.esWord === 'perro')).toMatchObject({ repetitions: 9 })
  })

  it('restoring twice does not queue anything twice', async () => {
    const storage = memoryStorage()
    killedRun(storage)
    const queue = open(storage, recordingSender({ hang: true }).sender)
    expect(queue.restore().restored).toBe(6)
    expect(queue.restore()).toEqual({ restored: 0, droppedStale: 0, droppedUnreadable: 0 })
    expect(queue.getStatus().pendingRatings).toBe(2)
  })

  it('what has not been sent yet is closing-confirmation material again: the restored entries count as unsaved', () => {
    const storage = memoryStorage()
    killedRun(storage)
    const queue = open(storage, recordingSender({ hang: true }).sender)
    queue.restore()
    expect(queue.getStatus().unsaved).toBe(true)
  })
})

describe("one account's queue is never another's", () => {
  it('a queue saved under another user id is ignored, and left alone', () => {
    const storage = memoryStorage()
    killedRun(storage, 'user-1')
    const other = recordingSender()
    const queue = open(storage, other.sender, 'user-2')
    expect(queue.restore()).toEqual({ restored: 0, droppedStale: 0, droppedUnreadable: 0 })
    expect(queue.getStatus().unsaved).toBe(false)
    expect(other.calls).toEqual([])
    expect(storage.items.has(storageKeyFor('user-1'))).toBe(true) // still waiting for its owner
  })

  it('even a record that sits under the right key but names another user is not used', () => {
    const storage = memoryStorage()
    killedRun(storage, 'user-1')
    const stolen = storage.items.get(storageKeyFor('user-1'))!
    storage.items.set(storageKeyFor('user-2'), stolen)
    const queue = open(storage, recordingSender().sender, 'user-2')
    expect(queue.restore().restored).toBe(0)
  })
})

describe('storage that fails changes nothing', () => {
  const throwing = (on: 'read' | 'write' | 'both'): StorageLike => ({
    getItem: () => {
      if (on !== 'write') throw new Error('SecurityError: storage is blocked')
      return null
    },
    setItem: () => {
      if (on !== 'read') throw new Error('QuotaExceededError')
    },
    removeItem: () => {
      if (on !== 'read') throw new Error('SecurityError')
    },
  })

  for (const on of ['read', 'write', 'both'] as const) {
    it(`throwing on ${on}: the queue works exactly as without storage`, async () => {
      const next = recordingSender()
      const queue = open(throwing(on), next.sender)
      expect(queue.restore()).toEqual({ restored: 0, droppedStale: 0, droppedUnreadable: 0 })
      queue.enqueueProgress(makeUpdate('casa'))
      queue.enqueueSettings({ streak_count: 1 })
      queue.persistNow()
      await vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))
      expect(next.calls).toEqual(['progress', 'settings'])
      expect(queue.getStatus().failed).toBe(false)
    })
  }

  it('no storage at all (null): same', async () => {
    const next = recordingSender()
    const queue = open(null, next.sender)
    expect(queue.restore().restored).toBe(0)
    queue.enqueueProgress(makeUpdate('casa'))
    await vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))
    expect(next.calls).toEqual(['progress'])
  })

  it('a damaged record is dropped and counted, not thrown', () => {
    const storage = memoryStorage({ [storageKeyFor('user-1')]: '{"v":1,"userId":"user-1","progress":[{"value":{"esWord":42},"at":1}' })
    const queue = open(storage, recordingSender().sender)
    expect(queue.restore()).toEqual({ restored: 0, droppedStale: 0, droppedUnreadable: 1 })

    const partly = memoryStorage()
    killedRun(partly)
    const saved = JSON.parse(partly.items.get(storageKeyFor('user-1'))!)
    saved.progress[0].value.easeFactor = 'banana'
    partly.items.set(storageKeyFor('user-1'), JSON.stringify(saved))
    const next = open(partly, recordingSender({ hang: true }).sender)
    expect(next.restore()).toMatchObject({ restored: 5, droppedUnreadable: 1 })
  })
})

describe('entries older than 7 days are not replayed', () => {
  it('are dropped on restore and counted, per entry; younger ones are kept', async () => {
    const storage = memoryStorage()
    clock = T0 - 8 * DAY
    const old = open(storage, recordingSender({ hang: true }).sender)
    old.enqueueProgress(makeUpdate('vieja'))
    old.enqueueSettings({ streak_count: 1 })
    old.enqueueHidden('viejo', true)
    old.enqueueMetrics(row('2026-09-28'))
    clock = T0 - 6 * DAY
    old.enqueueProgress(makeUpdate('reciente'))
    old.enqueueSettings({ theme_preference: 'dark' }) // a newer key next to an old one in the same patch

    clock = T0
    const next = recordingSender()
    const queue = open(storage, next.sender)
    const report = queue.restore()
    expect(report).toEqual({ restored: 2, droppedStale: 4, droppedUnreadable: 0 })
    expect(queue.getStatus()).toMatchObject({ restoredEntries: 2, droppedStale: 4, droppedUnreadable: 0 })
    await vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))
    expect(next.progress.flat().map((u) => u.esWord)).toEqual(['reciente'])
    expect(next.settings).toEqual([{ theme_preference: 'dark' }])
    expect(next.hidden).toEqual([])
    expect(next.metrics).toEqual([])
  })

  it('the limit is exactly 7 days', () => {
    const edge = (age: number) => {
      const storage = memoryStorage()
      clock = T0 - age
      open(storage, recordingSender({ hang: true }).sender).enqueueProgress(makeUpdate('casa'))
      clock = T0
      return open(storage, recordingSender({ hang: true }).sender).restore()
    }
    expect(edge(MAX_AGE_MS)).toMatchObject({ restored: 1, droppedStale: 0 })
    expect(edge(MAX_AGE_MS + 1)).toMatchObject({ restored: 0, droppedStale: 1 })
  })

  it('shows up in the Debug screen', () => {
    const storage = memoryStorage()
    clock = T0 - 9 * DAY
    open(storage, recordingSender({ hang: true }).sender).enqueueProgress(makeUpdate('vieja'))
    clock = T0
    const queue = open(storage, recordingSender({ hang: true }).sender)
    queue.restore()
    const html = renderToStaticMarkup(createElement(MetricsSection, { queue, metrics: null, client: null, userId: null }))
    expect(html).toContain('<dt>Restored on open</dt><dd>0</dd>')
    expect(html).toContain('<dt>Dropped (older than 7 days)</dt><dd>1</dd>')
    expect(html).toContain('<dt>Dropped (unreadable)</dt><dd>0</dd>')
  })
})

describe('mirroring writes that are still waiting into the loaded state', () => {
  it('applies progress, settings, hidden words and favourites, hides and un-hides (likes and un-likes) separately', () => {
    const calls: string[] = []
    mirrorPending(
      { progress: [makeUpdate('casa')], settings: { streak_count: 4 }, hidden: [{ esWord: 'a', hidden: true }, { esWord: 'b', hidden: false }, { esWord: 'c', hidden: true }], favorites: [{ esWord: 'x', favorite: true }, { esWord: 'y', favorite: false }] },
      {
        applyProgress: (u) => calls.push(`progress:${u.map((x) => x.esWord)}`),
        applySettings: (p) => calls.push(`settings:${JSON.stringify(p)}`),
        applyHidden: (w, hidden) => calls.push(`hidden:${w}:${hidden}`),
        applyFavorite: (w, favorite) => calls.push(`favorite:${w}:${favorite}`),
      },
    )
    expect(calls).toEqual(['progress:casa', 'settings:{"streak_count":4}', 'hidden:a,c:true', 'hidden:b:false', 'favorite:x:true', 'favorite:y:false'])
  })
  it('does nothing when nothing is waiting', () => {
    const calls: string[] = []
    mirrorPending({ progress: [], settings: null, hidden: [], favorites: [] }, { applyProgress: () => calls.push('p'), applySettings: () => calls.push('s'), applyHidden: () => calls.push('h'), applyFavorite: () => calls.push('f') })
    expect(calls).toEqual([])
  })
})

describe('the order on open: restore and send first, read the state after', () => {
  let server: ReturnType<typeof createFakeServer>
  beforeEach(() => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.test')
    vi.resetModules()
    server = createFakeServer({ now: () => T0 })
    vi.stubGlobal('fetch', server.fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  async function openApp(storage: StorageLike) {
    const { ensureSession } = await import('../lib/auth')
    const { createSupabaseWriteQueue } = await import('./writeQueue')
    const { loadOverlay } = await import('./overlay')
    const client = server.client()
    const initData = initDataFor(99)
    const auth = await ensureSession(client, initData, 99)
    if (auth.status !== 'signed-in') throw new Error('sign-in failed')
    const queue = createSupabaseWriteQueue(client, auth.userId, () => null, {
      store: createQueueStore(auth.userId, storage, now),
      now,
      retryDelaysMs: [1, 1, 1],
      sleep: async () => {},
      recoverSession: async () => (await ensureSession(client, initData, 99, { force: true })).status === 'signed-in',
    })
    return { client, auth, queue, loadOverlay: () => loadOverlay(client, auth.userId) }
  }
  const index = (method: string, path: string) => server.log.findIndex((l) => l.method === method && l.url === `/rest/v1/${path}`)
  const lastIndex = (method: string, path: string) => server.log.map((l) => `${l.method} ${l.url}`).lastIndexOf(`${method} /rest/v1/${path}`)

  it('the pending writes reach the server before the first read of the user\'s state, and the state read back already contains them', async () => {
    const storage = memoryStorage()
    // The user's earlier run: it had signed in and queued writes, then the webview was killed.
    const first = await openApp(storage)
    const userKey = storageKeyFor(first.auth.userId)
    const dead = createWriteQueue(recordingSender({ hang: true }).sender, { store: createQueueStore(first.auth.userId, storage, now), now, sendTimeoutMs: 2_000_000_000 })
    dead.enqueueProgress(makeUpdate('casa', { repetitions: 3 }))
    dead.enqueueSettings({ streak_count: 4, streak_last_activity_date: '2026-10-06' })
    expect(storage.items.has(userKey)).toBe(true)
    // The server already holds a settings blob with a key this client does not own.
    server.tables.set('user_settings', [{ user_id: first.auth.userId, settings: { learn_picks: ['x'], streak_count: 1, streak_last_activity_date: '2026-10-05' } }])
    server.log.length = 0

    // The next open, in the order App does it:
    const app = await openApp(storage)
    server.log.length = 0
    const report = await restoreAndFlush(app.queue)
    expect(report.restored).toBe(3)
    const overlay = (await app.loadOverlay()).overlay

    // Loading the state starts with user_words / user_progress; every restored write is on the server before that.
    // (The one settings read before the settings write is the restore itself reading the server's blob to merge into.)
    const lastWrite = Math.max(lastIndex('POST', 'user_progress'), lastIndex('POST', 'user_settings'))
    const firstRead = Math.min(index('GET', 'user_words'), index('GET', 'user_progress'))
    expect(lastWrite, JSON.stringify(server.log)).toBeGreaterThanOrEqual(0)
    expect(firstRead).toBeGreaterThan(lastWrite)
    expect(lastIndex('GET', 'user_settings')).toBeGreaterThan(lastIndex('POST', 'user_settings')) // the state's settings were read after the write
    expect(overlay.progress.map((p) => p.es_word)).toEqual(['casa'])
    expect(overlay.settings).toEqual({ learn_picks: ['x'], streak_count: 4, streak_last_activity_date: '2026-10-06' }) // the patch landed on the server's own blob, not on an empty one
    expect(storage.items.has(userKey)).toBe(false)
  })

  it('the auth check still applies: with no session and no way back, nothing restored goes out unauthenticated', async () => {
    const storage = memoryStorage()
    const first = await openApp(storage)
    createWriteQueue(recordingSender({ hang: true }).sender, { store: createQueueStore(first.auth.userId, storage, now), now, sendTimeoutMs: 2_000_000_000 }).enqueueProgress(makeUpdate('casa'))

    const app = await openApp(storage)
    server.break.forgetSessions = true
    await app.client.auth.getUser() // supabase-js drops the session
    server.break.proxyDown = true
    server.log.length = 0
    await restoreAndFlush(app.queue, { waitMs: 1000 })
    expect(app.queue.getStatus().authRejected).toBe(true)
    expect(server.log.filter((l) => l.method !== 'GET' && l.url.startsWith('/rest/v1/') && l.role !== 'authenticated')).toEqual([])
    expect(app.queue.pending().progress.map((u) => u.esWord)).toEqual(['casa']) // still queued, still saved on disk
    expect(storage.items.has(storageKeyFor(app.auth.userId))).toBe(true)
  })

  it('App holds the state load until the restore has been sent, and only for a signed-in user', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    const hook = readFileSync('src/data/useUserData.ts', 'utf8')
    expect(app).toMatch(/restoreAndFlush\(queue\)/)
    expect(app).toMatch(/const holdLoad = userId !== null && restoredFor !== userId/)
    expect(app).toMatch(/useUserData\(auth, client, holdLoad\)/)
    expect(hook).toMatch(/if \(authPending \|\| holdLoad\) return/)
    expect(app).toMatch(/mirrorPending\(queue\.pending\(\), readyData\)/)
  })

  it('a restore that cannot finish does not keep the app closed: it gives up waiting after waitMs', async () => {
    const storage = memoryStorage()
    killedRun(storage)
    const queue: WriteQueue = open(storage, recordingSender({ hang: true }).sender)
    const started = Date.now()
    const report = await restoreAndFlush(queue, { waitMs: 50 })
    expect(report.restored).toBe(6)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(queue.getStatus().unsaved).toBe(true) // still queued; mirrorPending will show it
  })
})
