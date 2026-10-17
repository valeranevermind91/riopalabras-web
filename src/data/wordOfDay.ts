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

/**
 * Which position of the full ordered pool is shown on the day at position `i` (the day number modulo the pool's size), given which positions the
 * user has marked as known (`hidden`). Null when no word is left.
 *
 * A word that is visible is ALWAYS shown on its own day. Hiding a word therefore changes only the days that word itself fell on, and never the
 * divisor: the day number indexes the whole pool, hidden words included, so every other day, those already shown included, keeps its word.
 *
 * A day on a hidden word needs another word. Skipping forward to the next visible one is the obvious choice and it fails twice: the next day is
 * that word's own, so the same word is shown two days running, and "step on if it is yesterday's" then moves every later day one word on, which
 * is the very shift this exists to prevent (and makes a day's word depend on where the counting began). So the substitute is chosen from the
 * position alone, with no memory of other days:
 *   - it starts half a pool away, so the word that must be shown twice comes back about half a cycle later, not days later;
 *   - for a run of hidden days in a row, each takes the first visible word at or after its own target that is not the previous day's substitute,
 *     and the first and last of the run also avoid the visible words on either side of it. So no two days in a row show the same word.
 * The pool is a circle: the last position is followed by the first. With fewer than three words left no rule can keep two days apart, and the
 * first visible word at or after the target is used.
 */
export function pickIndex(hidden: readonly boolean[], i: number): number | null {
  const n = hidden.length
  if (n === 0) return null
  if (!hidden[i]) return i
  const visible = hidden.reduce((count, h) => count + (h ? 0 : 1), 0)
  if (visible === 0) return null

  // The run of hidden positions that i is in (it ends at a visible position at each side: there is one).
  let start = i
  while (hidden[(start - 1 + n) % n]) start = (start - 1 + n) % n
  let length = 1
  while (hidden[(start + length) % n]) length++
  const before = (start - 1 + n) % n
  const after = (start + length) % n

  const firstVisible = (from: number, avoid: readonly number[]): number | null => {
    for (let step = 0; step < n; step++) {
      const position = (from + step) % n
      if (!hidden[position] && !avoid.includes(position)) return position
    }
    return null
  }
  const half = Math.floor(n / 2)
  let previous = -1
  for (let j = 0; j < length; j++) {
    const avoid = [j === 0 ? before : previous, ...(j === length - 1 ? [after] : [])]
    const target = (start + j + half) % n
    previous = firstVisible(target, avoid) ?? (firstVisible(target, []) as number)
    if ((start + j) % n === i) return previous
  }
  return null // unreachable: i is in the run
}

// The full ordered pool for a words array, and which of its words are known. The app replaces the array whenever a word changes and never edits
// one, so the array itself is the key: the list is built once for it, not on every call (Home asks on every render).
const poolCache = new WeakMap<readonly Word[], { order: readonly Word[]; hidden: readonly boolean[] }>()
function poolFor(words: readonly Word[]): { order: readonly Word[]; hidden: readonly boolean[] } {
  let entry = poolCache.get(words)
  if (!entry) {
    const order = wordOfTheDayOrder(wordOfTheDayPool(words))
    entry = { order, hidden: order.map((w) => w.isHidden) }
    poolCache.set(words, entry)
  }
  return entry
}

/**
 * The word for a local date: the day number indexes into the fixed order of the WHOLE pool, so with nothing marked as known every word comes
 * once before any comes again (a cycle as long as the pool), and the same date gives the same word for everyone. (A date's pick used to be a
 * hash of the date on its own, so two days could land on the same word however many there were. Then it indexed the pool without the known
 * words, so marking one word as known changed the divisor and every day's word moved, days already shown included.) A word the user has marked
 * as known (hidden) is never shown: only the days it fell on get another word (see pickIndex), and no word is shown two days running.
 * Null when no word is left (none have an example, or all are known).
 */
export function pickWordOfTheDay(words: readonly Word[], now: Date): Word | null {
  const { order, hidden } = poolFor(words)
  if (order.length === 0) return null
  const index = pickIndex(hidden, dayNumber(now) % order.length)
  return index === null ? null : order[index]
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
