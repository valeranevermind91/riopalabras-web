import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { requestMessageAccess } from '../lib/telegram'
import { deviceTimezone, reminderFlag, supabaseReminderStore, syncTimezone, turnReminderOff, turnReminderOn, type ReminderPatch, type ReminderState, type ReminderStore } from './reminders'
import { isReviewablePos } from './words'

/** A store that remembers, in order, everything done to it. */
function fakeStore(partial: Partial<ReminderState> | null = null, failing: { read?: boolean; write?: boolean; update?: boolean } = {}) {
  const row: ReminderState | null = partial && { enabled: false, timezone: null, paused: false, unreachable: false, ...partial }
  const log: string[] = []
  const writes: ReminderPatch[] = []
  const updates: ReminderPatch[] = []
  const store: ReminderStore = {
    async read() {
      log.push('read')
      if (failing.read) throw new Error('offline')
      return row
    },
    async write(patch) {
      log.push('write')
      if (failing.write) throw new Error('offline')
      writes.push(patch)
    },
    async update(patch) {
      log.push('update')
      if (failing.update) throw new Error('offline')
      updates.push(patch)
    },
  }
  return { store, log, writes, updates }
}

describe('turning the reminder on', () => {
  it('asks Telegram first and writes the row only once it has said yes, with the device time zone', async () => {
    const { store, log, writes } = fakeStore()
    let answer!: (granted: boolean) => void
    const pending = turnReminderOn(store, () => new Promise((resolve) => (answer = resolve)), 'America/Montevideo')
    await Promise.resolve()
    expect(writes).toEqual([]) // the popup is still open: nothing is written
    expect(log).toEqual([])
    answer(true)
    expect(await pending).toBe('on')
    expect(writes).toEqual([{ enabled: true, timezone: 'America/Montevideo' }])
    expect(log).toEqual(['write'])
  })

  it('writes nothing at all when Telegram says no', async () => {
    const { store, log } = fakeStore()
    expect(await turnReminderOn(store, async () => false, 'America/Montevideo')).toBe('declined')
    expect(log).toEqual([])
  })

  it('treats a prompt that fails as a refusal, and writes nothing', async () => {
    const { store, log } = fakeStore()
    expect(
      await turnReminderOn(
        store,
        async () => {
          throw new Error('no such method')
        },
        'UTC',
      ),
    ).toBe('declined')
    expect(log).toEqual([])
  })

  it('is "failed" when permission was given but the row could not be saved', async () => {
    const { store, writes } = fakeStore(null, { write: true })
    expect(await turnReminderOn(store, async () => true, 'UTC')).toBe('failed')
    expect(writes).toEqual([])
  })

  it('leaves the time zone out when the device will not say, rather than writing an empty one', async () => {
    const { store, writes } = fakeStore()
    await turnReminderOn(store, async () => true, null)
    expect(writes).toEqual([{ enabled: true }])
  })
})

describe('turning it off', () => {
  it('changes the existing row only, and asks nothing', async () => {
    const { store, log, updates } = fakeStore({ enabled: true, timezone: 'UTC' })
    expect(await turnReminderOff(store)).toBe(true)
    expect(updates).toEqual([{ enabled: false }])
    expect(log).toEqual(['update'])
  })

  it('says so when it could not be saved', async () => {
    expect(await turnReminderOff(fakeStore({ enabled: true, timezone: 'UTC' }, { update: true }).store)).toBe(false)
  })
})

describe('why a switched-on reminder is not arriving', () => {
  it('is "unreachable" when Telegram cannot deliver, "paused" when the job paused it, and unreachable first when both', () => {
    expect(reminderFlag({ enabled: true, paused: false, unreachable: true })).toBe('unreachable')
    expect(reminderFlag({ enabled: true, paused: true, unreachable: false })).toBe('paused')
    expect(reminderFlag({ enabled: true, paused: true, unreachable: true })).toBe('unreachable')
  })

  it('is nothing when all is well, when the reminder is off (the flags mean nothing then), and when there is no row', () => {
    expect(reminderFlag({ enabled: true, paused: false, unreachable: false })).toBeNull()
    expect(reminderFlag({ enabled: false, paused: true, unreachable: true })).toBeNull()
    expect(reminderFlag(null)).toBeNull()
  })
})

