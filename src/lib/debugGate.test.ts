import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { HomeScreen } from '../screens/Home'
import { NotAvailable } from '../screens/NotAvailable'
import { isDebugAllowed, parseAllowedIds, resolveDebugAccess, telegramIdFromEmail, verifiedTelegramId } from './debugGate'

const email = (id: number | string) => `tg_${id}@telegram.riopalabras.internal`
const clientWith = (user: { email?: string; user_metadata?: Record<string, unknown> } | null, error: { message: string } | null = null) => {
  const getUser = vi.fn(async () => ({ data: { user }, error }))
  return { client: { auth: { getUser } } as never, getUser }
}

describe('parseAllowedIds', () => {
  it('unset, empty and blank mean nobody', () => {
    for (const raw of [undefined, null, '', '   ', ',', ' , , ']) expect(parseAllowedIds(raw).size, String(raw)).toBe(0)
  })

  it('reads a comma-separated list, trimming spaces and dropping duplicates', () => {
    expect([...parseAllowedIds('123456789')]).toEqual([123456789])
    expect([...parseAllowedIds(' 111 , 222,333 ,111')].sort()).toEqual([111, 222, 333])
  })

  it('ignores anything that is not a positive whole number rather than guessing', () => {
    expect([...parseAllowedIds('abc, 12x, -5, 0, 1.5, 1e3, 42, @name')]).toEqual([42])
  })
})

describe('telegramIdFromEmail', () => {
  it('reads the id from the proxy-made email and from nothing else', () => {
    expect(telegramIdFromEmail(email(987654321))).toBe(987654321)
    for (const bad of [null, undefined, '', 'me@example.com', 'tg_12@evil.example', 'tg_@telegram.riopalabras.internal', 'xtg_12@telegram.riopalabras.internal', 'tg_12@telegram.riopalabras.internal.evil.com', 'tg_0@telegram.riopalabras.internal']) {
      expect(telegramIdFromEmail(bad), String(bad)).toBeNull()
    }
  })
})

describe('verifiedTelegramId: the id comes from the auth server, not from anything the client can set', () => {
  it('asks the auth server (getUser) and reads the email', async () => {
    const c = clientWith({ email: email(555) })
    expect(await verifiedTelegramId(c.client)).toBe(555)
    expect(c.getUser).toHaveBeenCalledTimes(1)
  })

  it('ignores user_metadata, which a user can edit themselves', async () => {
    const c = clientWith({ email: email(555), user_metadata: { telegram_id: 111 } })
    expect(await verifiedTelegramId(c.client)).toBe(555)
    expect(await verifiedTelegramId(clientWith({ user_metadata: { telegram_id: 111 } }).client)).toBeNull()
  })

  it('is null when the lookup fails, throws, or the account is not a Telegram one', async () => {
    expect(await verifiedTelegramId(clientWith(null, { message: 'jwt expired' }).client)).toBeNull()
    expect(await verifiedTelegramId(clientWith(null).client)).toBeNull()
    expect(await verifiedTelegramId(clientWith({ email: 'someone@example.com' }).client)).toBeNull()
    const throwing = { auth: { getUser: async () => { throw new Error('network') } } } as never
    expect(await verifiedTelegramId(throwing)).toBeNull()
  })
})

describe('isDebugAllowed', () => {
  const allowed = new Set([111, 222])
  const base = { allowedIds: allowed, telegramId: 111, isDev: false, noTelegramContext: false }

  it('allowed: a verified id on the list', () => {
    expect(isDebugAllowed(base)).toBe(true)
    expect(isDebugAllowed({ ...base, telegramId: 222 })).toBe(true)
  })

  it('not allowed: an id that is not on the list, or no verified id', () => {
    expect(isDebugAllowed({ ...base, telegramId: 333 })).toBe(false)
    expect(isDebugAllowed({ ...base, telegramId: null })).toBe(false)
  })

  it('unset: an empty list lets nobody in', () => {
    expect(isDebugAllowed({ ...base, allowedIds: new Set() })).toBe(false)
    expect(isDebugAllowed({ ...base, allowedIds: new Set(), telegramId: null })).toBe(false)
  })

  it('dev: allowed outside Telegram when the dev server is running, whatever the list says', () => {
    expect(isDebugAllowed({ allowedIds: new Set(), telegramId: null, isDev: true, noTelegramContext: true })).toBe(true)
  })

  it('dev does not open the door in production, nor inside a real Telegram session', () => {
    expect(isDebugAllowed({ allowedIds: new Set(), telegramId: null, isDev: false, noTelegramContext: true })).toBe(false) // a production build in a plain browser
    expect(isDebugAllowed({ allowedIds: new Set(), telegramId: 333, isDev: true, noTelegramContext: false })).toBe(false) // dev server, but opened inside Telegram: the list applies
    expect(isDebugAllowed({ allowedIds: allowed, telegramId: 111, isDev: true, noTelegramContext: false })).toBe(true)
  })
})

describe('resolveDebugAccess (the lookup plus the decision)', () => {
  const opts = (over: Partial<Parameters<typeof resolveDebugAccess>[1]> = {}) => ({ allowedIds: new Set([111]), isDev: false, noTelegramContext: false, ...over })

  it('allows a listed Telegram account and refuses an unlisted one', async () => {
    expect(await resolveDebugAccess(clientWith({ email: email(111) }).client, opts())).toBe(true)
    expect(await resolveDebugAccess(clientWith({ email: email(999) }).client, opts())).toBe(false)
  })

  it('an unset list refuses without even asking the server', async () => {
    const c = clientWith({ email: email(111) })
    expect(await resolveDebugAccess(c.client, opts({ allowedIds: parseAllowedIds(undefined) }))).toBe(false)
    expect(c.getUser).not.toHaveBeenCalled()
  })

  it('dev outside Telegram allows without asking the server', async () => {
    const c = clientWith(null)
    expect(await resolveDebugAccess(c.client, opts({ allowedIds: new Set(), isDev: true, noTelegramContext: true }))).toBe(true)
    expect(c.getUser).not.toHaveBeenCalled()
  })

  it('a failed lookup refuses', async () => {
    expect(await resolveDebugAccess(clientWith(null, { message: 'boom' }).client, opts())).toBe(false)
  })
})

describe('what the UI shows', () => {
  const props = { auth: { status: 'no-telegram' as const }, data: { status: 'loading' as const }, onLearn: () => {}, onReview: () => {}, onMatching: () => {}, onCloze: () => {}, queue: null, metrics: null }

  it('the Home screen no longer has a Debug link, whoever is looking: Settings is the way in', () => {
    expect(renderToStaticMarkup(createElement(HomeScreen, props))).not.toContain('debug-link')
    expect(renderToStaticMarkup(createElement(HomeScreen, { ...props, onSettings: () => {} }))).not.toMatch(/>Debug</)
  })

  it('the refusal is a plain "Not available" and nothing else', () => {
    expect(renderToStaticMarkup(createElement(NotAvailable))).toBe('<main class="screen"><p>Not available</p></main>')
  })
})
