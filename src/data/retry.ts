import type { LoadErrorKind, LoadLog } from './loadLog'

/** A failed read of one user-data table, with what is needed to decide whether to retry and what to log. */
export class TableLoadError extends Error {
  readonly table: string
  readonly kind: LoadErrorKind
  readonly status: number | null
  readonly code: string | null
  readonly detail: string

  constructor(table: string, detail: string, status: number | null, code: string | null) {
    super(`${table}: ${detail}`)
    this.name = 'TableLoadError'
    this.table = table
    this.detail = detail
    this.status = status
    this.code = code
    this.kind = classify(status, code, detail)
  }
}

const NETWORK_MESSAGE = /failed to fetch|load failed|networkerror|network request failed|network error|timeout|timed out|aborted|econn|socket|offline|fetch failed/i
const AUTH_MESSAGE = /jwt|token.*(expired|invalid)|invalid.*token|not authenticated|no api key|invalid api key/i

/**
 * auth: the session is no good (401, an expired JWT): refresh it once and retry.
 * transient: worth retrying (network, 5xx, 408, 429, PostgREST schema cache not ready).
 * permanent: retrying cannot help (403/RLS, 400, a missing table, ...).
 */
export function classify(status: number | null, code: string | null, message: string): LoadErrorKind {
  if (status === 401 || code === 'PGRST301' || code === 'PGRST300' || AUTH_MESSAGE.test(message)) return 'auth'
  if (code === 'PGRST002' || code === 'PGRST205') return 'transient' // schema cache reloading right after a migration
  if (status !== null && (status >= 500 || status === 408 || status === 429)) return 'transient'
  // no HTTP status at all (0 or none): the request never completed, which is a network problem if the message says so
  if ((status === null || status === 0) && NETWORK_MESSAGE.test(message)) return 'transient'
  return 'permanent'
}

/** Wraps anything thrown while loading a table (a PostgREST error, a fetch failure, a plain Error). */
export function toTableLoadError(table: string, err: unknown): TableLoadError {
  if (err instanceof TableLoadError) return err
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown; status?: unknown }
    const message = typeof e.message === 'string' && e.message ? e.message : String(err)
    return new TableLoadError(table, message, typeof e.status === 'number' ? e.status : null, typeof e.code === 'string' && e.code ? e.code : null)
  }
  return new TableLoadError(table, String(err), null, null)
}

export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 8000]

export interface RetryOptions {
  /** Waits between attempts; its length is the number of retries. */
  delaysMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
  /** Refreshes the Supabase session. Called at most once per table when it hits an auth error. */
  refreshSession?: () => Promise<void>
  log: LoadLog
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Runs `load` until it succeeds. Transient failures wait through `delaysMs` (1s / 3s / 8s by default) and retry;
 * an auth failure refreshes the session once and retries at once; anything else (or running out of retries)
 * throws the TableLoadError. Every failure is logged with its status, code and message.
 */
export async function loadWithRetry<T>(table: string, load: () => Promise<T>, options: RetryOptions): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS
  const sleep = options.sleep ?? realSleep
  let attempt = 0
  let retries = 0
  let refreshed = false
  let failedBefore = false

  for (;;) {
    attempt++
    try {
      const value = await load()
      if (failedBefore) options.log.record({ table, attempt, kind: 'transient', status: null, code: null, message: 'loaded after an earlier failure', outcome: 'recovered' })
      return value
    } catch (raw) {
      failedBefore = true
      const err = toTableLoadError(table, raw)
      const entry = { table, attempt, kind: err.kind, status: err.status, code: err.code, message: err.detail }

      if (err.kind === 'auth' && !refreshed && options.refreshSession) {
        refreshed = true
        options.log.record({ ...entry, outcome: 'refreshing-session' })
        try {
          await options.refreshSession()
        } catch (refreshErr) {
          options.log.record({ ...entry, message: `session refresh failed: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`, outcome: 'failed' })
          throw err
        }
        continue
      }
      if (err.kind === 'transient' && retries < delays.length) {
        options.log.record({ ...entry, outcome: 'retrying' })
        await sleep(delays[retries++])
        continue
      }
      options.log.record({ ...entry, outcome: 'failed' })
      throw err
    }
  }
}
