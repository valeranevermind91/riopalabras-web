import { useEffect, useState } from 'react'
import { getWebApp, onTelegramEvent } from './telegram'

/**
 * The longest time on one card that is still taken as time spent on it. Past this the reading is NOT clamped to the limit: it is dropped (null). The
 * log's duration_ms is for statistics and for a scheduler, and a reading that is not time on the card is worse than none: someone who looked away
 * from an open app (a phone call, a cup of tea) leaves a number like 130 seconds for a question that takes ten, and clamping it to 60 would leave
 * a value that LOOKS real, and quietly drags every average the wrong way, where a null says "we do not know". A minute is well past how long a flash
 * card or a one-word blank takes, even for someone stuck on it, and short enough that a real pause is not mistaken for an answer.
 */
export const MAX_CARD_MS = 60_000

/** What a timer needs from the world: a monotonic clock in milliseconds, and whether the page is hidden right now. */
export interface TimerEnvironment {
  now: () => number
  hidden: () => boolean
}

/**
 * Times one card at a time. `start()` when the card is shown, `stop()` when it is answered: the milliseconds in between, or null when they cannot be
 * trusted. They cannot be trusted if the app was away at ANY point in between (the page hidden, or Telegram deactivating the Mini App: `interrupt()`),
 * or if they come to more than MAX_CARD_MS. A card shown while the page is already hidden is not trusted either. Null is also what `stop()` gives
 * when no card was being timed.
 */
export function createCardTimer(env: TimerEnvironment) {
  let startedAt: number | null = null
  let interrupted = false
  return {
    start() {
      startedAt = env.now()
      interrupted = env.hidden()
    },
    /** The app went away: whatever is being timed now is not time spent on the card. */
    interrupt() {
      if (startedAt !== null) interrupted = true
    },
    stop(): number | null {
      if (startedAt === null) return null
      const elapsed = env.now() - startedAt
      startedAt = null
      if (interrupted || !(elapsed >= 0) || elapsed > MAX_CARD_MS) return null
      return Math.round(elapsed)
    },
  }
}

/**
 * A card timer for a screen, on the real clock and the real page: it is interrupted when the page becomes hidden and when Telegram deactivates the
 * Mini App (Bot API 8.0+, where the page may never report hidden). It does not start by itself: the screen calls `start()` when a card appears.
 */
export function useCardTimer() {
  const [timer] = useState(() => createCardTimer({ now: () => performance.now(), hidden: () => document.visibilityState === 'hidden' }))
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') timer.interrupt()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const stopDeactivated = onTelegramEvent('deactivated', () => timer.interrupt(), getWebApp().webApp)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stopDeactivated()
    }
  }, [timer])
  return timer
}
