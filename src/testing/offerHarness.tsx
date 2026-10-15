// A page for the real-browser test of the daily-reminder offer at the end of a Learn session (src/lib/reminderOffer.browser.test.ts): the real Learn
// screen, the real write queue (its sender just records what it is given in window.__sent.settings), the real useReminders hook over a fake row and a fake
// Telegram prompt (src/testing/fakeReminders.ts, which also documents that part of the query). Query: pool=N (how many new words there are to learn,
// default 12; the first batch is 10), offered=1 (the offer was already made: the flag is in the blob), lang=ru, nolearn=1 (the page passes no reminders
// control at all, as a screen that has none).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { applyProgressUpdates, applySettingsPatch } from '../data/mutations'
import { parseSettings } from '../data/settings'
import { computeStats } from '../data/stats'
import type { ProgressUpdate, SettingsPatch, Word } from '../data/types'
import { createWriteQueue } from '../data/writeQueue'
import { effectiveLanguage, setLanguage, useLanguage } from '../lib/language'
import { useReminders } from '../lib/useReminders'
import { LearnScreen } from '../screens/Learn'
import { createFakeReminders } from './fakeReminders'
import { makeWord } from './makeWord'

const params = new URLSearchParams(location.search)
const sent: { settings: SettingsPatch[]; progress: number } = { settings: [], progress: 0 }
;(window as never as { __sent: typeof sent }).__sent = sent
const queue = createWriteQueue(
  { sendProgress: async (updates) => void (sent.progress += updates.length), sendSettings: async (patch) => void sent.settings.push(patch), sendHidden: async () => {} },
  { retryDelaysMs: [1], sleep: async () => {} },
)
const fakeReminders = createFakeReminders(params)

const POOL = Number(params.get('pool') ?? 12)
const WORDS: readonly Word[] = Array.from({ length: POOL }, (_, i) => makeWord(`palabra${String(i + 1).padStart(2, '0')}`, { rank: i + 1, enTranslation: `word${i + 1}`, ruTranslation: `слово${i + 1}` }))

export function Harness() {
  useLanguage()
  const [words, setWords] = useState<readonly Word[]>(WORDS)
  const [settings, setSettings] = useState(() => parseSettings({ daily_new_word_limit: 20, onboarding_done: true, ...(params.get('offered') === '1' ? { reminder_offer_shown: true } : {}), ...(params.get('lang') ? { ui_language: params.get('lang') } : {}) }))
  const latest = useRef(settings)
  const latestWords = useRef(words)
  const applySettings = useCallback((patch: SettingsPatch) => {
    latest.current = applySettingsPatch(latest.current, patch)
    setSettings(latest.current)
  }, [])
  const applyProgress = useCallback((updates: readonly ProgressUpdate[]) => {
    latestWords.current = applyProgressUpdates(latestWords.current, updates)
    setWords(latestWords.current)
  }, [])
  const data = useMemo(
    () => ({ words, settings, stats: computeStats(words, settings, new Date()), getSettings: () => latest.current, getWords: () => latestWords.current, applySettings, applyProgress, applyHidden: () => {}, degraded: [], retryDegraded: () => {} }) as never,
    [words, settings, applySettings, applyProgress],
  )
  useEffect(() => {
    setLanguage(effectiveLanguage(settings.uiLanguage))
  }, [settings.uiLanguage])
  const reminders = useReminders(fakeReminders.store, { askAccess: fakeReminders.askAccess, timezone: fakeReminders.timezone })
  // The screen is drawn once the reminder row has been read (or could not be), as in the app, where it is read when the app opens, long before Learn.
  // Without this an end screen reached at once (nothing to learn) would mount while the row is still loading, and be refused for that reason.
  if (reminders.status === 'loading') return null
  return <LearnScreen data={data} queue={queue} metrics={null} reminders={params.get('nolearn') === '1' ? undefined : reminders} onHome={() => {}} onReview={() => {}} />
}

createRoot(document.getElementById('root')!).render(<Harness />)
