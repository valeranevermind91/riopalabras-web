// A page for the real-browser Settings test (src/lib/settings.browser.test.ts): the real Home header, Settings and Debug
// screens, the real theme hook, and Back going where App sends it (lib/nav). The write queue's sender just records the
// settings it is given (window.__sent.settings). Query: debug=1 (allowed to open Debug), goal=18 (or goal=default: no stored goal),
// ru=1, en=0, fresh=1 (an account that has not finished the intro: it is shown instead of Home, as App does), lang=ru (a stored
// interface language; without it the language follows Telegram, which here means English), ready=1 (Home with a few words, so its
// tiles and status show), dict=1 (the real dictionary, loaded from the page: enough words for the placement test), late=1 (the settings arrive only when the page calls window.__loadSettings(), like a slow load).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { parseDictionary } from '../data/dictionary'
import { applyHiddenFlag, applySettingsPatch } from '../data/mutations'
import { needsOnboarding } from '../data/onboarding'
import { parseSettings } from '../data/settings'
import { computeStats, getLearnPool } from '../data/stats'
import { createWriteQueue } from '../data/writeQueue'
import { makeWord } from './makeWord'
import type { SettingsPatch, Word } from '../data/types'
import { effectiveLanguage, setLanguage, useLanguage } from '../lib/language'
import { backTarget, type Screen } from '../lib/nav'
import { themePatch, type ThemeChoice } from '../lib/theme'
import { useTheme } from '../lib/useTheme'
import { DebugScreen } from '../screens/Debug'
import { HomeScreen } from '../screens/Home'
import { HowItWorks } from '../screens/HowItWorks'
import { Onboarding } from '../screens/Onboarding'
import { PlacementScreen } from '../screens/PlacementScreen'
import { SettingsScreen } from '../screens/Settings'

const params = new URLSearchParams(location.search)
// `hidden` holds one entry per request the hidden lane makes (the es_words in it), so a test can see that a batch left in one request.
const sent: { settings: SettingsPatch[]; hidden: string[][] } = { settings: [], hidden: [] }
;(window as never as { __sent: typeof sent }).__sent = sent
const queue = createWriteQueue(
  { sendProgress: async () => {}, sendSettings: async (patch) => void sent.settings.push(patch), sendHidden: async (ops) => void sent.hidden.push(ops.map((o) => `${o.hidden ? '' : '-'}${o.esWord}`)) },
  { retryDelaysMs: [1], sleep: async () => {} },
)

const HOME_WORDS = [
  ...Array.from({ length: 8 }, (_, i) =>
    makeWord(`palabra${i}`, { repetitions: 1, nextReview: new Date('2026-10-01T03:00:00.000Z'), rank: i + 1, ruTranslation: `слово${'абвгдежз'[i]}`, enTranslation: `word${i}`, exampleSentence: `Esta es la palabra${i} del día.`, wordFormInExample: `palabra${i}` }),
  ),
  ...Array.from({ length: 10 }, (_, i) => makeWord(`nueva${i}`, { rank: 100 + i, ruTranslation: `новое${i}`, enTranslation: `new${i}` })),
]

