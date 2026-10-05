import { useEffect, useRef, useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import type { MetricsRecorder } from '../data/metrics'
import {
  WRONG_FLASH_MS,
  buildMatchingGroup,
  clearWrong,
  isMatchingComplete,
  tapAndFinish,
  matchingEligibleCount,
  PRACTICE_MIN_WORDS,
  recordPracticeCompleted,
  startMatching,
  type MatchSide,
  type MatchingState,
} from '../data/practice'
import { langFromSettings } from '../data/rio'
import type { UserData } from '../data/useUserData'
import type { WriteQueue } from '../data/writeQueue'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

interface MatchingScreenProps {
  data: UserData
  queue: WriteQueue
  metrics: Pick<MetricsRecorder, 'markActiveToday'> | null
  onHome: () => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
}

const newRound = (data: UserData): MatchingState | null => {
  const group = buildMatchingGroup(data.words)
  return group ? startMatching(group) : null
}

export function MatchingScreen({ data, queue, metrics, onHome, onBack }: MatchingScreenProps) {
  const t = strings.practice[langFromSettings(data.settings)]
  const [round, setRound] = useState(() => newRound(data))
  const latest = useRef(round)
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
    // Once per finished group: the streak and today's metrics row, through the write queue. Nothing per tap.
    const next = tapAndFinish(current, side, id, () =>
      recordPracticeCompleted({ getSettings: data.getSettings, applySettings: data.applySettings, queue, metrics }),
    )
    if (next === current) return
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
    commit(newRound(data))
  }

  const header = <ScreenHeader title={t.matchingTitle} onBack={onBack} />

  if (!round) {
    return (
      <main className="screen">
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

  if (isMatchingComplete(round)) {
    const canContinue = matchingEligibleCount(data.words) >= PRACTICE_MIN_WORDS
    return (
      <main className="screen">
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
    if (round.matched.has(id)) return 'match-tile is-matched'
    if (selected) return round.wrong ? 'match-tile is-wrong' : 'match-tile is-selected'
    return 'match-tile'
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
    <main className="screen">
      {header}
      <p className="match-hint">{t.matchingHint}</p>
      <div className="match-grid">
        {column('left')}
        {column('right')}
      </div>
    </main>
  )
}
