import { useCallback, useEffect, useMemo, useState } from 'react'
import { nextDueWithin } from '../data/stats'
import type { Word } from '../data/types'
import { RELEARN_MS } from '../sm2/sm2'
import { useForeground } from './useForeground'

/**
 * The moment a count of "what is due" is taken at, kept honest while a screen stays open. A word rated Again is due again after RELEARN_MS and
 * nothing else changes when it comes due, so a count made once (when the screen opened, or when a session ended) would stay as it was for ever.
 * So `asOf` is taken again (a) when the app comes back to the foreground, and (b) the moment the next word that is about to come due does, if
 * that is within RELEARN_MS: one timer, set for that word, set again for the next one after it fires. Home and the Review end screen both count
 * what is due from this one clock.
 *
 * `timed: false` leaves out the timer (a screen that is not showing a count yet; or a test that names its own "now"); the foreground
 * refresh stays. `refresh()` takes the moment again now, for a screen that is about to show a count and wants it current.
 */
export function useDueClock(words: readonly Word[] | null, { timed = true }: { timed?: boolean } = {}): { asOf: Date; refresh: () => void } {
  const [asOf, setAsOf] = useState(() => new Date())
  const refresh = useCallback(() => setAsOf(new Date()), [])
  // A Mini App left open overnight would otherwise keep yesterday's date, and with it yesterday's counts.
  useForeground(refresh)
  const comesDueAt = useMemo(() => (timed && words ? nextDueWithin(words, asOf, RELEARN_MS)?.getTime() ?? null : null), [timed, words, asOf])
  useEffect(() => {
    if (comesDueAt === null) return
    const timer = setTimeout(refresh, Math.max(0, comesDueAt - Date.now()) + 250)
    return () => clearTimeout(timer)
  }, [comesDueAt, refresh])
  return { asOf, refresh }
}
