import { useEffect, useState } from 'react'
import { buildPlacement, placementResult, type PlacementResult } from '../data/placement'
import { headword } from '../data/headword'
import type { Word } from '../data/types'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

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
  /** The line saying the test can be taken later from Settings (the intro says it; Settings does not need to). */
  showSkipNote: boolean
  /** Lets the back button (Telegram's or the page's) step back through the sets before it leaves. */
  interceptBack?: (handler: (() => boolean) | null) => void
}

/**
 * The placement test: five sets of five words, one set per screen, ascending in rarity. "Which of these do you know?" The words toggle;
 * nothing is right or wrong and none marked is fine. No score, no praise. Skip is on every set. The words are picked once, when the test opens.
 */
export function PlacementTest({ words, onSave, onDone, onSkip, onBack, showSkipNote, interceptBack }: PlacementTestProps) {
  const [bands] = useState(() => buildPlacement(words))
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<ReadonlySet<string>[]>(() => Array.from({ length: 5 }, () => new Set<string>()))

  useEffect(() => {
    if (!interceptBack) return
    interceptBack(() => {
      if (index > 0) {
        setIndex(index - 1)
        return true
      }
      return false
    })
    return () => interceptBack(null)
  }, [interceptBack, index])

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
    onSave(placementResult(bands, selected))
    onDone()
  }

  return (
    <div className="place" data-state="asking" data-set={index + 1}>
      <div className="place-progress">
        <span>{labels.set(index + 1, bands.length)}</span>
        <div className="bar" role="progressbar" aria-label={labels.progress} aria-valuemin={1} aria-valuemax={bands.length} aria-valuenow={index + 1}>
          <div className="bar-fill" style={{ width: `${((index + 1) / bands.length) * 100}%` }} />
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
