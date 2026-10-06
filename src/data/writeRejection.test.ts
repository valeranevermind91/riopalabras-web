import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import { makeUpdate } from '../testing/makeWord'
import { showUnsavedNotice } from './useQueueStatus'
import { createWriteQueue, type QueueSender } from './writeQueue'
import { WriteError, isRejection } from './writes'

const refused = (status = 403, code = '42501') => new WriteError('user_progress', 'new row violates row-level security policy', status, code)
const ok: QueueSender = { sendProgress: async () => {}, sendSettings: async () => {}, sendMetrics: async () => {} }

describe('which failures are a refusal for who is asking', () => {
  it('a missing or expired login, a policy refusal and "no session on this device" are; a dead network and a server error are not', () => {
    expect(isRejection(new WriteError('t', 'x', 401))).toBe(true)
    expect(isRejection(new WriteError('t', 'x', 403))).toBe(true)
    expect(isRejection(new WriteError('t', 'denied', 400, '42501'))).toBe(true)
    expect(isRejection(new WriteError('t', 'JWT expired', 400, 'PGRST301'))).toBe(true)
    expect(isRejection(new WriteError('t', 'new row violates row-level security policy', null, null))).toBe(true)
    expect(isRejection(new WriteError('session', "You're not signed in", 401, 'NO_SESSION'))).toBe(true)

    expect(isRejection(new WriteError('t', 'Failed to fetch', null, null))).toBe(false)
    expect(isRejection(new WriteError('t', 'upstream', 503, null))).toBe(false)
    expect(isRejection(new WriteError('t', 'unique violation', 409, '23505'))).toBe(false)
    expect(isRejection(new Error('no answer after 20000 ms'))).toBe(false)
    expect(isRejection('x')).toBe(false)
  })
})

