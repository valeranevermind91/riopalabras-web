import type { ReminderState, ReminderStore } from '../data/reminders'

/**
 * The daily reminder's row, in memory, and Telegram's permission prompt, for the real-browser harnesses. Nothing is sent anywhere; what the app
 * writes to the row is in window.__reminders, and a prompt left open is answered by window.__answerAccess(true | false). Query:
 *   reminder=on|off|none   the row at the start: on, off, or no row (the default)
 *   rtz=<zone>             the zone on that row (default America/Montevideo)
 *   tz=<zone>              the device's zone (default America/Montevideo)
 *   paused=1, unreachable=1  what the job has set on the row
 *   access=yes|no|manual   the prompt: agreed at once (default), refused at once, or left open until window.__answerAccess
 *   savefail=1, readfail=1 writes / the read fail, as with no connection
 */
export function createFakeReminders(params: URLSearchParams) {
  const log: { writes: Record<string, unknown>[]; updates: Record<string, unknown>[]; asked: number } = { writes: [], updates: [], asked: 0 }
  ;(window as never as { __reminders: typeof log }).__reminders = log

  const start = params.get('reminder')
  let row: ReminderState | null = start && start !== 'none' ? { enabled: start === 'on', timezone: params.get('rtz') ?? 'America/Montevideo', paused: params.get('paused') === '1', unreachable: params.get('unreachable') === '1' } : null

  const store: ReminderStore = {
    async read() {
      if (params.get('readfail') === '1') throw new Error('offline')
      return row ? { ...row } : null
    },
    async write(patch) {
      if (params.get('savefail') === '1') throw new Error('offline')
      log.writes.push(patch)
      // as the database's trigger does: turning it on (from off) clears what the job set
      row = { enabled: false, timezone: null, paused: false, unreachable: false, ...row, ...patch, ...(patch.enabled && !row?.enabled ? { paused: false, unreachable: false } : {}) }
    },
    async update(patch) {
      if (params.get('savefail') === '1') throw new Error('offline')
      log.updates.push(patch)
      if (row) row = { ...row, ...patch }
    },
  }

  let answer: ((granted: boolean) => void) | null = null
  ;(window as never as { __answerAccess: (granted: boolean) => void }).__answerAccess = (granted) => answer?.(granted)
  const askAccess = (): Promise<boolean> => {
    log.asked++
    const mode = params.get('access') ?? 'yes'
    if (mode === 'manual') return new Promise((resolve) => (answer = resolve))
    return Promise.resolve(mode === 'yes')
  }

  return { store, askAccess, timezone: () => params.get('tz') ?? 'America/Montevideo', log }
}
