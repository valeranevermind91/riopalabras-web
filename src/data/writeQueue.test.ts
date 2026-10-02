import { describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '../testing/fakeSupabase'
import { makeUpdate } from '../testing/makeWord'
import { parseSettings } from './settings'
import type { ProgressUpdate, SettingsPatch } from './types'
import { createSupabaseWriteQueue, createWriteQueue, type WriteQueue } from './writeQueue'

/** A sender whose requests can be held open, failed on demand, and inspected. */
function harness(options: Parameters<typeof createWriteQueue>[1] = {}) {
  const progressCalls: ProgressUpdate[][] = []
  const settingsCalls: SettingsPatch[] = []
  const order: string[] = []
  const failures = { progress: 0, settings: 0 }
  let gate: Promise<void> | null = null
  let inFlight = 0
  let maxInFlight = 0

  async function request(kind: 'progress' | 'settings', record: () => void) {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      record()
      if (gate) await gate
      await Promise.resolve()
      if (failures[kind] > 0) {
        failures[kind]--
        throw new Error(`${kind} failed`)
      }
    } finally {
      inFlight--
    }
  }

  const delays: number[] = []
  const queue = createWriteQueue(
    {
      sendProgress: (updates) =>
        request('progress', () => {
          progressCalls.push([...updates])
          order.push(`progress:${updates.map((u) => u.esWord).join(',')}`)
        }),
      sendSettings: (patch) =>
        request('settings', () => {
          settingsCalls.push(patch)
          order.push('settings')
        }),
    },
    {
      retryDelaysMs: [10, 20, 30],
      sleep: (ms) => {
        delays.push(ms)
        return Promise.resolve()
      },
      ...options,
    },
  )

  return {
    queue,
    progressCalls,
    settingsCalls,
    order,
    failures,
    delays,
    maxInFlight: () => maxInFlight,
    hold() {
      let release!: () => void
      gate = new Promise<void>((resolve) => (release = resolve))
      return () => {
        gate = null
        release()
      }
    },
  }
}

const idle = (queue: WriteQueue) => vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))
const failed = (queue: WriteQueue) => vi.waitFor(() => expect(queue.getStatus().failed).toBe(true))
const sentWords = (calls: ProgressUpdate[][]) => calls.flat().map((u) => u.esWord)

describe('ordering', () => {
  it('sends serially, in enqueue order, with settings after the progress it belongs to', async () => {
    const h = harness()
    h.queue.enqueueProgress(makeUpdate('uno'))
    h.queue.enqueueProgress(makeUpdate('dos'))
    h.queue.enqueueProgress(makeUpdate('tres'))
    h.queue.enqueueSettings({ streak_count: 4 })
    await idle(h.queue)

    expect(sentWords(h.progressCalls)).toEqual(['uno', 'dos', 'tres'])
    expect(h.order.filter((o) => o === 'settings')).toHaveLength(1)
    expect(h.order.at(-1)).toBe('settings') // after every progress request, even ones queued while the first was in flight
    expect(h.maxInFlight()).toBe(1)
  })
})

describe('per-word dedupe', () => {
  it('keeps only the latest unsent state for a word', async () => {
    const h = harness()
    const release = h.hold()
    h.queue.enqueueProgress(makeUpdate('x')) // in flight, held open
    h.queue.enqueueProgress(makeUpdate('w', { repetitions: 1 }))
    h.queue.enqueueProgress(makeUpdate('w', { repetitions: 2 }))
    h.queue.enqueueProgress(makeUpdate('w', { repetitions: 3 }))
    expect(h.queue.getStatus().pendingRatings).toBe(2) // x (in flight) + w
    release()
    await idle(h.queue)

    expect(sentWords(h.progressCalls)).toEqual(['x', 'w'])
    expect(h.progressCalls[1][0].repetitions).toBe(3)
  })

  it('matches words case-insensitively but sends the original casing', async () => {
    const h = harness()
    const release = h.hold()
    h.queue.enqueueProgress(makeUpdate('x'))
    h.queue.enqueueProgress(makeUpdate('Hacienda', { repetitions: 1 }))
    h.queue.enqueueProgress(makeUpdate('hacienda', { repetitions: 2 }))
    release()
    await idle(h.queue)
    expect(h.progressCalls[1]).toHaveLength(1)
    expect(h.progressCalls[1][0]).toMatchObject({ esWord: 'hacienda', repetitions: 2 })
  })

  it('a newer state that arrives while an older one is in flight is not lost', async () => {
    const h = harness()
    const release = h.hold()
    h.queue.enqueueProgress(makeUpdate('w', { repetitions: 1 })) // sending, held open
    h.queue.enqueueProgress(makeUpdate('w', { repetitions: 2 })) // arrives mid-flight
    release()
    await idle(h.queue)
    expect(h.progressCalls.map((c) => c[0].repetitions)).toEqual([1, 2])
  })

  it('merges settings patches into one write', async () => {
    const h = harness()
    const release = h.hold()
    h.queue.enqueueProgress(makeUpdate('x'))
    h.queue.enqueueSettings({ streak_count: 4 })
    h.queue.enqueueSettings({ streak_last_activity_date: '2026-10-02' })
    release()
    await idle(h.queue)
    expect(h.settingsCalls).toEqual([{ streak_count: 4, streak_last_activity_date: '2026-10-02' }])
  })

  it('splits a large backlog into requests of at most chunkSize words', async () => {
    const h = harness({ chunkSize: 100 })
    const release = h.hold()
    h.queue.enqueueProgress(makeUpdate('first'))
    for (let i = 0; i < 250; i++) h.queue.enqueueProgress(makeUpdate(`w${i}`))
    release()
    await idle(h.queue)
    expect(h.progressCalls.map((c) => c.length)).toEqual([1, 100, 100, 50])
  })
})

