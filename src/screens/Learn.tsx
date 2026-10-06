import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { SwipeGhost } from '../components/SwipeGhost'
import { WordCard } from '../components/WordCard'
import { headword } from '../data/headword'
import { langFromSettings } from '../data/rio'
import { learnedToday } from '../data/daily'
import { createBatchFinisher, learnPhase, markKnown, selectLearnBatch, undoKnown } from '../data/learn'
import type { MetricsRecorder } from '../data/metrics'
import type { UserData } from '../data/useUserData'
import { useQueueStatus } from '../data/useQueueStatus'
import type { QueueTicket, WriteQueue } from '../data/writeQueue'
import { haptic } from '../lib/telegram'
import { useVerticalSwipesOff } from '../lib/useVerticalSwipesOff'
import { arrivalOf, type Arrival, type ExitPlan } from '../lib/swipe'
import { useSwipe } from '../lib/useSwipe'
import { strings } from '../strings'

interface LearnScreenProps {
  data: UserData
  queue: WriteQueue
  metrics: Pick<MetricsRecorder, 'markActiveToday'> | null
  onHome: () => void
  onReview: () => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
}

export function LearnScreen({ data, queue, metrics, onHome, onReview, onBack }: LearnScreenProps) {
  useVerticalSwipesOff() // the card scrolls inside itself: keep Telegram's swipe-down-to-minimize out of the way
  const [batch, setBatch] = useState(() => selectLearnBatch(data.words, data.settings, new Date()))
  // The finisher is made when "Finish batch" is first pressed, from the batch as it is then (known words swapped out).
  const finisher = useRef<(() => QueueTicket) | null>(null)
  const knownDeps = { queue, applyHidden: data.applyHidden }

  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  // The batch's place in the write queue, once "Finish batch" was pressed. The screen follows the queue: saving → error (Retry) → done.
  const [ticket, setTicket] = useState<QueueTicket | null>(null)
  const status = useQueueStatus(queue)

  const words = batch.words
  const lastIndex = words.length - 1
  const phase = words.length === 0 ? 'done' : learnPhase(ticket, status)
  const error = phase === 'error' ? (status.error ?? '') : null
  const reading = phase === 'reading'

  const lastPhase = useRef(phase)
  useEffect(() => {
    if (lastPhase.current === phase) return
    lastPhase.current = phase
    if (phase === 'done') haptic('success')
    else if (phase === 'error') haptic('error')
  }, [phase])

  // How the card in front arrives after a swipe: from where the leaving card would be one strip-length away (see arrivalOf).
  const [arrival, setArrival] = useState<Arrival | null>(null)

  const go = (delta: 1 | -1, plan?: ExitPlan) => {
    const next = index + delta
    if (!reading || next < 0 || next > lastIndex) return
    setDirection(delta > 0 ? 'next' : 'prev')
    setArrival(plan ? arrivalOf(plan) : null)
    setIndex(next)
    haptic('select')
  }

  const goRef = useRef(go)
  useEffect(() => {
    goRef.current = go
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goRef.current(1)
      else if (e.key === 'ArrowLeft') goRef.current(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A committed swipe: the card that was let go keeps travelling (SwipeGhost) while the next one arrives.
  const [leaving, setLeaving] = useState<{ id: number; index: number; plan: ExitPlan } | null>(null)
  const leaveCount = useRef(0)
  const clearLeaving = useCallback(() => setLeaving(null), [])
  const commit = (delta: 1 | -1, plan: ExitPlan) => {
    const next = index + delta
    if (!reading || next < 0 || next > lastIndex) return
    setLeaving({ id: ++leaveCount.current, index, plan })
    go(delta, plan)
  }

  const swipe = useSwipe({
    onNext: (plan) => commit(1, plan),
    onPrevious: (plan) => commit(-1, plan),
    canNext: index < lastIndex,
    canPrevious: index > 0,
    enabled: reading,
  })

  // Hands the batch to the queue (a double tap just returns the same ticket); nothing here awaits the network.
  const finish = () => {
    haptic('tap')
    finisher.current ??= createBatchFinisher(batch, {
      queue,
      getSettings: data.getSettings,
      applyProgress: data.applyProgress,
      applySettings: data.applySettings,
      onFinished: () => metrics?.markActiveToday(),
    })
    setTicket(finisher.current())
  }

  // "Already know it": hidden for good (Learn, Review, practice) through the write queue; the next candidate takes its place.
  const know = () => {
    if (!reading || !words[index]) return
    haptic('select')
    const next = markKnown(batch, index, knownDeps)
    setBatch(next)
    setIndex(Math.max(0, Math.min(index, next.words.length - 1)))
  }

  const undo = () => {
    const last = batch.known[batch.known.length - 1]
    if (!reading || !last) return
    haptic('tap')
    setBatch(undoKnown(batch, knownDeps))
    setIndex(Math.min(last.index, batch.words.length))
  }

  const startNextBatch = () => {
    haptic('tap')
    setBatch(selectLearnBatch(data.words, data.settings, new Date()))
    finisher.current = null
    setTicket(null)
    setIndex(0)
    setDirection('next')
    setArrival(null)
  }

  if (phase === 'done') {
    return (
      <main className="screen">
        <ScreenHeader title={strings.learn.title} onBack={onBack} />
        <PostBatch data={data} onNextBatch={startNextBatch} onReview={onReview} onHome={onHome} />
      </main>
    )
  }

  const onLastCard = index >= lastIndex
  const progress = ((index + 1) / words.length) * 100

  return (
    <main className="screen fill">
      <ScreenHeader title={strings.learn.title} onBack={onBack} />

      <div className="learn-progress">
        <span>{strings.learn.wordNofM(index + 1, words.length)}</span>
        <div className="bar" role="progressbar" aria-valuemin={1} aria-valuemax={words.length} aria-valuenow={index + 1}>
          <div className="bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="swipe-area" {...swipe.handlers}>
        <div className="swipe-stage">
          <div className="swipe-layer" style={swipe.layerStyle}>
            <div
              key={`${index}:${words[index].esWord}`}
              className={arrival ? 'card-enter card-arrive' : `card-enter card-enter-${direction}`}
              style={arrival ? ({ '--arrive-from': `${arrival.from}px`, '--arrive-ms': `${arrival.duration}ms` } as CSSProperties) : undefined}
            >
              <WordCard word={words[index]} lang={langFromSettings(data.settings)} />
            </div>
          </div>
          {leaving && (
            <SwipeGhost key={leaving.id} plan={leaving.plan} onDone={clearLeaving}>
              <WordCard word={words[leaving.index]} lang={langFromSettings(data.settings)} />
            </SwipeGhost>
          )}
        </div>
      </div>

      {reading && batch.known.length > 0 && (
        <div className="learn-undo" role="status">
          <span>{strings.learn.markedKnown(headword(batch.known[batch.known.length - 1].word).text)}</span>
          <button type="button" className="link-btn" onClick={undo}>
            {strings.learn.undo}
          </button>
        </div>
      )}

      {reading && (
        <div className="learn-known">
          <button type="button" className="known-btn" onClick={know}>
            {strings.learn.alreadyKnow}
          </button>
        </div>
      )}

      <div className="learn-nav">
        <button type="button" className="btn btn-icon" aria-label={strings.learn.previous} disabled={!reading || index === 0} onClick={() => go(-1)}>
          ‹
        </button>
        <span className="hint">{strings.learn.swipeHint}</span>
        <button type="button" className="btn btn-icon" aria-label={strings.learn.next} disabled={!reading || onLastCard} onClick={() => go(1)}>
          ›
        </button>
      </div>

      {onLastCard && (
        <div className="learn-finish">
          {error !== null && (
            <p className="error" role="alert">
              {strings.learn.saveFailed(error)}
            </p>
          )}
          <button type="button" className="btn btn-primary" disabled={phase === 'saving'} onClick={phase === 'error' ? () => void queue.retry() : finish}>
            {phase === 'saving' ? strings.common.saving : phase === 'error' ? strings.common.retry : strings.learn.finishBatch}
          </button>
        </div>
      )}
    </main>
  )
}

function PostBatch({
  data,
  onNextBatch,
  onReview,
  onHome,
}: {
  data: UserData
  onNextBatch: () => void
  onReview: () => void
  onHome: () => void
}) {
  const { stats, settings } = data

  let title: string
  let subtitle: string | null = null
  let canContinue = false

  if (stats.learnPool === 0) {
    title = strings.learn.poolEmptyTitle
    subtitle = strings.learn.poolEmptySubtitle
  } else if (stats.remainingToday === 0) {
    title = strings.learn.capReachedTitle
    subtitle = strings.learn.capReachedSubtitle
  } else {
    title = strings.learn.newWordsToday(learnedToday(settings, new Date()), settings.dailyNewWordLimit)
    canContinue = true
  }

  const canReview = stats.reviewDue > 0
  // Exactly one primary button: the first action offered.
  const secondary = (primary: boolean) => (primary ? 'btn btn-primary' : 'btn btn-secondary')

  return (
    <section className="post-batch">
      <h2>{title}</h2>
      {subtitle && <p className="subtitle">{subtitle}</p>}
      <div className="post-batch-actions">
        {canContinue && (
          <button type="button" className={secondary(true)} onClick={onNextBatch}>
            {strings.learn.learnNextBatch}
          </button>
        )}
        {canReview && (
          <button type="button" className={secondary(!canContinue)} onClick={onReview}>
            {strings.learn.reviewDueWords(stats.reviewDue)}
          </button>
        )}
        <button type="button" className={secondary(!canContinue && !canReview)} onClick={onHome}>
          {strings.common.backToHome}
        </button>
      </div>
    </section>
  )
}
