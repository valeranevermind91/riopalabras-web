import { useEffect, useState } from 'react'
import { ensureSession, type AuthResult } from './lib/auth'
import { getSupabase } from './lib/supabase'
import { applyTelegramTheme, getWebApp, type TelegramUser } from './lib/telegram'

interface TelegramState {
  user: TelegramUser | null
  initData: string
  isMock: boolean
}

type AuthState = { status: 'loading' } | AuthResult

function readTelegramState(): TelegramState {
  const { webApp, isMock } = getWebApp()
  return {
    user: webApp.initDataUnsafe.user ?? null,
    initData: webApp.initData ?? '',
    isMock,
  }
}

function App() {
  const [telegram] = useState(readTelegramState)
  const [asyncAuth, setAuth] = useState<AuthState>({ status: 'loading' })
  const { client, error: clientError } = getSupabase()
  const auth: AuthState = client
    ? asyncAuth
    : { status: 'error', message: clientError ?? 'Supabase client unavailable' }

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

  return (
    <main className="screen">
      <h1>Riopalabras</h1>

      {telegram.isMock ? (
        <p className="badge badge-mock">Using mock Telegram data (dev only)</p>
      ) : (
        <p className="badge badge-live">Live Telegram data</p>
      )}

      <section className="card">
        <h2>Auth</h2>
        {auth.status === 'loading' && <p>Signing in…</p>}

        {auth.status === 'signed-in' && (
          <>
            <p>
              <strong>Signed in as {auth.telegramFirstName ?? telegram.user?.first_name ?? 'unknown'}</strong>
            </p>
            <dl>
              <dt>Supabase user id</dt>
              <dd className="mono">{auth.userId}</dd>
              <dt>Session</dt>
              <dd>
                active ({auth.source === 'existing' ? 'reused stored session' : 'new, from /auth/telegram'})
              </dd>
            </dl>
          </>
        )}

        {auth.status === 'no-telegram' && <p>Open inside Telegram to sign in.</p>}

        {auth.status === 'error' && (
          <p className="error">Sign-in failed: {auth.message}</p>
        )}
      </section>

      <section className="card">
        <h2>Telegram identity</h2>
        {telegram.user ? (
          <dl>
            <dt>id</dt>
            <dd>{telegram.user.id}</dd>
            <dt>first_name</dt>
            <dd>{telegram.user.first_name}</dd>
            <dt>username</dt>
            <dd>{telegram.user.username ?? '(none)'}</dd>
          </dl>
        ) : (
          <p>No Telegram user found.</p>
        )}
        <p>
          Raw initData present: <strong>{telegram.initData ? 'yes' : 'no'}</strong>
        </p>
      </section>
    </main>
  )
}

export default App
