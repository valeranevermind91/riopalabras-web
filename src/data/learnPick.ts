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
  /** Where the word stood in the stored learn_picks when it was marked as known (it left the queue then), or null if it was not queued. */
  queuedAt: number | null
}

export interface BatchPick {
  /** The words to learn, in the order they are shown. */
  readonly words: readonly Word[]
  /** The stratum each word was drawn from (parallel to `words`); QUEUED for a word the user queued. */
  readonly strata: readonly number[]
  /** The candidates: the next WINDOW_SIZE unlearned words in rank order, one card per headword. */
  readonly window: readonly Word[]
  /** The stratum of each window word (parallel to `window`). */
  readonly windowStrata: readonly number[]
  /** Everything after the window, in rank order: used only to widen a search for a single slot. */
  readonly reserve: readonly Word[]
  /** Queued words that did not fit in this batch, in queue order: the next one takes the place of a queued word marked as known. */
  readonly overflow: readonly Word[]
  /** Words marked as known during this batch, newest last. */
  readonly known: readonly KnownRecord[]
  /** The local date the picks are seeded with. */
  readonly dayKey: string
  /** The number of strata (the batch size the day asked for). */
  readonly size: number
}

/** The "stratum" of a word that leads the batch because the user queued it: it was not drawn from the window. */
export const QUEUED = -1

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
 * Draws `size` words. Words the user queued (`queued`: eligible, in the order they were queued) come first, up to `size`; the rest
 * of the batch is drawn from the pool: unlearned, eligible, in rank order, giving a window of the first WINDOW_SIZE; the window is
 * cut into one stratum per remaining slot; each stratum contributes the word with the lowest hash of (local date, word). That makes
 * the filler a pure function of the user's state (which words are still unlearned, and the queue) and the date, so reopening Learn
 * the same day brings the same batch back, and removing one word from the pool leaves the other picks almost untouched. Queued words
 * are never drawn as filler, whether or not they fit today.
 *
 * At least one Rioplatense overlay word is included whenever the batch can hold one: a queued overlay word counts, and then the
 * filler adds none. Otherwise, if the draw missed them all, the overlay word with the lowest hash replaces the pick of the stratum it
 * sits in. If the window has none, the search is widened for that single slot only: the nearest overlay word after the window (in
 * rank order) takes the slot of the last stratum. A batch made only of queued words is the user's own choice and is left alone.
 */
export function pickBatch(pool: readonly Word[], size: number, now: Date, queued: readonly Word[] = []): BatchPick {
  const dayKey = localDateKey(now)
  const line = uniqueByHeadword(queued)
  const lead = line.slice(0, Math.max(0, size))
  const overflow = line.slice(lead.length)
  const queuedKeys = new Set(line.map((w) => w.esWord.toLowerCase()))
  const leadHeadwords = new Set(lead.map(keyOf))
  const candidates = uniqueByHeadword(queuedKeys.size === 0 ? pool : pool.filter((w) => !queuedKeys.has(w.esWord.toLowerCase()) && !leadHeadwords.has(keyOf(w))))
  const window = candidates.slice(0, WINDOW_SIZE)
  const reserve = candidates.slice(WINDOW_SIZE)
  const n = Math.min(size - lead.length, window.length)
  const windowStrata = window.map((_, i) => stratumOf(i, window.length, Math.max(n, 1)))

  const picks: (Word | null)[] = []
  for (const [start, end] of strataBounds(window.length, n)) {
    let best: Word | null = null
    for (let i = start; i < end; i++) {
      if (!best || rankHash(dayKey, window[i]) < rankHash(dayKey, best)) best = window[i]
    }
    picks.push(best)
  }

  if (n > 0 && !lead.some(isRioplatense) && !picks.some((w) => w && isRioplatense(w))) {
    const inWindow = window.map((w, i) => ({ w, i })).filter(({ w }) => isRioplatense(w))
    if (inWindow.length > 0) {
      const { w, i } = inWindow.reduce((a, b) => (rankHash(dayKey, b.w) < rankHash(dayKey, a.w) ? b : a))
      picks[windowStrata[i]] = w
    } else {
      const widened = reserve.find(isRioplatense)
      if (widened) picks[n - 1] = widened
    }
  }

  // The filler is shown in a day-seeded mixed order, so the most common word is not always the first card; queued words lead it, in queue order.
  const order = picks.map((word, stratum) => ({ word: word!, stratum })).sort((a, b) => rankHash(dayKey, a.word) - rankHash(dayKey, b.word))
  return {
    words: [...lead, ...order.map((o) => o.word)],
    strata: [...lead.map(() => QUEUED), ...order.map((o) => o.stratum)],
    window,
    windowStrata,
    reserve,
    overflow,
    known: [],
    dayKey,
    size: n,
  }
}

