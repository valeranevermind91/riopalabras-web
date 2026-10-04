// A short in-memory log of user-data load problems, so the Debug screen can show the REAL cause
// (HTTP status, PostgREST code, message) even when a retry later succeeded and the user saw nothing.

export type LoadErrorKind = 'auth' | 'transient' | 'permanent'

export interface LoadLogEntry {
  id: number
  /** ISO time. */
  at: string
  table: string
  /** 1 for the first request of that table in this attempt series. */
  attempt: number
  kind: LoadErrorKind
  status: number | null
  code: string | null
  message: string
  /** What happened next: retrying after a delay, refreshing the session, giving up, or a later success. */
  outcome: 'retrying' | 'refreshing-session' | 'failed' | 'recovered'
}

export interface LoadLog {
  record: (entry: Omit<LoadLogEntry, 'id' | 'at'>, now?: Date) => void
  /** Newest first. The same array is returned until something is recorded (safe for useSyncExternalStore). */
  snapshot: () => readonly LoadLogEntry[]
  subscribe: (listener: () => void) => () => void
  clear: () => void
}

export function createLoadLog(limit = 30): LoadLog {
  let entries: readonly LoadLogEntry[] = []
  let nextId = 1
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const l of listeners) l()
  }

  return {
    record(entry, now = new Date()) {
      entries = Object.freeze([{ ...entry, id: nextId++, at: now.toISOString() }, ...entries].slice(0, limit))
      emit()
    },
    snapshot: () => entries,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    clear() {
      entries = []
      emit()
    },
  }
}

export const loadLog = createLoadLog()
