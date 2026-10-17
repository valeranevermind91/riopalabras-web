import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeUpdate } from '../testing/makeWord'
import { MAX_AGE_MS, createQueueStore, logStorageKeyFor, storageKeyFor, type StorageLike } from './queueStore'
import type { ReviewLogEntry } from './reviewLog'
import { WriteError, isDataError } from './writes'
import { LOG_CAP, createWriteQueue, type QueueSender } from './writeQueue'

// The review-log lane of the write queue: every row sent, in order, none replaced; kept on the device until the server has it; replayed after a
// restart; and a failure of it is invisible to everything else (no banner, no delay, no lost progress).

const T0 = Date.parse('2026-10-06T15:00:00Z')
const DAY = 86_400_000
let clock = T0
const now = () => clock
beforeEach(() => {
  clock = T0
})

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  const storage: StorageLike & { items: Map<string, string> } = { items, getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) }
  return storage
}

let n = 0
const entry = (over: Partial<ReviewLogEntry> = {}): ReviewLogEntry => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  esWord: 'casa',
  reviewedAt: new Date(clock).toISOString(),
  rating: 3,
  mode: 'review',
  stateBefore: 'review',
  elapsedDays: 3,
  scheduledDays: 8,
  intervalAfter: 8,
  easeAfter: 2.5,
  repetitionsAfter: 3,
  sessionId: 'session-1',
  durationMs: 1200,
  ...over,
})

/** A sender recording what it is asked, in order, that can be made to fail or hang per lane. */
function recorder(opts: { logFails?: () => unknown; hangLog?: boolean } = {}) {
  const calls: string[] = []
  const log: ReviewLogEntry[][] = []
  const progress: string[] = []
  const never = () => new Promise<void>(() => {})
  const sender: QueueSender = {
    sendProgress: async (u) => {
      calls.push('progress')
      progress.push(...u.map((x) => x.esWord))
    },
    sendSettings: async () => void calls.push('settings'),
    sendLog: async (entries) => {
      calls.push('log')
      log.push([...entries])
      if (opts.hangLog) return never()
      const failure = opts.logFails?.()
      if (failure) throw failure
    },
  }
  return { sender, calls, log, progress }
}

const options = (storage: StorageLike | null, userId = 'user-1') => ({ store: createQueueStore(userId, storage, now), now, retryDelaysMs: [1, 1, 1], logRetryDelaysMs: [1, 1], sleep: async () => {}, sendTimeoutMs: 2_000_000_000 })
const open = (storage: StorageLike | null, sender: QueueSender, userId = 'user-1') => createWriteQueue(sender, options(storage, userId))
const drained = (q: ReturnType<typeof createWriteQueue>) => vi.waitFor(() => expect(q.getStatus()).toMatchObject({ pendingLog: 0, sending: false }))
const settledLog = (q: ReturnType<typeof createWriteQueue>) => vi.waitFor(() => expect(q.getStatus().logGaveUp).toBe(true))

describe('every row is sent, in order, once', () => {
  it('rows are appended in the order they were made and reach the sender in that order', async () => {
    const r = recorder()
    const q = open(null, r.sender)
    const rows = [entry(), entry(), entry(), entry()]
    for (const row of rows) q.enqueueLog(row)
    await drained(q)
    expect(r.log.flat().map((e) => e.id)).toEqual(rows.map((e) => e.id))
  })

  it('a row is never replaced by another for the same word: two ratings of one word are two rows', async () => {
    const r = recorder()
    const q = open(null, r.sender)
    q.enqueueLog(entry({ esWord: 'casa', rating: 1 }))
    q.enqueueLog(entry({ esWord: 'casa', rating: 3 }))
    q.enqueueLog(entry({ esWord: 'CASA', rating: 4 })) // and casing does not merge them either
    await drained(q)
    expect(r.log.flat().map((e) => e.rating)).toEqual([1, 3, 4])
  })

  it('a row whose id is already waiting is not added again (the same row enqueued twice is one row)', async () => {
    const r = recorder({ hangLog: true })
    const q = open(null, r.sender)
    const row = entry()
    q.enqueueLog(row)
    q.enqueueLog({ ...row })
    expect(q.getStatus().pendingLog).toBe(1)
  })

  it('goes in requests of at most 100, and all 250 arrive, once each, in order', async () => {
    const r = recorder()
    const q = open(null, r.sender)
    const rows = Array.from({ length: 250 }, () => entry())
    for (const row of rows) q.enqueueLog(row) // (the first row starts the lane at once, so the first request is short: what matters is the limit)
    await drained(q)
    expect(Math.max(...r.log.map((chunk) => chunk.length))).toBe(100)
    expect(r.log.flat().map((e) => e.id)).toEqual(rows.map((e) => e.id))
  })

  it('goes after progress and settings: a rating is saved first, its log row after', async () => {
    const r = recorder()
    const q = open(null, r.sender)
    q.enqueueProgress(makeUpdate('casa'))
    q.enqueueLog(entry())
    q.enqueueSettings({ cards_done_today_count: 1 })
    await drained(q)
    await vi.waitFor(() => expect(r.calls).toEqual(['progress', 'settings', 'log']))
  })
})

