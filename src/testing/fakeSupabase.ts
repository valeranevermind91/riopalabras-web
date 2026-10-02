import type { SupabaseClient } from '@supabase/supabase-js'

export interface UpsertCall {
  table: string
  rows: unknown
  options: unknown
}

/** A stand-in for the one Supabase call the write layer makes: from(table).upsert(rows, options). */
export function fakeSupabase() {
  const calls: UpsertCall[] = []
  /** table → how many of its next upserts should fail. */
  const failures: Record<string, number> = {}

  const client = {
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
