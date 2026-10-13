import { useCallback, useEffect, useRef, useState } from 'react'
import { deviceTimezone, reminderFlag, syncTimezone, turnReminderOff, turnReminderOn, type ReminderStore } from '../data/reminders'
import { getWebApp, requestMessageAccess } from './telegram'

/**
 * What the one quiet line under the toggle says, if anything. What just happened comes first (Telegram refused, or the change could not be
 * saved); otherwise why a reminder that is switched on is not arriving (paused, or Telegram cannot deliver).
 */
export type ReminderNotice = 'declined' | 'failed' | 'paused' | 'unreachable' | null

export interface RemindersControl {
  /** 'loading' until the row has been read; 'unavailable' when it could not be (no connection): the toggle is then disabled. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Whether the toggle shows on: the saved state, or while a change is being made, the one the user asked for. */
  shown: boolean
  busy: boolean
  notice: ReminderNotice
  set: (on: boolean) => void
}

interface Options {
  /** Asks Telegram to let the bot message the user (default: WebApp.requestWriteAccess). */
  askAccess?: () => Promise<boolean>
  /** The device's time zone (default: Intl). */
  timezone?: () => string | null
}

/**
 * The daily reminder as the app sees it. Lives in App, not in Settings: the time zone is brought up to date at every app open (if the user
 * has a reminder row and the zone differs), and that must not wait for them to visit Settings. `store` is null until the user is signed in.
 */
export function useReminders(store: ReminderStore | null, options: Options = {}): RemindersControl {
  const [status, setStatus] = useState<RemindersControl['status']>('loading')
  const [enabled, setEnabled] = useState(false)
  const [pending, setPending] = useState<boolean | null>(null)
  const [outcome, setOutcome] = useState<'declined' | 'failed' | null>(null)
  const [flags, setFlags] = useState({ paused: false, unreachable: false })
  const busy = useRef(false)
  // The saved state as of now, for the async work in `set` (which must not read a stale render's copy).
  const enabledRef = useRef(false)
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])
  const opts = useRef(options)
  useEffect(() => {
    opts.current = options
  })

  useEffect(() => {
    if (!store) return
    let cancelled = false
    void (async () => {
      let row
      try {
        row = await store.read()
      } catch {
        if (!cancelled) setStatus('unavailable')
        return
      }
      if (cancelled) return
      setEnabled(row?.enabled === true)
      setFlags({ paused: row?.paused === true, unreachable: row?.unreachable === true })
      setStatus('ready')
      await syncTimezone(store, (opts.current.timezone ?? deviceTimezone)(), row)
    })()
    return () => {
      cancelled = true
    }
  }, [store])

  const set = useCallback(
    (on: boolean) => {
      if (!store || busy.current) return
      busy.current = true
      setOutcome(null)
      setPending(on)
      void (async () => {
        let next: 'declined' | 'failed' | null = null
        let saved = enabledRef.current
        if (on) {
          const ask = opts.current.askAccess ?? (() => requestMessageAccess(getWebApp().webApp))
          const result = await turnReminderOn(store, ask, (opts.current.timezone ?? deviceTimezone)())
          if (result === 'on') {
            saved = true
            setFlags({ paused: false, unreachable: false }) // a fresh turn-on clears them in the database (a trigger), so here too
          } else next = result
        } else if (await turnReminderOff(store)) {
          saved = false
        } else {
          next = 'failed'
        }
        enabledRef.current = saved
        setEnabled(saved)
        setOutcome(next)
        setPending(null)
        busy.current = false
      })()
    },
    [store],
  )

  const notice: ReminderNotice = outcome ?? (pending === null ? reminderFlag({ enabled, ...flags }) : null)
  return { status, shown: pending ?? enabled, busy: pending !== null, notice, set }
}
