// A page for the real-browser Review session test (src/lib/review.browser.test.ts): the real Home and Review screens over a word list that
// really changes as words are rated (Review's ratings go through applyProgress), with a write queue that only records. Query: due=50 (how many
// words are due, the nth one n hours overdue: vieja50 is the most overdue), soon=4 (one more word, "pronta", that comes due that many seconds from now).
import { useCallback, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { applyProgressUpdates, applySettingsPatch } from '../data/mutations'
import { parseSettings } from '../data/settings'
import { createWriteQueue } from '../data/writeQueue'
import type { ProgressUpdate, SettingsPatch, Word } from '../data/types'
import { HomeScreen } from '../screens/Home'
import { ReviewScreen } from '../screens/Review'
import { makeWord } from './makeWord'

const params = new URLSearchParams(location.search)
const due = Number(params.get('due') ?? 50)
const soon = Number(params.get('soon') ?? 0)

const sent: { progress: string[]; settings: SettingsPatch[] } = { progress: [], settings: [] }
;(window as never as { __sent: typeof sent }).__sent = sent
const queue = createWriteQueue(
  { sendProgress: async (updates) => void sent.progress.push(...updates.map((u) => u.esWord)), sendSettings: async (patch) => void sent.settings.push(patch), sendHidden: async () => {} },
  { retryDelaysMs: [1], sleep: async () => {} },
)

const now = Date.now()
const hour = 3_600_000
const initial: Word[] = [
  ...Array.from({ length: due }, (_, i) => makeWord(`vieja${i + 1}`, { rank: i + 1, repetitions: 2, interval: 3, easeFactor: 2.5, nextReview: new Date(now - (i + 1) * hour) })),
  ...(soon > 0 ? [makeWord('pronta', { rank: due + 1, repetitions: 2, interval: 3, easeFactor: 2.5, nextReview: new Date(now + soon * 1000) })] : []),
]

export function Harness() {
  const [screen, setScreen] = useState<'home' | 'review'>('home')
  const [words, setWords] = useState<readonly Word[]>(initial)
  const [settings, setSettings] = useState(() => parseSettings({ daily_new_word_limit: 10 }))
  // The latest settings, updated at once (as useUserData does).
  const latest = useRef(settings)
  const applyProgress = useCallback((updates: readonly ProgressUpdate[]) => setWords((w) => applyProgressUpdates(w, updates)), [])
  const applySettings = useCallback((patch: SettingsPatch) => {
    latest.current = applySettingsPatch(latest.current, patch)
    setSettings(latest.current)
  }, [])
  const data = useMemo(() => ({ words, settings, getSettings: () => latest.current, applyProgress, applySettings }) as never, [words, settings, applyProgress, applySettings])

  if (screen === 'review') return <ReviewScreen data={data} queue={queue} metrics={null} onHome={() => setScreen('home')} onLearn={() => {}} />
  return (
    <HomeScreen
      auth={{ status: 'no-telegram' }}
      data={{ status: 'ready', data: { ...(data as object), words, degraded: [], retryDegraded: () => {} } } as never}
      onLearn={() => {}}
      onReview={() => setScreen('review')}
      onMatching={() => {}}
      onCloze={() => {}}
      queue={null}
      metrics={null}
    />
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
