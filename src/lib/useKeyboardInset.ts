import { useEffect, useState, type RefObject } from 'react'

/** Below this the difference between the page and what can be seen is browser chrome or a zoom, not a keyboard (a phone keyboard is well over 200 px). */
export const KEYBOARD_MIN_PX = 100

/**
 * How much of the bottom of the page the on-screen keyboard covers, in CSS pixels. On some phones the keyboard is drawn over the page without shrinking
 * it: the layout viewport keeps its height, and only the visual viewport (what can be seen) gets shorter. That difference is the keyboard. A pinch-zoomed
 * page also has a shorter visual viewport, so a scale other than 1 is never read as a keyboard.
 */
export function keyboardInset(layoutHeight: number, viewport: { height: number; offsetTop: number; scale?: number } | null | undefined): number {
  if (!viewport) return 0
  if (viewport.scale !== undefined && Math.abs(viewport.scale - 1) > 0.01) return 0
  const covered = Math.round(layoutHeight - viewport.height - viewport.offsetTop)
  return covered >= KEYBOARD_MIN_PX ? covered : 0
}

/** How far to scroll down so that something whose bottom is at `elementBottom` (a viewport coordinate) ends `margin` px above `visibleBottom`; 0 when it already is. */
export function scrollDeltaToClear(elementBottom: number, visibleBottom: number, margin = 12): number {
  return Math.max(0, Math.ceil(elementBottom + margin - visibleBottom))
}

/**
 * Keeps `--keyboard-inset` on the page (in px) equal to what the keyboard covers, and returns it. A screen that has a field near the bottom pads itself
 * by it (so the page can scroll up that far) and scrolls the field's controls into the visible part; nothing else reads it. Gone with the screen.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement
    const update = () => {
      const next = keyboardInset(window.innerHeight, viewport)
      root.style.setProperty('--keyboard-inset', `${next}px`)
      setInset(next)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      root.style.removeProperty('--keyboard-inset')
    }
  }, [])
  return inset
}

/**
 * Keeps `ref`'s element in the part of the page that can be seen while the person is typing in it: with the keyboard drawn over the page (`inset` > 0), or with
 * the focus inside the element, which is what a page that shrinks for the keyboard has (no inset there: what can be seen is the whole page). It scrolls the
 * element's bottom to just above the bottom of what can be seen, when it is below it, and does it again whenever that changes (the keyboard rising or its
 * suggestion bar, a rotation) and whenever `settled` changes (a new question, an answer that made the dock taller). It never scrolls back, or on a scroll of
 * the person's own: reading the top of the page while the keyboard is up is theirs to do.
 */
export function useKeepInView(ref: RefObject<HTMLElement | null>, inset: number, settled: unknown): void {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const reveal = () => {
      if (inset === 0 && !element.contains(document.activeElement)) return
      const visible = window.visualViewport
      const visibleBottom = visible ? visible.offsetTop + visible.height : window.innerHeight
      const delta = scrollDeltaToClear(element.getBoundingClientRect().bottom, visibleBottom)
      if (delta > 0) window.scrollBy({ top: delta })
    }
    reveal()
    const visible = window.visualViewport
    visible?.addEventListener('resize', reveal)
    window.addEventListener('resize', reveal)
    return () => {
      visible?.removeEventListener('resize', reveal)
      window.removeEventListener('resize', reveal)
    }
  }, [ref, inset, settled])
}
