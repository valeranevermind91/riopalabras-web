import { useEffect, useRef, useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { WordCard } from '../components/WordCard'
import { langFromSettings } from '../data/rio'
import { learnedToday } from '../data/daily'
import { createBatchFinisher, learnPhase, selectLearnBatch } from '../data/learn'
import type { MetricsRecorder } from '../data/metrics'
import type { UserData } from '../data/useUserData'
import { useQueueStatus } from '../data/useQueueStatus'
import type { QueueTicket, WriteQueue } from '../data/writeQueue'
import { haptic } from '../lib/telegram'
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
  const buildSession = (source: UserData) => {
    const batch = selectLearnBatch(source.words, source.settings, new Date())
    const finish = createBatchFinisher(batch, {
      queue,
      getSettings: source.getSettings,
      applyProgress: source.applyProgress,
      applySettings: source.applySettings,
      onFinished: () => metrics?.markActiveToday(),
    })
    return { batch, finish }
  }

  const [session, setSession] = useState(() => buildSession(data))
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  // The batch's place in the write queue, once "Finish batch" was pressed. The screen follows the queue: saving → error (Retry) → done.
  const [ticket, setTicket] = useState<QueueTicket | null>(null)
  const status = useQueueStatus(queue)

  const words = session.batch.words
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

  const go = (delta: 1 | -1) => {
    const next = index + delta
    if (!reading || next < 0 || next > lastIndex) return
    setDirection(delta > 0 ? 'next' : 'prev')
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

  const swipe = useSwipe({
    onNext: () => go(1),
    onPrevious: () => go(-1),
    canNext: index < lastIndex,
    canPrevious: index > 0,
    enabled: reading,
  })

  // Hands the batch to the queue (a double tap just returns the same ticket); nothing here awaits the network.
  const finish = () => {
    haptic('tap')
    setTicket(session.finish())
  }

  const startNextBatch = () => {
    haptic('tap')
    const next = buildSession(data)
    setSession(next)
    setTicket(null)
    setIndex(0)
    setDirection('next')
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
    <main className="screen">
      <ScreenHeader title={strings.learn.title} onBack={onBack} />

      <div className="learn-progress">
        <span>{strings.learn.wordNofM(index + 1, words.length)}</span>
        <div className="bar" role="progressbar" aria-valuemin={1} aria-valuemax={words.length} aria-valuenow={index + 1}>
          <div className="bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="swipe-area" style={swipe.style} {...swipe.handlers}>
        <div key={index} className={`card-enter card-enter-${direction}`}>
          <WordCard word={words[index]} lang={langFromSettings(data.settings)} />
        </div>
      </div>

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
