import type { SupabaseClient } from '@supabase/supabase-js'

export type ScriptedResult = { data?: unknown; error: { message: string; code?: string } | null; status: number }

/** A scripted failure, as postgrest-js reports it: no throw, an error object plus the HTTP status. */
export const httpError = (status: number, message = `HTTP ${status}`, code = ''): ScriptedResult => ({ data: null, error: { message, code }, status })
/** postgrest-js turns a fetch failure into status 0 with the error's name and message. */
export const networkError = (): ScriptedResult => httpError(0, 'TypeError: Failed to fetch')

/**
 * A stand-in for the read calls the data layer makes: from(table).select().eq().order().range() and
 * from('user_settings')...maybeSingle(), plus auth.refreshSession(). Each table can be given a script of results
 * that are consumed one request at a time before it falls back to its rows.
 */
export function fakeReadSupabase(rows: Record<string, unknown[]> = {}) {
  const scripts: Record<string, ScriptedResult[]> = {}
  const requests: string[] = []
  const state = { refreshCalls: 0, refreshError: null as { message: string } | null }

  const respond = async (table: string, single: boolean): Promise<ScriptedResult> => {
    requests.push(table)
    const scripted = scripts[table]?.shift()
    if (scripted) return scripted
    const data = rows[table] ?? []
    return { data: single ? (data[0] ?? null) : data, error: null, status: 200 }
  }

  const client = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        range: () => respond(table, false),
        maybeSingle: () => respond(table, true),
      }
      return chain
    },
    auth: {
      refreshSession: async () => {
        state.refreshCalls++
        return { data: {}, error: state.refreshError }
      },
    },
  }

  return {
    client: client as unknown as SupabaseClient,
    /** Queue results for a table's next requests. */
    script: (table: string, ...results: ScriptedResult[]) => {
      scripts[table] = [...(scripts[table] ?? []), ...results]
    },
    requests,
    count: (table: string) => requests.filter((r) => r === table).length,
    state,
  }
}
