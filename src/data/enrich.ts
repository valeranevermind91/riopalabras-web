import type { SupabaseClient } from '@supabase/supabase-js'
import { isOffline } from '../lib/online'
import { strings } from '../strings'

// The proxy's POST /enrich: fills in a translation, an example and a Rioplatense form for a Spanish word the user typed.
// Same call the Flutter app makes (EnrichmentService): a Supabase JWT as the Bearer token, { words: [{ word, pos? }] },
// and { words: [{ word, en_translation, ru_translation, es_rioplatense, is_rioplatense_variant, example_sentence,
// example_translation_en, example_translation_ru, word_form_in_example }] } back. The proxy limits a user to 100 words a day
// and 10 requests a minute, and the whole service to a daily number of calls.
//
// Nothing here waits for long or throws: every outcome is a value, so the screen can say what happened and still be usable.

/** How long the request may take before it counts as failed (the Flutter app waits 15 seconds too). */
export const ENRICH_TIMEOUT_MS = 15_000

export interface Enriched {
  enTranslation: string
  ruTranslation: string
  exampleSentence: string
  exampleTranslationEn: string
  exampleTranslationRu: string
  esRioplatense: string | null
  isRioplatenseVariant: boolean
}

export type EnrichFailure =
  /** The browser says there is no network: not even tried. */
  | { kind: 'offline' }
  /** 401, or no session to send. */
  | { kind: 'unauthorized' }
  /** 429 with usage and limit: the user's daily word quota. */
  | { kind: 'daily-quota'; usage: number; limit: number }
  /** 429 without them: the per-minute limit. */
  | { kind: 'rate-limit' }
  /** 503: the service's own daily cap. */
  | { kind: 'busy' }
  | { kind: 'timeout' }
  /** The request could not be made at all (DNS, connection). */
  | { kind: 'network' }
  /** A good answer with nothing in it for this word. */
  | { kind: 'no-result' }
  | { kind: 'other'; status: number | null }

export type EnrichResult = { ok: true; value: Enriched } | { ok: false; failure: EnrichFailure }

