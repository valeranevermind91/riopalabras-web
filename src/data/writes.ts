import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyMetricsRow } from './metrics'
import type { ProgressUpdate, SettingsPatch, UserSettings } from './types'

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
  const { error } = await client
    .from('user_progress')
    .upsert(
      updates.map((u) => toProgressRow(userId, u, nowIso)),
      { onConflict: 'user_id,es_word' },
    )
  if (error) throw new Error(`user_progress: ${error.message}`)
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
  const { error } = await client
    .from('user_settings')
    .upsert({ user_id: userId, settings: merged, updated_at: now.toISOString() }, { onConflict: 'user_id' })
  if (error) throw new Error(`user_settings: ${error.message}`)
  return merged
}

/** One user_daily_metrics row, with exactly the columns the Flutter app pushed (no updated_at: the table fills it). */
export function toMetricsRow(userId: string, row: DailyMetricsRow) {
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
  }
}

/** Upserts daily metrics rows (push-only: nothing in the app ever reads this table back). Throws on any failure. */
export async function upsertDailyMetrics(client: SupabaseClient, userId: string, rows: readonly DailyMetricsRow[]): Promise<void> {
  if (rows.length === 0) return

  const { error } = await client
    .from('user_daily_metrics')
    .upsert(
      rows.map((r) => toMetricsRow(userId, r)),
      { onConflict: 'user_id,date' },
    )
  if (error) throw new Error(`user_daily_metrics: ${error.message}`)
}