/**
 * "Already know it": takes the word at `index` out of the batch and puts the next candidate in its place,
 * so the batch keeps its size. The candidate is the best unused one from the same stratum, then from the
 * nearest strata, then from the rest of the window, and only then from beyond it. If removing the word left
 * the batch without a Rioplatense word, a Rioplatense candidate is preferred (widening the search past the
 * window if needed). With no candidate left the batch gets shorter.
 *
 * A queued word is replaced by the next queued word that did not fit (it joins the end of the queued words at the front), and
 * only when there is none by a filler candidate (any stratum; it goes to the end of the batch, behind the queued words).
 */
export function replaceKnown(batch: BatchPick, index: number): BatchPick {
  const word = batch.words[index]
  if (!word) return batch
  const stratum = batch.strata[index]
  const wasQueued = stratum === QUEUED

  const taken = new Set([...batch.words, ...batch.known.map((k) => k.word)].map((w) => w.esWord.toLowerCase()))
  const used = new Set(batch.words.filter((_, i) => i !== index).map(keyOf))
  const free = (w: Word) => !taken.has(w.esWord.toLowerCase()) && !used.has(keyOf(w))

  // A queued word has no stratum to keep: every filler candidate is equally near (then the lowest hash wins).
  const distanceTo = (s: number) => (wasQueued ? 0 : Math.abs(s - stratum))
  const needRio = !batch.words.some((w, i) => i !== index && isRioplatense(w))
  const fromOverflow = (rioOnly: boolean): { w: Word; s: number } | null => {
    const w = wasQueued ? batch.overflow.find((c) => free(c) && (!rioOnly || isRioplatense(c))) : undefined
    return w ? { w, s: QUEUED } : null
  }
  const fromWindow = (rioOnly: boolean): { w: Word; s: number } | null => {
    let best: { w: Word; s: number; distance: number } | null = null
    for (let i = 0; i < batch.window.length; i++) {
      const w = batch.window[i]
      if (!free(w) || (rioOnly && !isRioplatense(w))) continue
      const s = batch.windowStrata[i]
      const distance = distanceTo(s)
      if (best === null || distance < best.distance || (distance === best.distance && rankHash(batch.dayKey, w) < rankHash(batch.dayKey, best.w))) best = { w, s, distance }
    }
    return best === null ? null : { w: best.w, s: best.s }
  }
  const fromReserve = (rioOnly: boolean): { w: Word; s: number } | null => {
    const w = batch.reserve.find((c) => free(c) && (!rioOnly || isRioplatense(c)))
    return w ? { w, s: stratum } : null
  }

  // The next queued word first, but a batch that would be left without a Rioplatense word takes one before anything else.
  let chosen: { w: Word; s: number } | null = null
  if (needRio) chosen = fromOverflow(true) ?? fromWindow(true) ?? fromReserve(true)
  chosen ??= fromOverflow(false) ?? fromWindow(false) ?? fromReserve(false)

  const record: KnownRecord = { word, index, stratum, replacement: chosen?.w ?? null, queuedAt: null }
  const words = [...batch.words]
  const strata = [...batch.strata]
  let overflow = batch.overflow
  if (!wasQueued) {
    if (chosen) {
      words[index] = chosen.w
      strata[index] = chosen.s
    } else {
      words.splice(index, 1)
      strata.splice(index, 1)
    }
  } else {
    words.splice(index, 1)
    strata.splice(index, 1)
    if (chosen) {
      // after the last queued word if it is another queued word, else at the very end
      const at = chosen.s === QUEUED ? strata.lastIndexOf(QUEUED) + 1 : words.length
      words.splice(at, 0, chosen.w)
      strata.splice(at, 0, chosen.s)
      if (chosen.s === QUEUED) overflow = overflow.filter((w) => w !== chosen!.w)
    }
  }
  return { ...batch, words, strata, overflow, known: [...batch.known, record] }
}

/** Undo for the most recent "already know it": the word returns to its place and its replacement goes back to the candidates. */
export function restoreKnown(batch: BatchPick): BatchPick {
  const last = batch.known[batch.known.length - 1]
  if (!last) return batch
  const words = [...batch.words]
  const strata = [...batch.strata]
  let overflow = batch.overflow
  if (last.replacement) {
    const at = words.findIndex((w) => w.esWord.toLowerCase() === last.replacement!.esWord.toLowerCase())
    if (last.stratum === QUEUED && at >= 0) {
      // the replacement moves out again (a queued one back to the front of those waiting), the word goes back where it stood
      if (strata[at] === QUEUED) overflow = [words[at], ...overflow]
      words.splice(at, 1)
      strata.splice(at, 1)
      const position = Math.min(last.index, words.length)
      words.splice(position, 0, last.word)
      strata.splice(position, 0, last.stratum)
    } else {
      const position = at >= 0 ? at : Math.min(last.index, words.length - 1)
      words[position] = last.word
      strata[position] = last.stratum
    }
  } else {
    const position = Math.min(last.index, words.length)
    words.splice(position, 0, last.word)
    strata.splice(position, 0, last.stratum)
  }
  return { ...batch, words, strata, overflow, known: batch.known.slice(0, -1) }
}