describe('retry with backoff', () => {
  it('retries a failing request after each configured delay and then succeeds', async () => {
    const h = harness()
    h.failures.progress = 2
    h.queue.enqueueProgress(makeUpdate('w'))
    await idle(h.queue)

    expect(h.progressCalls).toHaveLength(3)
    expect(h.delays).toEqual([10, 20])
    expect(h.queue.getStatus()).toMatchObject({ failed: false, error: null, pendingRatings: 0 })
  })

  it('resends the same state, not a stale or empty one', async () => {
    const h = harness()
    h.failures.progress = 1
    h.queue.enqueueProgress(makeUpdate('w', { repetitions: 5 }))
    await idle(h.queue)
    expect(h.progressCalls.map((c) => c[0].repetitions)).toEqual([5, 5])
  })

  it('retries a failing settings write too', async () => {
    const h = harness()
    h.failures.settings = 1
    h.queue.enqueueSettings({ streak_count: 2 })
    await idle(h.queue)
    expect(h.settingsCalls).toHaveLength(2)
  })
})

describe('persistent failure', () => {
  it('reports failed with the count and error once automatic retries are exhausted', async () => {
    const h = harness()
    h.failures.progress = 99
    h.queue.enqueueProgress(makeUpdate('a'))
    h.queue.enqueueProgress(makeUpdate('b'))
    h.queue.enqueueProgress(makeUpdate('c'))
    await failed(h.queue)

    expect(h.delays).toEqual([10, 20, 30])
    expect(h.queue.getStatus()).toMatchObject({
      failed: true,
      pendingRatings: 3,
      error: 'progress failed',
      unsaved: true,
      sending: false,
    })
  })

  it('stops retrying on its own, and new ratings keep queuing without blocking', async () => {
    const h = harness()
    h.failures.progress = 99
    h.queue.enqueueProgress(makeUpdate('a'))
    await failed(h.queue)
    const attempts = h.progressCalls.length

    h.queue.enqueueProgress(makeUpdate('b'))
    h.queue.enqueueProgress(makeUpdate('c'))
    await new Promise((r) => setTimeout(r, 20))
    expect(h.progressCalls).toHaveLength(attempts)
    expect(h.queue.getStatus().pendingRatings).toBe(3)
  })

  it('a settings-only failure is reported separately from ratings', async () => {
    const h = harness()
    h.failures.settings = 99
    h.queue.enqueueSettings({ streak_count: 1 })
    await failed(h.queue)
    expect(h.queue.getStatus()).toMatchObject({ failed: true, pendingRatings: 0, pendingSettings: true })
  })

  it('retry() sends everything again and clears the failed state', async () => {
    const h = harness()
    h.failures.progress = 4 // 1 attempt + 3 retries
    h.queue.enqueueProgress(makeUpdate('a'))
    h.queue.enqueueProgress(makeUpdate('b'))
    await failed(h.queue)

    h.queue.retry()
    await idle(h.queue)
    expect(h.queue.getStatus()).toMatchObject({ failed: false, error: null, pendingRatings: 0 })
    expect(sentWords(h.progressCalls).slice(-2)).toEqual(['a', 'b'])
  })

  it('double-tap on Retry sends one request', async () => {
    const h = harness()
    h.failures.progress = 4
    h.queue.enqueueProgress(makeUpdate('a'))
    await failed(h.queue)
    const before = h.progressCalls.length

    const release = h.hold()
    h.queue.retry()
    h.queue.retry()
    h.queue.retry()
    expect(h.progressCalls.length - before).toBe(1)
    release()
    await idle(h.queue)
    expect(h.progressCalls.length - before).toBe(1)
  })

  it('retry() is a single attempt: if the server is still down the failed state returns immediately', async () => {
    const h = harness()
    h.failures.progress = 99
    h.queue.enqueueProgress(makeUpdate('a'))
    await failed(h.queue)
    const before = h.progressCalls.length

    h.queue.retry()
    await failed(h.queue)
    expect(h.progressCalls.length - before).toBe(1)
    expect(h.queue.getStatus()).toMatchObject({ failed: true, pendingRatings: 1 })
  })

  it('after a single retry succeeds, automatic retries work again for later failures', async () => {
    const h = harness()
    h.failures.progress = 4
    h.queue.enqueueProgress(makeUpdate('a'))
    await failed(h.queue)
    h.queue.retry()
    await idle(h.queue)

    h.failures.progress = 2
    h.queue.enqueueProgress(makeUpdate('b'))
    await idle(h.queue)
    expect(h.queue.getStatus().failed).toBe(false)
  })

  it('retry() does nothing when there is nothing to send', () => {
    const h = harness()
    h.queue.retry()
    expect(h.progressCalls).toHaveLength(0)
  })
})

