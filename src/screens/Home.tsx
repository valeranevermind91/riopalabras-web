import { useEffect, useMemo, type ReactNode } from 'react'
import { Notice } from '../components/Notice'
import { ScreenHeader } from '../components/ScreenHeader'
import { ThemeToggle } from '../components/ThemeToggle'
import type { MetricsRecorder } from '../data/metrics'
import { PRACTICE_MIN_WORDS, clozeEligibleCount, matchingEligibleCount } from '../data/practice'
import { computeStats, type Stats } from '../data/stats'
import type { DataState, UserData } from '../data/useUserData'
import { showUnsavedNotice, useQueueStatus } from '../data/useQueueStatus'
import type { WriteQueue } from '../data/writeQueue'
import type { AuthState } from '../lib/auth'
import { haptic } from '../lib/telegram'
import type { ThemeChoice } from '../lib/theme'
import { strings } from '../strings'

interface HomeScreenProps {
  auth: AuthState
  data: DataState
  onLearn: () => void
  onReview: () => void
  onMatching: () => void
  onCloze: () => void
  /** Absent when the user may not open Debug: the link is then not rendered at all. */
  onDebug?: () => void
  queue: WriteQueue | null
  metrics: Pick<MetricsRecorder, 'captureStartOfDaySnapshotIfNeeded'> | null
  /** The theme toggle in the header; absent where there is nothing to toggle. */
  theme?: { choice: ThemeChoice; onCycle: () => void }
}

export function HomeScreen({ auth, data, onLearn, onReview, onMatching, onCloze, onDebug, queue, metrics, theme }: HomeScreenProps) {
  // Recomputed each time Home is shown (it remounts on navigation), so "due" and "today" are never stale.
  const stats = useMemo(
    () => (data.status === 'ready' ? computeStats(data.data.words, data.data.settings, new Date()) : null),
    [data],
  )

  // How many words each practice exercise can use, recomputed with the stats each time Home is shown.
  const practice = useMemo(() => {
    if (data.status !== 'ready') return null
    return {
      matching: matchingEligibleCount(data.data.words),
      cloze: clozeEligibleCount(data.data.words),
      t: strings.practice.en, // chrome: English
    }
  }, [data])

  // The start-of-day snapshot (due / pool / limit), captured the first time Home shows each day; a no-op after that.
  useEffect(() => {
    if (stats && metrics) {
      metrics.captureStartOfDaySnapshotIfNeeded({ reviewDue: stats.reviewDue, learnPool: stats.learnPool, dailyLimit: stats.dailyLimit })
    }
  }, [stats, metrics])

  const tiles = practice && stats ? buildTiles(stats, practice, { onLearn, onReview, onMatching, onCloze }) : []

  return (
    <main className="screen home">
      <ScreenHeader title={strings.appTitle} actions={theme && <ThemeToggle choice={theme.choice} onCycle={theme.onCycle} />} />

      {stats ? (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.reviewDue}</div>
              <div className="stat-label">{strings.home.toReviewToday}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.newToLearn}</div>
              <div className="stat-label">{strings.home.newToLearn}</div>
            </div>
          </div>

          {queue && <UnsavedNotice queue={queue} />}
          {data.status === 'ready' && data.data.degraded.length > 0 && <DegradedNotice data={data.data} />}

          {/* The actions live at the bottom: this wrapper takes all the space left over and the grid is the biggest square that fits in it. */}
          <div className="home-grid-wrap">
            <div className="home-grid">
              {tiles.map((tile) => (
                <button
                  key={tile.id}
                  type="button"
                  className={`home-tile${tile.primary ? ' is-primary' : ''}`}
                  data-tile={tile.id}
                  disabled={tile.disabled}
                  onClick={() => {
                    haptic('tap')
                    tile.onPress()
                  }}
                >
                  <svg className="home-tile-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {TILE_ICONS[tile.id]}
                  </svg>
                  <span className="home-tile-label">{tile.label}</span>
                </button>
              ))}
            </div>
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

export type TileId = 'learn' | 'review' | 'matching' | 'cloze'

interface Tile {
  id: TileId
  label: string
  disabled: boolean
  primary: boolean
  onPress: () => void
}

/** The four action tiles, in grid order: Learn, Review / Matching, Cloze. Labels carry the counts; a disabled tile says why. */
function buildTiles(
  stats: Stats,
  practice: { matching: number; cloze: number; t: (typeof strings.practice)['en'] },
  on: { onLearn: () => void; onReview: () => void; onMatching: () => void; onCloze: () => void },
): Tile[] {
  const learnLabel =
    stats.newToLearn > 0 ? strings.home.learnWithCount(stats.newToLearn) : stats.learnPool === 0 ? strings.home.learnPoolEmpty : strings.home.learnCapReached
  return [
    { id: 'learn', label: learnLabel, disabled: stats.newToLearn === 0, primary: true, onPress: on.onLearn },
    {
      id: 'review',
      label: stats.reviewDue > 0 ? strings.home.reviewWithCount(stats.reviewDue) : strings.home.reviewNothingDue,
      disabled: stats.reviewDue === 0,
      primary: false,
      onPress: on.onReview,
    },
    {
      id: 'matching',
      label: practice.matching >= PRACTICE_MIN_WORDS ? practice.t.matchingButton : practice.t.needWords,
      disabled: practice.matching < PRACTICE_MIN_WORDS,
      primary: false,
      onPress: on.onMatching,
    },
    {
      id: 'cloze',
      label: practice.cloze >= PRACTICE_MIN_WORDS ? practice.t.clozeButton : practice.t.needWords,
      disabled: practice.cloze < PRACTICE_MIN_WORDS,
      primary: false,
      onPress: on.onCloze,
    },
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
      {strings.home.unsavedProgress}
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
