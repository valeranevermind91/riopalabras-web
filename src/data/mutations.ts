import { mergeSettingsRaw, parseSettings } from './settings'
import type { ProgressUpdate, SettingsPatch, UserSettings, Word } from './types'
import { compareByRank, wordKey } from './words'

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

/** Pure: merges a patch over the full settings blob (unknown keys survive; a key patched to null is removed) and re-parses it. */
export function applySettingsPatch(settings: UserSettings, patch: SettingsPatch): UserSettings {
  return parseSettings(mergeSettingsRaw(settings.raw, patch))
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

/** Pure: sets (or clears) the hidden flag of the given words (matched by wordKey); the same list back if nothing changes. */
export function applyHiddenFlag(words: readonly Word[], esWords: readonly string[], hidden: boolean): readonly Word[] {
  const keys = new Set(esWords.map(wordKey))
  if (keys.size === 0) return words
  let changed = false
  const next = words.map((word) => {
    if (!keys.has(wordKey(word.esWord)) || word.isHidden === hidden) return word
    changed = true
    return Object.freeze({ ...word, isHidden: hidden })
  })
  return changed ? Object.freeze(next) : words
}

/** Pure: sets (or clears) the favourite flag of the given words (matched by wordKey); the same list back if nothing changes. */
export function applyFavoriteFlag(words: readonly Word[], esWords: readonly string[], favorite: boolean): readonly Word[] {
  const keys = new Set(esWords.map(wordKey))
  if (keys.size === 0) return words
  let changed = false
  const next = words.map((word) => {
    if (!keys.has(wordKey(word.esWord)) || word.isFavorite === favorite) return word
    changed = true
    return Object.freeze({ ...word, isFavorite: favorite })
  })
  return changed ? Object.freeze(next) : words
}

/**
 * Pure: puts a custom word in the list. A word already there (same key) keeps its progress and flags and takes the new
 * content; a new one is added in its place in the rank order (custom words, having no rank, sort after the ranked ones).
 */
export function upsertCustomWord(words: readonly Word[], incoming: Word): readonly Word[] {
  const key = wordKey(incoming.esWord)
  const at = words.findIndex((w) => wordKey(w.esWord) === key)
  if (at < 0) return Object.freeze([...words, Object.freeze(incoming)].sort(compareByRank))
  const existing = words[at]
  const next = [...words]
  next[at] = Object.freeze({
    ...existing,
    esWord: incoming.esWord,
    esRioplatense: incoming.esRioplatense,
    enTranslation: incoming.enTranslation,
    ruTranslation: incoming.ruTranslation,
    exampleSentence: incoming.exampleSentence,
    exampleTranslationEn: incoming.exampleTranslationEn,
    exampleTranslationRu: incoming.exampleTranslationRu,
    isRioplatenseVariant: incoming.isRioplatenseVariant,
    region: incoming.region,
    register: incoming.register,
    esStandard: incoming.esStandard,
    pos: incoming.pos,
    isEnriched: incoming.isEnriched,
  })
  return Object.freeze(next)
}

/** Pure: takes a custom word out of the list (matched by wordKey); the same list back if it is not there. Dictionary words are never removed. */
export function removeCustomWord(words: readonly Word[], esWord: string): readonly Word[] {
  const key = wordKey(esWord)
  const next = words.filter((w) => !(w.isCustom && wordKey(w.esWord) === key))
  return next.length === words.length ? words : Object.freeze(next)
}
