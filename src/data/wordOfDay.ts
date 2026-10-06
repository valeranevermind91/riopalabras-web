import { headword, highlightTarget, type HighlightRange } from './headword'
import { localDateKey } from './dates'
import { clozeCueLines } from './practice'
import type { UserSettings, Word } from './types'

// The word of the day: one word per local date, chosen from the Rioplatense overlay entries that
// have an example sentence. No network, no new data file, and nothing about the user's progress:
// the same date gives the same word for everyone, whatever they have learned.

/** FNV-1a, 32 bit: a small, stable string hash (the pick must not change between runs or devices). */
export function hashString(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Overlay words with an example whose target word can be located (so it can be highlighted), in a fixed order independent of the dictionary's. */
export function wordOfTheDayPool(words: readonly Word[]): Word[] {
  return words
    .filter((w) => w.rio?.example && highlightTarget(w).range !== null)
    .sort((a, b) => (a.esWord.toLowerCase() < b.esWord.toLowerCase() ? -1 : a.esWord.toLowerCase() > b.esWord.toLowerCase() ? 1 : 0))
}

/**
 * The word for a local date. The date picks a place in the fixed candidate list; a word the user has marked as
 * known (hidden) is never shown, so if the pick is one the search moves on to the next candidate, wrapping at the
 * end of the list. That keeps the day's word the same as ever unless it is a known one, and the same hidden words
 * always lead to the same fallback. Null when no candidate is left (none have an example, or all are known).
 */
export function pickWordOfTheDay(words: readonly Word[], now: Date): Word | null {
  const pool = wordOfTheDayPool(words)
  if (pool.length === 0) return null
  const start = hashString(localDateKey(now)) % pool.length
  for (let step = 0; step < pool.length; step++) {
    const word = pool[(start + step) % pool.length]
    if (!word.isHidden) return word
  }
  return null
}

export interface WordOfTheDay {
  word: Word
  /** The card's headword (the Rioplatense form where the card leads with it). */
  headword: string
  sentence: string
  /** The target word inside `sentence`, for the amber highlight. */
  range: HighlightRange
  /** The word's translation per the translation settings (RU first), one entry per language shown. */
  translations: string[]
}

export function wordOfTheDay(words: readonly Word[], settings: Pick<UserSettings, 'showRuTranslation' | 'showEnTranslation'>, now: Date): WordOfTheDay | null {
  const word = pickWordOfTheDay(words, now)
  if (!word) return null
  const { sentence, range } = highlightTarget(word)
  if (!range) return null
  return { word, headword: headword(word).text, sentence, range, translations: clozeCueLines(word, settings).map((l) => l.text) }
}
