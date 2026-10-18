import { useEffect, useLayoutEffect, useRef } from 'react'
import { backTarget, type Screen } from './nav'

/**
 * Where the page sits when a screen replaces another. Every screen shares the one page scroll, so without this a screen opens wherever the last one was
 * scrolled to: "How it works", a tall page, opened from the bottom of Settings landed in the middle of its text. A screen opens at the top; the one
 * Back leads to (or a flow leaves to) gets the place it was left at, so Settings is where it was after reading "How it works".
 */
export function scrollTargetFor(from: Screen, to: Screen, saved: ReadonlyMap<Screen, number>, openedFrom: 'home' | 'words' | null): number {
  return backTarget(from, from === 'word' ? openedFrom : null) === to ? (saved.get(to) ?? 0) : 0
}

/** Applies scrollTargetFor whenever `screen` changes. `openedFrom` is where an open word was opened from (it decides where Back goes from it). */
export function useScreenScroll(screen: Screen, openedFrom: 'home' | 'words' | null): void {
  const previous = useRef(screen)
  const lastY = useRef(0)
  const saved = useRef(new Map<Screen, number>())

  // The place on the screen being left, kept as it is scrolled: by the time the next screen has rendered the browser may already have clamped it.
  useEffect(() => {
    const onScroll = () => {
      lastY.current = window.scrollY
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    if (previous.current === screen) return
    const from = previous.current
    previous.current = screen
    saved.current.set(from, lastY.current)
    const y = scrollTargetFor(from, screen, saved.current, openedFrom)
    window.scrollTo(0, y)
    lastY.current = y
  }, [screen, openedFrom])
}
