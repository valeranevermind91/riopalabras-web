import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createLocalMetricsStore, createMetricsRecorder, fetchServerMetricsRow, parseServerRow } from './data/metrics'
import { sendFeedback, type FeedbackReport } from './data/feedback'
import { settleStars } from './data/starred'
import { bindClosingConfirmation, bindPersistOnHide, bindReconnectTriggers, bindStuckRetry, retryEverything } from './data/queueTriggers'
import { createTombstoneClearer } from './data/customWords'
import { supabaseReminderStore } from './data/reminders'
import { createLearnedAtStore, createReviewLog } from './data/reviewLog'
import { enrichDepsFor, enrichWord } from './data/enrich'
import { createSettingsSource, mirrorPending, restoreAndFlush } from './data/startup'
import { wordKey } from './data/words'
import { createViewStore } from './data/wordList'
import { useUserData } from './data/useUserData'
import { createSupabaseWriteQueue } from './data/writeQueue'
import { ensureSession, watchSessionLost, type AuthState } from './lib/auth'
import { effectiveLanguage, setLanguage, useLanguage } from './lib/language'
import { getSupabase } from './lib/supabase'
import { backTarget as backTargetFor, type Screen } from './lib/nav'
import { getWebApp, nativeBackButton } from './lib/telegram'
import { themePatch, type ThemeChoice } from './lib/theme'
import { useRecentActivity } from './lib/useRecentActivity'
import { useReminders } from './lib/useReminders'
import { useScreenScroll } from './lib/screenScroll'
import { useTheme } from './lib/useTheme'
import { DebugScreen, type TelegramInfo } from './screens/Debug'
import { HomeScreen } from './screens/Home'
import { ClozeScreen } from './screens/Cloze'
import { LearnScreen } from './screens/Learn'
import { MatchingScreen } from './screens/Matching'
import { FeedbackScreen } from './screens/Feedback'
import { SettingsScreen } from './screens/Settings'
import { HowItWorks } from './screens/HowItWorks'
import { PlacementScreen } from './screens/PlacementScreen'
import { Onboarding } from './screens/Onboarding'
import { needsOnboarding } from './data/onboarding'
import { WordDetail } from './screens/WordDetail'
import { WordsScreen } from './screens/Words'
import { NotAvailable } from './screens/NotAvailable'
import { ReviewScreen } from './screens/Review'

function readTelegramInfo(): TelegramInfo {
  const { webApp, isMock } = getWebApp()
  return {
    user: webApp.initDataUnsafe.user ?? null,
    initData: webApp.initData ?? '',
    isMock,
  }
}

