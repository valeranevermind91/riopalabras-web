// A page for the real-browser Settings test (src/lib/settings.browser.test.ts): the real Home header, Settings and Debug
// screens, the real theme hook, and Back going where App sends it (lib/nav). The write queue's sender just records the
// settings it is given (window.__sent.settings). Query: unlocked=1 (Debug unlocked on the account), goal=18 (or goal=default: no stored goal),
// ru=1, en=0, fresh=1 (an account that has not finished the intro: it is shown instead of Home, as App does), lang=ru (a stored
// interface language; without it the language follows Telegram, which here means English), ready=1 (Home with a few words, so its
// tiles and status show), reminder=on|off|none (the daily reminder's row at the start: on, off, or no row), rtz=<zone> (the zone on that row),
// tz=<zone> (the device's zone), access=yes|no|manual (Telegram's permission prompt: answered at once, or by window.__answerAccess(true|false)),
// endofday=N (Home at the end of the day: N new words learned today, as a finished Learn batch leaves them, and today's allowance spent, or only todaycount=M of it; window.__taps records which Home handler each tile calls), paused=1 / unreachable=1 (the job has paused it / Telegram cannot deliver), savefail=1 (writes to the row fail), readfail=1 (reading it fails); everything written to the row is in window.__reminders. dict=1 (the real dictionary, loaded from the page: enough words for the placement test), late=1 (the settings arrive only when the page calls window.__loadSettings(), like a slow load).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { parseDictionary } from '../data/dictionary'
import { applyHiddenFlag, applySettingsPatch } from '../data/mutations'
import { needsOnboarding } from '../data/onboarding'
import { parseSettings } from '../data/settings'
import { localDateKey } from '../data/dates'
import { computeStats } from '../data/stats'
import { learnedState } from '../sm2/sm2'
import { createWriteQueue } from '../data/writeQueue'
import { createFakeReminders } from './fakeReminders'
import { makeWord } from './makeWord'
import type { SettingsPatch, Word } from '../data/types'
import { effectiveLanguage, setLanguage, useLanguage } from '../lib/language'
import { backTarget, type Screen } from '../lib/nav'
import { useScreenScroll } from '../lib/screenScroll'
import { themePatch, type ThemeChoice } from '../lib/theme'
import { useTheme } from '../lib/useTheme'
import { DebugScreen } from '../screens/Debug'
import { HomeScreen } from '../screens/Home'
import { HowItWorks } from '../screens/HowItWorks'
import { Onboarding } from '../screens/Onboarding'
import { PlacementScreen } from '../screens/PlacementScreen'
import { AboutScreen } from '../screens/About'
import { SettingsScreen } from '../screens/Settings'
import { WhatsNewScreen } from '../screens/WhatsNew'
import type { NewsEntry } from '../data/whatsNew'
import { useReminders } from '../lib/useReminders'

const params = new URLSearchParams(location.search)
// `hidden` holds one entry per request the hidden lane makes (the es_words in it), so a test can see that a batch left in one request.
const sent: { settings: SettingsPatch[]; hidden: string[][] } = { settings: [], hidden: [] }
;(window as never as { __sent: typeof sent }).__sent = sent
const queue = createWriteQueue(
  { sendProgress: async () => {}, sendSettings: async (patch) => void sent.settings.push(patch), sendHidden: async (ops) => void sent.hidden.push(ops.map((o) => `${o.hidden ? '' : '-'}${o.esWord}`)) },
  { retryDelaysMs: [1], sleep: async () => {} },
)

// The daily reminder's row and Telegram's permission prompt, faked (src/testing/fakeReminders.ts; window.__reminders records what is written).
const fakeReminders = createFakeReminders(params)

// relearn=N: one more word that was rated Again just now: one repetition, interval 0, due again in N seconds (the real wait is ten minutes).
const relearnSeconds = Number(params.get('relearn') ?? 0)
const HOME_WORDS = [
  ...Array.from({ length: 8 }, (_, i) =>
    makeWord(`palabra${i}`, { repetitions: 1, nextReview: new Date('2026-10-01T03:00:00.000Z'), rank: i + 1, ruTranslation: `слово${'абвгдежз'[i]}`, enTranslation: `word${i}`, exampleSentence: `Esta es la palabra${i} del día.`, wordFormInExample: `palabra${i}` }),
  ),
  ...Array.from({ length: 10 }, (_, i) => makeWord(`nueva${i}`, { rank: 100 + i, ruTranslation: `новое${i}`, enTranslation: `new${i}` })),
]

const HOME_WORDS_WITH_RELEARN: readonly Word[] =
  relearnSeconds > 0 ? [...HOME_WORDS, makeWord('repasada', { repetitions: 1, interval: 0, easeFactor: 2.18, nextReview: new Date(Date.now() + relearnSeconds * 1000), rank: 50 })] : HOME_WORDS

