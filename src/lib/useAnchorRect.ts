import { useEffect, useState } from 'react'

/** Where an element is in the viewport (fixed coordinates), and the corner radius it is drawn with, so a spotlight can follow its shape. */
export interface AnchorRect {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
  readonly radius: string
}

/** The element a hint points at: any element carrying data-hint="<name>". Hints find their target by this, never by a position. */
export const anchorTarget = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-hint="${name}"]`)

const same = (a: AnchorRect | null, b: AnchorRect | null) => a === b || (a !== null && b !== null && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height && a.radius === b.radius)

function measure(name: string): AnchorRect | null {
  const el = anchorTarget(name)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height, radius: getComputedStyle(el).borderRadius }
}

/**
 * The target's place in the viewport, kept current for as long as `name` is set: measured once a frame (only a change renders), so a hint stays on its element when something moves it:
 * a notice that appears above the tiles, the practice panel, a font that arrives late, a scroll, a rotation. null while the element is not there (and for the first frame).
 */
export function useAnchorRect(name: string | null): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null)
  useEffect(() => {
    if (name === null) return
    let frame = 0
    const tick = () => {
      const next = measure(name)
      setRect((prev) => (same(prev, next) ? prev : next))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [name])
  return name === null ? null : rect
}

const reservations = new Set<number>()
let paddingBefore = ''
const RELEASE_MS = 600

/**
 * Adds `px` of room under the page for as long as a hint is over its foot (so that the page can scroll far enough to bring an element clear of the hint), and returns the function that
 * takes it away again. Several at once (a bubble closing as the snackbar opens) share the room: the largest holds. It is given back a moment late, so that a tap that closed a hint is
 * not undone by the page shrinking under the finger between the touch and the click.
 */
export function reserveFoot(px: number): () => void {
  if (reservations.size === 0) paddingBefore = document.body.style.paddingBottom
  const mine = px + reservations.size * 1e-6 // distinct, so two equal reservations are two
  reservations.add(mine)
  const apply = () => {
    document.body.style.paddingBottom = reservations.size === 0 ? paddingBefore : `${Math.max(...reservations)}px`
  }
  apply()
  return () =>
    void setTimeout(() => {
      reservations.delete(mine)
      apply()
    }, RELEASE_MS)
}

/** Scrolls the page just enough that the target, and `room` pixels beyond it on the side the hint opens to, are in view. */
export function revealTarget(name: string, room: number, side: 'above' | 'below'): void {
  const el = anchorTarget(name)
  if (!el) return
  const r = el.getBoundingClientRect()
  const vh = window.innerHeight
  const margin = 8
  if (side === 'below' && r.bottom + room > vh - margin) window.scrollBy(0, Math.min(r.bottom + room - (vh - margin), Math.max(0, r.top - margin)))
  else if (side === 'above' && r.top - room < margin) window.scrollBy(0, -Math.min(margin + room - r.top, window.scrollY))
  else if (r.top < margin) window.scrollBy(0, r.top - margin)
}
