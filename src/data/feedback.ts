import type { SupabaseClient } from '@supabase/supabase-js'
import { BUILD_HASH } from '../lib/buildInfo'
import { getLanguage, type UiLanguage } from '../lib/language'
import { getWebApp, type TelegramWebApp } from '../lib/telegram'
import { headword, type HeadwordSource } from './headword'
import { WriteError, isRejection } from './writes'

// Messages to the developer: a free note from Settings (kind 'general'), or a problem with one word from its detail screen (kind 'word').
// They go into public.feedback, which the signed-in user can read and add to (their own rows) and nothing else: a row is never changed or removed.

export const FEEDBACK_TABLE = 'feedback'
/** The table's limit on a message (1..2000 characters). */
export const MAX_MESSAGE = 2000
/** From this many characters on the form shows how many are used (nine tenths of the limit). */
export const COUNT_FROM = 1800
/** How long one try may take before it counts as failed (the words stay on the form, and a retry carries the same id). */
export const SEND_TIMEOUT_MS = 15_000

export type FeedbackKind = 'word' | 'general'
/** Where a report was written: the Settings row, or a word's detail screen. */
export type FeedbackScreen = 'settings' | 'word'

/** What travels with the text besides the person's account: nothing that identifies the device. */
export interface FeedbackContext {
  appVersion: string
  uiLanguage: UiLanguage
  screen: FeedbackScreen
  platform: string
}

export interface FeedbackReport extends FeedbackContext {
  /** Made on the client, so a retry of the same report cannot make a second row. */
  id: string
  kind: FeedbackKind
  /** What a word report names: the word on the card, and the standard form after it when they differ (see reportedWord); null for a general message. */
  esWord: string | null
  /** Already trimmed and checked. */
  message: string
}

/** The label in front of the standard word in what a word report names (it is read by the author, in the bot's message: English). */
export const STANDARD_LABEL = 'standard'

/**
 * The word a report about a card names: the word the person is LOOKING AT (the card's headword, which for a Rioplatense replacement is the Rioplatense form,
 * "cubierta"), and, when the card leads with another form than the dictionary's, the standard word after it, labelled ("cubierta (standard: neumático)").
 * `Word.esWord` is the dictionary key and is NOT necessarily what is on screen; reading it here is what named "neumático" in a report about "cubierta".
 * The standard word goes too because it is the key of the entry (and two entries can share a headword: quizá and quizás both lead with "capaz").
 * Two things come back: `named`, which is stored and sent to the author (both words), and `shown`, which is all the person is shown on the form (the word they saw).
 */
export function reportFor(word: HeadwordSource): { shown: string; named: string } {
  const shown = headword(word).text
  return { shown, named: shown.trim().toLowerCase() === word.esWord.trim().toLowerCase() ? shown : `${shown} (${STANDARD_LABEL}: ${word.esWord})` }
}

/** What a word report names (the row's es_word, the bot's heading): `reportFor(word).named`. The form shows the person only `reportFor(word).shown`. */
export const reportedWord = (word: HeadwordSource): string => reportFor(word).named

export type MessageCheck = { ok: true; message: string } | { ok: false; problem: 'empty' | 'too-long' }

/** The message as it will be sent: trimmed; refused when nothing is left, or when it is over the limit. */
export function checkMessage(raw: string): MessageCheck {
  const message = raw.trim()
  if (message === '') return { ok: false, problem: 'empty' }
  if (message.length > MAX_MESSAGE) return { ok: false, problem: 'too-long' }
  return { ok: true, message }
}

/** Whether the form should show how many characters are used. */
export const showsCount = (length: number): boolean => length >= COUNT_FROM

/** The short platform name Telegram reports ('android', 'ios', 'tdesktop', 'macos', 'weba', …); never the user agent. Anything else reads 'unknown'. */
export function telegramPlatform(webApp: Pick<TelegramWebApp, 'platform'> = getWebApp().webApp): string {
  const platform = webApp.platform
  return typeof platform === 'string' && /^[a-z0-9_-]{1,24}$/i.test(platform) ? platform.toLowerCase() : 'unknown'
}

