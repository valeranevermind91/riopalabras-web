// A page for the real-browser Settings test (src/lib/settings.browser.test.ts): the real Home header, Settings and Debug
// screens, the real theme hook, and Back going where App sends it (lib/nav). The write queue's sender just records the
// settings it is given (window.__sent.settings). Query: debug=1 (allowed to open Debug), goal=18, ru=1, en=0.
import { useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { applySettingsPatch } from '../data/mutations'
import { parseSettings } from '../data/settings'
import { createWriteQueue } from '../data/writeQueue'
import type { SettingsPatch } from '../data/types'
import { backTarget, type Screen } from '../lib/nav'
import { themePatch, type ThemeChoice } from '../lib/theme'
import { useTheme } from '../lib/useTheme'
import { DebugScreen } from '../screens/Debug'
import { HomeScreen } from '../screens/Home'
import { SettingsScreen } from '../screens/Settings'

const params = new URLSearchParams(location.search)
const sent: { settings: SettingsPatch[] } = { settings: [] }
;(window as never as { __sent: typeof sent }).__sent = sent
const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async (patch) => void sent.settings.push(patch) }, { retryDelaysMs: [1], sleep: async () => {} })

export function Harness() {
  const [screen, setScreen] = useState<Screen>('home')
  const [settings, setSettings] = useState(() =>
    parseSettings({ daily_new_word_limit: Number(params.get('goal') ?? 18), show_ru_translation: params.get('ru') !== '0', show_en_translation: params.get('en') === '1' }),
  )
  const applySettings = useCallback((patch: SettingsPatch) => setSettings((s) => applySettingsPatch(s, patch)), [])
  const data = useMemo(() => ({ settings, getSettings: () => settings, applySettings }) as never, [settings, applySettings])
  const persist = useCallback(
    (choice: ThemeChoice) => {
      applySettings(themePatch(choice))
      queue.enqueueSettings(themePatch(choice))
    },
    [applySettings],
  )
  const theme = useTheme(settings, persist)
  const back = () => setScreen(backTarget(screen, null))

  if (screen === 'settings')
    return <SettingsScreen data={data} queue={queue} theme={{ choice: theme.choice, set: theme.set }} debugAllowed={params.get('debug') === '1'} onOpenDebug={() => setScreen('debug')} onBack={back} />
  if (screen === 'debug')
    return <DebugScreen telegram={{ user: null, initData: '', isMock: true }} auth={{ status: 'no-telegram' }} data={{ status: 'loading' }} queue={null} metrics={null} client={null} userId={null} onBack={back} />
  return (
    <HomeScreen
      auth={{ status: 'no-telegram' }}
      data={{ status: 'loading' }}
      onLearn={() => {}}
      onReview={() => {}}
      onMatching={() => {}}
      onCloze={() => {}}
      onWords={() => {}}
      onSettings={() => setScreen('settings')}
      queue={null}
      metrics={null}
    />
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
