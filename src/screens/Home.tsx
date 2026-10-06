import { useEffect, useMemo, type ReactNode } from 'react'
import { Notice } from '../components/Notice'
import { ScreenHeader } from '../components/ScreenHeader'
import { ThemeToggle } from '../components/ThemeToggle'
import type { MetricsRecorder } from '../data/metrics'
import { PRACTICE_MIN_WORDS, clozeEligibleCount, matchingEligibleCount } from '../data/practice'
import { computeStats, type Stats } from '../data/stats'
import { DOT_COUNT, STREAK_WINDOW, activityDots, streakFromDots } from '../data/streakDots'
import type { Word } from '../data/types'
import type { DataState, UserData } from '../data/useUserData'
import { showUnsavedNotice, useQueueStatus } from '../data/useQueueStatus'
import { wordOfTheDay, type WordOfTheDay } from '../data/wordOfDay'
import type { WriteQueue } from '../data/writeQueue'
import type { AuthState } from '../lib/auth'
import { haptic } from '../lib/telegram'
import type { Scheme, ThemeChoice } from '../lib/theme'
import { strings } from '../strings'

interface HomeScreenProps {
  auth: AuthState
  data: DataState
  onLearn: () => void
  onReview: () => void
  onMatching: () => void
  onCloze: () => void
  /** Opens a word's full card (the word of the day's "See the card"). */
  onOpenWord?: (word: Word) => void
  /** Absent when the user may not open Debug: the link is then not rendered at all. */
  onDebug?: () => void
  queue: WriteQueue | null
  metrics: Pick<MetricsRecorder, 'captureStartOfDaySnapshotIfNeeded'> & Partial<Pick<MetricsRecorder, 'today'>> | null
  /** The theme toggle in the header; absent where there is nothing to toggle. */
  theme?: { choice: ThemeChoice; scheme: Scheme; onCycle: () => void }
  /** Dates with activity in the last 30 days, read from the server; null hides the dots and the streak. */
  activity?: ReadonlySet<string> | null
  /** "Now", injectable so the word of the day and the dots are testable. */
  now?: Date
}

