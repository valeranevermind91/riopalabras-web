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
export function fakeReadSupabase(rows: Record<string, unknown[]> = {}, options: { maxRows?: number } = {}) {
  const scripts: Record<string, ScriptedResult[]> = {}
  const requests: string[] = []
  /** The columns each request asked for, per table (select('es_word, created_at') → 'es_word, created_at'). */
  const selected: Record<string, string[]> = {}
  const state = { refreshCalls: 0, refreshError: null as { message: string } | null }

  const respond = async (table: string, single: boolean, range?: [number, number], columns?: string): Promise<ScriptedResult> => {
    requests.push(table)
    const scripted = scripts[table]?.shift()
    if (scripted) return scripted
    // Like PostgREST, only the columns asked for come back (select() with none, or '*', is every column).
    const keep = columns && columns !== '*' ? columns.split(',').map((c) => c.trim()) : null
    const data = (rows[table] ?? []).map((row) => (keep && row && typeof row === 'object' ? Object.fromEntries(Object.entries(row).filter(([key]) => keep.includes(key))) : row))
    if (single) return { data: data[0] ?? null, error: null, status: 200 }
    // Like PostgREST: the requested range, cut down to the server's max-rows setting.
    const [from, to] = range ?? [0, data.length - 1]
    const wanted = to - from + 1
    return { data: data.slice(from, from + Math.min(wanted, options.maxRows ?? Number.POSITIVE_INFINITY)), error: null, status: 200 }
  }

  const client = {
    from(table: string) {
      let columns: string | undefined
      const chain = {
        select: (asked?: string) => {
          columns = asked
          if (asked !== undefined) (selected[table] ??= []).push(asked)
          return chain
        },
        eq: () => chain,
        order: () => chain,
        range: (from: number, to: number) => respond(table, false, [from, to], columns),
        maybeSingle: () => respond(table, true, undefined, columns),
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
    selected,
    count: (table: string) => requests.filter((r) => r === table).length,
    state,
  }
}
