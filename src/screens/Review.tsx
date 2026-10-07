import { useRef, useState } from 'react'
import { RatingButtons } from '../components/RatingButtons'
import { ReviewCard } from '../components/ReviewCard'
import { ScreenHeader } from '../components/ScreenHeader'
import { UnsavedNotice } from '../components/UnsavedNotice'
import { buildReviewSession, createRater } from '../data/review'
import type { MetricsRecorder } from '../data/metrics'
import type { UserData } from '../data/useUserData'
import type { WriteQueue } from '../data/writeQueue'
import { haptic } from '../lib/telegram'
import { useVerticalSwipesOff } from '../lib/useVerticalSwipesOff'
import { strings } from '../strings'

interface ReviewScreenProps {
  data: UserData
  queue: WriteQueue
  metrics: Pick<MetricsRecorder, 'recordReviewRating'> | null
  onHome: () => void
  onLearn: () => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
}

export function ReviewScreen({ data, queue, metrics, onHome, onLearn, onBack }: ReviewScreenProps) {
  useVerticalSwipesOff() // the card scrolls inside itself: keep Telegram's swipe-down-to-minimize out of the way
  const [session, setSession] = useState(() => buildReviewSession(data.words, new Date()))
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [completed, setCompleted] = useState(false)
  const ratedIndex = useRef(-1)

  const [rate] = useState(() =>
    createRater({
      applyProgress: data.applyProgress,
      applySettings: data.applySettings,
      getSettings: data.getSettings,
      queue,
      ...(metrics ? { metrics } : {}),
    }),
  )

  const reveal = () => {
    if (revealed || completed) return
    haptic('tap')
    setRevealed(true)
  }

  const onRate = (quality: number) => {
    // One rating per card: a second tap before the next card renders is ignored.
    if (!revealed || ratedIndex.current === index) return
    ratedIndex.current = index
    haptic('select')

    rate(session[index], quality)

    if (index >= session.length - 1) {
      setCompleted(true)
      // Ask the queue to send what is still waiting. Nothing here waits for it: the ratings are already applied in memory,
      // and if the network is gone they stay queued (and saved on the device) until it can be sent.
      void queue.flush().catch(() => {})
    } else {
      setIndex(index + 1)
      setRevealed(false)
    }
  }

  const refresh = () => {
    haptic('tap')
    setSession(buildReviewSession(data.words, new Date()))
    setIndex(0)
    setRevealed(false)
    setCompleted(false)
    ratedIndex.current = -1
  }

  const header = <ScreenHeader title={strings.review.title} onBack={onBack} />

  if (completed) {
    return (
      <main className="screen">
        {header}
        <UnsavedNotice queue={queue} />
        <section className="post-batch">
          <h2>{strings.review.allCaughtUp}</h2>
          <p className="subtitle">{strings.review.allCaughtUpSubtitle}</p>
          <div className="post-batch-actions">
            <button type="button" className="btn btn-primary" onClick={onHome}>
              {strings.common.backToHome}
            </button>
            <button type="button" className="btn btn-secondary" onClick={refresh}>
              {strings.review.refresh}
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (session.length === 0) {
    return (
      <main className="screen">
        {header}
        <section className="post-batch">
          <h2>{strings.review.emptyTitle}</h2>
          <p className="subtitle">{strings.review.emptyMessage}</p>
          <div className="post-batch-actions">
            <button type="button" className="btn btn-primary" onClick={onLearn}>
              {strings.review.goLearn}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onHome}>
              {strings.common.backToHome}
            </button>
          </div>
        </section>
      </main>
    )
  }

  const word = session[index]
  const progress = ((index + 1) / session.length) * 100

  return (
    <main className="screen fill">
      <header className="review-head">
        {onBack && (
          <button type="button" className="back-link" onClick={onBack}>
            ‹ {strings.common.back}
          </button>
        )}
        <div className="bar" role="progressbar" aria-label={strings.review.title} aria-valuemin={1} aria-valuemax={session.length} aria-valuenow={index + 1}>
          <div className="bar-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="review-count">{strings.review.progress(index + 1, session.length)}</span>
      </header>

      <UnsavedNotice queue={queue} />

      <div className="review-slot">
        <ReviewCard key={index} word={word} settings={data.settings} revealed={revealed} onReveal={reveal} />
      </div>

      <RatingButtons word={word} onRate={onRate} hidden={!revealed} />
    </main>
  )
}
