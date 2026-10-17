import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyMetricsRow } from './metrics'
import type { ReviewLogEntry } from './reviewLog'
import { mergeSettingsRaw } from './settings'
import type { CustomWordOp, ProgressUpdate, SettingsPatch, UserSettings } from './types'

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

const AUTH_MESSAGE = /jwt|token.*(expired|invalid)|invalid.*token|not authenticated|no api key|invalid api key|row-level security|permission denied/i

/**
 * True when the server refused the write for who is asking, not for how it is asking: a missing or expired login (401,
 * a JWT error), a policy refusing the row (403, 42501, row-level security), or no session at all on this device.
 * Sending the same request again cannot change that; only a usable session can.
 */
export function isRejection(err: unknown): boolean {
  if (!(err instanceof WriteError)) return false
  return err.status === 401 || err.status === 403 || err.code === '42501' || err.code === 'PGRST301' || err.code === 'PGRST300' || err.code === 'NO_SESSION' || AUTH_MESSAGE.test(err.message)
}

/**
 * A write the database will never accept as it stands: one of its rows breaks a rule (SQLSTATE 22xxx, a bad value; 23xxx, a constraint). That is not
 * "try again later", and not a refusal for who is asking. It is judged by the code alone: a problem with the request as a whole (a missing table or
 * column, PGRST codes) is not about one row and must never be taken for it.
 */
export function isDataError(err: unknown): boolean {
  return err instanceof WriteError && !isRejection(err) && /^2[23][0-9A-Z]{3}$/.test(err.code ?? '')
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
 * client doesn't own (learn_picks, pending_word_deletes, …) are preserved, and a key patched to null is removed. Returns the blob written.
 */
export async function writeSettings(
  client: SupabaseClient,
  userId: string,
  current: UserSettings,
  patch: SettingsPatch,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const merged = mergeSettingsRaw(current.raw, patch)
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
 * Writes a word flag's changes to its table (user_hidden_words, user_favorites) the way the Flutter app did: additions are
 * one upsert on (user_id, es_word) (created_at is left to the database default), removals one delete by es_word. Both are
 * safe to repeat. Throws on any failure.
 */
async function writeWordFlags(client: SupabaseClient, userId: string, table: 'user_hidden_words' | 'user_favorites', ops: readonly { esWord: string; on: boolean }[]): Promise<void> {
  const added = ops.filter((o) => o.on).map((o) => ({ user_id: userId, es_word: o.esWord }))
  const removed = ops.filter((o) => !o.on).map((o) => o.esWord)

  if (added.length > 0) {
    const { error, status } = await client.from(table).upsert(added, { onConflict: 'user_id,es_word' })
    if (error) fail(table, error, status)
  }
  if (removed.length > 0) {
    const { error, status } = await client.from(table).delete().eq('user_id', userId).in('es_word', removed)
    if (error) fail(table, error, status)
  }
}

export const writeHiddenWords = (client: SupabaseClient, userId: string, ops: readonly { esWord: string; hidden: boolean }[]) =>
  writeWordFlags(client, userId, 'user_hidden_words', ops.map((o) => ({ esWord: o.esWord, on: o.hidden })))

export const writeFavoriteWords = (client: SupabaseClient, userId: string, ops: readonly { esWord: string; favorite: boolean }[]) =>
  writeWordFlags(client, userId, 'user_favorites', ops.map((o) => ({ esWord: o.esWord, on: o.favorite })))

/**
 * Writes custom-word changes to user_words the way the Flutter app does: saves are one upsert on (user_id, es_word), with
 * es_word as typed and without id, created_at (the database fills it on insert and leaves it on update) or
 * word_form_in_example (no such column); deletes are one request per word, matched by the word's STORED casing. (A lowercased
 * key silently matches no row for a capitalised word.) Both are safe to repeat. Throws on any failure.
 */
export async function writeCustomWords(client: SupabaseClient, userId: string, ops: readonly CustomWordOp[]): Promise<void> {
  const saved = ops.flatMap((op) => (op.kind === 'save' ? [{ user_id: userId, ...op.row }] : []))
  if (saved.length > 0) {
    const { error, status } = await client.from('user_words').upsert(saved, { onConflict: 'user_id,es_word' })
    if (error) fail('user_words', error, status)
  }
  for (const op of ops) {
    if (op.kind !== 'delete') continue
    const { error, status } = await client.from('user_words').delete().eq('user_id', userId).eq('es_word', op.esWord)
    if (error) fail('user_words', error, status)
  }
}

/** One review_log row, in the table's columns. stability_after and difficulty_after are for a later scheduler and are not filled in; algo says which scheduler made the numbers. */
export function toReviewLogRow(userId: string, entry: ReviewLogEntry) {
  return {
    id: entry.id,
    user_id: userId,
    es_word: entry.esWord,
    reviewed_at: entry.reviewedAt,
    rating: entry.rating,
    mode: entry.mode,
    state_before: entry.stateBefore,
    elapsed_days: entry.elapsedDays,
    scheduled_days: entry.scheduledDays,
    interval_after: entry.intervalAfter,
    ease_after: entry.easeAfter,
    repetitions_after: entry.repetitionsAfter,
    stability_after: null,
    difficulty_after: null,
    algo: 'sm2',
    session_id: entry.sessionId,
    duration_ms: entry.durationMs,
  }
}

/**
 * Appends review_log rows. The log is append-only (the client may SELECT and INSERT and nothing else), and every row has an id made on the client,
 * so the insert is "ignore a duplicate id": INSERT ... ON CONFLICT (id) DO NOTHING. A retry, or a replay of a row that did arrive, then changes nothing
 * and is not an error. (It must not be a merging upsert: that is an UPDATE, which the table refuses.) Throws on any failure.
 */
export async function insertReviewLog(client: SupabaseClient, userId: string, entries: readonly ReviewLogEntry[]): Promise<void> {
  if (entries.length === 0) return
  const { error, status } = await client.from('review_log').upsert(
    entries.map((e) => toReviewLogRow(userId, e)),
    { onConflict: 'id', ignoreDuplicates: true },
  )
  if (error) fail('review_log', error, status)
}