// endofday=N: the first N learned words are the day's own (first review tomorrow), the rest are not due for days: nothing is due now, and the allowance is spent.
const endOfDay = Number(params.get('endofday') ?? 0)
const END_OF_DAY_WORDS = HOME_WORDS.map((w, i) => (i < 8 ? (i < endOfDay ? { ...w, interval: 0, nextReview: learnedState(new Date()).nextReview } : { ...w, nextReview: new Date(Date.now() + 5 * 86_400_000) }) : w))
// news=1: two current "What's new" entries (today 10:00 and yesterday 09:00), long enough to wrap; without it there are none, so the other tests see no dot and no row.
// seen=old: the older one has been opened, seen=all: both; without seen, neither.
const stamp = (daysAgo: number, time: string) => {
  const day = new Date()
  day.setDate(day.getDate() - daysAgo)
  return `${localDateKey(day)}T${time}`
}
const NEWS: readonly NewsEntry[] =
  params.get('news') === '1'
    ? [
        { id: 'newer', at: stamp(0, '10:00'), en: { title: 'A newer thing you can do now', text: 'It works like this, and it takes a few words to say so that the text wraps on a narrow screen.' }, ru: { title: 'Новая возможность', text: 'Это работает так, и чтобы текст перенесся на узком экране, нужно сказать это несколькими словами подлиннее.' } },
        { id: 'older', at: stamp(1, '09:00'), en: { title: 'An older change', text: 'Before this, it worked differently.' }, ru: { title: 'Старое изменение', text: 'Раньше это работало иначе.' } },
      ]
    : []
const taps: string[] = []
;(window as never as { __taps: string[] }).__taps = taps

export function Harness() {
  useLanguage() // as App does: everything below re-renders when the language changes
  const [screen, setScreen] = useState<Screen>('home')
  // The words: a few for Home, or (dict=1) the real dictionary once it has been fetched.
  const [words, setWords] = useState<readonly Word[]>(endOfDay > 0 ? END_OF_DAY_WORDS : HOME_WORDS_WITH_RELEARN)
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
      ...(params.get('unlocked') === '1' ? { debug_unlocked: true } : {}),
      ...(params.get('seen') === 'old' ? { whats_new_seen: stamp(1, '09:00') } : params.get('seen') === 'all' ? { whats_new_seen: stamp(0, '10:00') } : {}),
      ...(endOfDay > 0 ? { new_words_learned_today_count: Number(params.get('todaycount') ?? params.get('goal') ?? 18), new_words_learned_today_date: localDateKey(new Date()) } : {}),
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
  const reminders = useReminders(fakeReminders.store, { askAccess: fakeReminders.askAccess, timezone: fakeReminders.timezone })
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
  useScreenScroll(screen, null) // as App does

  // origin: a fixed address, so the privacy link in About reads the same wherever the test runs
  if (screen === 'whatsnew') return <WhatsNewScreen data={data} queue={queue} news={NEWS} onBack={back} />
  if (screen === 'about') return <AboutScreen data={data} queue={queue} origin="https://app.test" onBack={back} />
  // as App does: where Telegram's own BackButton exists (native=1) the header draws no Back, and the end of the page has one that does the same
  if (screen === 'how') return <HowItWorks onBack={params.get('native') === '1' ? undefined : back} onDone={back} />
  if (screen === 'placement') return <PlacementScreen data={data} queue={queue} onExit={() => setScreen('settings')} registerBack={registerBack} onBack={back} />
  if (screen === 'onboarding') return <Onboarding data={data} queue={queue} mode="replay" onExit={() => setScreen('settings')} registerBack={registerBack} />
  if (screen === 'settings')
    return (
      <SettingsScreen
        data={data}
        queue={queue}
        theme={{ choice: theme.choice, set: theme.set }}
        onOpenDebug={() => setScreen('debug')}
        reminders={reminders}
        onTakePlacement={() => setScreen('placement')}
        onOpenAbout={() => setScreen('about')}
        onOpenHow={() => setScreen('how')}
        onOpenWhatsNew={() => setScreen('whatsnew')}
        news={NEWS}
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
      onLearn={() => void taps.push('learn')}
      onReview={() => void taps.push('review')}
      onMatching={() => void taps.push('matching')}
      onCloze={() => void taps.push('cloze')}
      onMatchingToday={() => void taps.push('matching-today')}
      onClozeToday={() => void taps.push('cloze-today')}
      onWords={() => {}}
      onSettings={() => setScreen('settings')}
      news={NEWS}
      queue={null}
      metrics={null}
    />
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
