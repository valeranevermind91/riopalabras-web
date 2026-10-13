import type { SupabaseClient } from '@supabase/supabase-js'

// The daily reminder. The bot sends it (the riopalabras-proxy repo's reminders job); this is the app's side: whether the user wants it, and
// the time zone the 20:00 is in; and it can say why nothing is arriving (the job paused it, or Telegram cannot deliver). All of it lives in its own table, `reminders`, one row per user, NOT in the settings blob: the app writes that
// blob whole, so anything the server keeps in it would be overwritten. The user may write exactly two columns of their row, enabled and
// timezone, and read paused and unreachable (row-level security and column privileges, see the proxy's sql/reminders.sql); the rest of the row is
// the job's.

export interface ReminderState {
  enabled: boolean
  timezone: string | null
  /** Set by the job after several reminders in a row led to no study. The user cannot change it; turning the reminder off and on clears it. */
  paused: boolean
  /** Set by the job when Telegram cannot deliver to this user (blocked the bot, never started it). Cleared the same way. */
  unreachable: boolean
}

export type ReminderFlag = 'paused' | 'unreachable'

/**
 * Why a reminder that is switched on is not arriving, if it is not: unreachable (Telegram cannot deliver) before paused. Nothing when it is
 * off (the flags mean nothing then), or when there is no row.
 */
export function reminderFlag(row: Pick<ReminderState, 'enabled' | 'paused' | 'unreachable'> | null): ReminderFlag | null {
  if (!row || !row.enabled) return null
  return row.unreachable ? 'unreachable' : row.paused ? 'paused' : null
}

export type ReminderPatch = { enabled?: boolean; timezone?: string }

export interface ReminderStore {
  /** The user's row, or null when there is none (never turned on). Throws when it cannot be read. */
  read(): Promise<ReminderState | null>
  /** Creates the row or changes it: used to turn the reminder on. Throws on failure. */
  write(patch: ReminderPatch): Promise<void>
  /** Changes an existing row and never creates one. Throws on failure. */
  update(patch: ReminderPatch): Promise<void>
}

/** The device's time zone as an IANA name (America/Montevideo), or null where the browser will not say. */
export function deviceTimezone(): string | null {
  try {
    const name = new Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof name === 'string' && name !== '' ? name : null
  } catch {
    return null
  }
}

export function supabaseReminderStore(client: SupabaseClient, userId: string): ReminderStore {
  return {
    async read() {
      const { data, error } = await client.from('reminders').select('enabled, timezone, paused, unreachable').eq('user_id', userId).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return null
      return { enabled: data.enabled === true, timezone: typeof data.timezone === 'string' ? data.timezone : null, paused: data.paused === true, unreachable: data.unreachable === true }
    },
    async write(patch) {
      const { error } = await client.from('reminders').upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
      if (error) throw new Error(error.message)
    },
    async update(patch) {
      const { error } = await client.from('reminders').update(patch).eq('user_id', userId)
      if (error) throw new Error(error.message)
    },
  }
}

export type TurnOnResult = 'on' | 'declined' | 'failed'

/**
 * Turning the reminder on: Telegram is asked first (the bot may only message someone who allows it), and the row is written only if the
 * answer is yes. A refusal writes nothing at all. A granted permission whose save then fails is 'failed': the toggle stays off.
 */
export async function turnReminderOn(store: ReminderStore, askAccess: () => Promise<boolean>, timezone: string | null): Promise<TurnOnResult> {
  let granted = false
  try {
    granted = await askAccess()
  } catch {
    granted = false
  }
  if (!granted) return 'declined'
  try {
    await store.write({ enabled: true, ...(timezone ? { timezone } : {}) })
  } catch {
    return 'failed'
  }
  return 'on'
}

/** Turning it off only says "off" in the row; nothing needs asking. Returns whether it was saved. */
export async function turnReminderOff(store: ReminderStore): Promise<boolean> {
  try {
    await store.update({ enabled: false })
    return true
  } catch {
    return false
  }
}

export type TimezoneSync = 'no-row' | 'same' | 'unknown' | 'updated' | 'failed'

/**
 * At every app open: if the user has a reminder row and the device's time zone is not the one on it (people travel), write the new one.
 * Writes only when it changed, never creates a row (someone who never turned the reminder on has none), and never throws.
 */
export async function syncTimezone(store: ReminderStore, timezone: string | null, known?: Pick<ReminderState, 'timezone'> | null): Promise<TimezoneSync> {
  try {
    const row = known === undefined ? await store.read() : known
    if (!row) return 'no-row'
    if (!timezone) return 'unknown'
    if (row.timezone === timezone) return 'same'
    await store.update({ timezone })
    return 'updated'
  } catch {
    return 'failed'
  }
}
