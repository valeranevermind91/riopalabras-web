// A page for the real-browser Settings test (src/lib/settings.browser.test.ts): the real Home header, Settings and Debug
// screens, the real theme hook, and Back going where App sends it (lib/nav). The write queue's sender just records the
// settings it is given (window.__sent.settings). Query: debug=1 (allowed to open Debug), goal=18 (or goal=default: no stored goal),
// ru=1, en=0, fresh=1 (an account that has not finished the intro: it is shown instead of Home, as App does).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { applySettingsPatch } from '../data/mutations'
import { needsOnboarding } from '../data/onboarding'
import { parseSettings } from '../data/settings'
import { createWriteQueue } from '../data/writeQueue'
import type { SettingsPatch } from '../data/types'
import { backTarget, type Screen } from '../lib/nav'
import { themePatch, type ThemeChoice } from '../lib/theme'
import { useTheme } from '../lib/useTheme'
import { DebugScreen } from '../screens/Debug'
import { HomeScreen } from '../screens/Home'
import { HowItWorks } from '../screens/HowItWorks'
import { Onboarding } from '../screens/Onboarding'
import { SettingsScreen } from '../screens/Settings'

const params = new URLSearchParams(location.search)
const sent: { settings: SettingsPatch[] } = { settings: [] }
;(window as never as { __sent: typeof sent }).__sent = sent
const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async (patch) => void sent.settings.push(patch) }, { retryDelaysMs: [1], sleep: async () => {} })

export function Harness() {
  const [screen, setScreen] = useState<Screen>('home')
  const [settings, setSettings] = useState(() =>
    parseSettings({
      ...(params.get('goal') === 'default' ? {} : { daily_new_word_limit: Number(params.get('goal') ?? 18) }),
      // a fresh account has stored neither switch (both languages show); the others start with Russian only unless told otherwise
      ...(params.get('fresh') === '1' && !params.has('ru') ? {} : { show_ru_translation: params.get('ru') !== '0' }),
      ...(params.get('fresh') === '1' && !params.has('en') ? {} : { show_en_translation: params.get('en') === '1' }),
      ...(params.get('fresh') === '1' ? {} : { onboarding_done: true }),
    }),
  )
  // The latest settings, updated at once (as useUserData does), so two taps before a render both see the first.
  const latest = useRef(settings)
  const applySettings = useCallback((patch: SettingsPatch) => {
    latest.current = applySettingsPatch(latest.current, patch)
    setSettings(latest.current)
  }, [])
  const data = useMemo(() => ({ settings, getSettings: () => latest.current, applySettings }) as never, [settings, applySettings])
  const persist = useCallback(
    (choice: ThemeChoice) => {
      applySettings(themePatch(choice))
      queue.enqueueSettings(themePatch(choice))
    },
    [applySettings],
  )
  const theme = useTheme(settings, persist)
  // Back as App does it: a screen with something open takes it first (the intro steps back), else it goes where lib/nav says.
  const interceptor = useRef<(() => boolean) | null>(null)
  const registerBack = useCallback((handler: (() => boolean) | null) => {
    interceptor.current = handler
  }, [])
  const goBack = () => {
    if (interceptor.current?.()) return 'handled'
    setScreen(backTarget(screen, null))
    return 'left'
  }
  useEffect(() => {
    ;(window as never as { __pressBack: () => string }).__pressBack = goBack
  })
  const back = () => void goBack()

  if (screen === 'how') return <HowItWorks onBack={back} />
  if (screen === 'onboarding') return <Onboarding data={data} queue={queue} mode="replay" onExit={() => setScreen('settings')} registerBack={registerBack} />
  if (screen === 'settings')
    return (
      <SettingsScreen
        data={data}
        queue={queue}
        theme={{ choice: theme.choice, set: theme.set }}
        debugAllowed={params.get('debug') === '1'}
        onOpenDebug={() => setScreen('debug')}
        onOpenHow={() => setScreen('how')}
        onRunIntro={() => setScreen('onboarding')}
        onBack={back}
      />
    )
  if (screen === 'debug')
    return <DebugScreen telegram={{ user: null, initData: '', isMock: true }} auth={{ status: 'no-telegram' }} data={{ status: 'loading' }} queue={null} metrics={null} client={null} userId={null} onBack={back} />
  if (needsOnboarding(settings)) return <Onboarding data={data} queue={queue} mode="first" registerBack={registerBack} />
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
