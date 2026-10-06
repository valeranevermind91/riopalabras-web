import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * A fake of everything the app talks to on the way from "Telegram opens the app" to "a row is written":
 * the proxy's /auth/telegram, Supabase Auth (/auth/v1/user, /auth/v1/token) and PostgREST (/rest/v1/<table>),
 * behind a fetch the REAL supabase-js client is built on. It behaves the way the live database does where it
 * matters here: row-level security only lets `authenticated` users write rows with their own user_id (a write
 * made with the anon key is refused with 401 / 42501), and reads made with the anon key do not fail, they come back empty.
 */
const b64 = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (text: string) => atob(text.replace(/-/g, '+').replace(/_/g, '/'))

export function makeJwt(claims: Record<string, unknown>): string {
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.fake-signature`
}

export const ANON_KEY = makeJwt({ role: 'anon', iss: 'supabase', exp: 4_000_000_000 })

export interface FakeServerOptions {
  /** The first sign-in for a Telegram id creates the user (the proxy's generateLink path); later ones find it. */
  now?: () => number
}

export interface Row {
  [column: string]: unknown
}

export function createFakeServer(options: FakeServerOptions = {}) {
  const now = options.now ?? (() => Date.now())
  const tables = new Map<string, Row[]>()
  const users = new Map<number, string>() // telegram id -> auth user id
  const log: { url: string; method: string; role: string; status: number }[] = []
  let nextUser = 1
  // Things a test can break on purpose.
  const broken = { forgetSessions: false, proxyDown: false, hangWrites: false, forbidWrites: false, forbidTable: null as string | null, failReadsOf: null as string | null, proxyUnreachable: false, networkDown: false }

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const claimsOf = (header: string | null): Record<string, unknown> | null => {
    const token = header?.replace(/^Bearer /, '')
    if (!token) return null
    try {
      const claims = JSON.parse(unb64(token.split('.')[1]))
      if (typeof claims.exp === 'number' && claims.exp * 1000 < now()) return { expired: true }
      return claims
    } catch {
      return null
    }
  }

  function issueSession(userId: string, telegramId: number) {
    const iat = Math.floor(now() / 1000)
    const access_token = makeJwt({ sub: userId, role: 'authenticated', aud: 'authenticated', iat, exp: iat + 3600, user_metadata: { telegram_id: telegramId, telegram_first_name: 'Test' } })
    return { access_token, refresh_token: `refresh-${userId}-${iat}`, expires_in: 3600 }
  }

  async function proxy(request: Request) {
    if (broken.proxyDown) return json({ error: 'Failed to authenticate.' }, 500)
    const { initData } = (await request.json()) as { initData: string }
    const telegramId = Number(new URLSearchParams(initData).get('id'))
    if (!users.has(telegramId)) users.set(telegramId, `user-${nextUser++}`)
    return json(issueSession(users.get(telegramId)!, telegramId))
  }

  async function auth(url: URL, request: Request) {
    if (url.pathname === '/auth/v1/user') {
      // The access token is still a perfectly good JWT, but the auth server does not know the session it names.
      if (broken.forgetSessions) return json({ code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' }, 403)
      const claims = claimsOf(request.headers.get('authorization'))
      if (!claims || claims.expired || claims.role !== 'authenticated') return json({ code: 401, msg: 'invalid JWT' }, 401)
      return json({ id: claims.sub, aud: 'authenticated', role: 'authenticated', user_metadata: claims.user_metadata ?? {}, app_metadata: {}, created_at: new Date(now()).toISOString() })
    }
    if (url.pathname === '/auth/v1/token') {
      const body = (await request.json()) as { refresh_token?: string }
      if (broken.forgetSessions) return json({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }, 400)
      const m = /^refresh-(user-\d+)-/.exec(body.refresh_token ?? '')
      if (!m) return json({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, 400)
      const telegramId = [...users].find(([, id]) => id === m[1])![0]
      const session = issueSession(m[1], telegramId)
      return json({ ...session, token_type: 'bearer', user: { id: m[1], aud: 'authenticated', role: 'authenticated', user_metadata: { telegram_id: telegramId }, app_metadata: {} } })
    }
    return json({ msg: 'not found' }, 404)
  }

  async function rest(url: URL, request: Request) {
    const table = url.pathname.replace('/rest/v1/', '')
    const claims = claimsOf(request.headers.get('authorization'))
    if (!claims) return json({ message: 'No API key found in request', hint: 'No `apikey` request header or url param was found.' }, 401)
    if (claims.expired) return json({ code: 'PGRST301', message: 'JWT expired' }, 401)
    const role = String(claims.role)
    const rows = tables.get(table) ?? []
    if (request.method === 'GET') {
      if (broken.failReadsOf === table) return json({ message: 'could not read this table' }, 400) // not a 5xx: supabase-js retries those on its own
      // RLS: a row is visible only to the user who owns it; anon sees nothing, and gets no error for it.
      let visible = role === 'authenticated' ? rows.filter((r) => r.user_id === claims.sub) : []
      for (const [column, filter] of url.searchParams) {
        if (filter.startsWith('eq.')) visible = visible.filter((r) => String(r[column]) === filter.slice(3))
      }
      return json(visible)
    }
    if (broken.hangWrites && request.method !== 'GET') return new Promise<Response>(() => {})
    if (broken.forbidWrites || broken.forbidTable === table) return json({ code: '42501', message: `new row violates row-level security policy for table "${table}"` }, 403)
    const incoming = ((await request.json()) as Row | Row[]) ?? []
    const batch = Array.isArray(incoming) ? incoming : [incoming]
    if (role !== 'authenticated') {
      return json({ code: '42501', message: `new row violates row-level security policy for table "${table}"` }, 401)
    }
    if (batch.some((r) => r.user_id !== claims.sub)) return json({ code: '42501', message: `new row violates row-level security policy for table "${table}"` }, 403)
    if (request.method === 'POST') {
      const keys = (url.searchParams.get('on_conflict') ?? 'user_id').split(',')
      for (const r of batch) {
        const at = rows.findIndex((x) => keys.every((k) => x[k] === r[k]))
        if (at >= 0) rows[at] = { ...rows[at], ...r }
        else rows.push({ ...r })
      }
      tables.set(table, rows)
      return new Response(null, { status: 201 })
    }
    if (request.method === 'DELETE') return new Response(null, { status: 204 })
    return json({ message: 'unsupported' }, 400)
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (broken.networkDown) throw new TypeError('Failed to fetch') // no network at all: nothing completes
    const request = new Request(input as RequestInfo, init)
    const url = new URL(request.url)
    let response: Response
    let role = 'none'
    const claims = claimsOf(request.headers.get('authorization'))
    if (claims) role = claims.expired ? 'expired' : String(claims.role)
    if (url.pathname === '/auth/telegram' && broken.proxyUnreachable) throw new TypeError('Failed to fetch') // no network: the request never completes
    if (url.pathname === '/auth/telegram') response = await proxy(request)
    else if (url.pathname.startsWith('/auth/v1/')) response = await auth(url, request)
    else if (url.pathname.startsWith('/rest/v1/')) response = await rest(url, request)
    else response = json({ message: 'not found' }, 404)
    log.push({ url: url.pathname, method: request.method, role, status: response.status })
    return response
  }

  const memory = () => {
    const store = new Map<string, string>()
    return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  }

  return {
    fetch,
    tables,
    log,
    users,
    /** Break things on purpose: sessions the auth server no longer knows, a proxy that is down, writes that never answer, writes refused by policy. */
    break: broken,
    /** The real supabase-js client, pointed at this fake. `storage` stands in for the webview's localStorage. */
    client(storage = memory()): SupabaseClient {
      return createClient('https://fake.supabase.test', ANON_KEY, {
        global: { fetch },
        auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage },
      })
    },
    rows: (table: string) => tables.get(table) ?? [],
  }
}

export function initDataFor(telegramId: number): string {
  return `id=${telegramId}&auth_date=${Math.floor(Date.now() / 1000)}&hash=x`
}
