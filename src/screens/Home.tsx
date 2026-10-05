import { useMemo } from 'react'
import { Notice } from '../components/Notice'
import { ScreenHeader } from '../components/ScreenHeader'
import { computeStats } from '../data/stats'
import type { DataState, UserData } from '../data/useUserData'
import { showUnsavedNotice, useQueueStatus } from '../data/useQueueStatus'
import type { WriteQueue } from '../data/writeQueue'
import type { AuthState } from '../lib/auth'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

interface HomeScreenProps {
  auth: AuthState
  data: DataState
  onLearn: () => void
  onReview: () => void
  onDebug: () => void
  queue: WriteQueue | null
}

export function HomeScreen({ auth, data, onLearn, onReview, onDebug, queue }: HomeScreenProps) {
  // Recomputed each time Home is shown (it remounts on navigation), so "due" and "today" are never stale.
  const stats = useMemo(
    () => (data.status === 'ready' ? computeStats(data.data.words, data.data.settings, new Date()) : null),
    [data],
  )

  return (
    <main className="screen">
      <ScreenHeader title={strings.appTitle} />

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

          <div className="home-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={stats.newToLearn === 0}
              onClick={() => {
                haptic('tap')
                onLearn()
              }}
            >
              {stats.newToLearn > 0
                ? strings.home.learnWithCount(stats.newToLearn)
                : stats.learnPool === 0
                  ? strings.home.learnPoolEmpty
                  : strings.home.learnCapReached}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={stats.reviewDue === 0}
              onClick={() => {
                haptic('tap')
                onReview()
              }}
            >
              {stats.reviewDue > 0 ? strings.home.reviewWithCount(stats.reviewDue) : strings.home.reviewNothingDue}
            </button>
          </div>
        </>
      ) : (
        <section className="card">
          <HomeStatus auth={auth} data={data} />
        </section>
      )}

      <button type="button" className="debug-link" onClick={onDebug}>
        {strings.home.debugLink}
      </button>
    </main>
  )
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
