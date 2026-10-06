import { localDateKey } from './dates'
import { headword } from './headword'
import type { Word } from './types'
import { hashString } from './wordOfDay'

// Which new words a Learn batch holds. The batch is NOT the head of the frequency queue: it is spread
// over a window of the next candidates, one word from each equal slice of that window (a "stratum"),
// so a day mixes very common words with less common ones. The queue still advances by frequency over
// time, because the window starts at the first word not yet learned (or marked as known).

/** How many of the next unlearned, eligible words (by rank) a batch is drawn from. */
export const WINDOW_SIZE = 150

export interface KnownRecord {
  /** The word that was marked as known (with its place in the batch, for Undo). */
  word: Word
  index: number
  stratum: number
  /** The candidate that took its place, or null when none was left (the batch got shorter). */
  replacement: Word | null
}

export interface BatchPick {
  /** The words to learn, in the order they are shown. */
  readonly words: readonly Word[]
  /** The stratum each word was drawn from (parallel to `words`). */
  readonly strata: readonly number[]
  /** The candidates: the next WINDOW_SIZE unlearned words in rank order, one card per headword. */
  readonly window: readonly Word[]
  /** The stratum of each window word (parallel to `window`). */
  readonly windowStrata: readonly number[]
  /** Everything after the window, in rank order: used only to widen a search for a single slot. */
  readonly reserve: readonly Word[]
  /** Words marked as known during this batch, newest last. */
  readonly known: readonly KnownRecord[]
  /** The local date the picks are seeded with. */
  readonly dayKey: string
  /** The number of strata (the batch size the day asked for). */
  readonly size: number
}

const keyOf = (word: Word) => headword(word).text.toLowerCase()
const isRioplatense = (word: Word) => word.rio !== null

/** Deterministic and stable: the same word on the same day always gets the same number. */
function rankHash(dayKey: string, word: Word): number {
  return hashString(`${dayKey}|${word.esWord.toLowerCase()}`)
}

/** The stratum (0..size-1) of window position `i`: equal slices that differ by at most one word. */
export function stratumOf(i: number, windowLength: number, size: number): number {
  return Math.min(size - 1, Math.floor((i * size) / windowLength))
}

/** [start, end) of each stratum of a window: they tile it exactly. */
export function strataBounds(windowLength: number, size: number): [number, number][] {
  const bounds: [number, number][] = []
  for (let s = 0; s < size; s++) {
    const start = Math.ceil((s * windowLength) / size)
    const end = Math.ceil(((s + 1) * windowLength) / size)
    bounds.push([start, end])
  }
  return bounds
}

/** One card per headword, first in rank order wins (two cards that would show the same headword never share a batch). */
function uniqueByHeadword(pool: readonly Word[]): Word[] {
  const seen = new Set<string>()
  const out: Word[] = []
  for (const word of pool) {
    const key = keyOf(word)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(word)
  }
  return out
}

/**
 * Draws `size` words: the pool (unlearned, eligible, in rank order) gives a window of the first
 * WINDOW_SIZE; the window is cut into `size` equal strata; each stratum contributes the word with the
 * lowest hash of (local date, word). That makes the batch a pure function of the user's state (which words
 * are still unlearned) and the date, so reopening Learn the same day brings the same batch back, and removing
 * one word from the pool leaves the other picks almost untouched.
 *
 * At least one Rioplatense overlay word is included whenever the window has one: if the draw missed them all,
 * the overlay word with the lowest hash replaces the pick of the stratum it sits in. If the window has none,
 * the search is widened for that single slot only: the nearest overlay word after the window (in rank order)
 * takes the slot of the last stratum.
 */
export function pickBatch(pool: readonly Word[], size: number, now: Date): BatchPick {
  const dayKey = localDateKey(now)
  const candidates = uniqueByHeadword(pool)
  const window = candidates.slice(0, WINDOW_SIZE)
  const reserve = candidates.slice(WINDOW_SIZE)
  const n = Math.min(size, window.length)
  const windowStrata = window.map((_, i) => stratumOf(i, window.length, Math.max(n, 1)))

  const picks: (Word | null)[] = []
  for (const [start, end] of strataBounds(window.length, n)) {
    let best: Word | null = null
    for (let i = start; i < end; i++) {
      if (!best || rankHash(dayKey, window[i]) < rankHash(dayKey, best)) best = window[i]
    }
    picks.push(best)
  }

  if (n > 0 && !picks.some((w) => w && isRioplatense(w))) {
    const inWindow = window.map((w, i) => ({ w, i })).filter(({ w }) => isRioplatense(w))
    if (inWindow.length > 0) {
      const { w, i } = inWindow.reduce((a, b) => (rankHash(dayKey, b.w) < rankHash(dayKey, a.w) ? b : a))
      picks[windowStrata[i]] = w
    } else {
      const widened = reserve.find(isRioplatense)
      if (widened) picks[n - 1] = widened
    }
  }

  // The batch is shown in a day-seeded mixed order, so the most common word is not always the first card.
  const order = picks.map((word, stratum) => ({ word: word!, stratum })).sort((a, b) => rankHash(dayKey, a.word) - rankHash(dayKey, b.word))
  return { words: order.map((o) => o.word), strata: order.map((o) => o.stratum), window, windowStrata, reserve, known: [], dayKey, size: n }
}