describe('a queued row survives a restart and is replayed once', () => {
  it('rows queued and never sent come back after the app is killed, go out once, and are not there for the run after', async () => {
    const storage = memoryStorage()
    const killed = recorder({ hangLog: true })
    const first = open(storage, killed.sender)
    const rows = [entry(), entry(), entry()]
    for (const row of rows) first.enqueueLog(row)
    await vi.waitFor(() => expect(killed.log).toHaveLength(1)) // the request went out and never answered: the app dies here
    expect(storage.items.has(logStorageKeyFor('user-1'))).toBe(true)

    const second = recorder()
    const run2 = open(storage, second.sender)
    expect(run2.restore()).toMatchObject({ restored: 3, droppedStale: 0, droppedUnreadable: 0 })
    await drained(run2)
    expect(second.log.flat().map((e) => e.id)).toEqual(rows.map((e) => e.id)) // replayed once, in order
    expect(second.log).toHaveLength(1)
    expect(storage.items.has(logStorageKeyFor('user-1'))).toBe(false) // and gone from the disk once the server has them

    const third = recorder()
    const run3 = open(storage, third.sender)
    expect(run3.restore().restored).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(third.log).toEqual([]) // nothing replayed a second time
  })

  it('the rows keep their fields exactly (every column, the nulls too)', async () => {
    const storage = memoryStorage()
    const row = entry({ elapsedDays: null, sessionId: null, durationMs: null, mode: 'matching', stateBefore: 'learning', rating: 1 })
    open(storage, recorder({ hangLog: true }).sender).enqueueLog(row)
    const r = recorder()
    const q = open(storage, r.sender)
    q.restore()
    await drained(q)
    expect(r.log.flat()).toEqual([row])
  })

  it('is replayed in the order of the rows made in the new run too: rows from before come first', async () => {
    const storage = memoryStorage()
    const before = [entry(), entry()]
    const killed = open(storage, recorder({ hangLog: true }).sender)
    for (const row of before) killed.enqueueLog(row)
    const r = recorder()
    const q = open(storage, r.sender)
    const fresh = entry()
    q.restore()
    q.enqueueLog(fresh)
    await drained(q)
    expect(r.log.flat().map((e) => e.id)).toEqual([...before.map((e) => e.id), fresh.id])
  })

  it('has no age limit: a row from a month ago is still sent (the rest of the queue drops entries after 7 days)', async () => {
    const storage = memoryStorage()
    const killed = open(storage, recorder({ hangLog: true }).sender)
    killed.enqueueLog(entry())
    killed.enqueueProgress(makeUpdate('vieja'))
    clock = T0 + 30 * DAY
    expect(30 * DAY).toBeGreaterThan(MAX_AGE_MS)
    const r = recorder()
    const q = open(storage, r.sender)
    expect(q.restore()).toMatchObject({ droppedStale: 1 }) // the progress entry went stale, as it always did
    await drained(q)
    expect(r.log.flat()).toHaveLength(1) // the log row did not
  })

  it('is kept under its own key: the main key is not written for it, and a log too big to save does not stop progress being saved', async () => {
    const storage = memoryStorage()
    const quotaFull: StorageLike = { ...storage, setItem: (k, v) => (k === logStorageKeyFor('user-1') ? (() => { throw new Error('QuotaExceededError') })() : storage.setItem(k, v)) }
    const q = createWriteQueue(recorder({ hangLog: true }).sender, { ...options(quotaFull), retryDelaysMs: [1] })
    q.enqueueLog(entry())
    expect(storage.items.has(storageKeyFor('user-1'))).toBe(false) // a log row alone writes nothing to the main key
    q.enqueueProgress(makeUpdate('casa'))
    const saved = JSON.parse(storage.items.get(storageKeyFor('user-1'))!)
    expect(saved.progress).toHaveLength(1) // the rating is on disk although the log could not be
    expect(saved.log).toBeUndefined()
  })

  it('another account\'s log is never replayed, and unreadable rows are counted and left out', async () => {
    const storage = memoryStorage()
    open(storage, recorder({ hangLog: true }).sender, 'user-1').enqueueLog(entry())
    const r = recorder()
    const other = open(storage, r.sender, 'user-2')
    expect(other.restore().restored).toBe(0)

    const record = JSON.parse(storage.items.get(logStorageKeyFor('user-1'))!)
    record.entries.push({ id: 'x', esWord: 'a' }, 'garbage', { ...record.entries[0], id: 'y', rating: 9 }, { ...record.entries[0], id: 'z', mode: 'quiz' })
    storage.items.set(logStorageKeyFor('user-1'), JSON.stringify(record))
    const q = open(storage, recorder().sender)
    expect(q.restore()).toMatchObject({ restored: 1, droppedUnreadable: 4 })
  })
})