export function Harness() {
  useLanguage() // as App does: everything below re-renders when the language changes
  const [screen, setScreen] = useState<Screen>('home')
  // The words: a few for Home, or (dict=1) the real dictionary once it has been fetched.
  const [words, setWords] = useState<readonly Word[]>(HOME_WORDS)
  useEffect(() => {
    if (params.get('dict') !== '1') return
    let cancelled = false
    void fetch('/words_enriched.json')
      .then((r) => r.json())
      .then((raw) => {
        if (!cancelled) setWords(parseDictionary(raw))
        ;(window as never as { __dictionary: boolean }).__dictionary = true
      })
    return () => {
      cancelled = true
    }
  }, [])
  const applyHidden = useCallback((esWords: readonly string[], hidden: boolean) => setWords((w) => applyHiddenFlag(w, esWords, hidden)), [])
  // late=1: the settings are not there yet (the language is whatever the device last used), until the page says so.
  const [loaded, setLoaded] = useState(() => params.get('late') !== '1')
  useEffect(() => {
    ;(window as never as { __loadSettings: () => void }).__loadSettings = () => setLoaded(true)
  }, [])
  const [settings, setSettings] = useState(() =>
    parseSettings({
      ...(params.get('goal') === 'default' ? {} : { daily_new_word_limit: Number(params.get('goal') ?? 18) }),
      // a fresh account has stored neither switch (both languages show); the others start with Russian only unless told otherwise
      ...(params.get('fresh') === '1' && !params.has('ru') ? {} : { show_ru_translation: params.get('ru') !== '0' }),
      ...(params.get('fresh') === '1' && !params.has('en') ? {} : { show_en_translation: params.get('en') === '1' }),
      ...(params.get('fresh') === '1' ? {} : { onboarding_done: true }),
      ...(params.get('lang') ? { ui_language: params.get('lang') } : {}),
      ...(params.get('start_rank') ? { start_rank: Number(params.get('start_rank')) } : {}),
    }),
  )
  // The latest settings, updated at once (as useUserData does), so two taps before a render both see the first.
  const latest = useRef(settings)
  const applySettings = useCallback((patch: SettingsPatch) => {
    latest.current = applySettingsPatch(latest.current, patch)
    setSettings(latest.current)
  }, [])
  const data = useMemo(() => ({ settings, getSettings: () => latest.current, applySettings, words, applyHidden }) as never, [settings, applySettings, words, applyHidden])
  const persist = useCallback(
    (choice: ThemeChoice) => {
      applySettings(themePatch(choice))
      queue.enqueueSettings(themePatch(choice))
    },
    [applySettings],
  )
  const theme = useTheme(settings, persist)
  // The chosen language once the settings are there; with none chosen, Telegram's.
  useEffect(() => {
    if (loaded) setLanguage(effectiveLanguage(settings.uiLanguage))
  }, [loaded, settings.uiLanguage])
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
  if (screen === 'placement') return <PlacementScreen data={data} queue={queue} onExit={() => setScreen('settings')} registerBack={registerBack} onBack={back} />
  if (screen === 'onboarding') return <Onboarding data={data} queue={queue} mode="replay" onExit={() => setScreen('settings')} registerBack={registerBack} />
  if (screen === 'settings')
    return (
      <SettingsScreen
        data={data}
        queue={queue}
        theme={{ choice: theme.choice, set: theme.set }}
        debugAllowed={params.get('debug') === '1'}
        onOpenDebug={() => setScreen('debug')}
        onTakePlacement={() => setScreen('placement')}
        onOpenHow={() => setScreen('how')}
        onRunIntro={() => setScreen('onboarding')}
        onBack={back}
      />
    )
  // ready=1: Debug's Data section gets the loaded words and settings (stats and the pool preview computed as the app does).
  const debugData =
    loaded && params.get('ready') === '1'
      ? ({
          status: 'ready',
          data: {
            ...(data as object),
            stats: computeStats(words, settings, new Date()),
            diagnostics: { baseCount: words.length, orphanProgress: 0, orphanFavorites: 0, orphanHidden: 0 },
            learnPoolPreview: getLearnPool(words).slice(0, 8),
            degraded: [],
            retryDegraded: () => {},
          },
        } as never)
      : ({ status: 'loading' } as const)
  if (screen === 'debug')
    return <DebugScreen telegram={{ user: null, initData: '', isMock: true }} auth={{ status: 'no-telegram' }} data={debugData} queue={null} metrics={null} client={null} userId={null} onBack={back} />
  if (loaded && needsOnboarding(settings)) return <Onboarding data={data} queue={queue} mode="first" registerBack={registerBack} />
  return (
    <HomeScreen
      auth={{ status: 'no-telegram' }}
      data={loaded && params.get('ready') === '1' ? ({ status: 'ready', data: { ...(data as object), words, degraded: [], retryDegraded: () => {} } } as never) : { status: 'loading' }}
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
