import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export function createSupabaseClient(): { client: SupabaseClient | null; error: string | null } {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      client: null,
      error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY',
    }
  }

  try {
    return { client: createClient(supabaseUrl, supabaseAnonKey), error: null }
  } catch (err) {
    return { client: null, error: err instanceof Error ? err.message : String(err) }
  }
}
