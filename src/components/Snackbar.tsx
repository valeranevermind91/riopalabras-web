import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { anchorTarget, reserveFoot } from '../lib/useAnchorRect'

/** How long the snackbar stays when nobody touches it. */
export const SNACKBAR_MS = 5000

/** A short line at the foot of the screen with one action; it goes by itself after `durationMs`. Give it a new `key` to start it over. `avoid` is the data-hint of an element the bar must not
 * cover (the button just pressed): the page gets room under it and is scrolled to bring that element clear. */
export function Snackbar({ message, actionLabel, onAction, onDismiss, durationMs = SNACKBAR_MS, avoid }: { message: string; actionLabel?: string; onAction?: () => void; onDismiss: () => void; durationMs?: number; avoid?: string }) {
  const bar = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!bar.current || !avoid) return
    const room = bar.current.offsetHeight + 24
    const release = reserveFoot(room)
    const el = anchorTarget(avoid)
    if (el) {
      const over = el.getBoundingClientRect().bottom + 8 - (window.innerHeight - room)
      if (over > 0) window.scrollBy(0, over)
    }
    return release
  }, [avoid])
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(timer)
  }, [onDismiss, durationMs])
  return (
    <div ref={bar} className="snackbar" role="status" style={{ '--snackbar-ms': `${durationMs}ms` } as CSSProperties}>
      <svg className="snackbar-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12.4l2.7 2.7L16 9.6" />
      </svg>
      <span className="snackbar-text">{message}</span>
      {actionLabel && onAction && (
        <button type="button" className="snackbar-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      <span className="snackbar-timer" aria-hidden="true" />
    </div>
  )
}
