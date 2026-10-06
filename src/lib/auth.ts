import type { SupabaseClient } from '@supabase/supabase-js'

const PROXY_URL = (import.meta.env.VITE_PROXY_URL ?? '').replace(/\/+$/, '')

export type AuthResult =
  | { status: 'signed-in'; userId: string; telegramFirstName: string | null; source: 'existing' | 'telegram' }
  | { status: 'no-telegram' }
  | { status: 'error'; message: string }

/** Sign-in as the UI sees it: still working, or one of the three outcomes. */
export type AuthState = { status: 'loading' } | AuthResult

interface ProxySession {
  access_token: string
  refresh_token: string
}

async function fetchProxySession(initData: string): Promise<ProxySession> {
  if (!PROXY_URL) {
    throw new Error('VITE_PROXY_URL is not set')
  }

  let res: Response
  try {
    res = await fetch(`${PROXY_URL}/auth/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
  } catch {
    throw new Error('Could not reach the auth server (network error or blocked by CORS)')
  }

  if (!res.ok) {
    let serverMessage = ''
    try {
      const body = await res.json()
      if (typeof body?.error === 'string') serverMessage = body.error
    } catch {
      // non-JSON error body; fall back to the status code alone
    }
    throw new Error(`Auth server returned ${res.status}${serverMessage ? `: ${serverMessage}` : ''}`)
  }

  const body = await res.json()
  if (typeof body?.access_token !== 'string' || typeof body?.refresh_token !== 'string') {
    throw new Error('Auth server returned an unexpected response')
  }
  return { access_token: body.access_token, refresh_token: body.refresh_token }
}

function telegramMetadata(session: { user: { user_metadata?: Record<string, unknown> } }) {
  const meta = session.user.user_metadata ?? {}
  return {
    id: typeof meta.telegram_id === 'number' ? meta.telegram_id : null,
    firstName: typeof meta.telegram_first_name === 'string' ? meta.telegram_first_name : null,
  }
}

async function run(client: SupabaseClient, initData: string, telegramUserId: number | null, force: boolean): Promise<AuthResult> {
  // getSession() transparently refreshes an expired access token via the stored refresh_token.
  // `force` (recovery after the session was lost or refused) skips the stored one and signs in again through the proxy.
  const { data: existing } = force ? { data: { session: null } } : await client.auth.getSession()
  if (existing.session) {
    const meta = telegramMetadata(existing.session)
    // A stored session for a different Telegram account must not be reused.
    const belongsToOtherAccount = telegramUserId !== null && meta.id !== null && meta.id !== telegramUserId
    if (!belongsToOtherAccount) {
      return {
        status: 'signed-in',
        userId: existing.session.user.id,
        telegramFirstName: meta.firstName,
        source: 'existing',
      }
    }
  }

  if (!initData) {
    return { status: 'no-telegram' }
  }

  try {
    const { access_token, refresh_token } = await fetchProxySession(initData)
    const { data, error } = await client.auth.setSession({ access_token, refresh_token })
    if (error || !data.session) {
      throw new Error(`Could not start the Supabase session: ${error?.message ?? 'no session returned'}`)
    }
    return {
      status: 'signed-in',
      userId: data.session.user.id,
      telegramFirstName: telegramMetadata(data.session).firstName,
      source: 'telegram',
    }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

// Shared across callers so React StrictMode's double-invoked effect can't fire two /auth/telegram requests.
const inFlight: { normal: Promise<AuthResult> | null; forced: Promise<AuthResult> | null } = { normal: null, forced: null }

/**
 * Signs in (or finds the stored session). `force: true` is for recovery: the session this device held was lost or
 * refused, so it signs in again through the proxy instead of trusting what is stored.
 */
export function ensureSession(
  client: SupabaseClient,
  initData: string,
  telegramUserId: number | null,
  options: { force?: boolean } = {},
): Promise<AuthResult> {
  const slot = options.force ? 'forced' : 'normal'
  if (!inFlight[slot]) {
    inFlight[slot] = run(client, initData, telegramUserId, slot === 'forced')
      .catch((err): AuthResult => ({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      }))
      .finally(() => {
        inFlight[slot] = null
      })
  }
  return inFlight[slot]
}

/**
 * Calls `onLost` when supabase-js drops the session it holds (the auth server said it no longer knows it, or a refresh was
 * refused). The callback runs on the next tick, never inside supabase-js's own callback, where touching the client deadlocks.
 * Returns the unsubscribe.
 */
export function watchSessionLost(client: SupabaseClient, onLost: () => void): () => void {
  const { data } = client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') setTimeout(onLost, 0)
  })
  return () => data.subscription.unsubscribe()
}
