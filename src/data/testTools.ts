import { learnedToday } from './daily'
import { localDateKey } from './dates'
import type { MetricsRecorder } from './metrics'
import { isReviewDue } from './stats'
import type { ProgressUpdate, SettingsPatch, UserSettings, Word } from './types'
import { hasTranslations, isReviewablePos } from './words'

// Testing tools for the Debug screen. Nothing here is used by the learning flow.

export const DEFAULT_MAKE_DUE = 5
export const MAX_MAKE_DUE = 50

/** The count typed into the input: a whole number from 1 to MAX_MAKE_DUE, otherwise null. */
export function parseMakeDueCount(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  return n >= 1 && n <= MAX_MAKE_DUE ? n : null
}

/**
 * The words to pull forward: learned, ones Review would actually show (not hidden, reviewable part
 * of speech, enriched, with translations) and NOT already due, those with the furthest due dates
 * first. A word whose due date is already past is left alone: it is due as it is.
 */
export function selectWordsToMakeDue(words: readonly Word[], n: number, now: Date): Word[] {
  return words
    .filter((w) => w.repetitions > 0 && !w.isHidden && w.isEnriched && isReviewablePos(w.pos) && hasTranslations(w))
    .filter((w) => w.nextReview !== null && !isReviewDue(w, now))
    .sort((a, b) => b.nextReview!.getTime() - a.nextReview!.getTime())
    .slice(0, Math.max(0, n))
}

/** Only the due date changes: ease, interval and repetitions are copied as they are, so the next real rating behaves exactly as it would have. */
export function dueNowUpdates(words: readonly Word[], now: Date): ProgressUpdate[] {
  return words.map((w) => ({ esWord: w.esWord, easeFactor: w.easeFactor, interval: w.interval, repetitions: w.repetitions, nextReview: now }))
}

export interface MakeDueDeps {
  signedIn: boolean
  words: readonly Word[]
  count: number
  now?: Date
  /** Optimistic: mirror the new due dates into the in-memory words. */
  applyProgress: (updates: readonly ProgressUpdate[]) => void
  queue: { enqueueProgress: (update: ProgressUpdate) => void }
}

export interface MakeDueReport {
  /** The words whose due date was set to now (original casing), in the order chosen. */
  words: string[]
  message: string
}

/** Sets the due date of the chosen words to now through the write queue. Does nothing unless signed in. */
export function makeWordsDue(deps: MakeDueDeps): MakeDueReport {
  if (!deps.signedIn) return { words: [], message: 'Not signed in: nothing was changed.' }

  const now = deps.now ?? new Date()
  const chosen = selectWordsToMakeDue(deps.words, deps.count, now)
  if (chosen.length === 0) return { words: [], message: 'No learned words with a future due date: nothing was changed.' }

  const updates = dueNowUpdates(chosen, now)
  deps.applyProgress(updates)
  for (const update of updates) deps.queue.enqueueProgress(update)

  const names = chosen.map((w) => w.esWord)
  const short = chosen.length < deps.count ? ` (only ${chosen.length} available, ${deps.count} asked)` : ''
  return { words: names, message: `${names.length} word${names.length === 1 ? '' : 's'} set due${short}: ${names.join(', ')}` }
}

export interface ResetMetricsReport {
  ok: boolean
  message: string
}

/** Clears today's local metrics row and re-pushes a zeroed one. Does nothing unless signed in. */
export function resetTodayMetrics(deps: { signedIn: boolean; metrics: Pick<MetricsRecorder, 'resetToday'> | null; now?: Date }): ResetMetricsReport {
  if (!deps.signedIn || !deps.metrics) return { ok: false, message: 'Not signed in: nothing was changed.' }
  const now = deps.now ?? new Date()
  const row = deps.metrics.resetToday(now)
  return row
    ? { ok: true, message: `Today's metrics row (${localDateKey(now)}) cleared on this device and a zeroed row queued for the server.` }
    : { ok: false, message: 'Could not reset the metrics row.' }
}

export interface ResetNewWordsDeps {
  signedIn: boolean
  /** The latest settings, read now. */
  getSettings: () => UserSettings
  /** Optimistic: mirror the patch into the in-memory settings, so Home and Learn see it at once. */
  applySettings: (patch: SettingsPatch) => void
  queue: { enqueueSettings: (patch: SettingsPatch) => void }
  now?: Date
}

export interface ResetNewWordsReport {
  /** The count that was cleared (0 when there was nothing to clear). */
  cleared: number
  message: string
}

/**
 * Sets today's new-word count back to 0 so the daily limit no longer blocks Learn. It is the same settings
 * write Learn itself makes (new_words_learned_today_count and _date), through the normal write queue; the
 * streak, the limit and every other setting are left alone. Does nothing unless signed in.
 */
export function resetTodayNewWords(deps: ResetNewWordsDeps): ResetNewWordsReport {
  if (!deps.signedIn) return { cleared: 0, message: 'Not signed in: nothing was changed.' }
  const now = deps.now ?? new Date()
  const settings = deps.getSettings()
  const learned = learnedToday(settings, now)
  if (learned === 0) return { cleared: 0, message: `Today's new-word count is already 0 (limit ${settings.dailyNewWordLimit}): nothing was changed.` }

  const patch: SettingsPatch = { new_words_learned_today_count: 0, new_words_learned_today_date: localDateKey(now) }
  deps.applySettings(patch)
  deps.queue.enqueueSettings(patch)
  return { cleared: learned, message: `Today's new-word count reset from ${learned} to 0 (limit ${settings.dailyNewWordLimit}): Learn is available again.` }
}
