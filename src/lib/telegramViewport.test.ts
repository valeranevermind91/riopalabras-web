import { describe, expect, it, vi } from 'vitest'
import { onTelegramViewportStable, type TelegramWebApp } from './telegram'

// viewportChanged is Telegram's "the visible part of the Mini App changed": it comes many times while a gesture or an animation is going (isStateStable false) and once more
// when it has settled (true). Only the settled one is of use to the code that puts the client's colours back.
const webApp = () => {
  const handlers: ((event?: { isStateStable?: boolean }) => void)[] = []
  const app = {
    onEvent: vi.fn((name: string, cb: (event?: { isStateStable?: boolean }) => void) => void (name === 'viewportChanged' && handlers.push(cb))),
    offEvent: vi.fn((_name: string, cb: (event?: { isStateStable?: boolean }) => void) => void handlers.splice(handlers.indexOf(cb), 1)),
  }
  return { app: app as unknown as TelegramWebApp, handlers, raw: app }
}

describe('onTelegramViewportStable', () => {
  it('calls back only when the resizing has settled: isStateStable true, not false, not missing', () => {
    const w = webApp()
    const cb = vi.fn()
    onTelegramViewportStable(cb, w.app)
    expect(w.raw.onEvent).toHaveBeenCalledWith('viewportChanged', expect.any(Function))
    w.handlers[0]({ isStateStable: false })
    w.handlers[0]({})
    w.handlers[0](undefined)
    expect(cb).not.toHaveBeenCalled()
    w.handlers[0]({ isStateStable: true })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes the handler it subscribed', () => {
    const w = webApp()
    const stop = onTelegramViewportStable(() => {}, w.app)
    stop()
    expect(w.raw.offEvent).toHaveBeenCalledWith('viewportChanged', w.raw.onEvent.mock.calls[0][1])
    expect(w.handlers).toHaveLength(0)
  })

  it('is a harmless no-op where there are no events (the dev mock), and when subscribing or unsubscribing throws', () => {
    expect(onTelegramViewportStable(() => {}, {} as TelegramWebApp)()).toBeUndefined()
    const throwing = { onEvent: () => { throw new Error('boom') } } as unknown as TelegramWebApp
    expect(onTelegramViewportStable(() => {}, throwing)()).toBeUndefined()
    const throwingOff = { onEvent: () => {}, offEvent: () => { throw new Error('boom') } } as unknown as TelegramWebApp
    expect(() => onTelegramViewportStable(() => {}, throwingOff)()).not.toThrow()
  })
})
