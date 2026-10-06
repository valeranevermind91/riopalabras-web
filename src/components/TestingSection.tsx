import { useState } from 'react'
import type { MetricsRecorder } from '../data/metrics'
import { DEFAULT_MAKE_DUE, MAX_MAKE_DUE, makeWordsDue, parseMakeDueCount, resetTodayMetrics, resetTodayNewWords } from '../data/testTools'
import type { UserData } from '../data/useUserData'
import type { WriteQueue } from '../data/writeQueue'
import { confirmDialog } from '../lib/telegram'

interface TestingSectionProps {
  signedIn: boolean
  data: UserData | null
  queue: WriteQueue | null
  metrics: Pick<MetricsRecorder, 'resetToday'> | null
}

/** TESTING TOOLS: they change real progress and the real metrics row. Disabled unless signed in. */
export function TestingSection({ signedIn, data, queue, metrics }: TestingSectionProps) {
  const [count, setCount] = useState(String(DEFAULT_MAKE_DUE))
  const [report, setReport] = useState<string | null>(null)
  const n = parseMakeDueCount(count)

  const makeDue = async () => {
    if (!signedIn || !data || !queue || n === null) return
    const ok = await confirmDialog(
      `TESTING: set the due date of up to ${n} of your learned words to now? Only the due date changes (interval, ease and repetitions stay).`,
    )
    if (!ok) return
    setReport(makeWordsDue({ signedIn, words: data.words, count: n, applyProgress: data.applyProgress, queue }).message)
  }

  const resetMetrics = async () => {
    if (!signedIn) return
    const ok = await confirmDialog("TESTING: clear today's metrics row on this device and overwrite the server's row with zeros?")
    if (!ok) return
    setReport(resetTodayMetrics({ signedIn, metrics }).message)
  }

  const resetNewWords = async () => {
    if (!signedIn || !data || !queue) return
    const ok = await confirmDialog("TESTING: set today's new-word count back to 0, so Learn is available again? Your streak, your limit and your progress stay as they are.")
    if (!ok) return
    setReport(resetTodayNewWords({ signedIn, getSettings: data.getSettings, applySettings: data.applySettings, queue }).message)
  }

  const canMakeDue = signedIn && data !== null && queue !== null && n !== null

  return (
    <section className="card testing" data-testid="testing-section">
      <h2>Testing</h2>
      <p className="badge badge-mock">Testing tools: these change your real progress and metrics.</p>
      {!signedIn && <p>Sign in to use them.</p>}

      <div className="testing-row">
        <label>
          Make{' '}
          <input
            className="testing-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_MAKE_DUE}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            aria-label="Number of words"
          />{' '}
          words due now
        </label>
        <button type="button" className="btn-small wp-off" disabled={!canMakeDue} onClick={() => void makeDue()}>
          Make due
        </button>
      </div>
      {n === null && <p className="error">Enter a whole number from 1 to {MAX_MAKE_DUE}.</p>}

      <div className="testing-row">
        <span>Reset today's metrics row</span>
        <button type="button" className="btn-small wp-off" disabled={!signedIn || metrics === null} onClick={() => void resetMetrics()}>
          Reset
        </button>
      </div>

      <div className="testing-row">
        <span>Reset today's new words</span>
        <button type="button" className="btn-small wp-off" disabled={!signedIn || data === null || queue === null} onClick={() => void resetNewWords()}>
          Reset
        </button>
      </div>

      {report && (
        <p className="testing-report" role="status">
          {report}
        </p>
      )}
    </section>
  )
}
