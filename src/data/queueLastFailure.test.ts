import { describe, expect, it } from 'vitest'
import { makeUpdate } from '../testing/makeWord'
import { WriteError } from './writes'
import { createWriteQueue, type QueueSender } from './writeQueue'

// `lastSaveFailure`: the last failure of the main lane in this run, kept after the queue recovers (`error` is not): the error's text, the request that was being made, the HTTP status and
// database code when the request got an answer, and when.
const NOW = Date.parse('2026-10-25T20:00:00Z')

/** A queue whose settings sends fail with the errors it is given, one per attempt, and then succeed. Retries run out at once (no delays), so the first failure is "stuck". */
function queueFailing(...errors: unknown[]) {
  const pending = [...errors]
  const sender: QueueSender = {
    sendProgress: async () => {},
    sendSettings: async () => {
      const next = pending.shift()
      if (next) throw next
    },
    sendMetrics: async () => {
      throw new WriteError('user_daily_metrics', 'metrics boom', 500, 'XX000')
    },
  }
  return createWriteQueue(sender, { retryDelaysMs: [], metricsRetryDelaysMs: [], sleep: async () => {}, now: () => NOW })
}
const settled = async (queue: ReturnType<typeof queueFailing>) => {
  for (let i = 0; i < 50 && queue.getStatus().sending; i++) await new Promise((r) => setTimeout(r, 1))
  await new Promise((r) => setTimeout(r, 5))
}