describe('a failed log write is invisible to everything else', () => {
  it('it never counts as unsaved, failed, stuck or rejected, and progress is saved as usual', async () => {
    const r = recorder({ logFails: () => new Error('the table cannot be reached') })
    const q = open(null, r.sender)
    q.enqueueLog(entry())
    q.enqueueProgress(makeUpdate('casa'))
    await settledLog(q)
    expect(r.progress).toEqual(['casa']) // the rating was saved
    expect(q.getStatus()).toMatchObject({ unsaved: false, failed: false, stuck: false, authRejected: false, pendingRatings: 0, pendingLog: 1, logGaveUp: true })
    expect(q.getStatus().logError).toContain('cannot be reached')
  })

  it('the row stays queued (and on disk), so nothing is lost; a later retry sends it', async () => {
    const storage = memoryStorage()
    let down = true
    const r = recorder({ logFails: () => (down ? new Error('offline') : null) })
    const q = open(storage, r.sender)
    const row = entry()
    q.enqueueLog(row)
    await settledLog(q)
    expect(storage.items.has(logStorageKeyFor('user-1'))).toBe(true)
    down = false
    expect(await q.retry()).toBe(true)
    await drained(q)
    expect(r.log.flat().filter((e) => e.id === row.id).length).toBeGreaterThanOrEqual(2) // the failed attempts, then the one that worked
    expect(q.getStatus()).toMatchObject({ pendingLog: 0, logError: null, logGaveUp: false })
  })

  it('a new row after the lane gave up starts a fresh round of attempts, with the old rows', async () => {
    let down = true
    const r = recorder({ logFails: () => (down ? new Error('offline') : null) })
    const q = open(null, r.sender)
    const first = entry()
    q.enqueueLog(first)
    await settledLog(q)
    down = false
    const second = entry()
    q.enqueueLog(second)
    await drained(q)
    const delivered = r.log.at(-1)!.map((e) => e.id)
    expect(delivered).toEqual([first.id, second.id])
  })

  it('enqueueing returns at once and never throws, whatever the sender does', () => {
    const q = open(null, { ...recorder().sender, sendLog: () => { throw new Error('sync boom') } })
    expect(() => q.enqueueLog(entry())).not.toThrow()
    const hanging = open(null, recorder({ hangLog: true }).sender)
    const started = performance.now()
    for (let i = 0; i < 200; i++) hanging.enqueueLog(entry())
    expect(performance.now() - started).toBeLessThan(1000) // 200 rows with the server not answering: no waiting
  })

  it('a refusal for who is asking (not signed in) is not shown: the lane waits for the next trigger, and the app carries on', async () => {
    const r = recorder({ logFails: () => new WriteError('review_log', "You're not signed in on this device", 401, 'NO_SESSION') })
    const q = open(null, r.sender)
    q.enqueueLog(entry())
    q.enqueueProgress(makeUpdate('casa'))
    await settledLog(q)
    expect(q.getStatus()).toMatchObject({ authRejected: false, failed: false, unsaved: false, pendingLog: 1 })
    expect(r.progress).toEqual(['casa'])
  })

  it('without a log sender (the lane is off) a row is simply not queued, and nothing else changes', () => {
    const { sendLog: _off, ...withoutLog } = recorder().sender
    const q = open(null, withoutLog)
    q.enqueueLog(entry())
    expect(q.getStatus().pendingLog).toBe(0)
  })
})