function App() {
  // The interface language: everything below is drawn by this component, so it re-renders (and every string is read again) when it changes.
  useLanguage()
  const [telegram] = useState(readTelegramInfo)
  const [asyncAuth, setAuth] = useState<AuthState>({ status: 'loading' })
  const { client, error: clientError } = getSupabase()
  const auth: AuthState = client
    ? asyncAuth
    : { status: 'error', message: clientError ?? 'Supabase client unavailable' }

  // One write queue for the whole session, so ratings still being sent survive leaving Review. It exists as soon as the
  // user is known (not when their state has loaded): what a killed webview left behind is sent before that state is read.
  const userId = auth.status === 'signed-in' ? auth.userId : null
  // A lost or refused session is replaced by signing in again through the proxy (never by a different user's session).
  const recoverSession = useCallback(async () => {
    if (!client || !userId) return false
    const result = await ensureSession(client, telegram.initData, telegram.user?.id ?? null, { force: true })
    if (result.status === 'error' && result.network) return 'unreachable' // no network is not a refusal
    return result.status === 'signed-in' && result.userId === userId
  }, [client, userId, telegram])
  // The loaded settings, once there are any; until then writes that need them read the server's own copy.
  const [settingsSource] = useState(createSettingsSource)
  const readSettings = settingsSource.read
  // Once custom-word deletes reached the server, their tombstones (pending_word_deletes) are cleared, as the Flutter app's sync does.
  // The in-memory settings are updated too: every later settings write sends the whole blob.
  const [tombstones] = useState(createTombstoneClearer)
  const onWordsDeleted = tombstones.clear
  const queue = useMemo(
    () => (client && userId ? createSupabaseWriteQueue(client, userId, readSettings, { recoverSession, onWordsDeleted }) : null),
    [client, userId, readSettings, recoverSession, onWordsDeleted],
  )
  // The review log (reviewLog.ts): every answer, appended through the queue above. It exists only for a signed-in user, as the queue does.
  const reviewLog = useMemo(() => (queue && userId ? createReviewLog({ enqueue: queue.enqueueLog, learnedAt: createLearnedAtStore(userId) }) : null), [queue, userId])
  const enrich = useMemo(() => (client ? (input: { word: string; pos: string | null }) => enrichWord(input, enrichDepsFor(client, recoverSession)) : undefined), [client, recoverSession])

  // Restore the queue saved by an earlier run and send it, and only then let the user's state load.
  const [restoredFor, setRestoredFor] = useState<string | null>(null)
  useEffect(() => {
    if (!queue || !userId) return
    let cancelled = false
    void restoreAndFlush(queue).finally(() => {
      if (!cancelled) setRestoredFor(userId)
    })
    return () => {
      cancelled = true
    }
  }, [queue, userId])
  const holdLoad = userId !== null && restoredFor !== userId

  const data = useUserData(auth, client, holdLoad)
  // The daily reminder lives here, not in Settings: the time zone on its row is kept current at every open.
  const reminderStore = useMemo(() => (client && userId ? supabaseReminderStore(client, userId) : null), [client, userId])
  const reminders = useReminders(reminderStore)
  const readyData = data.status === 'ready' ? data.data : null
  // Debug has one way in: seven taps on the version row in Settings, remembered in the account's settings (debug_unlocked), and one way out ("Lock Debug").
  const debugUnlocked = readyData?.settings.debugUnlocked ?? false
  const getSettings = readyData?.getSettings ?? null
  // The chosen language once the settings are there (until then the one this device used last); with none chosen, Telegram's.
  const storedLanguage = readyData ? readyData.settings.uiLanguage : undefined
  useEffect(() => {
    if (storedLanguage !== undefined) setLanguage(effectiveLanguage(storedLanguage))
  }, [storedLanguage])
  useEffect(() => {
    settingsSource.use(readyData?.getSettings ?? null)
    tombstones.use(readyData ? { read: readyData.getSettings, apply: readyData.applySettings } : null)
  })

  // Writes still unsent after the restore are the user's latest state: show them over the copy the server returned,
  // before the first paint of the loaded data.
  const mirroredFor = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!queue || !readyData || !userId || mirroredFor.current === userId) return
    mirroredFor.current = userId
    mirrorPending(queue.pending(), readyData)
  }, [queue, readyData, userId])

  // Once per launch, with the data loaded and nothing degraded: the old Learn queue becomes stars (and goes), and a star that does nothing is cleared.
  // Waiting for a clean load keeps a failed favourites read from looking like "no stars".
  const settledFor = useRef<string | null>(null)
  useEffect(() => {
    if (!queue || !readyData || !userId || settledFor.current === userId || readyData.degraded.length > 0) return
    settledFor.current = userId
    settleStars({ words: readyData.words, settings: readyData.settings, applyFavorite: readyData.applyFavorite, applySettings: readyData.applySettings, queue })
  }, [queue, readyData, userId])

  const [screen, setScreenNow] = useState<Screen>('home')
  // A note to the developer: from Settings (esWord null) or about the open word. `feedbackSent` is where one has just gone from, for the line that says so;
  // it is forgotten as soon as the person goes anywhere else.
  const [feedback, setFeedback] = useState<{ esWord: string | null }>({ esWord: null })
  const [feedbackSent, setFeedbackSent] = useState<{ screen: 'settings' | 'word'; key: string | null } | null>(null)
  const setScreen = useCallback((to: Screen) => {
    setScreenNow(to)
    if (to !== 'settings' && to !== 'word' && to !== 'feedback') setFeedbackSent(null)
  }, [])
  // A word's detail is opened from the word of the day (back goes Home) or from the Words list (back goes to the list).
  const [open, setOpen] = useState<{ key: string; from: 'home' | 'words' } | null>(null)
  // The Words list as it was left, so it comes back with its search, filters, segment and place while a word is open.
  const [wordsView] = useState(createViewStore)
  // Leaving a screen never asks and never waits: whatever is unsent is held by the queue (and saved on the device), not by the screen.
  const go = useCallback((to: Screen) => setScreen(to), [setScreen])
  // Only a signed-in user can send one (the table takes their own rows); without a session the entry points are not there.
  const sendReport = useMemo(() => (client && userId ? (report: FeedbackReport) => sendFeedback(report, { client, userId, recoverSession: async () => (await recoverSession()) === true }) : null), [client, userId, recoverSession])
  /** Where Back leads from the current screen. */
  const backTarget: Screen = backTargetFor(screen, screen === 'word' ? (open?.from ?? null) : null, feedback.esWord !== null)
  // A screen opens at the top of the page (the one Back leads to gets its place back), not wherever the last one was scrolled to.
  useScreenScroll(screen, open?.from ?? null)
  // A screen with something open on top of it (a bottom sheet) can take the back press first: it closes that and says so.
  const backInterceptor = useRef<(() => boolean) | null>(null)
  const registerBack = useCallback((handler: (() => boolean) | null) => {
    backInterceptor.current = handler
  }, [])
  const goBack = useCallback(() => {
    if (backInterceptor.current?.()) return
    go(backTarget)
  }, [go, backTarget])

  // supabase-js drops its session when the auth server stops recognising it, and from then on sends the anon key:
  // sign in again at once and let the queue send what waited.
  useEffect(() => {
    if (!client || !userId) return
    return watchSessionLost(client, () => {
      void recoverSession().then((ok) => ok && queue?.retry())
    })
  }, [client, userId, recoverSession, queue])

  // Today's metrics row: accumulated on this device, pushed through the queue's lowest-priority lane.
  const metrics = useMemo(
    () =>
      queue && userId && getSettings
        ? createMetricsRecorder({
            store: createLocalMetricsStore(userId),
            enqueue: queue.enqueueMetrics,
            getSettings,
            // Seeding only: merges another device's counts into this one's before anything is pushed.
            fetchServerRow: async (date) => (client ? parseServerRow(await fetchServerMetricsRow(client, userId, date)) : null),
          })
        : null,
    [queue, userId, getSettings, client],
  )

  // On open: read today's server row once and merge it into the local row (a failed read changes nothing).
  useEffect(() => {
    void metrics?.seedToday()
  }, [metrics])

  // Theme: the synced choice (saved through the same settings path as the streak), localStorage until settings load.
  const applySettings = readyData?.applySettings
  const persistTheme = useMemo(
    () =>
      queue && applySettings
        ? (choice: ThemeChoice) => {
            const patch = themePatch(choice)
            applySettings(patch)
            queue.enqueueSettings(patch)
          }
        : null,
    [queue, applySettings],
  )
  const theme = useTheme(readyData?.settings ?? null, persistTheme)
  const activity = useRecentActivity(client, userId)

  // Queue resilience: closing confirmation while anything is unsaved, slow background retries once stuck.
  useEffect(() => {
    if (!queue) return
    const unbindClosing = bindClosingConfirmation(queue)
    const unbindStuck = bindStuckRetry(queue)
    const unbindPersist = bindPersistOnHide(queue)
    return () => {
      unbindClosing()
      unbindStuck()
      unbindPersist()
    }
  }, [queue])

  // Back online / app shown again: send queued writes and retry the degraded user data now, not at the next backoff step.
  const retryDegraded = readyData?.retryDegraded
  const retryNow = useRef<() => void>(() => {})
  useEffect(() => {
    retryNow.current = () => retryEverything({ queue, retryDegraded })
  })
  useEffect(() => bindReconnectTriggers(() => retryNow.current()), [])

  useEffect(() => {
    const { webApp } = getWebApp()
    webApp.ready()
    webApp.expand()
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!client) return

    ensureSession(client, telegram.initData, telegram.user?.id ?? null).then((result) => {
      if (!cancelled) setAuth(result)
    })

    return () => {
      cancelled = true
    }
  }, [client, telegram])

  const native = nativeBackButton(getWebApp().webApp)
  useEffect(() => {
    if (!native) return
    if (screen === 'home') {
      native.hide()
      return
    }
    native.show()
    const onClick = () => goBack()
    native.onClick(onClick)
    return () => native.offClick(onClick)
  }, [native, screen, goBack])

  // Telegram's BackButton does the job where it exists; elsewhere each screen draws its own.
  const inPageBack = native ? undefined : goBack

  if (screen === 'settings' && readyData && queue) {
    return (
      <SettingsScreen
        data={readyData}
        queue={queue}
        theme={{ choice: theme.choice, set: theme.set }}
        onOpenDebug={() => setScreen('debug')}
        reminders={reminders}
        onTakePlacement={() => setScreen('placement')}
        onOpenHow={() => setScreen('how')}
        onRunIntro={() => setScreen('onboarding')}
        onOpenFeedback={
          sendReport
            ? () => {
                setFeedback({ esWord: null })
                setFeedbackSent(null)
                setScreen('feedback')
              }
            : undefined
        }
        feedbackSent={feedbackSent?.screen === 'settings'}
        onBack={inPageBack}
      />
    )
  }

  if (screen === 'feedback' && sendReport) {
    const about = feedback.esWord
    return (
      <FeedbackScreen
        key={about ?? 'general'}
        kind={about === null ? 'general' : 'word'}
        esWord={about}
        from={about === null ? 'settings' : 'word'}
        send={sendReport}
        onSent={() => {
          setFeedbackSent({ screen: about === null ? 'settings' : 'word', key: about === null ? null : wordKey(about) })
          go(backTarget)
        }}
        onClose={() => go(backTarget)}
        registerBack={registerBack}
        onBack={inPageBack}
      />
    )
  }

  if (screen === 'how') return <HowItWorks onBack={inPageBack} />

  // The placement test on its own, from Settings; finishing or skipping it goes back to Settings.
  if (screen === 'placement' && readyData && queue) {
    return <PlacementScreen data={readyData} queue={queue} onExit={() => setScreen('settings')} registerBack={registerBack} onBack={inPageBack} />
  }

  // "Run the intro again": from step 1, with the current values; finishing or leaving it goes back to Settings.
  if (screen === 'onboarding' && readyData && queue) {
    return <Onboarding data={readyData} queue={queue} mode="replay" onExit={() => setScreen('settings')} registerBack={registerBack} />
  }

  if (screen === 'debug') {
    if (!debugUnlocked) return <NotAvailable />
    return (
      <DebugScreen
        telegram={telegram}
        auth={auth}
        data={data}
        onBack={inPageBack}
        queue={queue}
        metrics={metrics}
        client={client}
        userId={userId}
      />
    )
  }

  if (screen === 'learn' && readyData && queue) {
    return (
      <LearnScreen
        data={readyData}
        queue={queue}
        metrics={metrics}
        reminders={reminders}
        reviewLog={reviewLog}
        onHome={() => void go('home')}
        onReview={() => void go('review')}
        onBack={inPageBack}
      />
    )
  }

  if (screen === 'review' && readyData && queue) {
    return (
      <ReviewScreen
        data={readyData}
        queue={queue}
        metrics={metrics}
        reviewLog={reviewLog}
        onHome={() => void go('home')}
        onLearn={() => void go('learn')}
        onBack={inPageBack}
      />
    )
  }

  if (screen === 'matching' && readyData && queue) {
    return <MatchingScreen data={readyData} queue={queue} metrics={metrics} reviewLog={reviewLog} onHome={() => void go('home')} onBack={inPageBack} />
  }

  if (screen === 'words' && readyData && queue) {
    return (
      <WordsScreen
        data={readyData}
        queue={queue}
        savedView={wordsView.get()}
        onViewChange={wordsView.set}
        registerBack={registerBack}
        enrich={enrich}
        onOpen={(esWord) => {
          // The list hands over the word as stored; a word is found by its key (a word the user typed with a capital is not its own key).
          setOpen({ key: wordKey(esWord), from: 'words' })
          setScreen('word')
        }}
        onBack={inPageBack}
      />
    )
  }

  const openedWord = screen === 'word' && open ? readyData?.words.find((w) => wordKey(w.esWord) === open.key) : undefined
  if (openedWord && readyData && queue) {
    return (
      <WordDetail
        word={openedWord}
        data={readyData}
        queue={queue}
        registerBack={registerBack}
        onDeleted={() => go(backTarget)}
        onReport={
          sendReport
            ? () => {
                setFeedback({ esWord: openedWord.esWord })
                setFeedbackSent(null)
                setScreen('feedback')
              }
            : undefined
        }
        reportSent={feedbackSent?.screen === 'word' && feedbackSent.key === wordKey(openedWord.esWord)}
        onBack={inPageBack}
      />
    )
  }

  if (screen === 'cloze' && readyData && queue) {
    return <ClozeScreen data={readyData} queue={queue} metrics={metrics} reviewLog={reviewLog} onHome={() => void go('home')} onBack={inPageBack} />
  }

  // The first open of an account that has not finished the intro: it is shown instead of Home, and finishing it writes onboarding_done.
  if (screen === 'home' && readyData && queue && needsOnboarding(readyData.settings)) {
    return <Onboarding data={readyData} queue={queue} mode="first" registerBack={registerBack} />
  }

  return (
    <HomeScreen
      auth={auth}
      data={data}
      onLearn={() => setScreen('learn')}
      onReview={() => setScreen('review')}
      onMatching={() => setScreen('matching')}
      onCloze={() => setScreen('cloze')}
      onWords={() => setScreen('words')}
      onSettings={() => setScreen('settings')}
      activity={activity}
      onOpenWord={(word) => {
        setOpen({ key: wordKey(word.esWord), from: 'home' })
        setScreen('word')
      }}
      queue={queue}
      metrics={metrics}
    />
  )
}

export default App
