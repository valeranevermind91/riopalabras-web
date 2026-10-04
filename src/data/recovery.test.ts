import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackgroundRetrier } from './recovery'

afterEach(() => vi.useRealTimers())

describe('createBackgroundRetrier', () => {
  const make = (results: boolean[], extra = {}) => {
    const run = vi.fn(async () => {
      const next = results.shift()
      if (next === undefined) throw new Error('unexpected extra attempt')
      return next
    })
    return { run, retrier: createBackgroundRetrier({ run, delaysMs: [100, 200], repeatMs: 500, ...extra }) }
  }

  it('waits, retries on the schedule 100 / 200 / then every 500, and stops once everything is recovered', async () => {
    vi.useFakeTimers()
    const { run, retrier } = make([false, false, false, true])
    retrier.start()
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(99)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(499)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(500)
    expect(run).toHaveBeenCalledTimes(4) // returned true: done
    await vi.advanceTimersByTimeAsync(5000)
    expect(run).toHaveBeenCalledTimes(4)
  })

  it('a throwing attempt does not kill the retrier', async () => {
    vi.useFakeTimers()
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true)
    const retrier = createBackgroundRetrier({ run, delaysMs: [10], repeatMs: 10 })
    retrier.start()
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('retryNow tries immediately, then the schedule continues; it is a no-op while an attempt runs, after stop and after finishing', async () => {
    vi.useFakeTimers()
    let release: (v: boolean) => void = () => {}
    const run = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (release = resolve)))
      .mockResolvedValueOnce(true)
    const retrier = createBackgroundRetrier({ run, delaysMs: [1000], repeatMs: 1000 })
    retrier.start()
    retrier.retryNow()
    expect(run).toHaveBeenCalledTimes(1)
    retrier.retryNow() // an attempt is running
    expect(run).toHaveBeenCalledTimes(1)
    release(false)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2) // true: finished
    retrier.retryNow()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('stop cancels the pending attempt, and an attempt that finishes after stop schedules nothing', async () => {
    vi.useFakeTimers()
    const { run, retrier } = make([false, false])
    retrier.start()
    retrier.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).not.toHaveBeenCalled()
    retrier.retryNow()
    expect(run).not.toHaveBeenCalled()

    let release: (v: boolean) => void = () => {}
    const slow = vi.fn(() => new Promise<boolean>((resolve) => (release = resolve)))
    const running = createBackgroundRetrier({ run: slow, delaysMs: [10], repeatMs: 10 })
    running.start()
    await vi.advanceTimersByTimeAsync(10)
    running.stop()
    release(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(slow).toHaveBeenCalledTimes(1)
  })

  it('start again restarts the schedule from the first delay', async () => {
    vi.useFakeTimers()
    const { run, retrier } = make([false, true])
    retrier.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(1)
    retrier.stop()
    retrier.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(2)
  })
})
