import { isInLearnPool } from './stats'
import type { SettingsPatch, UserSettings, Word } from './types'
import { wordKey } from './words'

// The Learn queue: words the user asked to be taught next. It lives in the settings blob under `learn_picks`, exactly as the
// Flutter app keeps it: an ORDERED list of es_word, trimmed and lowercased (HiveService.learnPicks). The blob is shared with
// that app, so the shape does not change: nothing but plain strings, oldest first, appended at the end.
//
// Flutter's rules, which this follows: a word is added at the end (a second add is a no-op); a word leaves the list when the
// batch it was in is COMPLETED (never when it is only drawn), or when the user takes it out; a pick that went stale (the word
// was learned some other way, hidden, or deleted) is not served and is not an error, but it is also not cleaned out of the list
// until a batch teaches it. The one difference is the cap: Flutter has none, the web client refuses a 51st word.

export const LEARN_PICKS_KEY = 'learn_picks'
export const MAX_LEARN_PICKS = 50

/** The queue as Learn serves it: stored order, only the words that can still be taught (each once). */
export function livePicks(words: readonly Word[], picks: readonly string[]): Word[] {
  if (picks.length === 0) return []
  const byKey = new Map<string, Word>()
  for (const word of words) byKey.set(wordKey(word.esWord), word)
  const seen = new Set<string>()
  const live: Word[] = []
  for (const pick of picks) {
    const key = wordKey(pick)
    if (seen.has(key)) continue
    seen.add(key)
    const word = byKey.get(key)
    if (word && isInLearnPool(word)) live.push(word)
  }
  return live
}

/** Only a word that is not started (and could be taught: not hidden, not reference-only) can be queued. */
export const isQueueable = isInLearnPool

/** 1-based place of the word in the live queue, or null when it is not queued. */
export function queuePosition(live: readonly Word[], word: Word): number | null {
  const key = wordKey(word.esWord)
  const at = live.findIndex((w) => wordKey(w.esWord) === key)
  return at < 0 ? null : at + 1
}

export type AddResult = { ok: true; patch: SettingsPatch; position: number } | { ok: false; reason: 'full' | 'not-startable' | 'already' }

/** Appends the word to the queue: the patch to save and the place it takes, or why it cannot be added. */
export function addToQueue(settings: UserSettings, words: readonly Word[], word: Word): AddResult {
  if (!isQueueable(word)) return { ok: false, reason: 'not-startable' }
  const key = wordKey(word.esWord)
  const live = livePicks(words, settings.learnPicks)
  if (live.some((w) => wordKey(w.esWord) === key)) return { ok: false, reason: 'already' }
  if (live.length >= MAX_LEARN_PICKS) return { ok: false, reason: 'full' }
  // The stored list is kept as it is (stale entries included, as Flutter keeps them); the word goes on the end of it.
  const stored = settings.learnPicks.filter((p) => wordKey(p) !== key)
  return { ok: true, patch: { [LEARN_PICKS_KEY]: [...stored, key] }, position: live.length + 1 }
}

/** Takes the word out of the queue, keeping the order of the rest; null when it was not in the stored list. */
export function removeFromQueue(settings: UserSettings, word: Word): SettingsPatch | null {
  return removeKeys(settings, [word.esWord])
}

/** Takes every one of these words out of the stored list (what a completed batch has taught); null when none was in it. */
export function removeKeys(settings: UserSettings, esWords: readonly string[]): SettingsPatch | null {
  const gone = new Set(esWords.map(wordKey))
  const kept = settings.learnPicks.filter((p) => !gone.has(wordKey(p)))
  return kept.length === settings.learnPicks.length ? null : { [LEARN_PICKS_KEY]: kept }
}

/** Puts a word back in the stored list at `at` (clamped), for Undo of "already know it" on a queued word. */
export function restoreKey(settings: UserSettings, esWord: string, at: number): SettingsPatch | null {
  const key = wordKey(esWord)
  if (settings.learnPicks.some((p) => wordKey(p) === key)) return null
  const next = [...settings.learnPicks]
  next.splice(Math.max(0, Math.min(at, next.length)), 0, key)
  return { [LEARN_PICKS_KEY]: next }
}

/** Where the word sits in the stored list (not the live one), or -1. */
export const storedIndex = (settings: UserSettings, esWord: string): number => settings.learnPicks.findIndex((p) => wordKey(p) === wordKey(esWord))

export interface QueueDeps {
  /** The latest settings (read at the moment of the tap, so two quick taps both count). */
  getSettings: () => UserSettings
  words: readonly Word[]
  applySettings: (patch: SettingsPatch) => void
  queue: { enqueueSettings: (patch: SettingsPatch) => void }
}

export type ToggleResult = { done: 'queued'; position: number } | { done: 'removed' } | { done: 'refused'; reason: 'full' | 'not-startable' }

/** The detail's button: queues the word, or takes it out when it is queued. Saved at once and sent through the settings lane of the write queue. */
export function toggleQueued(word: Word, deps: QueueDeps): ToggleResult {
  const settings = deps.getSettings()
  const live = livePicks(deps.words, settings.learnPicks)
  if (queuePosition(live, word) !== null) {
    const patch = removeFromQueue(settings, word)
    if (patch) {
      deps.applySettings(patch)
      deps.queue.enqueueSettings(patch)
    }
    return { done: 'removed' }
  }
  const added = addToQueue(settings, deps.words, word)
  // ('already' cannot happen here: a queued word took the branch above)
  if (!added.ok) return { done: 'refused', reason: added.reason === 'full' ? 'full' : 'not-startable' }
  deps.applySettings(added.patch)
  deps.queue.enqueueSettings(added.patch)
  return { done: 'queued', position: added.position }
}
