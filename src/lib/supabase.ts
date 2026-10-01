import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

interface SupabaseResult {
  client: SupabaseClient | null
  error: string | null
}

function build(): SupabaseResult {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      client: null,
      error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY',
    }
  }

  try {
    return {
      client: createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Telegram passes launch params in the URL hash; there is no OAuth redirect to parse.
          detectSessionInUrl: false,
        },
      }),
      error: null,
    }
  } catch (err) {
    return { client: null, error: err instanceof Error ? err.message : String(err) }
  }
}

// Singleton: a second client on the same storage key would race the first one's token refreshes.
const result = build()

export function getSupabase(): SupabaseResult {
  return result
}
