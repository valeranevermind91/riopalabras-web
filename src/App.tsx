import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLocalMetricsStore, createMetricsRecorder, fetchServerMetricsRow, parseServerRow } from './data/metrics'
import { bindClosingConfirmation, bindReconnectTriggers, bindStuckRetry, retryEverything } from './data/queueTriggers'
import { useUserData } from './data/useUserData'
import { createSupabaseWriteQueue } from './data/writeQueue'
import { ensureSession, type AuthState } from './lib/auth'
import { useDebugAccess } from './lib/useDebugAccess'
import { getSupabase } from './lib/supabase'
import { getWebApp, nativeBackButton } from './lib/telegram'
import { themePatch, type ThemeChoice } from './lib/theme'
import { useTheme } from './lib/useTheme'
import { DebugScreen, type TelegramInfo } from './screens/Debug'
import { HomeScreen } from './screens/Home'
import { ClozeScreen } from './screens/Cloze'
import { LearnScreen } from './screens/Learn'
import { MatchingScreen } from './screens/Matching'
import { NotAvailable } from './screens/NotAvailable'
import { ReviewScreen } from './screens/Review'

type Screen = 'home' | 'learn' | 'review' | 'matching' | 'cloze' | 'debug'
type LeaveGuard = () => boolean | Promise<boolean>

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

  const data = useUserData(auth, client)
  const debugAllowed = useDebugAccess(auth, client, telegram.isMock)

  const [screen, setScreen] = useState<Screen>('home')
  const leaveGuard = useRef<LeaveGuard | null>(null)
  const registerLeaveGuard = useCallback((guard: LeaveGuard | null) => {
    leaveGuard.current = guard
  }, [])

  // Every screen change goes through the active screen's leave guard (unsaved work asks first).
  const go = useCallback(async (to: Screen) => {
    if (leaveGuard.current && !(await leaveGuard.current())) return
    setScreen(to)
  }, [])

  // One write queue for the whole session, so ratings still being sent survive leaving Review.
  const readyData = data.status === 'ready' ? data.data : null
  const getSettings = readyData?.getSettings ?? null
  const userId = auth.status === 'signed-in' ? auth.userId : null
  const queue = useMemo(
    () => (client && userId && getSettings ? createSupabaseWriteQueue(client, userId, getSettings) : null),
    [client, userId, getSettings],
  )

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

  // Queue resilience: closing confirmation while anything is unsaved, slow background retries once stuck.
  useEffect(() => {
    if (!queue) return
    const unbindClosing = bindClosingConfirmation(queue)
    const unbindStuck = bindStuckRetry(queue)
    return () => {
      unbindClosing()
      unbindStuck()
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
    const onClick = () => void go('home')
    native.onClick(onClick)
    return () => native.offClick(onClick)
  }, [native, screen, go])

  // Telegram's BackButton does the job where it exists; elsewhere each screen draws its own.
  const inPageBack = native ? undefined : () => void go('home')

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
        registerLeaveGuard={registerLeaveGuard}
      />
    )
  }

  if (screen === 'matching' && readyData && queue) {
    return <MatchingScreen data={readyData} queue={queue} metrics={metrics} onHome={() => void go('home')} onBack={inPageBack} />
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
      onDebug={debugAllowed ? () => setScreen('debug') : undefined}
      theme={{ choice: theme.choice, onCycle: theme.cycle }}
      queue={queue}
      metrics={metrics}
    />
  )
}

export default App
