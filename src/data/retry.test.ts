import { describe, expect, it, vi } from 'vitest'
import { createLoadLog } from './loadLog'
import { DEFAULT_RETRY_DELAYS_MS, TableLoadError, classify, loadWithRetry, toTableLoadError } from './retry'

describe('classify', () => {
  it.each([
    [401, null, 'JWT expired', 'auth'],
    [200, 'PGRST301', 'x', 'auth'],
    [400, null, 'invalid token', 'auth'],
    [500, null, 'boom', 'transient'],
    [502, null, 'bad gateway', 'transient'],
    [503, 'PGRST002', 'schema cache', 'transient'],
    [404, 'PGRST205', "Could not find the table 'public.user_hidden_words' in the schema cache", 'transient'],
    [408, null, 'timeout', 'transient'],
    [429, null, 'rate limited', 'transient'],
    [0, null, 'TypeError: Failed to fetch', 'transient'],
    [0, null, 'TypeError: Load failed', 'transient'],
    [null, null, 'NetworkError when attempting to fetch resource.', 'transient'],
    [403, '42501', 'permission denied for table user_hidden_words', 'permanent'],
    [404, '42P01', 'relation does not exist', 'permanent'],
    [400, null, 'bad request', 'permanent'],
    [0, null, 'something odd', 'permanent'],
  ] as const)('HTTP %s code %s %j → %s', (status, code, message, kind) => {
    expect(classify(status, code, message)).toBe(kind)
  })
})

describe('TableLoadError', () => {
  it('keeps the table in the message (the text the user has always seen) and the details for the log', () => {
    const err = new TableLoadError('user_hidden_words', 'TypeError: Failed to fetch', 0, null)
    expect(err.message).toBe('user_hidden_words: TypeError: Failed to fetch')
    expect(err).toMatchObject({ table: 'user_hidden_words', kind: 'transient', status: 0, code: null, detail: 'TypeError: Failed to fetch' })
  })

  it('wraps plain errors, error-like objects and non-errors', () => {
    expect(toTableLoadError('t', new Error('Load failed')).kind).toBe('transient')
    expect(toTableLoadError('t', { message: 'JWT expired', code: 'PGRST301', status: 401 })).toMatchObject({ kind: 'auth', code: 'PGRST301', status: 401 })
    expect(toTableLoadError('t', 'weird').detail).toBe('weird')
    const original = new TableLoadError('t', 'x', 500, null)
    expect(toTableLoadError('other', original)).toBe(original)
  })
})

describe('loadWithRetry', () => {
  const run = (script: Array<() => unknown>, extra: Partial<Parameters<typeof loadWithRetry>[2]> = {}) => {
    const log = createLoadLog()
    const sleep = vi.fn(async (ms: number) => void ms)
    const load = vi.fn(async () => {
      const step = script.shift()
      if (!step) throw new Error('script exhausted')
      return step()
    })
    return { log, sleep, load, promise: loadWithRetry('user_hidden_words', load, { log, sleep, ...extra }) }
  }
  const fail = (status: number, message = 'boom', code = '') => () => {
    throw new TableLoadError('user_hidden_words', message, status, code || null)
  }

  it('returns at once on success and logs nothing', async () => {
    const r = run([() => 'rows'])
    await expect(r.promise).resolves.toBe('rows')
    expect(r.sleep).not.toHaveBeenCalled()
    expect(r.log.snapshot()).toEqual([])
  })

  it('retries a transient failure after 1s, then 3s, then 8s, and returns the first success', async () => {
    const r = run([fail(0, 'TypeError: Failed to fetch'), fail(503), fail(0, 'TypeError: Load failed'), () => 'rows'])
    await expect(r.promise).resolves.toBe('rows')
    expect(r.sleep.mock.calls.map((c) => c[0])).toEqual([1000, 3000, 8000])
    expect(r.load).toHaveBeenCalledTimes(4)
    expect(DEFAULT_RETRY_DELAYS_MS).toEqual([1000, 3000, 8000])
    const entries = r.log.snapshot()
    expect(entries.map((e) => e.outcome)).toEqual(['recovered', 'retrying', 'retrying', 'retrying']) // newest first
    expect(entries.at(-1)).toMatchObject({ table: 'user_hidden_words', attempt: 1, kind: 'transient', status: 0, message: 'TypeError: Failed to fetch' })
  })

  it('gives up after the last retry and throws the real error, logged as failed', async () => {
    const r = run([fail(500, 'a'), fail(500, 'b'), fail(500, 'c'), fail(500, 'the last one')])
    await expect(r.promise).rejects.toMatchObject({ message: 'user_hidden_words: the last one', status: 500 })
    expect(r.load).toHaveBeenCalledTimes(4)
    expect(r.sleep).toHaveBeenCalledTimes(3)
    expect(r.log.snapshot()[0]).toMatchObject({ outcome: 'failed', message: 'the last one', attempt: 4 })
  })

  it('does not retry a permanent error (a wrong policy or a missing table cannot fix itself)', async () => {
    const r = run([fail(403, 'permission denied for table user_hidden_words', '42501'), () => 'never'])
    await expect(r.promise).rejects.toMatchObject({ kind: 'permanent', code: '42501' })
    expect(r.load).toHaveBeenCalledTimes(1)
    expect(r.sleep).not.toHaveBeenCalled()
  })

  it('on an auth error refreshes the session once, then retries immediately (no backoff)', async () => {
    const refreshSession = vi.fn(async () => {})
    const r = run([fail(401, 'JWT expired', 'PGRST301'), () => 'rows'], { refreshSession })
    await expect(r.promise).resolves.toBe('rows')
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(r.sleep).not.toHaveBeenCalled()
    expect(r.log.snapshot().map((e) => e.outcome)).toEqual(['recovered', 'refreshing-session'])
  })

  it('refreshes only once: a second auth error is final', async () => {
    const refreshSession = vi.fn(async () => {})
    const r = run([fail(401, 'JWT expired'), fail(401, 'JWT expired'), () => 'never'], { refreshSession })
    await expect(r.promise).rejects.toMatchObject({ kind: 'auth' })
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(r.load).toHaveBeenCalledTimes(2)
  })

  it('fails with the original error if the session refresh itself fails', async () => {
    const refreshSession = vi.fn(async () => {
      throw new Error('refresh token not found')
    })
    const r = run([fail(401, 'JWT expired'), () => 'never'], { refreshSession })
    await expect(r.promise).rejects.toMatchObject({ message: 'user_hidden_words: JWT expired' })
    expect(r.log.snapshot()[0]).toMatchObject({ outcome: 'failed', message: expect.stringContaining('refresh token not found') })
  })

  it('without a refresh function an auth error is final', async () => {
    const r = run([fail(401, 'JWT expired'), () => 'never'])
    await expect(r.promise).rejects.toMatchObject({ kind: 'auth' })
    expect(r.load).toHaveBeenCalledTimes(1)
  })

  it('honours a custom list of delays, and an empty one means a single attempt', async () => {
    const r = run([fail(500), fail(500), () => 'rows'], { delaysMs: [5, 7] })
    await expect(r.promise).resolves.toBe('rows')
    expect(r.sleep.mock.calls.map((c) => c[0])).toEqual([5, 7])
    const single = run([fail(500), () => 'never'], { delaysMs: [] })
    await expect(single.promise).rejects.toBeInstanceOf(TableLoadError)
    expect(single.load).toHaveBeenCalledTimes(1)
  })
})
