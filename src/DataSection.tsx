import { settingsEntries } from './data/settingsEntries'
import type { DataState } from './data/useUserData'

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

export function DataSection({ state }: { state: DataState }) {
  return (
    <section className="card">
      <h2>Data</h2>

      {state.status === 'loading' && <p>Loading dictionary and your data…</p>}

      {state.status === 'error' && <p className="error">Data load failed: {state.message}</p>}

      {state.status === 'signed-out' && (
        <>
          <p>Dictionary loaded: {state.dictionaryCount} words</p>
          <p>Sign in to load your progress.</p>
        </>
      )}

      {state.status === 'ready' && (
        <>
          <dl>
            <Row label="Dictionary loaded" value={`${state.data.diagnostics.baseCount} words`} />
            <Row label="total" value={state.data.stats.total} />
            <Row label="learned" value={state.data.stats.learned} />
            <Row label="reviewDue" value={state.data.stats.reviewDue} />
            <Row label="learnPool" value={state.data.stats.learnPool} />
            <Row label="newToLearn" value={state.data.stats.newToLearn} />
            <Row label="favorites" value={state.data.stats.favorites} />
            <Row label="hidden" value={state.data.stats.hidden} />
            <Row label="custom" value={state.data.stats.custom} />
            <Row label="streak" value={state.data.stats.streak} />
            <Row label="dailyLimit" value={state.data.stats.dailyLimit} />
            <Row label="remainingToday" value={state.data.stats.remainingToday} />
          </dl>

          <dl>
            <dt>Next in learn pool (rank order, from the first word; ignores start_rank)</dt>
            <dd className="mono">
              {state.data.learnPoolPreview.map((w) => `${w.rank}:${w.esWord}`).join('  ') || '(empty)'}
            </dd>
            <dt>Settings keys stored ({Object.keys(state.data.settings.raw).length})</dt>
            <dd className="mono settings-keys">
              {settingsEntries(state.data.settings.raw).map(([key, value]) => (
                <span key={key} className="settings-key">
                  {key}: {value}
                </span>
              ))}
              {Object.keys(state.data.settings.raw).length === 0 && '(none)'}
            </dd>
            <dt>Orphan rows ignored (progress / favorites / hidden)</dt>
            <dd>
              {state.data.diagnostics.orphanProgress} / {state.data.diagnostics.orphanFavorites} /{' '}
              {state.data.diagnostics.orphanHidden}
            </dd>
          </dl>
        </>
      )}
    </section>
  )
}
