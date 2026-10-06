// A page for the real-browser offline test (src/lib/offline.browser.test.ts): the real Learn or Review screen, the
// real write queue and the real supabase-js client, talking to an address that nothing answers (or that the test's
// request interception answers, and then stops answering). Query: screen=learn|review.
import { createClient } from '@supabase/supabase-js'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { createQueueStore, type StorageLike } from '../data/queueStore'
import { parseSettings } from '../data/settings'
import { computeStats } from '../data/stats'
import { createSupabaseWriteQueue } from '../data/writeQueue'
import { LearnScreen } from '../screens/Learn'
import { ReviewScreen } from '../screens/Review'
import { makeWord } from './makeWord'

const screenName = new URLSearchParams(location.search).get('screen') ?? 'learn'
const b64 = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const items = new Map(Object.entries(initial))
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) }
}

// A signed-in client: a stored session with a long-lived token, so nothing needs the network to know who it is.
const exp = Math.floor(Date.now() / 1000) + 3600 * 24
const accessToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'user-1', role: 'authenticated', aud: 'authenticated', exp })}.sig`
const STORAGE_KEY = 'sb-offline-auth-token'
const authStorage = memoryStorage({
  [STORAGE_KEY]: JSON.stringify({ access_token: accessToken, refresh_token: 'r', expires_at: exp, expires_in: 86400, token_type: 'bearer', user: { id: 'user-1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }),
})
const client = createClient('https://fake.supabase.test', 'anon-key', { auth: { storageKey: STORAGE_KEY, storage: authStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } })

const settings = parseSettings({ daily_new_word_limit: 10 })
const queue = createSupabaseWriteQueue(client, 'user-1', () => settings, { store: createQueueStore('user-1', memoryStorage()) })

const now = new Date()
const words =
  screenName === 'review'
    ? Array.from({ length: 6 }, (_, i) => makeWord(`vieja${i + 1}`, { rank: i + 1, repetitions: 2, interval: 3, nextReview: new Date(now.getTime() - 86_400_000) }))
    : Array.from({ length: 30 }, (_, i) => makeWord(`palabra${String(i + 1).padStart(2, '0')}`, { rank: i + 1 }))
const data = {
  words,
  settings,
  stats: computeStats(words, settings, now),
  getSettings: () => settings,
  applySettings: () => {},
  applyProgress: () => {},
  applyHidden: () => {},
  degraded: [],
  retryDegraded: () => {},
} as never

;(window as never as { __queue: typeof queue }).__queue = queue

const element =
  screenName === 'review' ? (
    <ReviewScreen data={data} queue={queue} metrics={null} onHome={() => {}} onLearn={() => {}} />
  ) : (
    <LearnScreen data={data} queue={queue} metrics={null} onHome={() => {}} onReview={() => {}} />
  )
createRoot(document.getElementById('root')!).render(element)
