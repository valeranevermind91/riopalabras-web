import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createLocalMetricsStore, createMetricsRecorder, fetchServerMetricsRow, parseServerRow } from './data/metrics'
import { bindClosingConfirmation, bindPersistOnHide, bindReconnectTriggers, bindStuckRetry, retryEverything } from './data/queueTriggers'
import { createSettingsSource, mirrorPending, restoreAndFlush } from './data/startup'
import { wordKey } from './data/words'
import { createViewStore } from './data/wordList'
import { useUserData } from './data/useUserData'
import { createSupabaseWriteQueue } from './data/writeQueue'
import { ensureSession, watchSessionLost, type AuthState } from './lib/auth'
import { useDebugAccess } from './lib/useDebugAccess'
import { getSupabase } from './lib/supabase'
import { getWebApp, nativeBackButton } from './lib/telegram'
import { themePatch, type ThemeChoice } from './lib/theme'
import { useRecentActivity } from './lib/useRecentActivity'
import { useTheme } from './lib/useTheme'
import { DebugScreen, type TelegramInfo } from './screens/Debug'
import { HomeScreen } from './screens/Home'
import { ClozeScreen } from './screens/Cloze'
import { LearnScreen } from './screens/Learn'
import { MatchingScreen } from './screens/Matching'
import { WordDetail } from './screens/WordDetail'
import { WordsScreen } from './screens/Words'
import { NotAvailable } from './screens/NotAvailable'
import { ReviewScreen } from './screens/Review'

type Screen = 'home' | 'learn' | 'review' | 'matching' | 'cloze' | 'words' | 'word' | 'debug'

function readTelegramInfo(): TelegramInfo {
  const { webApp, isMock } = getWebApp()
  return {
    user: webApp.initDataUnsafe.user ?? null,
    initData: webApp.initData ?? '',
    isMock,
  }
}

function App() {
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
  const queue = useMemo(
    () => (client && userId ? createSupabaseWriteQueue(client, userId, readSettings, { recoverSession }) : null),
    [client, userId, readSettings, recoverSession],
  )

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
  const debugAllowed = useDebugAccess(auth, client, telegram.isMock)
  const readyData = data.status === 'ready' ? data.data : null
  const getSettings = readyData?.getSettings ?? null
  useEffect(() => {
    settingsSource.use(readyData?.getSettings ?? null)
  })

  // Writes still unsent after the restore are the user's latest state: show them over the copy the server returned,
  // before the first paint of the loaded data.
  const mirroredFor = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!queue || !readyData || !userId || mirroredFor.current === userId) return
    mirroredFor.current = userId
    mirrorPending(queue.pending(), readyData)
  }, [queue, readyData, userId])

  const [screen, setScreen] = useState<Screen>('home')
  // A word's detail is opened from the word of the day (back goes Home) or from the Words list (back goes to the list).
  const [open, setOpen] = useState<{ key: string; from: 'home' | 'words' } | null>(null)
  // The Words list as it was left, so it comes back with its search, filters, segment and place while a word is open.
  const [wordsView] = useState(createViewStore)
  // Leaving a screen never asks and never waits: whatever is unsent is held by the queue (and saved on the device), not by the screen.
  const go = useCallback((to: Screen) => setScreen(to), [])
  /** Where Back leads from the current screen. */
  const backTarget: Screen = screen === 'word' ? (open?.from ?? 'home') : 'home'
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

  if (screen === 'debug') {
    if (!debugAllowed) return <NotAvailable />
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
        onHome={() => void go('home')}
        onLearn={() => void go('learn')}
        onBack={inPageBack}
      />
    )
  }

  if (screen === 'matching' && readyData && queue) {
    return <MatchingScreen data={readyData} queue={queue} metrics={metrics} onHome={() => void go('home')} onBack={inPageBack} />
  }

  if (screen === 'words' && readyData && queue) {
    return (
      <WordsScreen
        data={readyData}
        queue={queue}
        savedView={wordsView.get()}
        onViewChange={wordsView.set}
        registerBack={registerBack}
        onOpen={(key) => {
          setOpen({ key, from: 'words' })
          setScreen('word')
        }}
        onBack={inPageBack}
      />
    )
  }

  const openedWord = screen === 'word' && open ? readyData?.words.find((w) => wordKey(w.esWord) === open.key) : undefined
  if (openedWord && readyData && queue) {
    return <WordDetail word={openedWord} data={readyData} queue={queue} onBack={inPageBack} />
  }

  if (screen === 'cloze' && readyData && queue) {
    return <ClozeScreen data={readyData} queue={queue} metrics={metrics} onHome={() => void go('home')} onBack={inPageBack} />
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
      onDebug={debugAllowed ? () => setScreen('debug') : undefined}
      theme={{ choice: theme.choice, scheme: theme.scheme, onCycle: theme.cycle }}
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
