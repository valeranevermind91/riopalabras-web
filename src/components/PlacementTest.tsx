import { useEffect, useState } from 'react'
import { buildPlacement, placementResult, probePositions, startPosition, type PlacementResult } from '../data/placement'
import { headword } from '../data/headword'
import type { Word } from '../data/types'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'
import { PlacementScale } from './PlacementScale'

const t = () => strings.onboarding.placement

interface PlacementTestProps {
  words: readonly Word[]
  /** Keeps what the test found (start_rank, the words marked as known). Not called for a skip. */
  onSave: (result: PlacementResult) => void
  /** The test is finished and kept. */
  onDone: () => void
  /** Leaves with no result and nothing written. */
  onSkip: () => void
  /** Back from the first set. */
  onBack: () => void
  /** Whether a starting point is already stored: a test with nothing ticked then changes nothing, and the result says so. */
  hasStartRank: boolean
  /** The line saying the test can be taken later from Settings (the intro says it; Settings does not need to). */
  showSkipNote: boolean
  /** Lets the back button (Telegram's or the page's) step back through the sets before it leaves. */
  interceptBack?: (handler: (() => boolean) | null) => void
}

/**
 * The placement test: five sets of five words, one set per screen, ascending in rarity. "Which of these do you know?" The words toggle;
 * nothing is right or wrong and none marked is fine. No score, no praise. Skip is on every set. The words are picked once, when the test opens.
 */
export function PlacementTest({ words, onSave, onDone, onSkip, onBack, hasStartRank, showSkipNote, interceptBack }: PlacementTestProps) {
  const [bands] = useState(() => buildPlacement(words))
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<ReadonlySet<string>[]>(() => Array.from({ length: 5 }, () => new Set<string>()))
  // What the finished test found, said back to the person before they move on (null while the test is being taken).
  const [found, setFound] = useState<PlacementResult | null>(null)

  useEffect(() => {
    if (!interceptBack) return
    interceptBack(() => {
      if (found) {
        onDone() // already kept: Back from the result leaves, it does not reopen the sets
        return true
      }
      if (index > 0) {
        setIndex(index - 1)
        return true
      }
      return false
    })
    return () => interceptBack(null)
  }, [interceptBack, index, found, onDone])

  const labels = t()
  if (!bands) {
    return (
      <div className="place" data-state="unavailable">
        <p className="intro-text">{labels.unavailable}</p>
        <div className="place-footer">
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            {labels.back}
          </button>
          <button type="button" className="btn btn-primary" onClick={onSkip}>
            {labels.next}
          </button>
        </div>
      </div>
    )
  }

  const band = bands[index]
  const last = index === bands.length - 1
  const toggle = (esWord: string) => {
    haptic('select')
    setSelected((all) =>
      all.map((set, k) => {
        if (k !== index) return set
        const next = new Set(set)
        if (!next.delete(esWord)) next.add(esWord)
        return next
      }),
    )
  }
  const forward = () => {
    haptic('tap')
    if (!last) return setIndex(index + 1)
    const result = placementResult(bands, selected)
    onSave(result)
    setFound(result)
  }

  const positions = probePositions(bands.length)
  if (found) {
    // Nothing ticked with a stored starting point: nothing was written (savePlacement), so there is no new place to show on the scale, only that the old one stays.
    if (found.marked.length === 0 && hasStartRank) {
      return (
        <div className="place" data-state="result" data-unchanged="true">
          <h2 className="place-question">{labels.resultTitle}</h2>
          <p className="intro-text">{labels.resultUnchanged}</p>
          <div className="place-footer is-single">
            <button type="button" className="btn btn-primary" onClick={onDone}>
              {showSkipNote ? labels.next : labels.resultDone}
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className="place" data-state="result">
        <h2 className="place-question">{labels.resultTitle}</h2>
        {/* the search, finished: every probe asked, and the marker where Learn will start */}
        <div role="img" aria-label={labels.scale.resultLabel}>
          <PlacementScale probes={positions} current={null} done={positions.map((_, i) => i)} settled={startPosition(bands, found.startRank)} labels={labels.scale} />
        </div>
        <p className="intro-text">{found.marked.length > 0 ? labels.resultMarked(found.marked.length) : labels.resultNoneMarked}</p>
        <p className="intro-text">{found.startRank !== null ? labels.resultHarder : labels.resultBeginning}</p>
        {/* a start from further out is a guess from 25 words: say it will correct itself (Learn draws about a third of every batch from below the start) */}
        {found.startRank !== null && <p className="intro-note place-approx">{labels.resultApprox}</p>}
        <div className="place-footer is-single">
          <button type="button" className="btn btn-primary" onClick={onDone}>
            {showSkipNote ? labels.next : labels.resultDone}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="place" data-state="asking" data-set={index + 1}>
      {index === 0 && <p className="place-purpose">{labels.purpose}</p>}
      <div className="place-progress">
        <span>{labels.set(index + 1, bands.length)}</span>
        {/* the search so far on a scale of the whole dictionary: the set being asked is lit, the ones asked are dimmed; nothing fills up */}
        <div role="progressbar" aria-label={labels.progress} aria-valuemin={1} aria-valuemax={bands.length} aria-valuenow={index + 1} aria-valuetext={labels.set(index + 1, bands.length)}>
          <PlacementScale probes={positions} current={index} done={positions.map((_, i) => i).filter((i) => i < index)} settled={null} labels={labels.scale} />
        </div>
      </div>

      <h2 className="place-question" id="place-question">
        {labels.question}
      </h2>
      <p className="intro-note">{labels.hint}</p>

      <div className="place-chips" role="group" aria-labelledby="place-question">
        {band.words.map((word) => {
          const on = selected[index].has(word.esWord)
          return (
            <button key={word.esWord} type="button" lang="es" className={on ? 'place-chip is-on' : 'place-chip'} aria-pressed={on} onClick={() => toggle(word.esWord)}>
              {headword(word).text}
            </button>
          )
        })}
      </div>

      <p className="intro-note place-hides">{labels.hidesNote}</p>

      <div className="place-skip">
        <button type="button" className="link-btn" onClick={onSkip}>
          {labels.skip}
        </button>
        {showSkipNote && <span className="intro-note">{labels.skipNote}</span>}
      </div>

      <div className="place-footer">
        <button type="button" className="btn btn-secondary" onClick={() => (index > 0 ? setIndex(index - 1) : onBack())}>
          {labels.back}
        </button>
        <button type="button" className="btn btn-primary" onClick={forward}>
          {last ? labels.finish : labels.next}
        </button>
      </div>
    </div>
  )
}