describe('the time zone at every app open', () => {
  it('is written when it has changed (people travel), as the only thing written', async () => {
    const { store, updates, writes } = fakeStore({ enabled: true, timezone: 'Europe/Madrid' })
    expect(await syncTimezone(store, 'America/Montevideo')).toBe('updated')
    expect(updates).toEqual([{ timezone: 'America/Montevideo' }])
    expect(writes).toEqual([])
  })

  it('is not written when it is the same', async () => {
    const { store, log } = fakeStore({ enabled: true, timezone: 'America/Montevideo' })
    expect(await syncTimezone(store, 'America/Montevideo')).toBe('same')
    expect(log).toEqual(['read'])
  })

  it('is not written for someone with no row: opening the app must not create one', async () => {
    const { store, log } = fakeStore(null)
    expect(await syncTimezone(store, 'America/Montevideo')).toBe('no-row')
    expect(log).toEqual(['read'])
  })

  it('also keeps a turned-off row current, and fills in a row that has no zone', async () => {
    const off = fakeStore({ enabled: false, timezone: 'Europe/Madrid' })
    expect(await syncTimezone(off.store, 'Asia/Tokyo')).toBe('updated')
    const blank = fakeStore({ enabled: true, timezone: null })
    expect(await syncTimezone(blank.store, 'Asia/Tokyo')).toBe('updated')
  })

  it('does nothing when the device will not say its zone', async () => {
    const { store, log } = fakeStore({ enabled: true, timezone: 'UTC' })
    expect(await syncTimezone(store, null)).toBe('unknown')
    expect(log).toEqual(['read'])
  })

  it('uses the row it is given instead of reading again', async () => {
    const { store, log } = fakeStore({ enabled: true, timezone: 'UTC' })
    expect(await syncTimezone(store, 'UTC', { timezone: 'UTC' })).toBe('same')
    expect(log).toEqual([])
  })

  it('never throws: a read or a write that fails is just not done', async () => {
    expect(await syncTimezone(fakeStore(null, { read: true }).store, 'UTC')).toBe('failed')
    expect(await syncTimezone(fakeStore({ enabled: true, timezone: 'Europe/Madrid' }, { update: true }).store, 'UTC')).toBe('failed')
  })

  it('reads the device zone as an IANA name (the tests run in America/Montevideo)', () => {
    expect(deviceTimezone()).toBe('America/Montevideo')
  })
})

describe('the reminders table, as the app talks to it', () => {
  function recordingClient(result: { data?: unknown; error?: { message: string } | null } = { data: null, error: null }) {
    const calls: { table: string; op: string; args: unknown[] }[] = []
    const chain = (table: string, op: string, args: unknown[]) => {
      calls.push({ table, op, args })
      const builder: Record<string, unknown> = {
        eq: (...a: unknown[]) => (calls.push({ table, op: 'eq', args: a }), builder),
        select: (...a: unknown[]) => (calls.push({ table, op: 'select', args: a }), builder),
        maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }),
        then: (resolve: (value: unknown) => void) => resolve({ error: result.error ?? null }),
      }
      return builder
    }
    const client = { from: (table: string) => ({ select: (...a: unknown[]) => chain(table, 'select', a), upsert: (...a: unknown[]) => chain(table, 'upsert', a), update: (...a: unknown[]) => chain(table, 'update', a) }) }
    return { client: client as unknown as SupabaseClient, calls }
  }

  it('writes only the two columns the user owns, keyed by their id, to the reminders table and nowhere else', async () => {
    const { client, calls } = recordingClient()
    const store = supabaseReminderStore(client, 'user-1')
    await store.write({ enabled: true, timezone: 'America/Montevideo' })
    await store.update({ timezone: 'Asia/Tokyo' })
    await store.update({ enabled: false })
    expect(calls.filter((c) => c.table !== 'reminders')).toEqual([]) // never the settings blob, never another table
    expect(calls[0]).toEqual({ table: 'reminders', op: 'upsert', args: [{ user_id: 'user-1', enabled: true, timezone: 'America/Montevideo' }, { onConflict: 'user_id' }] })
    expect(calls.filter((c) => c.op === 'update').map((c) => c.args[0])).toEqual([{ timezone: 'Asia/Tokyo' }, { enabled: false }])
    expect(calls.filter((c) => c.op === 'eq').map((c) => c.args)).toEqual([['user_id', 'user-1'], ['user_id', 'user-1']])
    for (const call of calls.filter((c) => c.op === 'upsert' || c.op === 'update')) {
      const columns = Object.keys(call.args[0] as object).filter((k) => k !== 'user_id')
      expect(columns.every((k) => k === 'enabled' || k === 'timezone')).toBe(true)
    }
  })

  it('reads its own row and nothing else of it', async () => {
    const { client, calls } = recordingClient({ data: { enabled: true, timezone: 'UTC', paused: true, unreachable: false } })
    expect(await supabaseReminderStore(client, 'user-1').read()).toEqual({ enabled: true, timezone: 'UTC', paused: true, unreachable: false })
    expect(calls.find((c) => c.op === 'select')!.args).toEqual(['enabled, timezone, paused, unreachable']) // the two the user may read, and the two they may write
    // a row from a database that has never heard of the flags reads as "not paused, reachable"
    const old = recordingClient({ data: { enabled: true, timezone: 'UTC' } })
    expect(await supabaseReminderStore(old.client, 'user-1').read()).toEqual({ enabled: true, timezone: 'UTC', paused: false, unreachable: false })
    const none = recordingClient({ data: null })
    expect(await supabaseReminderStore(none.client, 'user-1').read()).toBeNull()
  })

  it('turns a database error into a thrown error, so a failed save is never taken for a saved one', async () => {
    const { client } = recordingClient({ error: { message: 'row-level security' } })
    const store = supabaseReminderStore(client, 'user-1')
    await expect(store.write({ enabled: true })).rejects.toThrow('row-level security')
    await expect(store.update({ enabled: false })).rejects.toThrow('row-level security')
    await expect(store.read()).rejects.toThrow('row-level security')
  })
})

