import { canStar } from './starred'
import type { SettingsPatch, UserSettings, Word } from './types'

// The one-time hints: the coach-mark tour on Home (new people), the bubble on Home's Word of the day row (people who already learn), and the bubble on a word's "add to the
// learning queue" button. What was shown is remembered in one key of the settings blob, a list of ids (like whats_new_seen): it follows the account across devices, and
// "Show hints again" in Settings removes the key.

/** The settings-blob key: a list of the ids below (and any a later version adds; they are kept). */
export const HINTS_SEEN_KEY = 'hints_seen'

export type HintId = 'tour' | 'home-wotd' | 'word-queue'

/** What the tour covers: seeing or skipping it also counts as seeing the bubble on the Word of the day, which it already explained. */
export const TOUR_FLAGS: readonly HintId[] = ['tour', 'home-wotd']

/** The ids in the blob's value, once each; anything that is not a list of strings is none. */
export function parseHintsSeen(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((v): v is string => typeof v === 'string'))]
}

const seen = (settings: Pick<UserSettings, 'hintsSeen'>, id: HintId) => settings.hintsSeen.includes(id)

/** The patch that marks hints as seen (read from the latest settings), or null when all of them already are. */
export function hintSeenPatch(settings: Pick<UserSettings, 'hintsSeen'>, ...ids: readonly HintId[]): SettingsPatch | null {
  const add = ids.filter((id) => !seen(settings, id))
  return add.length === 0 ? null : { [HINTS_SEEN_KEY]: [...settings.hintsSeen, ...add] }
}

/** "Show hints again": the key goes out of the blob (a null value removes a key). */
export const hintsResetPatch = (): SettingsPatch => ({ [HINTS_SEEN_KEY]: null })

/** Whether the person has started learning: some word has been through Learn (hiding or starring words is not that). */
export const hasProgress = (words: readonly Pick<Word, 'repetitions'>[]): boolean => words.some((w) => w.repetitions > 0)

export type HomeHint = 'tour' | 'wotd'

/**
 * What Home shows once, decided when it first has the data: the tour for a person with no progress (who has not had it), the bubble on the Word of the day for one who already
 * learns (who has had neither; the tour covers the bubble). `replay` is "Show hints again": the tour, whatever the progress.
 */
export function homeHint({ words, settings, replay }: { words: readonly Pick<Word, 'repetitions'>[]; settings: Pick<UserSettings, 'hintsSeen'>; replay: boolean }): HomeHint | null {
  if (replay) return 'tour'
  if (seen(settings, 'tour')) return null
  if (!hasProgress(words)) return 'tour'
  return seen(settings, 'home-wotd') ? null : 'wotd'
}

/** Whether a word's page shows the bubble on its queue button: the button is there (a word Learn can still teach, not queued yet) and the bubble has not been shown. */
export const wordQueueHint = ({ word, settings }: { word: Word; settings: Pick<UserSettings, 'hintsSeen'> }): boolean => canStar(word) && !word.isFavorite && !seen(settings, 'word-queue')
