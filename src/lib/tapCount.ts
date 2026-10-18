/**
 * Counts consecutive taps on one thing: `taps` of them, each within `gapMs` of the one before, and the last one answers true (once), after
 * which the count starts again. A pause longer than `gapMs` starts the count over. Pure apart from the clock it is given, so a test drives it.
 * It is how the version row in Settings unlocks the Debug section: nothing on screen says it is there.
 */
export function createTapCounter({ taps, gapMs, now = () => Date.now() }: { taps: number; gapMs: number; now?: () => number }): { tap: () => boolean; reset: () => void } {
  let count = 0
  let last = 0
  return {
    tap() {
      const at = now()
      count = count > 0 && at - last <= gapMs ? count + 1 : 1
      last = at
      if (count < taps) return false
      count = 0
      return true
    },
    reset() {
      count = 0
    },
  }
}

/** Seven taps, each within a second and a half of the last: quick enough that nobody gets there by accident, slow enough to do on purpose. */
export const DEBUG_UNLOCK_TAPS = 7
export const DEBUG_UNLOCK_GAP_MS = 1500
