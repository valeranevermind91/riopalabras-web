import type { SupabaseClient } from '@supabase/supabase-js'
import { useState } from 'react'
import { fetchServerMetricsRow, type MetricsRecorder } from '../data/metrics'
import { localDateKey } from '../data/dates'
import { useQueueStatus } from '../data/useQueueStatus'
import type { WriteQueue } from '../data/writeQueue'

interface MetricsSectionProps {
  queue: WriteQueue | null
  metrics: (Pick<MetricsRecorder, 'today'> & Partial<Pick<MetricsRecorder, 'seedStatus'>>) | null
  client: SupabaseClient | null
  userId: string | null
}

type ServerCheck = { state: 'idle' } | { state: 'loading' } | { state: 'done'; row: Record<string, unknown> | null } | { state: 'error'; message: string }

const FIELDS = ['date', 'newWords', 'reviewsDone', 'reviewsLapsed', 'dueAtStart', 'learnPool', 'dailyLimit', 'active'] as const

/** Debug: today's user_daily_metrics row as recorded on this device, the lane's state, and an on-demand look at the server's copy. */
export function MetricsSection({ queue, metrics, client, userId }: MetricsSectionProps) {
  if (!queue) return <MetricsBody queue={null} metrics={metrics} client={client} userId={userId} />
  return <WithQueue queue={queue} metrics={metrics} client={client} userId={userId} />
}

function WithQueue(props: MetricsSectionProps & { queue: WriteQueue }) {
  // Re-render on every queue change, so the pending count follows the lane.
  useQueueStatus(props.queue)
  return <MetricsBody {...props} />
}

function MetricsBody({ queue, metrics, client, userId }: MetricsSectionProps) {
  const [check, setCheck] = useState<ServerCheck>({ state: 'idle' })
  const [, refresh] = useState(0) // the seed status changes outside the queue: this re-reads it on demand
  const row = metrics?.today() ?? null
  const status = queue?.getStatus()
  const seed = metrics?.seedStatus?.()
  const date = localDateKey()

  const checkServer = async () => {
    if (!client || !userId) return
    setCheck({ state: 'loading' })
    try {
      setCheck({ state: 'done', row: await fetchServerMetricsRow(client, userId, date) })
    } catch (err) {
      setCheck({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <section className="card" data-testid="metrics-section">
      <h2>Today's metrics ({date})</h2>
      {row ? (
        <dl>
          {FIELDS.map((field) => (
            <div key={field}>
              <dt>{field}</dt>
              <dd>{String(row[field])}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>Nothing recorded on this device today.</p>
      )}
      {seed && (
        <p>
          Server seed: {seed.state}
          {seed.detail ? ` (${seed.detail})` : ''}
        </p>
      )}
      {status && (
        <dl data-testid="metrics-lane">
          <div>
            <dt>Metrics lane</dt>
            <dd>{status.metricsRunning ? 'running' : status.metricsGaveUp ? 'gave up (idle until the next change or retry)' : 'idle'}</dd>
          </div>
          <div>
            <dt>Rows waiting</dt>
            <dd>
              {status.pendingMetrics}
              {status.metricsWaitingForProgress ? ' (waiting for progress/settings to be sent first)' : ''}
            </dd>
          </div>
          <div>
            <dt>Send attempts</dt>
            <dd>{status.metricsAttempts}</dd>
          </div>
          <div>
            <dt>Last attempt</dt>
            <dd>{status.metricsLastAttemptAt ?? 'never'}</dd>
          </div>
          <div>
            <dt>Last success</dt>
            <dd>{status.metricsLastSuccessAt ?? 'never'}</dd>
          </div>
          <div>
            <dt>Last error</dt>
            <dd>{status.metricsError ?? 'none'}</dd>
          </div>
        </dl>
      )}
      {status && (
        <dl data-testid="queue-restore">
          <div>
            <dt>Restored on open</dt>
            <dd>{status.restoredEntries}</dd>
          </div>
          <div>
            <dt>Dropped (older than 7 days)</dt>
            <dd>{status.droppedStale}</dd>
          </div>
          <div>
            <dt>Dropped (unreadable)</dt>
            <dd>{status.droppedUnreadable}</dd>
          </div>
        </dl>
      )}
      <button type="button" className="btn-small wp-off" onClick={() => refresh((n) => n + 1)}>
        Refresh
      </button>{' '}
      <button type="button" className="btn-small wp-off" disabled={!client || !userId || check.state === 'loading'} onClick={() => void checkServer()}>
        Check server copy
      </button>
      {check.state === 'done' && <pre className="mono">{check.row ? JSON.stringify(check.row, null, 2) : 'No row on the server for today.'}</pre>}
      {check.state === 'error' && <p className="error">{check.message}</p>}
    </section>
  )
}
