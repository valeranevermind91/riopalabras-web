import { headword, highlightTarget, type HighlightRange } from './headword'
import { clozeCueLines } from './practice'
import type { UserSettings, Word } from './types'

// The word of the day: one word per local date, chosen from the Rioplatense overlay entries whose card has an example it can highlight (the
// overlay's own, or else the dictionary's, exactly as the card shows it). No network, no new data file, and nothing about the user's progress:
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

/**
 * Registers that never come up as the word of the day: it sits on the home screen and is seen in passing, so a vulgar, offensive or
 * pejorative word has no place there (it is still in Learn, Review and the Words screen, where the user chose to be).
 */
export const KEPT_OFF_HOME = ['vulgar', 'offensive', 'pejorative']

/**
 * Every overlay entry whose card can highlight its example (the overlay's own example, or the dictionary's when there is none: the same one the
 * card shows), except the ones kept off the home screen. In a fixed order independent of the dictionary's.
 */
export function wordOfTheDayPool(words: readonly Word[]): Word[] {
  return words
    .filter((w) => w.rio && !KEPT_OFF_HOME.includes(w.rio.register) && highlightTarget(w).range !== null)
    .sort((a, b) => (a.esWord.toLowerCase() < b.esWord.toLowerCase() ? -1 : a.esWord.toLowerCase() > b.esWord.toLowerCase() ? 1 : 0))
}

/** The whole number of days from 1970-01-01 to this LOCAL calendar date: the same all day, and one more each local midnight (daylight saving cannot skip or repeat one). */
export function dayNumber(now: Date): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000)
}

/**
 * The fixed order the words come in: a permutation of the pool, by a hash of each word's own name (ties by the name). Because the order is
 * decided word by word, adding a word to the pool puts it somewhere without reshuffling the others.
 */
export function wordOfTheDayOrder(pool: readonly Word[]): Word[] {
  const key = (w: Word) => hashString(`word-of-the-day|${w.esWord.toLowerCase()}`)
  return [...pool].sort((a, b) => key(a) - key(b) || (a.esWord.toLowerCase() < b.esWord.toLowerCase() ? -1 : 1))
}

// The candidates (the ordered pool without the known words) for a words array. The app replaces the array whenever a word changes and never edits
// one, so the array itself is the key: the list is built once for it, not on every call (Home asks on every render).
const candidateCache = new WeakMap<readonly Word[], readonly Word[]>()
function candidatesFor(words: readonly Word[]): readonly Word[] {
  let candidates = candidateCache.get(words)
  if (!candidates) {
    candidates = wordOfTheDayOrder(wordOfTheDayPool(words)).filter((w) => !w.isHidden)
    candidateCache.set(words, candidates)
  }
  return candidates
}

/**
 * The word for a local date: the day number indexes into the fixed order of the words that are not known, so every word comes once before any
 * comes again (a cycle as long as the list), and the same date gives the same word for everyone. (A date's pick used to be a hash of the date
 * on its own, so two days could land on the same word however many there were, and a known word's days all fell on the next one.) A word
 * the user has marked as known (hidden) is never shown: it leaves the list, so the cycle is one day shorter and from that day on the days shift
 * (a word is skipped; while the list stays as it is no word comes twice in a cycle, but on the day the list changes the pick can be any word). Null
 * when no candidate is left (none have an example, or all are known).
 */
export function pickWordOfTheDay(words: readonly Word[], now: Date): Word | null {
  const candidates = candidatesFor(words)
  if (candidates.length === 0) return null
  return candidates[dayNumber(now) % candidates.length]
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
