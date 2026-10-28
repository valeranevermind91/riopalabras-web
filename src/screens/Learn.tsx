import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { UnsavedNotice } from '../components/UnsavedNotice'
import { SwipeGhost } from '../components/SwipeGhost'
import { WordCard } from '../components/WordCard'
import { headword } from '../data/headword'
import { reportFor, type FeedbackReport, type SendResult } from '../data/feedback'
import { learnedToday } from '../data/daily'
import { batchPracticeAvailable, buildBatchRounds, type MatchGroup } from '../data/practice'
import { offerOutcome, reminderOfferAnsweredPatch, reminderOfferShownPatch, shouldOfferReminder } from '../data/reminderOffer'
import { saveSetting } from '../data/settingsActions'
import { UNDO_WINDOW_MS, createBatchKeeper, learnPhase, markKnown, selectLearnBatch, undoKnown, type BatchKeeper } from '../data/learn'
import type { MetricsRecorder } from '../data/metrics'
import type { UserData } from '../data/useUserData'
import { wordKey } from '../data/words'
import type { QueueTicket, WriteQueue } from '../data/writeQueue'
import { haptic } from '../lib/telegram'
import type { ReviewLog } from '../data/reviewLog'
import type { RemindersControl } from '../lib/useReminders'
import { useVerticalSwipesOff } from '../lib/useVerticalSwipesOff'
import { arrivalOf, type Arrival, type ExitPlan } from '../lib/swipe'
import { useSwipe } from '../lib/useSwipe'
import { strings } from '../strings'
import { FeedbackScreen } from './Feedback'
import { MatchingScreen } from './Matching'

interface LearnScreenProps {
  data: UserData
  queue: WriteQueue
  metrics: (Pick<MetricsRecorder, 'markActiveToday'> & Partial<Pick<MetricsRecorder, 'noteLearnCardsSeen'>>) | null
  /** The daily reminder (App owns it). Without it the end screen makes no offer. */
  reminders?: RemindersControl
  /** The review log (App makes it once the user is signed in). Without it nothing is logged. */
  reviewLog?: ReviewLog | null
  /** Sends a note to the author (App makes it only for a signed-in user). Without it the card has no "Report a problem" and nothing else changes. */
  sendReport?: ((report: FeedbackReport) => Promise<SendResult>) | null
  onHome: () => void
  onReview: () => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
  /** Lets the screen take the back press first (Telegram's BackButton) while the batch is being practised: Back then returns to the end screen. */
  registerBack?: (handler: (() => boolean) | null) => void
}