describe("Telegram's permission prompt", () => {
  const ask = (granted: unknown) => ({ requestWriteAccess: (cb?: (g: boolean) => void) => cb?.(granted as boolean) })

  it('is true only when the user agreed', async () => {
    expect(await requestMessageAccess(ask(true))).toBe(true)
    expect(await requestMessageAccess(ask(false))).toBe(false)
    expect(await requestMessageAccess(ask(undefined))).toBe(false)
  })

  it('is false where Telegram cannot ask: no method, a version before 6.9, a method that throws', async () => {
    expect(await requestMessageAccess({})).toBe(false)
    expect(await requestMessageAccess({ ...ask(true), isVersionAtLeast: (v: string) => v !== '6.9' })).toBe(false)
    expect(await requestMessageAccess({ ...ask(true), isVersionAtLeast: () => true })).toBe(true)
    expect(
      await requestMessageAccess({
        requestWriteAccess: () => {
          throw new Error('x')
        },
      }),
    ).toBe(false)
  })
})

describe('which parts of speech Review skips', () => {
  // The daily-reminder job (riopalabras-proxy, reminders.js: NON_REVIEWABLE_POS) counts what is due with this same list, so the number in
  // the message matches Review. If this test has to change, change that list too. ('letter' was added here first: reminders.js in the proxy repo
  // still has to get it, or a reminder can count a learned letter that Review no longer shows.)
  it('is art, prep, conj, contraction, determiner, pron and letter, in any case, and nothing else', () => {
    for (const pos of ['art', 'prep', 'conj', 'contraction', 'determiner', 'pron', 'letter', 'ART', 'Prep', 'Letter']) expect(isReviewablePos(pos), pos).toBe(false)
    for (const pos of ['n', 'v', 'adj', 'adv', 'num', 'interj', 'custom', 'phrase']) expect(isReviewablePos(pos), pos).toBe(true)
  })
})

describe('the wiring in App', () => {
  // App is not rendered by any test, and a toggle that App forgot to hand a control would sit disabled for ever, so the wiring is pinned.
  it('creates the reminder store for the signed-in user, runs the hook at the top level, and hands the control to Settings', async () => {
    const { readFileSync } = await import('node:fs')
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toContain('supabaseReminderStore(client, userId)')
    expect(app).toMatch(/const reminders = useReminders\(reminderStore\)/)
    expect(app).toMatch(/<SettingsScreen[\s\S]*?reminders=\{reminders\}[\s\S]*?\/>/)
  })
})
