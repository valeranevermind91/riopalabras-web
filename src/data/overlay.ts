import type { SupabaseClient } from '@supabase/supabase-js'
import { loadLog, type LoadLog } from './loadLog'
import { TableLoadError, loadWithRetry, type RetryOptions } from './retry'

// Supabase caps a single select at 1000 rows by default; user_progress alone can exceed that.
const PAGE_SIZE = 1000

export interface UserWordRow {
  es_word: string
  es_rioplatense: string | null
  en_translation: string | null
  ru_translation: string | null
  example_sentence: string | null
  example_translation_en: string | null
  example_translation_ru: string | null
  is_rioplatense_variant: boolean | null
  pos: string | null
}

export interface ProgressRow {
  es_word: string
  ease_factor: number | null
  interval_days: number | null
  repetitions: number | null
  next_review: string | null
}

export interface Overlay {
  customWords: UserWordRow[]
  progress: ProgressRow[]
  favorites: string[]
  hidden: string[]
  settings: Record<string, unknown> | null
}

async function fetchAll<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  userId: string,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error, status } = await client
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .order('es_word')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new TableLoadError(table, error.message, status ?? null, error.code || null)

    const page = (data ?? []) as unknown as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

async function fetchSettings(client: SupabaseClient, userId: string): Promise<Record<string, unknown> | null> {
  const { data, error, status } = await client
    .from('user_settings')
    .select('settings')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new TableLoadError('user_settings', error.message, status ?? null, error.code || null)

  const blob = data?.settings
  return blob && typeof blob === 'object' && !Array.isArray(blob) ? (blob as Record<string, unknown>) : null
}

const WORD_COLUMNS =
  'es_word, es_rioplatense, en_translation, ru_translation, example_sentence, example_translation_en, example_translation_ru, is_rioplatense_variant, pos'

/** Without these the app would show wrong progress or lose the user's own words: a failure here is an error. */
export const CRITICAL_TABLES = ['user_words', 'user_progress', 'user_settings'] as const
/** The app works without these for a while: a failure here only degrades it (see loadOverlay). */
export const NON_CRITICAL_TABLES = ['user_favorites', 'user_hidden_words'] as const
export type NonCriticalTable = (typeof NON_CRITICAL_TABLES)[number]

export interface LoadedOverlay {
  overlay: Overlay
  /** Non-critical tables that still failed after the retries; their lists are empty in `overlay` for now. */
  degraded: readonly NonCriticalTable[]
}

type LoadOptions = Omit<RetryOptions, 'log' | 'refreshSession'> & { log?: LoadLog }

/** One shared session refresh per load, so several tables hitting a 401 together don't refresh in parallel. */
function sharedRefresh(client: SupabaseClient): () => Promise<void> {
  let pending: Promise<void> | null = null
  return () => {
    pending ??= client.auth.refreshSession().then(({ error }) => {
      if (error) throw error
    })
    return pending
  }
}

/**
 * Read-only. RLS already scopes rows to the signed-in user; the user_id filter is belt-and-braces.
 * Every table is read with retries (1s / 3s / 8s for transient failures; an auth failure refreshes the session once).
 * A table that is critical and still fails makes the whole load fail. A favorites or hidden-words failure does not:
 * the rest loads and the table is reported in `degraded` for the caller to keep retrying in the background.
 */
export async function loadOverlay(client: SupabaseClient, userId: string, options: LoadOptions = {}): Promise<LoadedOverlay> {
  const retry: RetryOptions = { ...options, log: options.log ?? loadLog, refreshSession: sharedRefresh(client) }
  const read = <T>(table: string, load: () => Promise<T>) => loadWithRetry(table, load, retry)
  const soft = async <T>(table: NonCriticalTable, load: () => Promise<T>, fallback: T): Promise<{ value: T; failed: boolean }> => {
    try {
      return { value: await read(table, load), failed: false }
    } catch {
      return { value: fallback, failed: true } // already logged by loadWithRetry
    }
  }

  const [customWords, progress, settings, favorites, hidden] = await Promise.all([
    read('user_words', () => fetchAll<UserWordRow>(client, 'user_words', WORD_COLUMNS, userId)),
    read('user_progress', () => fetchAll<ProgressRow>(client, 'user_progress', 'es_word, ease_factor, interval_days, repetitions, next_review', userId)),
    read('user_settings', () => fetchSettings(client, userId)),
    soft('user_favorites', () => fetchAll<{ es_word: string }>(client, 'user_favorites', 'es_word', userId), []),
    soft('user_hidden_words', () => fetchAll<{ es_word: string }>(client, 'user_hidden_words', 'es_word', userId), []),
  ])

  return {
    overlay: { customWords, progress, favorites: favorites.value.map((r) => r.es_word), hidden: hidden.value.map((r) => r.es_word), settings },
    degraded: [...(favorites.failed ? (['user_favorites'] as const) : []), ...(hidden.failed ? (['user_hidden_words'] as const) : [])],
  }
}

export interface Recovered {
  favorites?: string[]
  hidden?: string[]
  /** Still failing. */
  failed: NonCriticalTable[]
}

/**
 * One background attempt at the non-critical tables that failed at launch. A single attempt each (the caller spaces the
 * attempts out), still refreshing the session once on an auth error. Failures are logged, never thrown.
 */
export async function recoverTables(client: SupabaseClient, userId: string, tables: readonly NonCriticalTable[], options: LoadOptions = {}): Promise<Recovered> {
  const retry: RetryOptions = { ...options, delaysMs: options.delaysMs ?? [], log: options.log ?? loadLog, refreshSession: sharedRefresh(client) }
  const out: Recovered = { failed: [] }
  await Promise.all(
    tables.map(async (table) => {
      try {
        const rows = await loadWithRetry(table, () => fetchAll<{ es_word: string }>(client, table, 'es_word', userId), retry)
        const words = rows.map((r) => r.es_word)
        if (table === 'user_favorites') out.favorites = words
        else out.hidden = words
      } catch {
        out.failed.push(table)
      }
    }),
  )
  return out
}