export function LearnScreen({ data, queue, metrics, reminders, reviewLog, sendReport, onHome, onReview, onBack, registerBack }: LearnScreenProps) {
  useVerticalSwipesOff() // the card scrolls inside itself: keep Telegram's swipe-down-to-minimize out of the way
  const [batch, setBatch] = useState(() => selectLearnBatch(data.words, data.settings, new Date()))
  // The keeper counts the batch as it is read: a word is learned the moment its card is reached (see createBatchKeeper), not when "Finish batch" is pressed. One per batch.
  const keeper = useRef<BatchKeeper | null>(null)
  const knownDeps = { queue, applyHidden: data.applyHidden, applyFavorite: data.applyFavorite }

  // The review log: a batch is one sitting, so it has a session id of its own (a new batch gets a new one).
  const [sessionId, setSessionId] = useState(() => reviewLog?.startSession() ?? null)

  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  // The batch's place in the write queue, once "Finish batch" was pressed. The screen is done at that moment: it does not wait for the network.
  const [ticket, setTicket] = useState<QueueTicket | null>(null)
  // The end screen's offer: Matching on the words of the batch just learned. The rounds, while it is on screen; null otherwise. Practising keeps the batch,
  // the ticket and everything else of this screen as they are, so leaving it, finished or not, is the end screen as it was.
  const [practising, setPracticing] = useState<readonly MatchGroup[] | null>(null)
  const exitPractice = useCallback(() => {
    setPracticing(null)
    window.scrollTo(0, 0)
  }, [])
  useEffect(() => {
    if (!registerBack || !practising) return
    registerBack(() => {
      exitPractice()
      return true
    })
    return () => registerBack(null)
  }, [registerBack, practising, exitPractice])

  // A report about the word on the card. The form is drawn over the card (which stays mounted, hidden), so the batch, the place in it and the marks are as they
  // were when it closes; the word it names is what the person is looking at (reportFor), the same hand-over as the word's detail screen. `reportedKey` is the
  // word it has just gone for, for the line under the control.
  const [reporting, setReporting] = useState<{ shown: string; named: string; key: string } | null>(null)
  const [reportedKey, setReportedKey] = useState<string | null>(null)
  const closeReport = useCallback(() => setReporting(null), [])

  const words = batch.words
  const lastIndex = words.length - 1
  const phase = words.length === 0 ? 'done' : learnPhase(ticket)
  const reading = phase === 'reading'

  const lastPhase = useRef(phase)
  useEffect(() => {
    if (lastPhase.current === phase) return
    lastPhase.current = phase
    if (phase === 'done') haptic('success')
  }, [phase])

  // How the card in front arrives after a swipe: from where the leaving card would be one strip-length away (see arrivalOf).
  const [arrival, setArrival] = useState<Arrival | null>(null)

  // The "marked as known" bar with its Undo: offered for the latest mark only, until the user moves to another card or UNDO_WINDOW_MS has passed. The
  // number says which mark it is (a second mark restarts the window); null is no offer. The marks themselves stay recorded until the batch is finished.
  const [undoOffer, setUndoOffer] = useState<number | null>(null)
  const offers = useRef(0)
  useEffect(() => {
    if (undoOffer === null) return
    const timer = setTimeout(() => setUndoOffer(null), UNDO_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [undoOffer])

  const go = (delta: 1 | -1, plan?: ExitPlan) => {
    const next = index + delta
    if (!reading || reporting || next < 0 || next > lastIndex) return // with the form open the arrow keys belong to its text box, not to the cards behind it
    setUndoOffer(null)
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
    enabled: reading && reporting === null,
  })

  const theKeeper = () =>
    (keeper.current ??= createBatchKeeper({
      queue,
      getSettings: data.getSettings,
      getWords: data.getWords,
      applyProgress: data.applyProgress,
      applySettings: data.applySettings,
      applyFavorite: data.applyFavorite,
      onKept: () => metrics?.markActiveToday(),
      onFinished: () => metrics?.markActiveToday(),
      ...(reviewLog ? { log: reviewLog, sessionId } : {}),
    }))

  // A card reached is a word learned: each time the card in front changes (and when Learn opens on the first), the keeper counts it, or takes back the one that was hidden
  // from the place it stood. The furthest card of the day goes to the day's row: it is what tells someone who left at card 8 from someone who never opened Learn.
  useEffect(() => {
    if (!reading || !words[index]) return
    theKeeper().reach(batch, index)
    metrics?.noteLearnCardsSeen?.(index + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the card in front (index in this batch) is what it runs for; the keeper and the metrics recorder are stable for the screen's life
  }, [reading, index, batch])

  // "Finish batch": what is left to count is counted (nothing, when every card was reached) and the screen is done; nothing here awaits the network.
  const finish = () => {
    haptic('tap')
    setUndoOffer(null)
    setTicket(theKeeper().finish(batch))
  }

  // "Already know it": hidden for good (Learn, Review, practice) through the write queue; the next candidate takes its place.
  const know = () => {
    if (!reading || !words[index]) return
    haptic('select')
    const next = markKnown(batch, index, knownDeps)
    setBatch(next)
    setUndoOffer(++offers.current)
    setIndex(Math.max(0, Math.min(index, next.words.length - 1)))
  }

  const undo = () => {
    const last = batch.known[batch.known.length - 1]
    if (!reading || !last || undoOffer === null) return
    haptic('tap')
    setUndoOffer(null) // one Undo for the latest mark: the one before it is not offered afterwards
    setBatch(undoKnown(batch, knownDeps))
    setIndex(Math.min(last.index, batch.words.length))
  }

  const startNextBatch = () => {
    haptic('tap')
    setUndoOffer(null)
    setBatch(selectLearnBatch(data.words, data.settings, new Date()))
    keeper.current = null
    setSessionId(reviewLog?.startSession() ?? null)
    setTicket(null)
    setIndex(0)
    setDirection('next')
    setArrival(null)
  }

  const batchKeys = useMemo(() => new Set(words.map((w) => wordKey(w.esWord))), [words])
  const practicable = phase === 'done' && ticket !== null && batchPracticeAvailable(data.words, batchKeys, data.settings)
  const practise = () => {
    haptic('tap')
    setPracticing(buildBatchRounds(data.words, batchKeys, data.settings))
    window.scrollTo(0, 0)
  }

  if (phase === 'done') {
    // The end screen stays mounted under the practice (hidden), so that coming back to it finds it as it was left: the one-time reminder offer included.
    return (
      <>
        {practising && <MatchingScreen data={data} queue={queue} metrics={metrics} reviewLog={reviewLog} onHome={onHome} onBack={onBack && exitPractice} practice={{ rounds: practising, onFinish: exitPractice }} />}
        <main className="screen" hidden={practising !== null}>
          <ScreenHeader title={strings.learn.title} onBack={onBack} />
          <PostBatch
            data={data}
            queue={queue}
            reminders={reminders}
            completed={ticket !== null}
            onPractise={practicable ? practise : null}
            onNextBatch={startNextBatch}
            onReview={onReview}
            onHome={onHome}
          />
        </main>
      </>
    )
  }

  const onLastCard = index >= lastIndex
  const progress = ((index + 1) / words.length) * 100

  const card = words[index]
  const canReport = reading && Boolean(sendReport) && !card.isCustom // a word the user typed in is edited, not reported (as on the detail screen)
  const openReport = () => {
    const { shown, named } = reportFor(card)
    haptic('tap')
    setUndoOffer(null)
    setReporting({ shown, named, key: wordKey(card.esWord) })
    window.scrollTo(0, 0)
  }

  return (
    <>
      {reporting && sendReport && (
        <FeedbackScreen
          kind="word"
          esWord={reporting.named}
          shownWord={reporting.shown}
          from="learn" // the place goes with the report (the kind stays 'word': it is about a word)
          send={sendReport}
          onSent={() => {
            setReportedKey(reporting.key)
            setReporting(null)
          }}
          onClose={closeReport}
          registerBack={registerBack}
          onBack={onBack}
        />
      )}
      <main className="screen fill" hidden={reporting !== null}>
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
                <WordCard word={words[index]} settings={data.settings} />
              </div>
            </div>
            {leaving && (
              <SwipeGhost key={leaving.id} plan={leaving.plan} onDone={clearLeaving}>
                <WordCard word={words[leaving.index]} settings={data.settings} />
              </SwipeGhost>
            )}
          </div>
        </div>

        {reading && undoOffer !== null && batch.known.length > 0 && (
          <div className="learn-undo" role="status">
            <span>{strings.learn.wordHidden(headword(batch.known[batch.known.length - 1].word).text)}</span>
            <button type="button" className="link-btn" onClick={undo}>
              {strings.learn.undo}
            </button>
          </div>
        )}

        {reading && (
          <div className="learn-known">
            <button type="button" className="known-btn" onClick={know}>
              {strings.learn.hideWord}
            </button>
          </div>
        )}

        {canReport && (
          <div className="learn-report">
            <button type="button" className="known-btn" onClick={openReport}>
              {strings.feedback.reportWord}
            </button>
            {reportedKey === wordKey(card.esWord) && (
              <p className="detail-note" role="status">
                {strings.feedback.sent}
              </p>
            )}
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
            <button type="button" className="btn btn-primary" onClick={finish}>
              {strings.learn.finishBatch}
            </button>
          </div>
        )}
      </main>
    </>
  )
}

function PostBatch({
  data,
  queue,
  reminders,
  completed,
  onPractise,
  onNextBatch,
  onReview,
  onHome,
}: {
  data: UserData
  queue: WriteQueue
  reminders: RemindersControl | undefined
  /** A batch was finished on this screen (as opposed to an end screen reached because there was nothing to learn). */
  completed: boolean
  /** The offer to practise the batch just learned; null when Matching cannot run on it (or no batch was learned here). */
  onPractise: (() => void) | null
  onNextBatch: () => void
  onReview: () => void
  onHome: () => void
}) {
  const { stats, settings } = data

  // The offer to turn on the daily reminder: at the end of a finished session, only if the reminder is known to be off, until it is answered and at most three times (data/reminderOffer.ts).
  // It is decided ONCE, here, when the end screen appears, because it counts itself as shown the moment it does (below), and that must not end it on this screen.
  // 'yes' and 'no' are the answers: the card is replaced by one line that says what happened and where the switch is, and stays until the person leaves.
  const [offer, setOffer] = useState<'open' | 'asking' | 'yes' | 'no' | 'closed'>(() => (shouldOfferReminder({ completed, settings, reminder: reminders }) ? 'open' : 'closed'))
  const shownBefore = useRef(settings.reminderOfferShows)
  const recorded = useRef(false)
  useEffect(() => {
    // Counted as shown now, through the write queue (nothing here waits for it), whatever the user does next: leaving without an answer leaves the offer to the next session, up to three.
    if (offer === 'closed' || recorded.current) return
    recorded.current = true
    saveSetting(reminderOfferShownPatch(shownBefore.current + 1), { applySettings: data.applySettings, queue })
  }, [offer, data.applySettings, queue])
  // An answer, yes or no, ends the offer for good.
  const answered = () => saveSetting(reminderOfferAnsweredPatch(), { applySettings: data.applySettings, queue })
  const remindMe = async () => {
    if (!reminders || offer !== 'open') return
    haptic('tap')
    setOffer('asking')
    answered()
    await reminders.set(true) // the Settings toggle's own path: Telegram's permission first, then the row with the time zone
    setOffer('yes') // granted, refused or failed alike: the line below says which, from the control's own state
  }
  const noThanks = () => {
    if (offer !== 'open') return
    haptic('select')
    answered()
    setOffer('no')
  }
  // What the answer led to. A refusal or a failed save says what Settings says; otherwise the reminder is on. A "yes" that did nothing (another change was under way) says nothing.
  const outcome = offer === 'yes' || offer === 'no' ? offerOutcome(offer, reminders) : null
  const answerLine = outcome === null ? null : { none: strings.learn.reminderOfferNone, done: strings.learn.reminderOfferDone, declined: strings.settings.reminderDeclined, failed: strings.settings.reminderFailed }[outcome]

  let title: string
  let subtitle: string | null = null
  let why: string | null = null
  let canContinue = false

  if (stats.learnPool === 0) {
    title = strings.learn.poolEmptyTitle
    subtitle = strings.learn.poolEmptySubtitle
  } else if (stats.remainingToday === 0) {
    title = strings.learn.capReachedTitle
    subtitle = strings.learn.capReachedSubtitle
    why = strings.learn.capReachedWhy // the reason the words stop: without it the limit reads as the app holding words back
  } else {
    title = strings.learn.newWordsToday(learnedToday(settings, new Date()), settings.dailyNewWordLimit)
    canContinue = true
  }

  const canReview = stats.reviewDue > 0
  // Exactly one primary button: the first action offered.
  const secondary = (primary: boolean) => (primary ? 'btn btn-primary' : 'btn btn-secondary')

  return (
    <section className="post-batch">
      <UnsavedNotice queue={queue} />
      <h2>{title}</h2>
      {subtitle && <p className="subtitle">{subtitle}</p>}
      {why && <p className="post-batch-why">{why}</p>}
      {onPractise && (
        <section className="practice-offer" aria-label={strings.learn.practiceButton}>
          <p>{strings.learn.practiceLine}</p>
          <button type="button" className="btn btn-secondary" onClick={onPractise}>
            {strings.learn.practiceButton}
          </button>
          <p className="practice-offer-note">{strings.learn.practiceNote}</p>
        </section>
      )}
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
      {(offer === 'open' || offer === 'asking') && (
        <section className="reminder-offer" aria-labelledby="reminder-offer-text">
          <p id="reminder-offer-text">{strings.learn.reminderOffer}</p>
          <div className="reminder-offer-actions">
            <button type="button" className="btn btn-secondary" disabled={offer === 'asking'} onClick={() => void remindMe()}>
              {strings.learn.reminderOfferYes}
            </button>
            <button type="button" className="btn btn-secondary" disabled={offer === 'asking'} onClick={noThanks}>
              {strings.learn.reminderOfferNo}
            </button>
          </div>
        </section>
      )}
      {answerLine && (
        <p className="reminder-offer-answer" role="status">
          {answerLine}
        </p>
      )}
    </section>
  )
}
