import { useSyncExternalStore } from 'react'
import { loadLog } from '../data/loadLog'
import type { NonCriticalTable } from '../data/overlay'
import { strings } from '../strings'

const t = strings.debug.loadLog

/** Debug: the latest user-data load errors with their HTTP status, PostgREST code and message. */
export function LoadLogSection({ degraded }: { degraded: readonly NonCriticalTable[] }) {
  const entries = useSyncExternalStore(loadLog.subscribe, loadLog.snapshot)

  return (
    <section className="card">
      <h2>{t.title}</h2>
      {degraded.length > 0 && <p className="error">{t.degraded([...degraded])}</p>}
      {entries.length === 0 ? (
        <p className="hint">{t.empty}</p>
      ) : (
        <>
          <ul className="load-log">
            {entries.map((e) => (
              <li key={e.id} className={e.outcome === 'failed' ? 'mono error' : 'mono'}>
                {t.entry(e)}
              </li>
            ))}
          </ul>
          <button type="button" className="btn-small wp-off" onClick={loadLog.clear}>
            {t.clear}
          </button>
        </>
      )}
    </section>
  )
}
