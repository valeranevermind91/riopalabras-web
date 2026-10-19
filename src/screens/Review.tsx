import { useEffect, useMemo, useRef, useState } from 'react'
import { RatingButtons } from '../components/RatingButtons'
import { ReviewCard } from '../components/ReviewCard'
import { ScreenHeader } from '../components/ScreenHeader'
import { UnsavedNotice } from '../components/UnsavedNotice'
import { buildReviewSession, createRater, dueWords, requeueAgain, withUpdate } from '../data/review'
import type { MetricsRecorder } from '../data/metrics'
import type { ReviewLog } from '../data/reviewLog'
import type { UserData } from '../data/useUserData'
import type { WriteQueue } from '../data/writeQueue'
import { useCardTimer } from '../lib/cardTimer'
import { useDueClock } from '../lib/useDueClock'
import { haptic } from '../lib/telegram'
import { useVerticalSwipesOff } from '../lib/useVerticalSwipesOff'
import { isAgain } from '../sm2/sm2'
import { strings } from '../strings'

interface ReviewScreenProps {
  data: UserData
  queue: WriteQueue
  metrics: Pick<MetricsRecorder, 'recordReviewRating'> | null
  /** The review log (App makes it once the user is signed in). Without it nothing is logged. */
  reviewLog?: ReviewLog | null
  onHome: () => void
  onLearn: () => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
}

export function ReviewScreen({ data, queue, metrics, reviewLog, onHome, onLearn, onBack }: ReviewScreenProps) {
  useVerticalSwipesOff() // the card scrolls inside itself: keep Telegram's swipe-down-to-minimize out of the way
  const [session, setSession] = useState(() => buildReviewSession(data.words, new Date()))
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [completed, setCompleted] = useState(false)
  const ratedIndex = useRef(-1)
  // The review log: this session's id (a new one when "Continue" starts the next session), and when the card now in front of the user appeared.
  const [sessionId, setSessionId] = useState(() => reviewLog?.startSession() ?? null)
  const timer = useCardTimer() // the time on a card: null if the app was away meanwhile or it took over a minute (see cardTimer.ts)
  useEffect(() => {
    timer.start() // the first card is in front of the user from the moment the screen is
  }, [timer])
  // The words rated in this session: a word comes back at the end after an Again (once: see requeueAgain), and rating it again is the same card, not a second one.
  const ratedInSession = useRef(new Set<string>())

  const [rate] = useState(() =>
    createRater({
      applyProgress: data.applyProgress,
      applySettings: data.applySettings,
      getSettings: data.getSettings,
      getWords: data.getWords,
      queue,
      ...(metrics ? { metrics } : {}),
      ...(reviewLog ? { log: reviewLog } : {}),
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

    const word = session[index]
    const repeat = ratedInSession.current.has(word.esWord)
    ratedInSession.current.add(word.esWord)
    const update = rate(word, quality, new Date(), !repeat, { sessionId, durationMs: timer.stop() })

    // An Again brings the word back at the end of this sitting, as the rating left it (so its next rating starts from the lowered ease), but only
    // once: a second Again lets it leave (it is already scheduled ten minutes out). The end is one card further on whenever a word is brought
    // back, so the session cannot finish with a word still owed, and the card counter's total never passes the ceiling.
    let cards = session
    if (isAgain(quality)) {
      cards = requeueAgain(session, withUpdate(session[index], update))
      setSession(cards)
    }

    if (index >= cards.length - 1) {
      clock.refresh() // the count on the end screen is taken as of now, not as of when the screen opened
      setCompleted(true)
      // Ask the queue to send what is still waiting. Nothing here waits for it: the ratings are already applied in memory,
      // and if the network is gone they stay queued (and saved on the device) until it can be sent.
      void queue.flush().catch(() => {})
    } else {
      setIndex(index + 1)
      setRevealed(false)
      timer.start() // the next card is in front of the user from now
    }
  }

  // When a session ends, how many words are still due, and it stays true while the person sits on that screen: the count is taken at the moment of the
  // last rating (so anything that came due meanwhile counts), again when the next word rated Again comes due, and again when the app returns to the
  // foreground. It is the same clock Home counts from (useDueClock), and the same rule Continue draws its next session by (dueWords at the moment).
  const clock = useDueClock(data.words, { timed: completed })
  const left = useMemo(() => (completed ? dueWords(data.words, clock.asOf).length : 0), [completed, data.words, clock.asOf])

  // "Continue" and "Refresh": the next session, drawn from what is due now.
  const refresh = () => {
    haptic('tap')
    setSession(buildReviewSession(data.words, new Date()))
    setSessionId(reviewLog?.startSession() ?? null) // the next session is a new sitting in the log
    timer.start()
    setIndex(0)
    setRevealed(false)
    setCompleted(false)
    ratedIndex.current = -1
    ratedInSession.current = new Set()
  }

  const header = <ScreenHeader title={strings.review.title} onBack={onBack} />

  if (completed && left > 0) {
    return (
      <main className="screen">
        {header}
        <UnsavedNotice queue={queue} />
        <section className="post-batch">
          <h2>{strings.review.sessionDone}</h2>
          <p className="subtitle">{strings.review.sessionLeft(left)}</p>
          <div className="post-batch-actions">
            <button type="button" className="btn btn-primary" onClick={refresh}>
              {strings.review.continue}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onHome}>
              {strings.common.backToHome}
            </button>
          </div>
        </section>
      </main>
    )
  }

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
