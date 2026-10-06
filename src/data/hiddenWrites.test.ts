import { describe, expect, it, vi } from 'vitest'
import { makeUpdate } from '../testing/makeWord'
import { bindClosingConfirmation } from './queueTriggers'
import { writeHiddenWords } from './writes'
import { createWriteQueue, type HiddenOp } from './writeQueue'

/** A Supabase stand-in with the three calls hidden-word writes use: upsert, delete().eq().in(). */
function fakeHiddenClient(failure: { upsert?: string; delete?: string } = {}) {
  const calls: { op: string; table: string; payload?: unknown; options?: unknown; filters?: [string, unknown][] }[] = []
  const client = {
    from: (table: string) => ({
      upsert: async (payload: unknown, options: unknown) => {
        calls.push({ op: 'upsert', table, payload, options })
        return { error: failure.upsert ? { message: failure.upsert } : null }
      },
      delete: () => {
        const filters: [string, unknown][] = []
        const chain = {
          eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
          in: async (c: string, v: unknown) => {
            filters.push([c, v])
            calls.push({ op: 'delete', table, filters })
            return { error: failure.delete ? { message: failure.delete } : null }
          },
        }
        return chain
      },
    }),
  }
  return { client: client as never, calls }
}

describe('writeHiddenWords (user_hidden_words, the way Flutter wrote it)', () => {
  it('additions are one upsert on (user_id, es_word) with the dictionary casing', async () => {
    const f = fakeHiddenClient()
    await writeHiddenWords(f.client, 'user-1', [{ esWord: 'Hacienda', hidden: true }, { esWord: 'casa', hidden: true }])
    expect(f.calls).toEqual([
      { op: 'upsert', table: 'user_hidden_words', payload: [{ user_id: 'user-1', es_word: 'Hacienda' }, { user_id: 'user-1', es_word: 'casa' }], options: { onConflict: 'user_id,es_word' } },
    ])
  })

  it('removals are one delete for this user and those words', async () => {
    const f = fakeHiddenClient()
    await writeHiddenWords(f.client, 'user-1', [{ esWord: 'casa', hidden: false }, { esWord: 'perro', hidden: false }])
    expect(f.calls).toEqual([{ op: 'delete', table: 'user_hidden_words', filters: [['user_id', 'user-1'], ['es_word', ['casa', 'perro']]] }])
  })

  it('a mixed batch does both, and an empty one does nothing', async () => {
    const f = fakeHiddenClient()
    await writeHiddenWords(f.client, 'u', [{ esWord: 'a', hidden: true }, { esWord: 'b', hidden: false }])
    expect(f.calls.map((c) => c.op)).toEqual(['upsert', 'delete'])
    const g = fakeHiddenClient()
    await writeHiddenWords(g.client, 'u', [])
    expect(g.calls).toHaveLength(0)
  })

  it('throws (never swallows) when Supabase reports an error', async () => {
    await expect(writeHiddenWords(fakeHiddenClient({ upsert: 'denied' }).client, 'u', [{ esWord: 'a', hidden: true }])).rejects.toThrow('user_hidden_words: denied')
    await expect(writeHiddenWords(fakeHiddenClient({ delete: 'denied' }).client, 'u', [{ esWord: 'a', hidden: false }])).rejects.toThrow('user_hidden_words: denied')
  })
})

describe('the hidden lane of the write queue', () => {
  function harness(options: Parameters<typeof createWriteQueue>[1] = {}) {
    const sent: HiddenOp[][] = []
    const order: string[] = []
    const failures = { hidden: 0 }
    const queue = createWriteQueue(
      {
        sendProgress: async () => void order.push('progress'),
        sendSettings: async () => void order.push('settings'),
        sendHidden: async (ops) => {
          order.push('hidden')
          if (failures.hidden > 0) {
            failures.hidden--
            throw new Error('hidden failed')
          }
          sent.push([...ops])
        },
      },
      { retryDelaysMs: [1, 1, 1], sleep: () => Promise.resolve(), ...options },
    )
    return { queue, sent, order, failures }
  }
  const idle = (q: ReturnType<typeof harness>['queue']) => vi.waitFor(() => expect(q.getStatus().unsaved).toBe(false))

  it('sends hide and un-hide, keeping only the latest state per word (mark then undo is one removal)', async () => {
    const h = harness()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow = createWriteQueue({ sendProgress: async () => gate, sendSettings: async () => {}, sendHidden: async (ops) => void h.sent.push([...ops]) }, { sleep: () => Promise.resolve() })
    slow.enqueueProgress(makeUpdate('x')) // keeps the queue busy so the hidden ops pile up
    slow.enqueueHidden('Casa', true)
    slow.enqueueHidden('perro', true)
    slow.enqueueHidden('casa', false) // undo, same word in another casing
    expect(slow.getStatus().pendingHidden).toBe(2)
    release()
    await idle(slow)
    expect(h.sent).toEqual([[{ esWord: 'casa', hidden: false }, { esWord: 'perro', hidden: true }]]) // one entry per word, newest state
  })

  it('goes after progress and before settings, in the same drain', async () => {
    const h = harness()
    h.queue.enqueueProgress(makeUpdate('a'))
    h.queue.enqueueHidden('b', true)
    h.queue.enqueueSettings({ streak_count: 1 })
    await idle(h.queue)
    expect(h.order).toEqual(['progress', 'hidden', 'settings'])
  })

  it('counts as unsaved, so the closing confirmation turns on while a hide is waiting and off once it is sent', async () => {
    const h = harness()
    const calls: boolean[] = []
    const unbind = bindClosingConfirmation(h.queue, (on) => calls.push(on))
    h.failures.hidden = 99
    h.queue.enqueueHidden('casa', true)
    expect(h.queue.getStatus()).toMatchObject({ pendingHidden: 1, unsaved: true })
    expect(calls).toEqual([true])
    await vi.waitFor(() => expect(h.queue.getStatus().stuck).toBe(true))
    expect(h.queue.getStatus()).toMatchObject({ pendingHidden: 1, failed: true }) // kept, never lost
    h.failures.hidden = 0
    expect(await h.queue.retry()).toBe(true)
    expect(h.sent).toEqual([[{ esWord: 'casa', hidden: true }]])
    expect(h.queue.getStatus().pendingHidden).toBe(0)
    expect(calls).toEqual([true, false])
    unbind()
  })

  it('retries like any other write, and a stuck hide shows the Home banner state (stuck)', async () => {
    const h = harness()
    h.failures.hidden = 2
    h.queue.enqueueHidden('casa', true)
    await idle(h.queue)
    expect(h.sent).toHaveLength(1)
    expect(h.queue.getStatus().stuck).toBe(false)
  })

  it('a hide that lands after the first attempt succeeded server-side is repeated safely (the write is idempotent)', async () => {
    const f = fakeHiddenClient()
    await writeHiddenWords(f.client, 'u', [{ esWord: 'casa', hidden: true }])
    await writeHiddenWords(f.client, 'u', [{ esWord: 'casa', hidden: true }])
    expect(f.calls.map((c) => c.options)).toEqual([{ onConflict: 'user_id,es_word' }, { onConflict: 'user_id,es_word' }])
  })

  it('without a hidden sender nothing is queued (and so nothing can hang the queue)', () => {
    const q = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
    q.enqueueHidden('casa', true)
    expect(q.getStatus()).toMatchObject({ pendingHidden: 0, unsaved: false })
  })
})
