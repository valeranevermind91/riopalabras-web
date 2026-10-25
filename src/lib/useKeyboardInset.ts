import { useEffect, useState } from 'react'

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
