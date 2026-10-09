import { useState } from 'react'
import { ClozeQuestion } from '../components/ClozeQuestion'
import { ScreenHeader } from '../components/ScreenHeader'
import type { MetricsRecorder } from '../data/metrics'
import {
  clozeCueLines,
  PRACTICE_MIN_WORDS,
  answerCloze,
  buildClozeSession,
  clozeEligibleCount,
  clozeScore,
  recordPracticeCompleted,
  startCloze,
  type ClozeItem,
  type ClozeOutcome,
  type ClozeProgress,
} from '../data/practice'
import type { UserData } from '../data/useUserData'
import type { WriteQueue } from '../data/writeQueue'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

interface ClozeScreenProps {
  data: UserData
  queue: WriteQueue
  metrics: Pick<MetricsRecorder, 'markActiveToday'> | null
  onHome: () => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
}

export function ClozeScreen({ data, queue, metrics, onHome, onBack }: ClozeScreenProps) {
  const t = strings.practice
  const [session, setSession] = useState<readonly ClozeItem[] | null>(() => buildClozeSession(data.words))
  const [progress, setProgress] = useState<ClozeProgress>(startCloze)
  const { index, results, done } = progress

  const header = <ScreenHeader title={t.clozeTitle} onBack={onBack} />

  const answered = (outcome: ClozeOutcome) => {
    if (!session) return
    // Once per finished session: the streak and today's metrics row, through the write queue. Nothing per question.
    const next = answerCloze(progress, session.length, outcome, () => {
      haptic('success')
      recordPracticeCompleted({ getSettings: data.getSettings, applySettings: data.applySettings, queue, metrics })
    })
    setProgress(next)
  }

  const newSession = () => {
    haptic('tap')
    setSession(buildClozeSession(data.words))
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
    const canContinue = clozeEligibleCount(data.words) >= PRACTICE_MIN_WORDS
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
      <ClozeQuestion key={`${index}-${session[index].headword}`} item={session[index]} settings={data.settings} onAnswered={answered} />
    </main>
  )
}