describe('a row the database refuses', () => {
  const refuse = (esWord: string) => (chunk: readonly ReviewLogEntry[]) => (chunk.some((e) => e.esWord === esWord) ? new WriteError('review_log', 'violates check constraint', 400, '23514') : null)

  function selective(code = '23514', refusing = (e: ReviewLogEntry) => e.esWord === 'bad') {
    const accepted: ReviewLogEntry[] = []
    const attempts: number[] = []
    const sender: QueueSender = {
      sendProgress: async () => {},
      sendSettings: async () => {},
      sendLog: async (chunk) => {
        attempts.push(chunk.length)
        if (chunk.some(refusing)) throw new WriteError('review_log', 'rule broken', 400, code)
        accepted.push(...chunk)
      },
    }
    return { sender, accepted, attempts }
  }

  it('one bad row among good ones is found, dropped and counted; the good ones are saved, and the lane carries on', async () => {
    const s = selective()
    const q = open(null, s.sender)
    const good = [entry({ esWord: 'a' }), entry({ esWord: 'b' })]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    q.enqueueLog(good[0])
    q.enqueueLog(entry({ esWord: 'bad' }))
    q.enqueueLog(good[1])
    await drained(q)
    expect(s.accepted.map((e) => e.id)).toEqual(good.map((e) => e.id))
    expect(q.getStatus()).toMatchObject({ pendingLog: 0, logDropped: 1, logError: null })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad'))
    // and the next row goes through as ever
    q.enqueueLog(entry({ esWord: 'c' }))
    await drained(q)
    expect(s.accepted).toHaveLength(3)
    warn.mockRestore()
  })

  it('a table that refuses EVERY row is not "a bad row": nothing is dropped, the rows wait (on disk) for the fix', async () => {
    const s = selective('23502', () => true)
    const storage = memoryStorage()
    const q = open(storage, s.sender)
    const rows = [entry(), entry(), entry()]
    for (const row of rows) q.enqueueLog(row)
    await settledLog(q)
    expect(q.getStatus()).toMatchObject({ pendingLog: 3, logDropped: 0, logGaveUp: true })
    expect(s.accepted).toEqual([])
    expect(JSON.parse(storage.items.get(logStorageKeyFor('user-1'))!).entries).toHaveLength(3)
  })

  it('a problem with the request as a whole (a missing column or table) is never taken for a bad row, even by a table that accepted rows before', async () => {
    for (const code of ['PGRST204', 'PGRST205', '42703', '42P01']) {
      let broken = false
      const sender: QueueSender = {
        sendProgress: async () => {},
        sendSettings: async () => {},
        sendLog: async () => {
          if (broken) throw new WriteError('review_log', 'schema', 400, code)
        },
      }
      const q = open(null, sender)
      q.enqueueLog(entry()) // the table accepts this one: from here on a refusal could be taken for a bad row, if the code allowed it
      await drained(q)
      broken = true
      for (let i = 0; i < 5; i++) q.enqueueLog(entry())
      await settledLog(q)
      expect(q.getStatus(), code).toMatchObject({ pendingLog: 5, logDropped: 0 })
    }
  })

  it('isDataError is about one row\'s own values (SQLSTATE 22xxx and 23xxx) and nothing else', () => {
    const error = (code: string | null, status: number | null = 400) => new WriteError('review_log', 'x', status, code)
    for (const code of ['22P02', '22003', '23502', '23505', '23514', '23503']) expect(isDataError(error(code)), code).toBe(true)
    for (const code of ['PGRST204', 'PGRST205', 'PGRST100', '42501', '42703', '42P01', '08006', '57014', null]) expect(isDataError(error(code)), String(code)).toBe(false)
    expect(isDataError(error('23514', 401))).toBe(false) // refused for who is asking: never a bad row
    expect(isDataError(error('23514', 403))).toBe(false)
    expect(isDataError(new Error('23514'))).toBe(false)
  })

  it('a bad row among rows the table accepted earlier is dropped even when it is alone in its request', async () => {
    const s = selective()
    const q = open(null, s.sender)
    q.enqueueLog(entry({ esWord: 'a' }))
    await drained(q)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    q.enqueueLog(entry({ esWord: 'bad' }))
    await drained(q)
    expect(q.getStatus()).toMatchObject({ pendingLog: 0, logDropped: 1 })
    warn.mockRestore()
  })

  it('the bad-row rule is judged by the database\'s code alone (refuse() helper sanity)', () => {
    expect(refuse('x')([entry({ esWord: 'x' })])).toBeInstanceOf(WriteError)
    expect(refuse('x')([entry({ esWord: 'y' })])).toBeNull()
  })
})

describe('the waiting log has a bound', () => {
  it('past the cap the OLDEST rows go (counted), and the newest are kept', () => {
    const q = createWriteQueue(recorder({ hangLog: true }).sender, { now, retryDelaysMs: [1], sleep: async () => {} })
    const rows = Array.from({ length: LOG_CAP + 3 }, () => entry())
    for (const row of rows) q.enqueueLog(row)
    expect(q.getStatus()).toMatchObject({ pendingLog: LOG_CAP, logEvicted: 3 })
  })
})
