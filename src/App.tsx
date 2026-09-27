import { useEffect, useState } from 'react'
import { createSupabaseClient } from './lib/supabase'
import { applyTelegramTheme, getWebApp, type TelegramUser } from './lib/telegram'

interface TelegramState {
  user: TelegramUser | null
  hasRawInitData: boolean
  isMock: boolean
}

function readTelegramState(): TelegramState {
  const { webApp, isMock } = getWebApp()
  return {
    user: webApp.initDataUnsafe.user ?? null,
    hasRawInitData: Boolean(webApp.initData && webApp.initData.length > 0),
    isMock,
  }
}

function readSupabaseStatus(): string {
  const { client, error } = createSupabaseClient()
  return client ? 'Supabase client ready' : `Supabase client error: ${error}`
}

function App() {
  const [telegram] = useState(readTelegramState)
  const [supabaseStatus] = useState(readSupabaseStatus)

  useEffect(() => {
    const { webApp } = getWebApp()
    webApp.ready()
    webApp.expand()
    applyTelegramTheme(webApp)
  }, [])

  return (
    <main className="screen">
      <h1>Riopalabras</h1>

      {telegram.isMock ? (
        <p className="badge badge-mock">Using mock Telegram data (dev only)</p>
      ) : (
        <p className="badge badge-live">Live Telegram data</p>
      )}

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
          Raw initData present: <strong>{telegram.hasRawInitData ? 'yes' : 'no'}</strong>
        </p>
      </section>

      <section className="card">
        <h2>Supabase</h2>
        <p>{supabaseStatus}</p>
      </section>
    </main>
  )
}

export default App
