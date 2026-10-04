import { describe, expect, it, vi } from 'vitest'
import { createLoadLog } from './loadLog'

const entry = (n: number) => ({ table: 't', attempt: n, kind: 'transient' as const, status: 0, code: null, message: `m${n}`, outcome: 'retrying' as const })

describe('load log', () => {
  it('records newest first with an id and a timestamp, keeps a bounded history and notifies subscribers', () => {
    const log = createLoadLog(3)
    const listener = vi.fn()
    const unsubscribe = log.subscribe(listener)
    for (let i = 1; i <= 4; i++) log.record(entry(i), new Date('2026-10-04T10:00:00.000Z'))
    expect(log.snapshot().map((e) => e.message)).toEqual(['m4', 'm3', 'm2'])
    expect(log.snapshot()[0]).toMatchObject({ id: 4, at: '2026-10-04T10:00:00.000Z' })
    expect(listener).toHaveBeenCalledTimes(4)
    unsubscribe()
    log.record(entry(5))
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('returns the same snapshot object until something changes (what useSyncExternalStore needs)', () => {
    const log = createLoadLog()
    const first = log.snapshot()
    expect(log.snapshot()).toBe(first)
    log.record(entry(1))
    expect(log.snapshot()).not.toBe(first)
    log.clear()
    expect(log.snapshot()).toEqual([])
  })
})
