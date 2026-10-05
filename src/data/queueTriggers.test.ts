import { describe, expect, it, vi } from 'vitest'
import { makeUpdate } from '../testing/makeWord'
import type { TelegramWebApp } from '../lib/telegram'
import { onTelegramActivated, setClosingConfirmation } from '../lib/telegram'
import { createBackgroundRetrier, type Retrier } from './recovery'
import { bindClosingConfirmation, bindReconnectTriggers, bindStuckRetry, retryEverything } from './queueTriggers'
import { showUnsavedNotice } from './useQueueStatus'
import { createWriteQueue, type WriteQueue } from './writeQueue'

/** A queue whose server can be switched down and up, with waits skipped. */
function queueHarness() {
  const state = { down: false, sent: [] as string[] }
  let gate: Promise<void> | null = null
  const queue = createWriteQueue(
    {
      sendProgress: async (updates) => {
        if (gate) await gate
        if (state.down) throw new Error('offline')
        state.sent.push(...updates.map((u) => u.esWord))
      },
      sendSettings: async () => {
        if (state.down) throw new Error('offline')
      },
    },
    { retryDelaysMs: [1, 1, 1], sleep: () => Promise.resolve() },
  )
  return {
    queue,
    state,
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

describe('Home banner states (showUnsavedNotice)', () => {
  it('hidden when idle, hidden during automatic retries, shown once they ran out, gone by itself after it drains', async () => {
    const h = queueHarness()
    expect(showUnsavedNotice(h.queue.getStatus())).toBe(false)

    h.state.down = true
    h.queue.enqueueProgress(makeUpdate('a'))
    expect(showUnsavedNotice(h.queue.getStatus())).toBe(false) // first attempt in flight
    await stuck(h.queue)
    expect(showUnsavedNotice(h.queue.getStatus())).toBe(true)

    expect(await h.queue.retry()).toBe(false) // still offline: banner stays, no flicker
    expect(showUnsavedNotice(h.queue.getStatus())).toBe(true)

    h.state.down = false
    expect(await h.queue.retry()).toBe(true)
    expect(showUnsavedNotice(h.queue.getStatus())).toBe(false)
  })
})

describe('closing confirmation follows the queue', () => {
  it('turns on while anything is unsaved (even stuck) and off once it drained', async () => {
    const h = queueHarness()
    const calls: boolean[] = []
    const unbind = bindClosingConfirmation(h.queue, (on) => calls.push(on))
    expect(calls).toEqual([]) // nothing queued: stays off, no call

    const release = h.hold()
    h.queue.enqueueProgress(makeUpdate('a'))
    expect(calls).toEqual([true])
    h.queue.enqueueProgress(makeUpdate('b')) // more changes while on: no repeated call
    expect(calls).toEqual([true])
    release()
    await idle(h.queue)
    expect(calls).toEqual([true, false])

    h.state.down = true
    h.queue.enqueueProgress(makeUpdate('c'))
    await stuck(h.queue)
    expect(calls).toEqual([true, false, true]) // a failed queue keeps it on

    h.state.down = false
    await h.queue.retry()
    expect(calls).toEqual([true, false, true, false])
    unbind()
  })

  it('unbinding while on switches it off', () => {
    const h = queueHarness()
    h.state.down = true
    const calls: boolean[] = []
    const unbind = bindClosingConfirmation(h.queue, (on) => calls.push(on))
    h.queue.enqueueProgress(makeUpdate('a'))
    expect(calls).toEqual([true])
    unbind()
    expect(calls).toEqual([true, false])
  })

  it('setClosingConfirmation is a no-op outside Telegram and in old clients, and calls Telegram when it can', () => {
    const base = { initData: '', initDataUnsafe: {}, colorScheme: 'light', themeParams: {}, ready() {}, expand() {} } as TelegramWebApp
    expect(() => setClosingConfirmation(true, base)).not.toThrow() // the dev mock: no functions at all

    const enable = vi.fn()
    const disable = vi.fn()
    const old = { ...base, enableClosingConfirmation: enable, disableClosingConfirmation: disable, isVersionAtLeast: (v: string) => v === '6.0' }
    setClosingConfirmation(true, old)
    expect(enable).not.toHaveBeenCalled() // needs Bot API 6.2

    const modern = { ...base, enableClosingConfirmation: enable, disableClosingConfirmation: disable, isVersionAtLeast: () => true }
    setClosingConfirmation(true, modern)
    setClosingConfirmation(false, modern)
    expect(enable).toHaveBeenCalledTimes(1)
    expect(disable).toHaveBeenCalledTimes(1)

    const throwing = { ...modern, enableClosingConfirmation: () => { throw new Error('boom') } }
    expect(() => setClosingConfirmation(true, throwing)).not.toThrow()
  })
})

/** Just enough of window / document to drive the listeners. */
function fakeTarget<T extends string>(extra: Record<string, unknown> = {}) {
  const listeners = new Map<T, Set<() => void>>()
  return {
    addEventListener: (type: T, fn: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: T, fn: () => void) => void listeners.get(type)?.delete(fn),
    fire: (type: T) => listeners.get(type)?.forEach((fn) => fn()),
    count: (type: T) => listeners.get(type)?.size ?? 0,
    ...extra,
  }
}

describe('reconnect triggers', () => {
  const setup = () => {
    const win = fakeTarget<'online'>()
    const doc = fakeTarget<'visibilitychange'>({ visibilityState: 'visible' }) as ReturnType<typeof fakeTarget<'visibilitychange'>> & { visibilityState: string }
    let activate: () => void = () => {}
    const offActivated = vi.fn()
    const onTrigger = vi.fn()
    const unbind = bindReconnectTriggers(onTrigger, {
      online: win as never,
      document: doc as never,
      activated: (cb) => {
        activate = cb
        return offActivated
      },
    })
    return { win, doc, onTrigger, unbind, offActivated, activate: () => activate() }
  }

  it('fires on online, on becoming visible (not on hiding), and on Telegram activation', () => {
    const s = setup()
    s.win.fire('online')
    expect(s.onTrigger).toHaveBeenCalledTimes(1)
    s.doc.fire('visibilitychange')
    expect(s.onTrigger).toHaveBeenCalledTimes(2)
    s.doc.visibilityState = 'hidden'
    s.doc.fire('visibilitychange')
    expect(s.onTrigger).toHaveBeenCalledTimes(2)
    s.activate()
    expect(s.onTrigger).toHaveBeenCalledTimes(3)
  })

  it('unbinds everything', () => {
    const s = setup()
    s.unbind()
    s.win.fire('online')
    s.doc.fire('visibilitychange')
    expect(s.onTrigger).not.toHaveBeenCalled()
    expect(s.win.count('online')).toBe(0)
    expect(s.doc.count('visibilitychange')).toBe(0)
    expect(s.offActivated).toHaveBeenCalled()
  })

  it('online flushes a stuck queue immediately instead of waiting for a backoff step', async () => {
    const h = queueHarness()
    h.state.down = true
    h.queue.enqueueProgress(makeUpdate('a'))
    await stuck(h.queue)

    const win = fakeTarget<'online'>()
    const unbind = bindReconnectTriggers(() => retryEverything({ queue: h.queue, retryDegraded: undefined }), {
      online: win as never,
      document: fakeTarget({ visibilityState: 'hidden' }) as never,
      activated: () => () => {},
    })
    h.state.down = false
    win.fire('online')
    await idle(h.queue)
    expect(h.state.sent).toEqual(['a'])
    expect(showUnsavedNotice(h.queue.getStatus())).toBe(false)
    unbind()
  })

  it('the degraded user-data retrier is triggered by the same events', () => {
    const retryDegraded = vi.fn()
    const h = queueHarness()
    retryEverything({ queue: h.queue, retryDegraded })
    expect(retryDegraded).toHaveBeenCalledTimes(1)
    retryEverything({ queue: null, retryDegraded }) // before the queue exists (still loading)
    expect(retryDegraded).toHaveBeenCalledTimes(2)
    expect(() => retryEverything({ queue: null, retryDegraded: undefined })).not.toThrow()
  })

  it('the real background retrier tries now when triggered, instead of waiting for its timer', async () => {
    const run = vi.fn(async () => false)
    const timers: (() => void)[] = []
    const retrier = createBackgroundRetrier({ run, setTimer: (fn) => (timers.push(fn), timers.length), clearTimer: () => {} })
    retrier.start()
    expect(run).not.toHaveBeenCalled()
    retryEverything({ queue: null, retryDegraded: () => retrier.retryNow() })
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  })

  it('Telegram activation: subscribes where the event exists and is a no-op where it does not', () => {
    const base = { initData: '', initDataUnsafe: {}, colorScheme: 'light', themeParams: {}, ready() {}, expand() {} } as TelegramWebApp
    expect(onTelegramActivated(() => {}, base)()).toBeUndefined() // dev mock: returns a harmless unsubscribe

    const on = vi.fn()
    const off = vi.fn()
    const cb = () => {}
    const unsubscribe = onTelegramActivated(cb, { ...base, onEvent: on, offEvent: off, isVersionAtLeast: (v: string) => v !== '8.0' })
    unsubscribe()
    expect(on).not.toHaveBeenCalled() // 'activated' needs Bot API 8.0

    const modern = onTelegramActivated(cb, { ...base, onEvent: on, offEvent: off, isVersionAtLeast: () => true })
    expect(on).toHaveBeenCalledWith('activated', cb)
    modern()
    expect(off).toHaveBeenCalledWith('activated', cb)
  })
})

describe('background retry while stuck', () => {
  it('starts when the queue gets stuck and stops once it drains; one attempt per tick', async () => {
    const h = queueHarness()
    const events: string[] = []
    let run: () => Promise<boolean> = async () => true
    const retrier: Retrier = { start: () => events.push('start'), stop: () => events.push('stop'), retryNow: () => {} }
    const unbind = bindStuckRetry(h.queue, (r) => ((run = r), retrier))
    expect(events).toEqual([])

    h.state.down = true
    h.queue.enqueueProgress(makeUpdate('a'))
    await stuck(h.queue)
    expect(events).toEqual(['start'])

    expect(await run()).toBe(false) // a tick while still offline: one attempt, still stuck
    expect(events).toEqual(['start'])

    h.state.down = false
    expect(await run()).toBe(true)
    expect(events).toEqual(['start', 'stop'])
    expect(h.state.sent).toEqual(['a'])

    unbind()
    expect(events.at(-1)).toBe('stop')
  })
})