/** Everything that is sent with the text, collected for the screen the report was written on. */
export function feedbackContext(screen: FeedbackScreen, overrides: Partial<FeedbackContext> = {}): FeedbackContext {
  return { appVersion: overrides.appVersion ?? BUILD_HASH, uiLanguage: overrides.uiLanguage ?? getLanguage(), screen, platform: overrides.platform ?? telegramPlatform() }
}

/** A new id for a report. */
export function newFeedbackId(): string {
  return globalThis.crypto.randomUUID()
}

/** Builds the report from what the form holds, or says why not. A word report carries the word; a general message never does. */
export function buildReport(input: { id: string; kind: FeedbackKind; esWord: string | null; text: string; context: FeedbackContext }): { ok: true; report: FeedbackReport } | { ok: false; problem: 'empty' | 'too-long' } {
  const checked = checkMessage(input.text)
  if (!checked.ok) return checked
  const esWord = input.kind === 'word' ? input.esWord : null
  return { ok: true, report: { ...input.context, id: input.id, kind: input.kind, esWord, message: checked.message } }
}

/** The table's columns for a report. created_at and status are the database's own. */
export function toFeedbackRow(userId: string, report: FeedbackReport) {
  return {
    id: report.id,
    user_id: userId,
    kind: report.kind,
    es_word: report.kind === 'word' ? report.esWord : null,
    message: report.message,
    app_version: report.appVersion,
    ui_language: report.uiLanguage,
    screen: report.screen,
    platform: report.platform,
  }
}

/**
 * Adds one row. The table takes inserts and nothing else, so this is "ignore a duplicate id" (INSERT ... ON CONFLICT (id) DO NOTHING, as the
 * review log does it): a retry of a report that did arrive changes nothing and is not an error. Throws a WriteError on any failure.
 */
export async function insertFeedback(client: SupabaseClient, userId: string, report: FeedbackReport): Promise<void> {
  const { error, status } = await client.from(FEEDBACK_TABLE).upsert(toFeedbackRow(userId, report), { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw new WriteError(FEEDBACK_TABLE, error.message, status, error.code || null)
}

export interface SendDeps {
  client: SupabaseClient | null
  userId: string | null
  /** Signs in again after the server refused the session; true when there is a usable one. */
  recoverSession?: () => Promise<boolean>
  timeoutMs?: number
}

export type SendResult = { ok: true } | { ok: false; reason: 'unavailable' | 'timeout' | 'failed' }

/**
 * Sends a report. It never throws: signed out (no client or user), a table that is not there, a refused session, the network, a try that takes too long
 * all come back as `{ ok: false }`, and the caller keeps what the person typed. A refused session is recovered and tried once more.
 */
export async function sendFeedback(report: FeedbackReport, deps: SendDeps): Promise<SendResult> {
  const { client, userId } = deps
  if (!client || !userId) return { ok: false, reason: 'unavailable' }
  const attempt = async () => {
    try {
      await insertFeedback(client, userId, report)
      return 'sent' as const
    } catch (error) {
      if (isRejection(error)) return 'rejected' as const
      return 'failed' as const
    }
  }
  const run = async (): Promise<'sent' | 'failed' | 'timeout'> => {
    let outcome = await attempt()
    if (outcome === 'rejected' && deps.recoverSession) {
      outcome = (await deps.recoverSession().catch(() => false)) ? await attempt() : 'rejected'
    }
    return outcome === 'sent' ? 'sent' : 'failed'
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deps.timeoutMs ?? SEND_TIMEOUT_MS)
  })
  const result = await Promise.race([run(), late]).finally(() => clearTimeout(timer))
  return result === 'sent' ? { ok: true } : { ok: false, reason: result === 'timeout' ? 'timeout' : 'failed' }
}
