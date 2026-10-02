import { DataSection } from '../DataSection'
import { ScreenHeader } from '../components/ScreenHeader'
import type { DataState } from '../data/useUserData'
import type { AuthState } from '../lib/auth'
import type { TelegramUser } from '../lib/telegram'
import { strings } from '../strings'

export interface TelegramInfo {
  user: TelegramUser | null
  initData: string
  isMock: boolean
}

interface DebugScreenProps {
  telegram: TelegramInfo
  auth: AuthState
  data: DataState
  onBack?: () => void
}

export function DebugScreen({ telegram, auth, data, onBack }: DebugScreenProps) {
  return (
    <main className="screen">
      <ScreenHeader title={strings.debug.title} onBack={onBack} />

      {telegram.isMock ? (
        <p className="badge badge-mock">Using mock Telegram data (dev only)</p>
      ) : (
        <p className="badge badge-live">Live Telegram data</p>
      )}

      <section className="card">
        <h2>{strings.debug.auth}</h2>
        {auth.status === 'loading' && <p>{strings.debug.signingIn}</p>}

        {auth.status === 'signed-in' && (
          <>
            <p>
              <strong>{strings.debug.signedInAs(auth.telegramFirstName ?? telegram.user?.first_name ?? 'unknown')}</strong>
            </p>
            <dl>
              <dt>{strings.debug.userId}</dt>
              <dd className="mono">{auth.userId}</dd>
              <dt>{strings.debug.session}</dt>
              <dd>{auth.source === 'existing' ? strings.debug.sessionReused : strings.debug.sessionNew}</dd>
            </dl>
          </>
        )}

        {auth.status === 'no-telegram' && <p>{strings.common.signInPrompt}</p>}

        {auth.status === 'error' && <p className="error">{strings.debug.signInFailed(auth.message)}</p>}
      </section>

      <DataSection state={data} />

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
