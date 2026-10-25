import type { SupabaseClient } from '@supabase/supabase-js'
import { isOffline } from '../lib/online'
import { customRegion, customRegister, type CustomRegister } from './customMarks'
import type { RioRegion } from './rio'
import { strings } from '../strings'

// The proxy's POST /enrich: fills in a translation, an example and a Rioplatense form for a Spanish word the user typed.
// Same call the Flutter app makes (EnrichmentService): a Supabase JWT as the Bearer token, { words: [{ word, pos? }] },
// and { words: [{ word, en_translation, ru_translation, es_rioplatense, is_rioplatense_variant, example_sentence,
// example_translation_en, example_translation_ru, word_form_in_example, is_real_word, suggested_spelling }] } back (the last two say
// whether the typed word is a Spanish word and what was probably meant; a proxy that does not send them reads as "a real word"). The proxy limits a user to a
// number of words a day (it says which, in the answer: `limit`; nothing here knows the number) and 10 requests a minute, one word to a request, and the whole
// service to a daily number of calls. Its errors carry a `code`, which is how the cases are told apart (a Gemini 503 and our own cap are both 503).
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
  /** 'ar' or 'uy'; null for both countries, not Rioplatense, or not sure. Anything else the proxy sent is null here too. */
  region: RioRegion | null
  register: CustomRegister | null
  /** The standard-Spanish equivalent, when the typed word is itself Rioplatense. */
  esStandard: string | null
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
  /** 503 with code `capacity`: the service's own daily cap, which starts again at `resetsAt` (ms since the epoch; null when the proxy did not say). */
  | { kind: 'capacity'; resetsAt: number | null }
  /** 503 with code `upstream_unavailable`: the translation provider's own quota is gone for now. */
  | { kind: 'unavailable' }
  /** Any other 503: busy for a moment (the provider overloaded). */
  | { kind: 'busy' }
  | { kind: 'timeout' }
  /** The request could not be made at all (DNS, connection). */
  | { kind: 'network' }
  /** A good answer with nothing in it for this word. */
  | { kind: 'no-result' }
  | { kind: 'other'; status: number | null }

/**
 * The proxy said the word as typed is not a Spanish word (`is_real_word` false), and what it probably meant when it had a guess. Only present
 * then: an answer that says the word is real, says nothing, or comes from a proxy that does not send the field is as it always was.
 */
export interface NotRecognised {
  /** The likely spelling (one word), or null when the proxy had no plausible guess. */
  suggestion: string | null
}

/** `value` is for the word as typed, except when `notRecognised` is there: then it is for the word the proxy believes was meant. */
export type EnrichResult = { ok: true; value: Enriched; notRecognised?: NotRecognised } | { ok: false; failure: EnrichFailure }

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

/** The proxy's verdict on the spelling: only an explicit `is_real_word: false` counts (anything else is a real word), and a suggestion is one word or nothing. */
function notRecognisedIn(item: Record<string, unknown>, typed: string): NotRecognised | null {
  if (item.is_real_word !== false) return null
  const suggestion = textOf(item.suggested_spelling)
  const usable = suggestion !== '' && !/\s/.test(suggestion) && suggestion.toLowerCase() !== typed.trim().toLowerCase()
  return { suggestion: usable ? suggestion : null }
}

/** The part of the answer that belongs to the word asked about (matched by lowercased `word`, as the Flutter app does). */
function entryFor(payload: unknown, word: string): { value: Enriched; notRecognised: NotRecognised | null } | null {
  const list = Array.isArray(payload) ? payload : isObject(payload) ? (['words', 'results', 'items'].map((k) => payload[k]).find(Array.isArray) as unknown[] | undefined) : undefined
  if (!list) return null
  const target = word.trim().toLowerCase()
  const item = list.find((e) => isObject(e) && typeof e.word === 'string' && e.word.toLowerCase() === target)
  if (!isObject(item)) return null
  const rio = textOf(item.es_rioplatense)
  return {
    value: {
      enTranslation: textOf(item.en_translation),
      ruTranslation: textOf(item.ru_translation),
      exampleSentence: textOf(item.example_sentence),
      exampleTranslationEn: textOf(item.example_translation_en),
      exampleTranslationRu: textOf(item.example_translation_ru),
      esRioplatense: rio === '' ? null : rio,
      isRioplatenseVariant: item.is_rioplatense_variant === true,
      region: customRegion(item.region),
      register: customRegister(item.register),
      esStandard: textOf(item.es_standard) || null,
    },
    notRecognised: notRecognisedIn(item, word),
  }
}