describe('flush', () => {
  it('resolves once everything is saved', async () => {
    const h = harness()
    h.queue.enqueueProgress(makeUpdate('a'))
    h.queue.enqueueProgress(makeUpdate('b'))
    h.queue.enqueueSettings({ streak_count: 1 })
    await h.queue.flush()
    expect(h.queue.getStatus().unsaved).toBe(false)
    expect(sentWords(h.progressCalls)).toEqual(['a', 'b'])
    expect(h.settingsCalls).toHaveLength(1)
  })

  it('resolves immediately when nothing is queued', async () => {
    const h = harness()
    await expect(h.queue.flush()).resolves.toBeUndefined()
    expect(h.progressCalls).toHaveLength(0)
  })

  it('skips the backoff wait: it re-attempts immediately instead of sleeping', async () => {
    const h = harness({ sleep: () => new Promise<void>(() => {}) }) // a backoff that would never end
    h.failures.progress = 1
    h.queue.enqueueProgress(makeUpdate('a'))
    await vi.waitFor(() => expect(h.progressCalls).toHaveLength(1)) // first attempt failed, now "sleeping"

    await h.queue.flush()
    expect(h.progressCalls).toHaveLength(2)
    expect(h.queue.getStatus().unsaved).toBe(false)
  })

  it('rejects when the server keeps failing', async () => {
    const h = harness()
    h.failures.progress = 99
    h.queue.enqueueProgress(makeUpdate('a'))
    await expect(h.queue.flush()).rejects.toThrow('progress failed')
    expect(h.queue.getStatus().failed).toBe(true)
  })

  it('after a persistent failure, flush tries again from scratch', async () => {
    const h = harness()
    h.failures.progress = 4
    h.queue.enqueueProgress(makeUpdate('a'))
    await failed(h.queue)
    await h.queue.flush()
    expect(h.queue.getStatus()).toMatchObject({ failed: false, unsaved: false })
  })
})

describe('status and subscriptions', () => {
  it('notifies listeners on change and returns a stable snapshot between changes', async () => {
    const h = harness()
    const listener = vi.fn()
    const unsubscribe = h.queue.subscribe(listener)

    const idleSnapshot = h.queue.getStatus()
    expect(h.queue.getStatus()).toBe(idleSnapshot)

    h.queue.enqueueProgress(makeUpdate('a'))
    expect(listener).toHaveBeenCalled()
    await idle(h.queue)

    const settled = h.queue.getStatus()
    expect(settled).not.toBe(idleSnapshot)
    expect(h.queue.getStatus()).toBe(settled)

    unsubscribe()
    listener.mockClear()
    h.queue.enqueueProgress(makeUpdate('b'))
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('createSupabaseWriteQueue', () => {
  it('writes user_progress with original casing and merges settings over the in-memory blob', async () => {
    const fake = fakeSupabase()
    const settings = parseSettings({ streak_count: 3, learn_picks: ['ser'], some_future_key: 1 })
    const queue = createSupabaseWriteQueue(fake.client, 'user-1', () => settings)

    queue.enqueueProgress(makeUpdate('Hacienda'))
    queue.enqueueSettings({ streak_count: 4 })
    await queue.flush()

    expect(fake.calls.map((c) => c.table)).toEqual(['user_progress', 'user_settings'])
    expect((fake.calls[0].rows as { es_word: string }[])[0].es_word).toBe('Hacienda')
    expect(fake.calls[0].options).toEqual({ onConflict: 'user_id,es_word' })
    expect((fake.calls[1].rows as { settings: unknown }).settings).toEqual({
      streak_count: 4,
      learn_picks: ['ser'],
      some_future_key: 1,
    })
  })
})
