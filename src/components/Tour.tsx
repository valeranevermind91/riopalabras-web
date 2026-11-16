import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { anchorTarget, revealTarget, useAnchorRect } from '../lib/useAnchorRect'
import { TOUR_STEPS, type TourStepId } from '../data/tourSteps'
import { strings } from '../strings'

const GAP = 16
const EDGE = 8
const SIDE_PAD = 16
const SPOT_PAD = 3

/**
 * The coach-mark tour on Home: the screen dimmed, one element lit at a time, a card with its name, a line, "Skip" (on every step) and "Next" / "Done". Each step is anchored to its element
 * (useAnchorRect), so it follows the element when a notice or anything else moves it. `onEnd` is called once, when the tour is finished or skipped.
 */
export function Tour({ onEnd }: { onEnd: (how: 'done' | 'skip') => void }) {
  // the steps whose element is there when the tour starts
  const [steps] = useState(() => TOUR_STEPS.filter((s) => anchorTarget(s.target)))
  const [index, setIndex] = useState(0)
  const step = steps[index]
  const rect = useAnchorRect(step?.target ?? null)
  const card = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const [height, setHeight] = useState(0)
  const ended = useRef(false)
  const last = index >= steps.length - 1

  const end = (how: 'done' | 'skip') => {
    if (ended.current) return
    ended.current = true
    onEnd(how)
  }
  const advance = () => (last ? end('done') : setIndex(index + 1))

  // nothing to show (no step has its element): the tour is over before it starts
  useEffect(() => {
    if (steps.length === 0) end('skip')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at the start
  }, [])

  // a step whose element has gone (the row left the screen) is passed over
  const gone = step !== undefined && rect === null
  useEffect(() => {
    if (!gone) return
    const timer = setTimeout(() => (last ? end('done') : setIndex((i) => i + 1)), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the element being gone is what it runs for
  }, [gone, last])

  // each step: its element in view, and the focus on "Next" (the page behind is inert, so the keyboard stays in the card)
  useLayoutEffect(() => {
    if (!step) return
    revealTarget(step.target, (card.current?.offsetHeight ?? 150) + GAP + EDGE, 'above')
    next.current?.focus({ preventScroll: true })
  }, [step])
  useLayoutEffect(() => {
    if (card.current && card.current.offsetHeight !== height) setHeight(card.current.offsetHeight)
  }, [rect, index, height])
  useEffect(() => {
    const main = document.querySelector('main')
    main?.setAttribute('inert', '')
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && end('skip')
    document.addEventListener('keydown', escape)
    return () => {
      main?.removeAttribute('inert')
      document.removeEventListener('keydown', escape)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, [])

  if (!step || !rect) return null
  const t = strings.hints.tour
  const text = t[step.id as TourStepId]
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const width = Math.min(320, vw - 2 * SIDE_PAD)
  const left = Math.max(SIDE_PAD, Math.min(vw - SIDE_PAD - width, rect.left + rect.width / 2 - width / 2))
  const pointer = Math.max(24, Math.min(width - 24, rect.left + rect.width / 2 - left))
  const placement = rect.top + rect.height / 2 > vh / 2 ? 'above' : 'below'
  const wanted = placement === 'below' ? rect.top + rect.height + GAP : rect.top - height - GAP
  const top = Math.max(EDGE, Math.min(vh - height - EDGE, wanted))
  return createPortal(
    <>
      <div className="tour-scrim" />
      <div className="tour-spot" style={{ top: rect.top - SPOT_PAD, left: rect.left - SPOT_PAD, width: rect.width + 2 * SPOT_PAD, height: rect.height + 2 * SPOT_PAD, borderRadius: rect.radius }} />
      <div ref={card} className={`tour-card is-${placement}`} role="dialog" aria-label={t.label} style={{ top, left, width, '--pointer-x': `${pointer}px` } as CSSProperties}>
        <h3>{text.title}</h3>
        <p>{text.text}</p>
        <div className="tour-foot">
          <span className="tour-step">{t.step(index + 1, steps.length)}</span>
          <button type="button" className="tour-skip" onClick={() => end('skip')}>
            {t.skip}
          </button>
          <button ref={next} type="button" className="tour-next" onClick={advance}>
            {last ? t.done : t.next}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