describe('the queue and a refusal', () => {
  it('is shown at once: no run of retries first, one attempt at getting a session back, and the closing confirmation stays on', async () => {
    const sendProgress = vi.fn(async () => {
      throw refused(401, 'PGRST301')
    })
    const recoverAuth = vi.fn(async () => false)
    const sleep = vi.fn(async () => {})
    const q = createWriteQueue({ ...ok, sendProgress, recoverAuth }, { sleep, retryDelaysMs: [1000, 3000, 8000] })
    q.enqueueProgress(makeUpdate('casa'))
    await vi.waitFor(() => expect(q.getStatus().failed).toBe(true))

    const status = q.getStatus()
    expect(status.authRejected).toBe(true)
    expect(status.stuck).toBe(true)
    expect(status.unsaved).toBe(true)
    expect(showUnsavedNotice(status)).toBe(true)
    expect(sendProgress).toHaveBeenCalledTimes(1)
    expect(recoverAuth).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled() // no silent 1s / 3s / 8s of the same refusal
  })

  it('when a session comes back the same write is sent again straight away, and nothing is flagged', async () => {
    let signedIn = false
    const sent: string[] = []
    const q = createWriteQueue({
      ...ok,
      sendProgress: async (updates) => {
        if (!signedIn) throw refused(401, 'PGRST301')
        sent.push(...updates.map((u) => u.esWord))
      },
      recoverAuth: async () => (signedIn = true),
    })
    q.enqueueProgress(makeUpdate('casa'))
    await vi.waitFor(() => expect(q.getStatus().unsaved).toBe(false))
    expect(sent).toEqual(['casa'])
    expect(q.getStatus().authRejected).toBe(false)
    expect(q.getStatus().failed).toBe(false)
  })

  it('Retry gets one more attempt at a session; the flag clears when a write is accepted', async () => {
    let allowed = false
    const recoverAuth = vi.fn(async () => allowed)
    const q = createWriteQueue({
      ...ok,
      sendProgress: async () => {
        if (!allowed) throw refused()
      },
      recoverAuth,
    })
    q.enqueueProgress(makeUpdate('casa'))
    await vi.waitFor(() => expect(q.getStatus().authRejected).toBe(true))
    expect(recoverAuth).toHaveBeenCalledTimes(1)

    expect(await q.retry()).toBe(false)
    expect(recoverAuth).toHaveBeenCalledTimes(2) // once per Retry, not once per failed request
    expect(q.getStatus().authRejected).toBe(true)

    allowed = true
    expect(await q.retry()).toBe(true)
    expect(q.getStatus().authRejected).toBe(false)
    expect(showUnsavedNotice(q.getStatus())).toBe(false)
  })

  it('an ordinary network failure is still retried quietly first, and is not called a refusal', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    const q = createWriteQueue(
      {
        ...ok,
        sendProgress: async () => {
          if (++calls < 3) throw new Error('Failed to fetch')
        },
      },
      { sleep },
    )
    q.enqueueProgress(makeUpdate('casa'))
    await vi.waitFor(() => expect(q.getStatus().unsaved).toBe(false))
    expect(calls).toBe(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(q.getStatus().authRejected).toBe(false)
  })

  it('a request that never answers fails after the timeout instead of "saving" forever', async () => {
    const q = createWriteQueue({ ...ok, sendProgress: () => new Promise<void>(() => {}) }, { sendTimeoutMs: 20, retryDelaysMs: [1], sleep: async () => {} })
    q.enqueueProgress(makeUpdate('casa'))
    await vi.waitFor(() => expect(q.getStatus().failed).toBe(true))
    expect(q.getStatus().error).toMatch(/no answer after 20 ms/)
    expect(q.getStatus().authRejected).toBe(false)
  })

  it('a refused metrics row is shown too (the lane stays best-effort: it does not count as unsaved and is not retried in a loop)', async () => {
    const sendMetrics = vi.fn(async () => {
      throw refused()
    })
    const q = createWriteQueue({ ...ok, sendMetrics }, { metricsRetryDelaysMs: [1, 1, 1] })
    q.enqueueMetrics({ date: '2026-10-06', newWords: 10, reviewsDone: 0, reviewsLapsed: 0, dueAtStart: 0, learnPool: 0, dailyLimit: 10, active: true })
    await vi.waitFor(() => expect(q.getStatus().authRejected).toBe(true))
    expect(q.getStatus().unsaved).toBe(false)
    expect(q.getStatus().failed).toBe(false)
    expect(sendMetrics).toHaveBeenCalledTimes(1)
  })
})

describe('losing the session after sign-in', () => {
  it('is noticed: supabase-js drops the session the auth server no longer knows, and the app is told', async () => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.test')
    vi.resetModules()
    const server = createFakeServer()
    vi.stubGlobal('fetch', server.fetch)
    try {
      const { ensureSession, watchSessionLost } = await import('../lib/auth')
      const client = server.client()
      expect((await ensureSession(client, initDataFor(7), 7)).status).toBe('signed-in')
      const lost = vi.fn()
      const stop = watchSessionLost(client, lost)

      server.break.forgetSessions = true
      await client.auth.getUser()
      await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1))
      expect((await client.auth.getSession()).data.session).toBeNull()

      server.break.forgetSessions = false
      const again = await ensureSession(client, initDataFor(7), 7, { force: true })
      expect(again.status).toBe('signed-in')
      expect((await client.auth.getSession()).data.session).not.toBeNull()
      stop()
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })
})

describe('the app wires it up', () => {
  const app = readFileSync('src/App.tsx', 'utf8')
  it('builds its queue with a way to sign in again, and signs in again when the session is dropped', () => {
    expect(app).toMatch(/createSupabaseWriteQueue\(client, userId, getSettings, \{ recoverSession \}\)/)
    expect(app).toMatch(/ensureSession\(client, telegram\.initData, telegram\.user\?\.id \?\? null, \{ force: true \}\)/)
    expect(app).toMatch(/watchSessionLost\(client,/)
    expect(app).toMatch(/result\.userId === userId/) // never under a different user's session
  })
})
