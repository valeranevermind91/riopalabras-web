import type { CSSProperties } from 'react'

/** Where something sits on the scale: 0 is the most frequent words, 1 the rarest. */
export type ScalePosition = number

export interface PlacementScaleProps {
  /** Where each probe sits, in the order they were (or will be) asked. A probe is one set of words put to the person. */
  probes: readonly ScalePosition[]
  /** The probe being asked now (its index in `probes`), or null when none is. */
  current: number | null
  /** The probes already asked (their indexes, in any order: an adaptive test goes back and forth). */
  done: readonly number[]
  /** Where Learn will start, once the test knows; null until then. It settles from the last probe, or from `settledFrom`. */
  settled: ScalePosition | null
  settledFrom?: ScalePosition
  labels: { frequent: string; rare: string; start: string }
}

const percent = (position: ScalePosition) => `${Math.min(1, Math.max(0, position)) * 100}%`

/**
 * The search, drawn: a horizontal scale for the whole dictionary (frequent words on the left, rare on the right), a mark for each set of words the
 * test puts to the person, and, when it is done, a marker where Learn will start. It is a search, not a score: nothing fills up, nothing is
 * counted, no number is shown, and no colour says "good". The probe being asked is lit, the ones asked are dimmed, and the marker settles in
 * from the last probe (without moving at all where the device asks for reduced motion). The page around it says what it means; this is decoration
 * for the eye and is hidden from screen readers, so whoever draws it carries the accessible name.
 *
 * It knows nothing about bands or about how many probes there are, only positions on the scale, so the adaptive test can draw it with probes that
 * jump about instead of marching from left to right.
 */
export function PlacementScale({ probes, current, done, settled, settledFrom, labels }: PlacementScaleProps) {
  const asked = new Set(done)
  const from = settledFrom ?? probes[probes.length - 1] ?? 0
  return (
    <div className="pscale" aria-hidden="true" data-settled={settled !== null ? 'true' : 'false'}>
      <div className="pscale-stage">
        {settled !== null && (
          <span className="pscale-start" style={{ left: percent(settled), '--from': percent(from) } as CSSProperties}>
            {/* the label hangs from the marker towards the middle of the scale, so it stays inside the screen at both ends */}
            <span className="pscale-start-label" style={{ transform: `translateX(-${Math.min(1, Math.max(0, settled)) * 100}%)` }}>
              {labels.start}
            </span>
          </span>
        )}
        <div className="pscale-track">
          {probes.map((position, i) => (
            <span key={i} className={i === current ? 'pscale-probe is-current' : asked.has(i) ? 'pscale-probe is-done' : 'pscale-probe'} style={{ left: percent(position) }} />
          ))}
        </div>
      </div>
      <div className="pscale-ends">
        <span>{labels.frequent}</span>
        <span>{labels.rare}</span>
      </div>
    </div>
  )
}
