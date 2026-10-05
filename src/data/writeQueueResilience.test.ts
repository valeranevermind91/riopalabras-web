import { describe, expect, it, vi } from 'vitest'
import { makeUpdate } from '../testing/makeWord'
import type { ProgressUpdate, SettingsPatch } from './types'
import { createWriteQueue, type WriteQueue } from './writeQueue'

/** A queue whose requests fail on demand and whose waits are controlled by the test. */
function harness(options: Parameters<typeof createWriteQueue>[1] = {}) {
  const progressCalls: ProgressUpdate[][] = []
  const settingsCalls: SettingsPatch[] = []
  const order: string[] = []
  const failures = { progress: 0, settings: 0 }
  let gate: Promise<void> | null = null
  const sleeps: { ms: number; wake: () => void }[] = []
  let manualSleep = false

  async function request(kind: 'progress' | 'settings', record: () => void) {
    record()
    if (gate) await gate
    await Promise.resolve()
    if (failures[kind] > 0) {
      failures[kind]--
      throw new Error(`${kind} failed`)
    }
  }

  const queue = createWriteQueue(
    {
      sendProgress: (updates) => request('progress', () => (progressCalls.push([...updates]), order.push('progress'))),
      sendSettings: (patch) => request('settings', () => (settingsCalls.push(patch), order.push('settings'))),
    },
    {
      retryDelaysMs: [10, 20, 30],
      sleep: (ms) =>
        manualSleep
          ? new Promise<void>((resolve) => sleeps.push({ ms, wake: resolve }))
          : Promise.resolve(),
      ...options,
    },
  )

  return {
    queue,
    progressCalls,
    settingsCalls,
    order,
    failures,
    sleeps,
    manualSleeps() {
      manualSleep = true
    },
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

const idle = (q: WriteQueue) => vi.waitFor(() => expect(q.getStatus().unsaved).toBe(false))
const stuck = (q: WriteQueue) => vi.waitFor(() => expect(q.getStatus().stuck).toBe(true))
const words = (calls: ProgressUpdate[][]) => calls.flat().map((u) => u.esWord)

describe('stuck: the state behind the Home banner', () => {
  it('is false while automatic retries are still running and true once they have run out', async () => {
    const h = harness()
    h.manualSleeps()
    h.failures.progress = 99
    h.queue.enqueueProgress(makeUpdate('a'))
    await vi.waitFor(() => expect(h.sleeps).toHaveLength(1)) // first backoff sleeping
    expect(h.queue.getStatus()).toMatchObject({ stuck: false, failed: false, unsaved: true })
    h.sleeps[0].wake()
    await vi.waitFor(() => expect(h.sleeps).toHaveLength(2))
    h.sleeps[1].wake()
    await vi.waitFor(() => expect(h.sleeps).toHaveLength(3))
    h.sleeps[2].wake()
    await stuck(h.queue)
    expect(h.queue.getStatus()).toMatchObject({ stuck: true, failed: true })
  })

  it('stays true through a failing retry attempt (no flicker) and clears by itself when the queue drains', async () => {
    const h = harness()
    h.failures.progress = 99
    h.queue.enqueueProgress(makeUpdate('a'))
    await stuck(h.queue)

    const seen: boolean[] = []
    h.queue.subscribe(() => seen.push(h.queue.getStatus().stuck))
    expect(await h.queue.retry()).toBe(false) // server still down
    expect(seen.every(Boolean)).toBe(true)
    expect(h.queue.getStatus().stuck).toBe(true)

    h.failures.progress = 0
    expect(await h.queue.retry()).toBe(true)
    expect(h.queue.getStatus()).toMatchObject({ stuck: false, failed: false, unsaved: false })
  })

  it('is never set by a transient failure that recovers within the automatic retries', async () => {
    const h = harness()
    h.failures.progress = 2
    const seen: boolean[] = []
    h.queue.subscribe(() => seen.push(h.queue.getStatus().stuck))
    h.queue.enqueueProgress(makeUpdate('a'))
    await idle(h.queue)
    expect(seen.some(Boolean)).toBe(false)
  })
})

describe('retry() as a trigger (online, app shown again, background retrier)', () => {
  it('wakes a sleeping backoff immediately', async () => {
    const h = harness()
    h.manualSleeps()
    h.failures.progress = 1
    h.queue.enqueueProgress(makeUpdate('a'))
    await vi.waitFor(() => expect(h.sleeps).toHaveLength(1))
    expect(h.progressCalls).toHaveLength(1)

    expect(await h.queue.retry()).toBe(true) // does not wait for the sleep to end
    expect(h.progressCalls).toHaveLength(2)
    expect(h.queue.getStatus().unsaved).toBe(false)
  })

  it('resolves true at once when there is nothing to send', async () => {
    const h = harness()
    expect(await h.queue.retry()).toBe(true)
    expect(h.progressCalls).toHaveLength(0)
  })

  it('called at the moment the last drain gives up, it still makes its attempt', async () => {
    const h = harness()
    h.failures.progress = 4 // initial + 3 retries, then a success
    h.queue.enqueueProgress(makeUpdate('a'))
    const unsubscribe = h.queue.subscribe(() => {
      if (h.queue.getStatus().failed) {
        unsubscribe()
        void h.queue.retry() // fired synchronously from the notification that announces the failure
      }
    })
    await idle(h.queue)
    expect(words(h.progressCalls)).toEqual(['a', 'a', 'a', 'a', 'a'])
  })

  it('many triggers at once never double a request', async () => {
    const h = harness()
    h.failures.progress = 99
    h.queue.enqueueProgress(makeUpdate('a'))
    await stuck(h.queue)
    const before = h.progressCalls.length
    const release = h.hold()
    void h.queue.retry()
    void h.queue.retry()
    void h.queue.retry()
    expect(h.progressCalls.length - before).toBe(1)
    h.failures.progress = 0
    release()
    await idle(h.queue)
  })
})

describe('a failed flush never loses an item and never applies one twice', () => {
  it('keeps every queued item after a failed flush, then sends each exactly once', async () => {
    const h = harness()
    h.failures.progress = 99
    h.failures.settings = 0
    h.queue.enqueueProgress(makeUpdate('a', { repetitions: 1 }))
    h.queue.enqueueProgress(makeUpdate('b', { repetitions: 1 }))
    h.queue.enqueueSettings({ streak_count: 7 })
    await expect(h.queue.flush()).rejects.toThrow('progress failed')
    expect(h.queue.getStatus()).toMatchObject({ pendingRatings: 2, pendingSettings: true })
    expect(h.settingsCalls).toHaveLength(0) // settings wait behind progress

    h.failures.progress = 0
    await h.queue.flush()
    const succeeded = h.progressCalls.slice(-1)[0]
    expect(succeeded.map((u) => u.esWord)).toEqual(['a', 'b'])
    expect(h.settingsCalls).toEqual([{ streak_count: 7 }])
    expect(h.queue.getStatus()).toMatchObject({ pendingRatings: 0, pendingSettings: false, unsaved: false })

    const callsAfterDrain = h.progressCalls.length
    await h.queue.flush()
    await h.queue.retry()
    expect(h.progressCalls).toHaveLength(callsAfterDrain) // nothing resent
  })

  it('a failure in a later chunk does not resend the chunks that were saved', async () => {
    const sent: string[] = []
    let failOnce = true
    const q = createWriteQueue(
      {
        sendProgress: async (updates) => {
          if (updates.some((u) => u.esWord === 'c') && failOnce) {
            failOnce = false
            throw new Error('chunk with c failed')
          }
          sent.push(...updates.map((u) => u.esWord))
        },
        sendSettings: async () => {},
      },
      { chunkSize: 2, retryDelaysMs: [] },
    )
    for (const w of ['a', 'b', 'c', 'd']) q.enqueueProgress(makeUpdate(w))
    await expect(q.flush()).rejects.toThrow('chunk with c failed')
    const savedBefore = [...sent]
    expect(savedBefore).toContain('a') // earlier chunks did go out
    expect(q.getStatus().pendingRatings).toBe(4 - savedBefore.length) // exactly the unsent ones are still queued

    await q.flush()
    expect(sent.slice().sort()).toEqual(['a', 'b', 'c', 'd']) // every word exactly once, none resent
  })

  it('an item enqueued while the queue is stuck is kept and goes out with the next retry', async () => {
    const h = harness()
    h.failures.progress = 4
    h.queue.enqueueProgress(makeUpdate('a'))
    await stuck(h.queue)
    h.queue.enqueueProgress(makeUpdate('b'))
    expect(h.queue.getStatus().pendingRatings).toBe(2)

    expect(await h.queue.retry()).toBe(true)
    expect(words(h.progressCalls).slice(-2)).toEqual(['a', 'b'])
  })

  it('a newer state enqueued while an older one is being retried replaces it, so only the newest is final', async () => {
    const h = harness()
    h.failures.progress = 99
    h.queue.enqueueProgress(makeUpdate('w', { repetitions: 1 }))
    await stuck(h.queue)
    h.queue.enqueueProgress(makeUpdate('w', { repetitions: 5 }))
    h.failures.progress = 0
    await h.queue.retry()
    expect(h.progressCalls.at(-1)).toHaveLength(1)
    expect(h.progressCalls.at(-1)?.[0].repetitions).toBe(5)
    expect(h.queue.getStatus().pendingRatings).toBe(0)
  })
})

