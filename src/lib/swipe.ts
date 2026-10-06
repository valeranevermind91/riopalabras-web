// The decisions behind the Learn card swipe, kept apart from the gesture plumbing so they can be tested.

/** Dragging further than this (px) on release commits the swipe. */
export const COMMIT_DISTANCE = 60
/** A quick flick commits sooner: at least this fast (px per ms)… */
export const FLICK_VELOCITY = 0.45
/** …and at least this far (px). */
export const FLICK_MIN_DISTANCE = 24
/** The finger must move this far, mostly sideways, before the card starts following it. */
export const LOCK_DISTANCE = 10
/** Past the first/last card the drag resists: it moves a quarter as far. */
export const RESISTANCE = 0.25

/** How long a released card takes to leave the screen (ms): the distance left divided by the speed it was released at, within bounds. */
export const MIN_EXIT_MS = 140
export const MAX_EXIT_MS = 360
/** A released card never leaves slower than this (px per ms), however gently it was let go. */
export const MIN_EXIT_SPEED = 0.8
export const REDUCED_FADE_MS = 160

export interface Sample {
  /** Milliseconds (performance.now or event.timeStamp). */
  t: number
  x: number
}

/** Horizontal velocity in px per ms over the last `windowMs` of samples; positive is rightwards. 0 with fewer than two usable samples. */
export function velocityOf(samples: readonly Sample[], windowMs = 100): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  const recent = samples.filter((s) => last.t - s.t <= windowMs)
  const first = recent[0]
  const dt = last.t - first.t
  return dt > 0 ? (last.x - first.x) / dt : 0
}

export type ReleaseDecision = 'next' | 'previous' | 'cancel'

export interface ReleaseInput {
  dx: number
  dy: number
  /** Horizontal velocity at release, px per ms (positive is rightwards). */
  velocity: number
  canNext: boolean
  canPrevious: boolean
}

/**
 * What a release does. Fingers moving left (negative dx) go to the NEXT card, moving right to the PREVIOUS one.
 * A drag commits when it is long enough, or short but fast (a flick) in the same direction; it must be mostly
 * horizontal. At the first or last card, or below the threshold, it cancels and the card springs back.
 */
export function decideRelease({ dx, dy, velocity, canNext, canPrevious }: ReleaseInput): ReleaseDecision {
  if (Math.abs(dx) < Math.abs(dy)) return 'cancel'
  const far = Math.abs(dx) >= COMMIT_DISTANCE
  const flick = Math.abs(dx) >= FLICK_MIN_DISTANCE && Math.abs(velocity) >= FLICK_VELOCITY && Math.sign(velocity) === Math.sign(dx)
  if (!far && !flick) return 'cancel'
  if (dx < 0) return canNext ? 'next' : 'cancel'
  if (dx > 0) return canPrevious ? 'previous' : 'cancel'
  return 'cancel'
}

export interface ExitPlan {
  /** translate: the card continues off-screen; fade: reduced motion, a cross-fade in place. */
  mode: 'translate' | 'fade'
  /** Where the released card started (px from centre) and where it ends. */
  from: number
  to: number
  duration: number
}

/**
 * The released card continues in the direction it was dragged, past the edge of the screen, at the speed it was
 * released with. With reduced motion it cross-fades instead and does not travel.
 */
export function planExit({ dx, velocity, width, reducedMotion }: { dx: number; velocity: number; width: number; reducedMotion: boolean }): ExitPlan {
  if (reducedMotion) return { mode: 'fade', from: 0, to: 0, duration: REDUCED_FADE_MS }
  const direction = dx < 0 ? -1 : 1
  const to = direction * (width + 48)
  const speed = Math.max(Math.abs(velocity), MIN_EXIT_SPEED)
  const duration = Math.round(Math.min(MAX_EXIT_MS, Math.max(MIN_EXIT_MS, Math.abs(to - dx) / speed)))
  return { mode: 'translate', from: dx, to, duration }
}

/** The drag offset for a finger movement: free, or resisted when there is no card that way. */
export function dragOffset(dx: number, canNext: boolean, canPrevious: boolean): number {
  const blocked = (dx < 0 && !canNext) || (dx > 0 && !canPrevious)
  return blocked ? dx * RESISTANCE : dx
}