describe('the last save failure', () => {
  it('is null until something fails', async () => {
    const queue = queueFailing()
    queue.enqueueSettings({ ui_language: 'ru' })
    await settled(queue)
    expect(queue.getStatus().lastSaveFailure).toBeNull()
    expect(queue.getStatus().unsaved).toBe(false)
  })

  it('has the message, the request, the HTTP status, the database code and the time of a failed request', async () => {
    const queue = queueFailing(new WriteError('user_settings', 'null value in column "x" violates not-null constraint', 400, '23502'))
    queue.enqueueSettings({ ui_language: 'ru' })
    await settled(queue)
    expect(queue.getStatus().stuck).toBe(true)
    expect(queue.getStatus().lastSaveFailure).toEqual({
      message: 'user_settings: null value in column "x" violates not-null constraint',
      step: 'user_settings',
      status: 400,
      code: '23502',
      at: '2026-10-25T20:00:00.000Z',
    })
  })

  it('has no status or code for a failure that never got an answer (a timeout, no connection, no session), and keeps the parts that exist otherwise', async () => {
    const timeout = queueFailing(new Error('no answer after 20000 ms'))
    timeout.enqueueSettings({ a: 1 })
    await settled(timeout)
    expect(timeout.getStatus().lastSaveFailure).toMatchObject({ message: 'no answer after 20000 ms', step: 'user_settings', status: null, code: null })

    const statusOnly = queueFailing(new WriteError('user_settings', 'bad gateway', 502, null))
    statusOnly.enqueueSettings({ a: 1 })
    await settled(statusOnly)
    expect(statusOnly.getStatus().lastSaveFailure).toMatchObject({ status: 502, code: null })

    const codeOnly = queueFailing(new WriteError('user_settings', 'odd', null, '22P02'))
    codeOnly.enqueueSettings({ a: 1 })
    await settled(codeOnly)
    expect(codeOnly.getStatus().lastSaveFailure).toMatchObject({ status: null, code: '22P02' })
  })

  it('names the request that was being made, whichever lane step failed: progress, hidden words, favourites, settings, own words (saves and deletes)', async () => {
    const fail = (which: string) => {
      const boom = () => { throw new WriteError(which, 'boom', 500, null) }
      return createWriteQueue(
        { sendProgress: async () => boom(), sendSettings: async () => boom(), sendHidden: async () => boom(), sendFavorites: async () => boom(), sendWords: async () => boom() },
        { retryDelaysMs: [], sleep: async () => {}, now: () => NOW },
      )
    }
    const steps: [string, (q: ReturnType<typeof fail>) => void][] = [
      ['user_progress', (q) => q.enqueueProgress(makeUpdate('a'))],
      ['user_hidden_words', (q) => q.enqueueHidden('a', true)],
      ['user_favorites', (q) => q.enqueueFavorite('a', true)],
      ['user_settings', (q) => q.enqueueSettings({ a: 1 })],
      ['user_words (saves)', (q) => q.enqueueCustomWord({ es_word: 'a' } as never)],
      ['user_words (deletes)', (q) => q.enqueueCustomDelete('a')],
    ]
    for (const [step, enqueue] of steps) {
      const queue = fail(step)
      enqueue(queue)
      await settled(queue as never)
      expect(queue.getStatus().lastSaveFailure?.step, step).toBe(step)
    }
  })

  it('stays after the queue recovers, while the current error clears: a failure that mended itself on a retry is still on record', async () => {
    const queue = queueFailing(new WriteError('user_settings', 'transient', 503, null))
    queue.enqueueSettings({ ui_language: 'ru' })
    await settled(queue)
    expect(queue.getStatus()).toMatchObject({ stuck: true, error: 'user_settings: transient' })
    await queue.retry()
    await settled(queue)
    const status = queue.getStatus()
    expect(status.unsaved).toBe(false)
    expect(status.stuck).toBe(false)
    expect(status.error).toBeNull() // nothing is wrong now
    expect(status.lastSaveFailure).toMatchObject({ message: 'user_settings: transient', status: 503 }) // but it was
  })

  it('a status of 0 (what supabase-js reports when the request got no answer at all) is no status', async () => {
    const queue = queueFailing(new WriteError('user_settings', 'TypeError: Failed to fetch', 0, null))
    queue.enqueueSettings({ a: 1 })
    await settled(queue)
    expect(queue.getStatus().lastSaveFailure).toMatchObject({ status: null, code: null })
  })

  it('is the latest failure when there are several', async () => {
    const queue = queueFailing(new WriteError('user_settings', 'first', 500, null), new WriteError('user_settings', 'second', 409, '23505'))
    queue.enqueueSettings({ a: 1 })
    await settled(queue)
    await queue.retry()
    await settled(queue)
    expect(queue.getStatus().lastSaveFailure).toMatchObject({ message: 'user_settings: second', status: 409, code: '23505' })
  })

  it('belongs to the main lane only: a metrics failure does not set it', async () => {
    const queue = queueFailing()
    queue.enqueueMetrics({ date: '2026-10-25' } as never)
    await settled(queue)
    await new Promise((r) => setTimeout(r, 20))
    expect(queue.getStatus().metricsError).toBe('user_daily_metrics: metrics boom')
    expect(queue.getStatus().lastSaveFailure).toBeNull()
  })

  it('a refusal for who is asking is a failure of the main lane too, with its status', async () => {
    const queue = queueFailing(new WriteError('user_settings', 'new row violates row-level security policy', 403, '42501'))
    queue.enqueueSettings({ a: 1 })
    await settled(queue)
    expect(queue.getStatus().authRejected).toBe(true)
    expect(queue.getStatus().lastSaveFailure).toMatchObject({ status: 403, code: '42501' })
  })

  it('progress failures count as well (the lane is one)', async () => {
    const sender: QueueSender = {
      sendProgress: async () => {
        throw new WriteError('user_progress', 'boom', 500, 'XX000')
      },
      sendSettings: async () => {},
    }
    const queue = createWriteQueue(sender, { retryDelaysMs: [], sleep: async () => {}, now: () => NOW })
    queue.enqueueProgress(makeUpdate('a'))
    await settled(queue as never)
    expect(queue.getStatus().lastSaveFailure).toMatchObject({ message: 'user_progress: boom', step: 'user_progress', status: 500, code: 'XX000' })
  })
})
