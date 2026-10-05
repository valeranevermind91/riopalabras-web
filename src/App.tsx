import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { bindClosingConfirmation, bindReconnectTriggers, bindStuckRetry, retryEverything } from './data/queueTriggers'
import { useUserData } from './data/useUserData'
import { createSupabaseWriteQueue } from './data/writeQueue'
import { ensureSession, type AuthState } from './lib/auth'
import { getSupabase } from './lib/supabase'
import { applyTelegramTheme, getWebApp, nativeBackButton } from './lib/telegram'
import { DebugScreen, type TelegramInfo } from './screens/Debug'
import { HomeScreen } from './screens/Home'
import { LearnScreen } from './screens/Learn'
import { ReviewScreen } from './screens/Review'

type Screen = 'home' | 'learn' | 'review' | 'debug'
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
    applyTelegramTheme(webApp)
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
    return <DebugScreen telegram={telegram} auth={auth} data={data} onBack={inPageBack} />
  }

  if (screen === 'learn' && readyData && auth.status === 'signed-in' && client) {
    return (
      <LearnScreen
        data={readyData}
        client={client}
        userId={auth.userId}
        onHome={() => void go('home')}
        onReview={() => void go('review')}
        onBack={inPageBack}
        registerLeaveGuard={registerLeaveGuard}
      />
    )
  }

  if (screen === 'review' && readyData && queue) {
    return (
      <ReviewScreen
        data={readyData}
        queue={queue}
        onHome={() => void go('home')}
        onLearn={() => void go('learn')}
        onBack={inPageBack}
        registerLeaveGuard={registerLeaveGuard}
      />
    )
  }

  return (
    <HomeScreen
      auth={auth}
      data={data}
      onLearn={() => setScreen('learn')}
      onReview={() => setScreen('review')}
      onDebug={() => setScreen('debug')}
      queue={queue}
    />
  )
}

export default App
