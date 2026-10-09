import { useMemo } from 'react'
import { emptyMessage, previewLearnBatch, previewLine } from './data/learnPreview'
import { settingsEntries } from './data/settingsEntries'
import type { DataState, UserData } from './data/useUserData'

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

function LearnBatchPreview({ words, settings }: { words: UserData['words']; settings: UserData['settings'] }) {
  // Selecting a batch writes nothing and consumes nothing, so this is safe to run on every render of the Debug screen.
  const preview = useMemo(() => previewLearnBatch(words, settings, new Date()), [words, settings])
  return (
    <>
      <span className="settings-key">start_rank: {preview.startRank ?? 'none'}</span>
      {preview.entries.map((entry) => (
        <span key={entry.esWord} className="settings-key">
          {previewLine(entry)}
        </span>
      ))}
      {preview.empty && <span className="settings-key">{emptyMessage(preview.empty)}</span>}
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
            <dt>Next Learn batch (the real selection, read-only)</dt>
            <dd className="mono settings-keys">
              <LearnBatchPreview words={state.data.words} settings={state.data.settings} />
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
