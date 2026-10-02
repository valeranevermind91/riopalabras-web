import type { SupabaseClient } from '@supabase/supabase-js'

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
    const { data, error } = await client
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .order('es_word')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)

    const page = (data ?? []) as unknown as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

async function fetchSettings(client: SupabaseClient, userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from('user_settings')
    .select('settings')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`user_settings: ${error.message}`)

  const blob = data?.settings
  return blob && typeof blob === 'object' && !Array.isArray(blob) ? (blob as Record<string, unknown>) : null
}

/** Read-only. RLS already scopes rows to the signed-in user; the user_id filter is belt-and-braces. */
export async function fetchOverlay(client: SupabaseClient, userId: string): Promise<Overlay> {
  const [customWords, progress, favorites, hidden, settings] = await Promise.all([
    fetchAll<UserWordRow>(
      client,
      'user_words',
      'es_word, es_rioplatense, en_translation, ru_translation, example_sentence, example_translation_en, example_translation_ru, is_rioplatense_variant, pos',
      userId,
    ),
    fetchAll<ProgressRow>(client, 'user_progress', 'es_word, ease_factor, interval_days, repetitions, next_review', userId),
    fetchAll<{ es_word: string }>(client, 'user_favorites', 'es_word', userId),
    fetchAll<{ es_word: string }>(client, 'user_hidden_words', 'es_word', userId),
    fetchSettings(client, userId),
  ])

  return {
    customWords,
    progress,
    favorites: favorites.map((r) => r.es_word),
    hidden: hidden.map((r) => r.es_word),
    settings,
  }
}
