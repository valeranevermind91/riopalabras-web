import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { LOCK_DISTANCE, decideRelease, dragOffset, planExit, velocityOf, type ExitPlan, type Sample } from './swipe'

interface SwipeOptions {
  /** A committed swipe left (finger moved left): the next card. The plan says how the released card should leave. */
  onNext: (plan: ExitPlan) => void
  /** A committed swipe right: the previous card. */
  onPrevious: (plan: ExitPlan) => void
  canNext: boolean
  canPrevious: boolean
  enabled: boolean
}

const prefersReducedMotion = () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)

/**
 * Horizontal swipe on pointer events only (touch, pen and mouse); vertical scrolling is left to the browser.
 * `layerStyle` goes on the card layer that follows the finger (transform only). When a release commits, the
 * hook hands the caller an ExitPlan (start offset, destination, duration from the release velocity) and resets
 * its own layer at once: the caller keeps the released card on screen as a leaving copy and animates it away
 * while the next card arrives. Below the threshold the layer springs back.
 */
export function useSwipe({ onNext, onPrevious, canNext, canPrevious, enabled }: SwipeOptions) {
  const origin = useRef<{ x: number; y: number; width: number } | null>(null)
  const samples = useRef<Sample[]>([])
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)

  const reset = () => {
    origin.current = null
    samples.current = []
    setDragging(false)
    setOffset(0)
  }

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!enabled || !e.isPrimary) return
    origin.current = { x: e.clientX, y: e.clientY, width: e.currentTarget.clientWidth }
    samples.current = [{ t: e.timeStamp, x: e.clientX }]
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // The pointer already ended (very fast tap); the gesture just won't be captured.
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const start = origin.current
    if (!start) return
    samples.current.push({ t: e.timeStamp, x: e.clientX })
    if (samples.current.length > 12) samples.current.shift()
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < LOCK_DISTANCE || Math.abs(dx) < Math.abs(dy)) return
    setDragging(true)
    setOffset(dragOffset(dx, canNext, canPrevious))
  }

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const start = origin.current
    if (!start) return
    samples.current.push({ t: e.timeStamp, x: e.clientX })
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const velocity = velocityOf(samples.current)
    const decision = decideRelease({ dx, dy, velocity, canNext, canPrevious })
    reset()
    if (decision === 'cancel') return
    // The leaving copy starts exactly where the finger let go of the card.
    const plan = planExit({ dx: dragOffset(dx, canNext, canPrevious), velocity, width: start.width, reducedMotion: prefersReducedMotion() })
    if (decision === 'next') onNext(plan)
    else onPrevious(plan)
  }

  const layerStyle: CSSProperties = {
    transform: offset ? `translateX(${offset}px)` : undefined,
    // following the finger: no transition; letting go below the threshold: spring back
    transition: dragging ? 'none' : 'transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)',
  }

  return { handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset }, layerStyle }
}
