import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { windowRange } from '../lib/windowRange'

/** A phone-sized guess for the first render, before the real height is measured. */
const DEFAULT_VIEWPORT = 640

interface VirtualListProps {
  count: number
  /** Every row is exactly this tall (px), which is what makes the window a sum instead of a measurement. */
  rowHeight: number
  getKey: (index: number) => string
  renderRow: (index: number) => ReactNode
  /** Where to start (a list coming back from a detail screen). Read once, on mount. */
  initialScrollTop?: number
  onScrollTop?: (scrollTop: number) => void
  label: string
}

/**
 * A scrolling list that renders only the rows in view: all 4,753 words are in memory, but only a screenful of them is in
 * the page. The scroller is the list itself, so the screen around it keeps its place.
 */
export function VirtualList({ count, rowHeight, getKey, renderRow, initialScrollTop = 0, onScrollTop, label }: VirtualListProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(initialScrollTop)
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = initialScrollTop
    setScrollTop(el.scrollTop)
    setViewport(el.clientHeight || DEFAULT_VIEWPORT)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setViewport(el.clientHeight || DEFAULT_VIEWPORT))
    observer.observe(el)
    return () => observer.disconnect()
    // initialScrollTop is read once, on mount: later changes come from the user scrolling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { start, end } = windowRange(scrollTop, viewport, rowHeight, count)
  const rows: ReactNode[] = []
  for (let i = start; i < end; i++) {
    rows.push(
      <div key={getKey(i)} role="listitem" className="vlist-row" style={{ top: i * rowHeight, height: rowHeight }}>
        {renderRow(i)}
      </div>,
    )
  }

  return (
    <div
      ref={scroller}
      className="vlist"
      role="list"
      aria-label={label}
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop
        setScrollTop(top)
        onScrollTop?.(top)
      }}
    >
      <div className="vlist-space" style={{ height: count * rowHeight }}>
        {rows}
      </div>
    </div>
  )
}
