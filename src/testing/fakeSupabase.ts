import type { SupabaseClient } from '@supabase/supabase-js'

export interface UpsertCall {
  table: string
  rows: unknown
  options: unknown
}

/**
 * A stand-in for the Supabase calls the write layer makes: from(table).upsert(rows, options), and the
 * session lookup that comes before every send. `userId` is the user the fake holds a session for.
 */
export function fakeSupabase(userId = 'user-1') {
  const calls: UpsertCall[] = []
  /** table → how many of its next upserts should fail. */
  const failures: Record<string, number> = {}

  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: userId } } }, error: null }) },
    from(table: string) {
      return {
        upsert: async (rows: unknown, options: unknown) => {
          calls.push({ table, rows, options })
          if ((failures[table] ?? 0) > 0) {
            failures[table]--
            return { error: { message: `boom from ${table}` } }
          }
          return { error: null }
        },
      }
    },
  }

  return { client: client as unknown as SupabaseClient, calls, failures }
}
