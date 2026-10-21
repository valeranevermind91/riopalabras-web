import { useEffect, useRef, useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import type { MetricsRecorder } from '../data/metrics'
import type { ReviewLog } from '../data/reviewLog'
import {
  WRONG_FLASH_MS,
  buildMatchingGroup,
  clearWrong,
  isMatchingComplete,
  tapAndFinish,
  type MatchGroup,
  matchingEligibleCount,
  PRACTICE_MIN_WORDS,
  recordPracticeCards,
  recordPracticeCompleted,
  startMatching,
  type MatchSide,
  type MatchingState,
} from '../data/practice'
import type { UserData } from '../data/useUserData'
import { wordKey } from '../data/words'
import type { WriteQueue } from '../data/writeQueue'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

interface MatchingScreenProps {
  data: UserData
  queue: WriteQueue
  metrics: Pick<MetricsRecorder, 'markActiveToday'> | null
  /** The review log (App makes it once the user is signed in). Without it nothing is logged. */
  reviewLog?: ReviewLog | null
  onHome: () => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
  /**
   * Set when Learn's end screen offers Matching on the batch just learned: these rounds, one after the other, and `onFinish` after the last one. This is
   * practice only. It does not count toward the streak, and its rows in the review log carry the mode 'practice'; it never touches the schedule.
   */
  practice?: { rounds: readonly MatchGroup[]; onFinish: () => void }
}

const newRound = (data: UserData): MatchingState | null => {
  const group = buildMatchingGroup(data.words, data.settings)
  return group ? startMatching(group) : null
}

export function MatchingScreen({ data, queue, metrics, reviewLog, onHome, onBack, practice }: MatchingScreenProps) {
  const t = strings.practice
  const [roundIndex, setRoundIndex] = useState(0)
  const [round, setRound] = useState(() => (practice ? startMatching(practice.rounds[0]) : newRound(data)))
  const latest = useRef(round)
  // The review log: a group is one sitting (a new group gets a new session id); the rounds of one batch's practice are one sitting together. `missed` holds the words that were in a wrong pair in this group:
  // a pair matched after that is logged as needing another try.
  const [sessionId, setSessionId] = useState(() => reviewLog?.startSession() ?? null)
  const missed = useRef(new Set<string>())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    },
    [],
  )

  const commit = (next: MatchingState | null) => {
    latest.current = next
    setRound(next)
  }

  const tap = (side: MatchSide, id: string) => {
    const current = latest.current
    if (!current) return
    // Once per finished group: today's metrics row. Once per matched pair: a card toward the streak. Practising a batch does neither (it is not counted).
    const deps = { getSettings: data.getSettings, applySettings: data.applySettings, queue, metrics, getWords: () => data.words }
    const next = tapAndFinish(current, side, id, () => {
      if (!practice) recordPracticeCompleted(deps)
    })
    if (next === current) return
    // Each matched pair is a card done (a wrong tap and a first selection are not).
    if (!practice && next.matched.size > current.matched.size) recordPracticeCards(deps, next.matched.size - current.matched.size)
    // One log row per matched pair: right at the first try, or after a wrong pair that included it (a wrong tap alone is not an answer to log).
    if (next.wrong && next.selectedLeft !== null && next.selectedRight !== null) {
      missed.current.add(next.selectedLeft)
      missed.current.add(next.selectedRight)
    }
    if (reviewLog && next.matched.size > current.matched.size) {
      for (const id of next.matched) {
        if (current.matched.has(id)) continue
        const word = data.words.find((w) => wordKey(w.esWord) === id)
        if (word) reviewLog.practice({ word, mode: practice ? 'practice' : 'matching', correct: !missed.current.has(id), sessionId, durationMs: null, now: new Date() })
      }
    }
    commit(next)

    if (next.wrong) {
      haptic('error')
      // Input stays blocked (tapTile ignores taps while `wrong`) until the flash is over.
      flashTimer.current = setTimeout(() => {
        flashTimer.current = null
        if (latest.current) commit(clearWrong(latest.current))
      }, WRONG_FLASH_MS)
    } else {
      haptic(isMatchingComplete(next) ? 'success' : 'select')
    }
  }

  const nextGroup = () => {
    haptic('tap')
    missed.current = new Set()
    if (practice) {
      const next = Math.min(roundIndex + 1, practice.rounds.length - 1)
      setRoundIndex(next)
      commit(startMatching(practice.rounds[next]))
      return
    }
    setSessionId(reviewLog?.startSession() ?? null)
    commit(newRound(data))
  }

  const header = <ScreenHeader title={t.matchingTitle} onBack={onBack} />

  if (!round) {
    return (
      <main className="screen practice">
        {header}
        <section className="post-batch">
          <h2>{t.matchingInsufficient}</h2>
          <div className="post-batch-actions">
            <button type="button" className="btn btn-primary" onClick={onHome}>
              {t.backHome}
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (practice && isMatchingComplete(round)) {
    const more = roundIndex < practice.rounds.length - 1
    return (
      <main className="screen practice">
        {header}
        <section className="post-batch">
          <h2>{t.groupComplete}</h2>
          <div className="post-batch-actions">
            <button type="button" className="btn btn-primary" onClick={more ? nextGroup : practice.onFinish}>
              {more ? t.nextWords : t.practiceDone}
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (isMatchingComplete(round)) {
    const canContinue = matchingEligibleCount(data.words, data.settings) >= PRACTICE_MIN_WORDS
    return (
      <main className="screen practice">
        {header}
        <section className="post-batch">
          <h2>{t.groupComplete}</h2>
          <div className="post-batch-actions">
            {canContinue && (
              <button type="button" className="btn btn-primary" onClick={nextGroup}>
                {t.nextGroup}
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

  const tileClass = (side: MatchSide, id: string) => {
    const selected = (side === 'left' ? round.selectedLeft : round.selectedRight) === id
    const base = side === 'left' ? 'match-tile is-es' : 'match-tile'
    if (round.matched.has(id)) return `${base} is-matched`
    if (selected) return `${base} ${round.wrong ? 'is-wrong' : 'is-selected'}`
    return base
  }

  const column = (side: MatchSide) => (
    <div className="match-col">
      {(side === 'left' ? round.left : round.right).map((item) => (
        <button
          key={item.id}
          type="button"
          className={tileClass(side, item.id)}
          disabled={round.matched.has(item.id)}
          aria-pressed={(side === 'left' ? round.selectedLeft : round.selectedRight) === item.id}
          onClick={() => tap(side, item.id)}
        >
          {side === 'left' ? item.spanish : item.gloss}
        </button>
      ))}
    </div>
  )

  return (
    <main className="screen practice">
      {header}
      <p className="match-hint">{t.matchingHint}</p>
      <div className="match-grid">
        {column('left')}
        {column('right')}
      </div>
    </main>
  )
}
