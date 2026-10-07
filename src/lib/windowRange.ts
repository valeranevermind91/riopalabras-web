/**
 * Which rows are on screen: from the row at the top edge to the row at the bottom edge, plus `overscan` either side,
 * clamped to the list. `end` is exclusive.
 */
export function windowRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = 6): { start: number; end: number } {
  if (count <= 0) return { start: 0, end: 0 }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const last = Math.ceil((Math.max(0, scrollTop) + viewport) / rowHeight)
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) }
}
