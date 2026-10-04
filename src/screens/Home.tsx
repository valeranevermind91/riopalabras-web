import { useMemo } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { computeStats } from '../data/stats'
import type { DataState, UserData } from '../data/useUserData'
import type { AuthState } from '../lib/auth'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

interface HomeScreenProps {
  auth: AuthState
  data: DataState
  onLearn: () => void
  onReview: () => void
  onDebug: () => void
}

export function HomeScreen({ auth, data, onLearn, onReview, onDebug }: HomeScreenProps) {
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

/** A small, non-blocking notice: favorites / hidden words didn't load yet and are being retried. */
function DegradedNotice({ data }: { data: UserData }) {
  const names = data.degraded.map((table) => strings.home.degradedTables[table] ?? table)
  return (
    <p className="notice" role="status">
      {strings.home.degraded(names)}
      {data.degraded.includes('user_hidden_words') && ` ${strings.home.degradedHiddenWarning}`}{' '}
      <button type="button" className="btn-small wp-off" onClick={data.retryDegraded}>
        {strings.home.retryNow}
      </button>
    </p>
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
