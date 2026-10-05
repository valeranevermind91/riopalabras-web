import type { SupabaseClient } from '@supabase/supabase-js'
import { useState } from 'react'
import { fetchServerMetricsRow, type MetricsRecorder } from '../data/metrics'
import { localDateKey } from '../data/dates'
import { useQueueStatus } from '../data/useQueueStatus'
import type { WriteQueue } from '../data/writeQueue'

interface MetricsSectionProps {
  queue: WriteQueue | null
  metrics: Pick<MetricsRecorder, 'today'> | null
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
  const row = metrics?.today() ?? null
  const status = queue?.getStatus()
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
      {status && (
        <p>
          Queue: {status.pendingMetrics} metrics row(s) waiting
          {status.metricsError ? `, last error: ${status.metricsError}` : ''}
        </p>
      )}
      <button type="button" className="btn-small wp-off" disabled={!client || !userId || check.state === 'loading'} onClick={() => void checkServer()}>
        Check server copy
      </button>
      {check.state === 'done' && <pre className="mono">{check.row ? JSON.stringify(check.row, null, 2) : 'No row on the server for today.'}</pre>}
      {check.state === 'error' && <p className="error">{check.message}</p>}
    </section>
  )
}
