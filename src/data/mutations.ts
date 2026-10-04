import { parseSettings } from './settings'
import type { ProgressUpdate, SettingsPatch, UserSettings, Word } from './types'
import { wordKey } from './words'

/** Pure: returns a new word list with the updates applied (same order), leaving the input untouched. */
export function applyProgressUpdates(words: readonly Word[], updates: readonly ProgressUpdate[]): readonly Word[] {
  if (updates.length === 0) return words

  const byKey = new Map(updates.map((u) => [wordKey(u.esWord), u]))
  const next = words.map((word) => {
    const update = byKey.get(wordKey(word.esWord))
    if (!update) return word
    return Object.freeze({
      ...word,
      easeFactor: update.easeFactor,
      interval: update.interval,
      repetitions: update.repetitions,
      nextReview: update.nextReview,
    })
  })
  return Object.freeze(next)
}

/** Pure: merges a patch over the full settings blob (unknown keys survive) and re-parses it. */
export function applySettingsPatch(settings: UserSettings, patch: SettingsPatch): UserSettings {
  return parseSettings({ ...settings.raw, ...patch })
}

/** Pure: marks the words in the recovered favorites / hidden lists (matched by wordKey); orphans are ignored. */
export function applyFlagLists(words: readonly Word[], lists: { favorites?: readonly string[]; hidden?: readonly string[] }): readonly Word[] {
  const favorites = new Set((lists.favorites ?? []).map(wordKey))
  const hidden = new Set((lists.hidden ?? []).map(wordKey))
  if (favorites.size === 0 && hidden.size === 0) return words

  return Object.freeze(
    words.map((word) => {
      const key = wordKey(word.esWord)
      const isFavorite = word.isFavorite || favorites.has(key)
      const isHidden = word.isHidden || hidden.has(key)
      return isFavorite === word.isFavorite && isHidden === word.isHidden ? word : Object.freeze({ ...word, isFavorite, isHidden })
    }),
  )
}
