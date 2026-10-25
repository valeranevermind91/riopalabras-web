import { useEffect, useMemo, useRef, useState } from 'react'
import { ClozeQuestion } from '../components/ClozeQuestion'
import { ScreenHeader } from '../components/ScreenHeader'
import type { MetricsRecorder } from '../data/metrics'
import type { ReviewLog } from '../data/reviewLog'
import {
  clozeCueLines,
  PRACTICE_MIN_WORDS,
  answerCloze,
  buildClozeSession,
  clozeEligibleCount,
  clozeScore,
  recordPracticeCards,
  recordPracticeCompleted,
  startCloze,
  type ClozeItem,
  type ClozeOutcome,
  type ClozeProgress,
} from '../data/practice'
import type { UserData } from '../data/useUserData'
import type { WriteQueue } from '../data/writeQueue'
import { useCardTimer } from '../lib/cardTimer'
import { useKeyboardInset } from '../lib/useKeyboardInset'
import { wordKey } from '../data/words'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

interface ClozeScreenProps {
  data: UserData
  queue: WriteQueue
  metrics: Pick<MetricsRecorder, 'markActiveToday'> | null
  /** The review log (App makes it once the user is signed in). Without it nothing is logged. */
  reviewLog?: ReviewLog | null
  onHome: () => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
  /** Only these words (their wordKeys), for the questions and for "New session": Home's practice on the words learned today. Without it, every word that can be used. */
  scope?: ReadonlySet<string>
}

export function ClozeScreen({ data, queue, metrics, reviewLog, onHome, onBack, scope }: ClozeScreenProps) {
  const t = strings.practice
  const words = useMemo(() => (scope ? data.words.filter((w) => scope.has(wordKey(w.esWord))) : data.words), [data.words, scope])
  const [session, setSession] = useState<readonly ClozeItem[] | null>(() => buildClozeSession(words))
  const [progress, setProgress] = useState<ClozeProgress>(startCloze)
  const { index, results, done } = progress
  // The review log: a Cloze session has an id of its own, and each question's time is from the question appearing to the answer.
  const [sessionId, setSessionId] = useState(() => reviewLog?.startSession() ?? null)
  const keyboardInset = useKeyboardInset() // how much of the page the on-screen keyboard covers: the screen pads for it and the question scrolls its dock clear of it
  const timer = useCardTimer() // the time on a question: null if the app was away meanwhile or it took over a minute (see cardTimer.ts)
  // The time is read when the answer is COMMITTED (Check, or giving up), not when "Continue" is pressed after the feedback: reading the feedback is not time answering.
  const answeredIn = useRef<number | null>(null)
  useEffect(() => {
    timer.start() // the first question is in front of the user from the moment the screen is
  }, [timer])

  const header = <ScreenHeader title={t.clozeTitle} onBack={onBack} />

  const answered = (outcome: ClozeOutcome) => {
    if (!session) return
    // Each answered question is a card toward the streak (giving up is not an answer); once per finished session, today's metrics row.
    const deps = { getSettings: data.getSettings, applySettings: data.applySettings, queue, metrics, getWords: () => data.words }
    recordPracticeCards(deps, outcome === 'gaveUp' ? 0 : 1)
    // One log row per answered question, right or wrong (giving up is not an answer). The clock is read for every question, so the next starts afresh.
    const durationMs = answeredIn.current
    answeredIn.current = null
    if (reviewLog && outcome !== 'gaveUp') reviewLog.practice({ word: session[index].word, mode: 'cloze', correct: outcome === 'correct', sessionId, durationMs, now: new Date() })
    timer.start() // the next question is in front of the user from now
    const next = answerCloze(progress, session.length, outcome, () => {
      haptic('success')
      recordPracticeCompleted(deps)
    })
    setProgress(next)
  }

  const newSession = () => {
    haptic('tap')
    setSession(buildClozeSession(words))
    setSessionId(reviewLog?.startSession() ?? null)
    timer.start()
    setProgress(startCloze())
  }

  if (!session) {
    return (
      <main className="screen practice">
        {header}
        <section className="post-batch">
          <h2>{t.clozeInsufficient}</h2>
          <div className="post-batch-actions">
            <button type="button" className="btn btn-primary" onClick={onHome}>
              {t.backHome}
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (done) {
    const canContinue = clozeEligibleCount(words) >= PRACTICE_MIN_WORDS
    return (
      <main className="screen practice">
        {header}
        <section className="post-batch">
          <h2>{t.sessionComplete}</h2>
          <p className="subtitle">{t.score(clozeScore(results), results.length)}</p>
          <ul className="cz-results">
            {session.map((item, i) => {
              const gloss = clozeCueLines(item.word, data.settings).map((line) => line.text).join(' · ') // every enabled language (the cue's lines), on the one line
              return (
                <li key={item.headword} className={`cz-result cz-result-${results[i]}`}>
                  <span className="cz-result-word">{item.headword}</span>
                  {gloss && <span className="cz-result-gloss"> — {gloss}</span>}
                  <span className="cz-result-outcome">{t.outcome[results[i]]}</span>
                </li>
              )
            })}
          </ul>
          <div className="post-batch-actions">
            {canContinue && (
              <button type="button" className="btn btn-primary" onClick={newSession}>
                {t.newSession}
              </button>
            )}
            <button type="button" className={canContinue ? 'btn btn-secondary' : 'btn btn-primary'} onClick={onHome}>
              {t.backHome}
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="screen practice cz-screen">
      {header}
      <div className="bar" role="progressbar" aria-label={t.progressLabel} aria-valuemin={1} aria-valuemax={session.length} aria-valuenow={index + 1}>
        <div className="bar-fill" style={{ width: `${((index + 1) / session.length) * 100}%` }} />
      </div>
      <p className="cz-instruction">{t.clozeHint}</p>
      <ClozeQuestion key={`${index}-${session[index].headword}`} item={session[index]} settings={data.settings} keyboardInset={keyboardInset} onAnswered={answered} onChecked={() => (answeredIn.current = timer.stop())} />
    </main>
  )
}