export function HomeScreen({ auth, data, onLearn, onReview, onMatching, onCloze, onOpenWord, onDebug, queue, metrics, theme, activity = null, now: nowProp }: HomeScreenProps) {
  // Recomputed each time Home is shown (it remounts on navigation), so "due" and "today" are never stale.
  const stats = useMemo(
    () => (data.status === 'ready' ? computeStats(data.data.words, data.data.settings, nowProp ?? new Date()) : null),
    [data, nowProp],
  )

  // How many words each practice exercise can use, and today's word.
  const extras = useMemo(() => {
    if (data.status !== 'ready') return null
    return {
      matching: matchingEligibleCount(data.data.words),
      cloze: clozeEligibleCount(data.data.words),
      wotd: wordOfTheDay(data.data.words, data.data.settings, nowProp ?? new Date()),
    }
  }, [data, nowProp])

  // The start-of-day snapshot (due / pool / limit), captured the first time Home shows each day; a no-op after that.
  useEffect(() => {
    if (stats && metrics) {
      metrics.captureStartOfDaySnapshotIfNeeded({ reviewDue: stats.reviewDue, learnPool: stats.learnPool, dailyLimit: stats.dailyLimit })
    }
  }, [stats, metrics])

  const tiles = extras && stats ? buildTiles(stats, extras, { onLearn, onReview, onMatching, onCloze }) : []
  const now = nowProp ?? new Date()

  return (
    <main className="screen home">
      <ScreenHeader brand title={strings.appTitle} actions={theme && <ThemeToggle choice={theme.choice} scheme={theme.scheme} onCycle={theme.onCycle} />} />

      {stats && data.status === 'ready' ? (
        <>
          <StatusRow activity={activity} todayActive={metrics?.today?.(now)?.active === true} now={now} />

          {queue && <UnsavedNotice queue={queue} />}
          {data.data.degraded.length > 0 && <DegradedNotice data={data.data} />}

          {extras?.wotd ? <WordOfTheDayCard wotd={extras.wotd} onOpen={onOpenWord} /> : <div className="home-spacer" />}

          <div className="home-grid">
            {tiles.map((tile) => (
              <button
                key={tile.id}
                type="button"
                className={`tile tile-${tile.id}`}
                data-tile={tile.id}
                disabled={tile.disabled}
                onClick={() => {
                  haptic('tap')
                  tile.onPress()
                }}
              >
                <svg className="tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {TILE_ICONS[tile.id]}
                </svg>
                <span className="tile-text">
                  <span className="tile-label">{tile.label}</span>
                  <span className="tile-sub">{tile.disabled ? tile.reason : tile.es}</span>
                </span>
                {!tile.disabled && tile.count !== null && <span className="tile-count">{tile.count}</span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <section className="card">
          <HomeStatus auth={auth} data={data} />
        </section>
      )}

      {onDebug && (
        <button type="button" className="debug-link" onClick={onDebug}>
          {strings.home.debugLink}
        </button>
      )}
    </main>
  )
}

/**
 * The week of dots, six days ago to today, each with its weekday letter, and the streak that ends at them.
 * The streak number is read off the same rows (consecutive active days ending today or yesterday, looking back
 * up to 30 days), so the dots and the number always agree. Without the dots' data (not loaded, or the read failed) there is nothing to agree with:
 * the whole row is left out, and no number is shown.
 */
function StatusRow({ activity, todayActive, now }: { activity: ReadonlySet<string> | null; todayActive: boolean; now: Date }) {
  if (!activity) return null
  // The streak is read off the whole window (30 days); only the last seven are drawn.
  const days = activityDots(now, activity, todayActive, STREAK_WINDOW)
  const dots = days.slice(-DOT_COUNT)
  const streak = streakFromDots(days)
  const activeDays = dots.filter((d) => d.active).length
  return (
    <div className="home-status">
      <div className="streak">
        <span className="streak-dots" role="img" aria-label={strings.home.streakDots(activeDays)}>
          {dots.map((d) => (
            <span key={d.date} className={d.today ? 'streak-day is-today' : 'streak-day'} data-date={d.date}>
              <span className={`streak-dot${d.active ? ' is-active' : ''}${d.today ? ' is-today' : ''}`} />
              <span className="streak-letter">{d.letter}</span>
            </span>
          ))}
        </span>
        <span>{strings.home.streak(streak.count, streak.atLeast)}</span>
      </div>
    </div>
  )
}

function WordOfTheDayCard({ wotd, onOpen }: { wotd: WordOfTheDay; onOpen?: (word: Word) => void }) {
  const { sentence, range } = wotd
  return (
    <section className="wotd" aria-label={strings.home.wotdTitle}>
      <div className="wotd-head">
        <h2 className="wotd-word">{wotd.headword}</h2>
        <span className="pill">{strings.home.wotdPill}</span>
      </div>
      <p className="wotd-sentence">
        {sentence.slice(0, range.start)}
        <mark>{sentence.slice(range.start, range.end)}</mark>
        {sentence.slice(range.end)}
      </p>
      <hr className="wotd-divider" />
      {wotd.translations.length > 0 && <p className="wotd-translation">{wotd.translations.join(' · ')}</p>}
      {onOpen && (
        <button type="button" className="link-btn" onClick={() => onOpen(wotd.word)}>
          {strings.home.seeCard}
        </button>
      )}
    </section>
  )
}

export type TileId = 'learn' | 'review' | 'matching' | 'cloze'

interface Tile {
  id: TileId
  label: string
  /** The Spanish word under the label. */
  es: string
  /** Learn and Review show a count; the practice tiles do not. */
  count: number | null
  disabled: boolean
  /** Why a disabled tile is disabled, shown in place of the Spanish word. */
  reason: string
  onPress: () => void
}

/** The four action tiles, in grid order: Learn, Review / Matching, Cloze. */
function buildTiles(
  stats: Stats,
  practice: { matching: number; cloze: number },
  on: { onLearn: () => void; onReview: () => void; onMatching: () => void; onCloze: () => void },
): Tile[] {
  const t = strings.home.tiles
  const need = strings.practice.en.needWords
  return [
    {
      id: 'learn',
      label: t.learn.label,
      es: t.learn.es,
      count: stats.newToLearn,
      disabled: stats.newToLearn === 0,
      reason: stats.learnPool === 0 ? strings.home.learnPoolEmpty : strings.home.learnCapReached,
      onPress: on.onLearn,
    },
    { id: 'review', label: t.review.label, es: t.review.es, count: stats.reviewDue, disabled: stats.reviewDue === 0, reason: strings.home.reviewNothingDue, onPress: on.onReview },
    { id: 'matching', label: t.matching.label, es: t.matching.es, count: null, disabled: practice.matching < PRACTICE_MIN_WORDS, reason: need, onPress: on.onMatching },
    { id: 'cloze', label: t.cloze.label, es: t.cloze.es, count: null, disabled: practice.cloze < PRACTICE_MIN_WORDS, reason: need, onPress: on.onCloze },
  ]
}

const TILE_ICONS: Record<TileId, ReactNode> = {
  learn: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z" />
    </>
  ),
  review: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v5h-5" />
    </>
  ),
  matching: (
    <>
      <rect x="3" y="4" width="7" height="6" rx="1.5" />
      <rect x="14" y="14" width="7" height="6" rx="1.5" />
      <path d="M10 7h2a2 2 0 0 1 2 2v6" />
    </>
  ),
  cloze: (
    <>
      <path d="M4 7h4M12 7h8M4 12h8M16 12h4M4 17h6" />
      <path d="M10 17h4" strokeDasharray="1 2.5" />
    </>
  ),
}

/** Favorites / hidden words didn't load yet and are being retried in the background. */
function DegradedNotice({ data }: { data: UserData }) {
  const names = data.degraded.map((table) => strings.home.degradedTables[table] ?? table)
  return (
    <Notice actionLabel={strings.home.retryNow} onAction={data.retryDegraded}>
      {strings.home.degraded(names)}
      {data.degraded.includes('user_hidden_words') && ` ${strings.home.degradedHiddenWarning}`}
    </Notice>
  )
}

/** Progress is stuck in the write queue (its retries ran out). Shown until the queue drains, then it goes away by itself. */
function UnsavedNotice({ queue }: { queue: WriteQueue }) {
  const status = useQueueStatus(queue)
  if (!showUnsavedNotice(status)) return null
  return (
    <Notice actionLabel={strings.home.retryNow} onAction={() => void queue.retry()}>
      {status.authRejected ? strings.home.signInRejected : strings.home.unsavedProgress}
    </Notice>
  )
}

function HomeStatus({ auth, data }: { auth: AuthState; data: DataState }) {
  if (auth.status === 'error') return <p className="error">{strings.debug.signInFailed(auth.message)}</p>
  if (auth.status === 'no-telegram') return <p>{strings.common.signInPrompt}</p>
  if (auth.status === 'loading' || data.status === 'loading') return <p>{strings.common.loading}</p>
  if (data.status === 'error') {
    return (
      <>
        <p className="error">{strings.common.loadFailed(data.message)}</p>
        <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
          {strings.common.reload}
        </button>
      </>
    )
  }
  return <p>{strings.common.loading}</p>
}