/**
 * Asks the proxy about one word. `pos` is left out of the request for "Other" (code `custom`), as the Flutter app does.
 * The request is always made: the browser's "offline" flag is not trusted to refuse it (on some devices it says no while the network works). It only names a failure
 * that has already happened, so a request that could not be made reads "offline" when the browser agrees and "network" when it does not. Nothing waits longer than the timeout.
 */
export async function enrichWord(input: { word: string; pos: string | null }, deps: EnrichDeps): Promise<EnrichResult> {
  const fail = (failure: EnrichFailure): EnrichResult => ({ ok: false, failure })
  const unreachable = (): EnrichResult => fail({ kind: (deps.isOffline ?? isOffline)() ? 'offline' : 'network' })

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
    if (res.status === 503) {
      const body: unknown = await res.json().catch(() => null)
      const code = isObject(body) ? body.code : null
      if (code === 'capacity') {
        const at = isObject(body) && typeof body.resets_at === 'string' ? Date.parse(body.resets_at) : NaN
        return fail({ kind: 'capacity', resetsAt: Number.isFinite(at) ? at : null })
      }
      if (code === 'upstream_unavailable') return fail({ kind: 'unavailable' })
      return fail({ kind: 'busy' })
    }
    if (!res.ok) return fail({ kind: 'other', status: res.status })

    const payload: unknown = await res.json().catch(() => null)
    const found = entryFor(payload, input.word)
    if (!found) return fail({ kind: 'no-result' })
    return found.notRecognised ? { ok: true, value: found.value, notRecognised: found.notRecognised } : { ok: true, value: found.value }
  }

  // A 401 (or no session) is answered by signing in again ONCE and asking again ONCE: never a loop.
  const run = async (): Promise<EnrichResult> => {
    const first = await attempt()
    if (first !== 'unauthorized') return first
    if (!deps.recoverSession) return fail({ kind: 'unauthorized' })
    const back = await deps.recoverSession()
    if (back === 'unreachable') return unreachable()
    if (!back) return fail({ kind: 'unauthorized' })
    const second = await attempt()
    return second === 'unauthorized' ? fail({ kind: 'unauthorized' }) : second
  }

  try {
    const result = await Promise.race([run(), timedOut])
    return result === 'timeout' ? fail({ kind: 'timeout' }) : result
  } catch (err) {
    if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return fail({ kind: 'timeout' })
    return unreachable()
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

/** The next 00:00 UTC after `now`, in ms: when the proxy's daily counters start again (the day is the UTC day, whatever time zone the person is in). */
export const nextUtcMidnight = (now: Date): number => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)

/** Whole hours until `resetsAt`, rounded to the nearest; 0 means less than an hour. Without a time from the proxy, the next 00:00 UTC. */
export function hoursUntilReset(resetsAt: number | null, now: Date): number {
  const at = resetsAt ?? nextUtcMidnight(now)
  return Math.max(0, Math.round((at - now.getTime()) / 3_600_000))
}

/** Whether asking again could help: not when the answer was "your day is used up", "the service's day is used up" or "the provider is out for now". */
export const isRetryable = (failure: EnrichFailure): boolean => failure.kind !== 'daily-quota' && failure.kind !== 'capacity' && failure.kind !== 'unavailable'

/** What to tell the user when a translation could not be filled in: one message per kind of failure. `now` is for the hours a cap has left. */
export function enrichFailureMessage(failure: EnrichFailure, now: Date = new Date()): string {
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
    case 'capacity':
      return m.capacity(hoursUntilReset(failure.resetsAt, now))
    case 'unavailable':
      return m.unavailable
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