export interface EnrichDeps {
  /** The Supabase access token to send, or null when there is no session. */
  getAccessToken: () => Promise<string | null>
  /**
   * Signs in again (the app's recovery from a lost or refused session): true when it did, false when it was refused,
   * 'unreachable' when the sign-in could not be reached at all. Used once, on a 401, before one retry.
   */
  recoverSession?: () => Promise<boolean | 'unreachable'>
  proxyUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  isOffline?: () => boolean
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** The part of the answer that belongs to the word asked about (matched by lowercased `word`, as the Flutter app does). */
function entryFor(payload: unknown, word: string): Enriched | null {
  const list = Array.isArray(payload) ? payload : isObject(payload) ? (['words', 'results', 'items'].map((k) => payload[k]).find(Array.isArray) as unknown[] | undefined) : undefined
  if (!list) return null
  const target = word.trim().toLowerCase()
  const item = list.find((e) => isObject(e) && typeof e.word === 'string' && e.word.toLowerCase() === target)
  if (!isObject(item)) return null
  const rio = textOf(item.es_rioplatense)
  return {
    enTranslation: textOf(item.en_translation),
    ruTranslation: textOf(item.ru_translation),
    exampleSentence: textOf(item.example_sentence),
    exampleTranslationEn: textOf(item.example_translation_en),
    exampleTranslationRu: textOf(item.example_translation_ru),
    esRioplatense: rio === '' ? null : rio,
    isRioplatenseVariant: item.is_rioplatense_variant === true,
  }
}

/**
 * Asks the proxy about one word. `pos` is left out of the request for "Other" (code `custom`), as the Flutter app does.
 * Offline fails at once, without a request; otherwise nothing waits longer than the timeout.
 */
export async function enrichWord(input: { word: string; pos: string | null }, deps: EnrichDeps): Promise<EnrichResult> {
  const fail = (failure: EnrichFailure): EnrichResult => ({ ok: false, failure })
  if ((deps.isOffline ?? isOffline)()) return fail({ kind: 'offline' })

  const proxyUrl = (deps.proxyUrl ?? import.meta.env.VITE_PROXY_URL ?? '').replace(/\/+$/, '')
  const doFetch = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve('timeout')
    }, deps.timeoutMs ?? ENRICH_TIMEOUT_MS)
  })

  /** One request with the token as it is now; 'unauthorized' when there is none or the proxy refuses it (so a sign-in can be tried). */
  const attempt = async (): Promise<EnrichResult | 'unauthorized'> => {
    const token = await deps.getAccessToken()
    if (!token) return 'unauthorized'
    if (!proxyUrl) return fail({ kind: 'other', status: null })

    const entry: { word: string; pos?: string } = { word: input.word }
    if (input.pos && input.pos !== 'custom') entry.pos = input.pos
    const res = await doFetch(`${proxyUrl}/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ words: [entry] }),
      signal: controller.signal,
    })

    if (res.status === 401) return 'unauthorized'
    if (res.status === 429) {
      const body: unknown = await res.json().catch(() => null)
      if (isObject(body) && typeof body.usage === 'number' && typeof body.limit === 'number') return fail({ kind: 'daily-quota', usage: body.usage, limit: body.limit })
      return fail({ kind: 'rate-limit' })
    }
    if (res.status === 503) return fail({ kind: 'busy' })
    if (!res.ok) return fail({ kind: 'other', status: res.status })

    const payload: unknown = await res.json().catch(() => null)
    const value = entryFor(payload, input.word)
    return value ? { ok: true, value } : fail({ kind: 'no-result' })
  }

  // A 401 (or no session) is answered by signing in again ONCE and asking again ONCE: never a loop.
  const run = async (): Promise<EnrichResult> => {
    const first = await attempt()
    if (first !== 'unauthorized') return first
    if (!deps.recoverSession) return fail({ kind: 'unauthorized' })
    const back = await deps.recoverSession()
    if (back === 'unreachable') return fail({ kind: 'network' })
    if (!back) return fail({ kind: 'unauthorized' })
    const second = await attempt()
    return second === 'unauthorized' ? fail({ kind: 'unauthorized' }) : second
  }

  try {
    const result = await Promise.race([run(), timedOut])
    return result === 'timeout' ? fail({ kind: 'timeout' }) : result
  } catch (err) {
    if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return fail({ kind: 'timeout' })
    return fail({ kind: 'network' })
  } finally {
    clearTimeout(timer)
  }
}

/** The deps the app uses: the signed-in Supabase session's access token (read fresh on every request, never kept). */
export function enrichDepsFor(client: SupabaseClient, recoverSession?: EnrichDeps['recoverSession']): EnrichDeps {
  return {
    recoverSession,
    getAccessToken: async () => {
      try {
        return (await client.auth.getSession()).data.session?.access_token ?? null
      } catch {
        return null
      }
    },
  }
}

/** What to tell the user when a translation could not be filled in: one message per kind of failure. */
export function enrichFailureMessage(failure: EnrichFailure): string {
  const m = strings.words.enrich
  switch (failure.kind) {
    case 'offline':
      return m.offline
    case 'unauthorized':
      return m.unauthorized
    case 'daily-quota':
      return m.dailyQuota(failure.usage, failure.limit)
    case 'rate-limit':
      return m.rateLimit
    case 'busy':
      return m.busy
    case 'timeout':
      return m.timeout
    case 'network':
      return m.network
    case 'no-result':
      return m.noResult
    case 'other':
      return m.other(failure.status)
  }
}

/** An enricher that is never available (a screen rendered without the app's wiring): every word is typed by hand. */
export const noEnrichment = async (): Promise<EnrichResult> => ({ ok: false, failure: { kind: 'other', status: null } })
