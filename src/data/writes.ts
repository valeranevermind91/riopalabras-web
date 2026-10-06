import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyMetricsRow } from './metrics'
import type { ProgressUpdate, SettingsPatch, UserSettings } from './types'

/** A failed write, with what the server said, so the queue can tell "try again" from "this request will never be accepted". */
export class WriteError extends Error {
  readonly table: string
  readonly status: number | null
  readonly code: string | null

  constructor(table: string, message: string, status: number | null = null, code: string | null = null) {
    super(`${table}: ${message}`)
    this.name = 'WriteError'
    this.table = table
    this.status = status
    this.code = code
  }
}

const fail = (table: string, error: { message: string; code?: string }, status: number | null): never => {
  throw new WriteError(table, error.message, status, error.code || null)
}

export function toProgressRow(userId: string, update: ProgressUpdate, nowIso: string) {
  return {
    user_id: userId,
    // Original dictionary casing, as the Flutter app wrote it: Postgres conflict matching is case-sensitive.
    es_word: update.esWord,
    ease_factor: update.easeFactor,
    interval_days: update.interval,
    repetitions: update.repetitions,
    next_review: update.nextReview.toISOString(),
    updated_at: nowIso,
  }
}

/** Upserts SM-2 state for the given words. Throws on any failure; nothing is retried or swallowed. */
export async function upsertProgress(
  client: SupabaseClient,
  userId: string,
  updates: readonly ProgressUpdate[],
  now: Date = new Date(),
): Promise<void> {
  if (updates.length === 0) return

  const nowIso = now.toISOString()
  const { error, status } = await client
    .from('user_progress')
    .upsert(
      updates.map((u) => toProgressRow(userId, u, nowIso)),
      { onConflict: 'user_id,es_word' },
    )
  if (error) fail('user_progress', error, status)
}

/**
 * Writes `patch` over the user's WHOLE settings blob, merged from the in-memory copy so keys this
 * client doesn't own (learn_picks, pending_word_deletes, …) are preserved. Returns the blob written.
 */
export async function writeSettings(
  client: SupabaseClient,
  userId: string,
  current: UserSettings,
  patch: SettingsPatch,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const merged = { ...current.raw, ...patch }
  const { error, status } = await client
    .from('user_settings')
    .upsert({ user_id: userId, settings: merged, updated_at: now.toISOString() }, { onConflict: 'user_id' })
  if (error) fail('user_settings', error, status)
  return merged
}

/**
 * One user_daily_metrics row: the columns the Flutter app pushed, plus updated_at. Flutter never
 * sent updated_at, so on an update the column kept its insert-time value and could not tell anyone
 * when the row was last written; the web client sets it on every push.
 */
export function toMetricsRow(userId: string, row: DailyMetricsRow, nowIso: string) {
  return {
    user_id: userId,
    date: row.date,
    new_words: row.newWords,
    reviews_done: row.reviewsDone,
    reviews_lapsed: row.reviewsLapsed,
    due_at_start: row.dueAtStart,
    learn_pool: row.learnPool,
    daily_limit: row.dailyLimit,
    active: row.active,
    updated_at: nowIso,
  }
}

/** Upserts daily metrics rows (push-only: nothing in the app ever reads this table back for its own logic). Throws on any failure. */
export async function upsertDailyMetrics(
  client: SupabaseClient,
  userId: string,
  rows: readonly DailyMetricsRow[],
  now: Date = new Date(),
): Promise<void> {
  if (rows.length === 0) return

  const nowIso = now.toISOString()
  const { error, status } = await client
    .from('user_daily_metrics')
    .upsert(
      rows.map((r) => toMetricsRow(userId, r, nowIso)),
      { onConflict: 'user_id,date' },
    )
  if (error) fail('user_daily_metrics', error, status)
}

/**
 * Writes hidden-word changes to user_hidden_words the way the Flutter app did: additions are one upsert
 * on (user_id, es_word) (created_at is left to the database default), removals one delete by es_word.
 * Both are safe to repeat. Throws on any failure.
 */
export async function writeHiddenWords(client: SupabaseClient, userId: string, ops: readonly { esWord: string; hidden: boolean }[]): Promise<void> {
  const added = ops.filter((o) => o.hidden).map((o) => ({ user_id: userId, es_word: o.esWord }))
  const removed = ops.filter((o) => !o.hidden).map((o) => o.esWord)

  if (added.length > 0) {
    const { error, status } = await client.from('user_hidden_words').upsert(added, { onConflict: 'user_id,es_word' })
    if (error) fail('user_hidden_words', error, status)
  }
  if (removed.length > 0) {
    const { error, status } = await client.from('user_hidden_words').delete().eq('user_id', userId).in('es_word', removed)
    if (error) fail('user_hidden_words', error, status)
  }
}
