import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { reserveFoot, revealTarget, useAnchorRect } from '../lib/useAnchorRect'
import { strings } from '../strings'

const GAP = 14
const EDGE = 8
const SIDE_PAD = 16

/**
 * A one-time bubble with a pointer, on the element carrying data-hint="<target>". It is kept on that element by useAnchorRect, not placed by a coordinate. A tap anywhere (and
 * Escape, and its own "Got it") closes it, and the tap still does what it was for. `onShown` is called once, when the target is found and the bubble is on screen.
 */
export function HintBubble({ target, placement, text, onDismiss, onShown }: { target: string; placement: 'above' | 'below'; text: string; onDismiss: () => void; onShown?: () => void }) {
  const rect = useAnchorRect(target)
  const box = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const revealed = useRef(false)
  const shown = useRef(false)
  const release = useRef<(() => void) | null>(null)
  useEffect(() => () => release.current?.(), [])

  useLayoutEffect(() => {
    if (!rect || !box.current) return
    const h = box.current.offsetHeight
    if (h !== height) setHeight(h)
    if (!revealed.current) {
      revealed.current = true
      if (placement === 'below') release.current = reserveFoot(h + GAP + EDGE) // the page may end right under the element: give it room to scroll
      revealTarget(target, h + GAP + EDGE, placement)
    }
    if (!shown.current) {
      shown.current = true
      onShown?.()
    }
  }, [rect, height, target, placement, onShown])

  useEffect(() => {
    const away = () => onDismiss()
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss()
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [onDismiss])

  if (!rect) return null
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const width = Math.min(300, vw - 2 * SIDE_PAD)
  const left = Math.max(SIDE_PAD, Math.min(vw - SIDE_PAD - width, rect.left + rect.width / 2 - width / 2))
  const pointer = Math.max(24, Math.min(width - 24, rect.left + rect.width / 2 - left))
  const wanted = placement === 'below' ? rect.top + rect.height + GAP : rect.top - height - GAP
  const top = Math.max(EDGE, Math.min(vh - height - EDGE, wanted))
  return createPortal(
    <>
      <div className="hint-ring" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: rect.radius }} />
      <div ref={box} className={`hint-bubble is-${placement}`} role="status" style={{ top, left, width, '--pointer-x': `${pointer}px` } as CSSProperties}>
        <p>{text}</p>
        <button type="button" className="hint-bubble-ok" onClick={onDismiss}>
          {strings.hints.gotIt}
        </button>
      </div>
    </>,
    document.body,
  )
}
