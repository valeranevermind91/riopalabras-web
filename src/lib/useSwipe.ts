import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'

const COMMIT_DISTANCE = 60
const LOCK_DISTANCE = 10

interface SwipeOptions {
  /** Finger moved left (reveals the next card). */
  onNext: () => void
  /** Finger moved right (reveals the previous card). */
  onPrevious: () => void
  canNext: boolean
  canPrevious: boolean
  enabled: boolean
}

/** Horizontal swipe on pointer events only (touch, pen and mouse); vertical scrolling is left to the browser. */
export function useSwipe({ onNext, onPrevious, canNext, canPrevious, enabled }: SwipeOptions) {
  const origin = useRef<{ x: number; y: number } | null>(null)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)

  const reset = () => {
    origin.current = null
    setDragging(false)
    setOffset(0)
  }

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!enabled || !e.isPrimary) return
    origin.current = { x: e.clientX, y: e.clientY }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // The pointer already ended (very fast tap); the gesture just won't be captured.
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const start = origin.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < LOCK_DISTANCE || Math.abs(dx) < Math.abs(dy)) return

    const blocked = (dx < 0 && !canNext) || (dx > 0 && !canPrevious)
    setDragging(true)
    setOffset(blocked ? dx * 0.25 : dx)
  }

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const start = origin.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    reset()

    if (Math.abs(dx) < COMMIT_DISTANCE || Math.abs(dx) < Math.abs(dy)) return
    if (dx < 0 && canNext) onNext()
    else if (dx > 0 && canPrevious) onPrevious()
  }

  const style: CSSProperties = {
    transform: offset ? `translateX(${offset}px)` : undefined,
    transition: dragging ? 'none' : 'transform 180ms ease-out',
    touchAction: 'pan-y',
  }

  return { handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset }, style }
}
