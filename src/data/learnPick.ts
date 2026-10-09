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

/**
 * With a start rank (the placement test), roughly this share of the batch comes from the words below it instead: the test is crude, so
 * the start is a bias, not a wall. Rounded so a batch of 10 takes 3 and a batch of 3 takes 1.
 */
export const LOWER_SHARE = 0.3
export const lowerShare = (slots: number) => Math.round(slots * LOWER_SHARE)

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
  /** The number of strata of the window (the filler the day asked for, less the words taken from below the start rank). */
  readonly size: number
  /** With a start rank: every candidate below it, in rank order, one card per headword (empty when the batch takes none from there). */
  readonly lowWindow: readonly Word[]
  /** The stratum of each lowWindow word: equal slices of the whole skipped range, not of its start. */
  readonly lowStrata: readonly number[]
  /** The number of strata of lowWindow: the words the batch takes from below the start rank. */
  readonly lowSize: number
}

/** The "stratum" of a word that leads the batch because the user queued it: it was not drawn from the window. */
export const QUEUED = -1

// A word drawn from below the start rank carries -2 - (its stratum in lowWindow), so it can't be mistaken for a window stratum or QUEUED.
export const lowerStratum = (s: number) => -2 - s
export const isLowerStratum = (stratum: number) => stratum <= -2
const lowerIndex = (stratum: number) => -2 - stratum

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
export function pickBatch(pool: readonly Word[], size: number, now: Date, queued: readonly Word[] = [], below: readonly Word[] = []): BatchPick {
  const dayKey = localDateKey(now)
  const line = uniqueByHeadword(queued)
  const lead = line.slice(0, Math.max(0, size))
  const overflow = line.slice(lead.length)
  const queuedKeys = new Set(line.map((w) => w.esWord.toLowerCase()))
  const leadHeadwords = new Set(lead.map(keyOf))
  const unqueued = (list: readonly Word[]) => uniqueByHeadword(queuedKeys.size === 0 ? list : list.filter((w) => !queuedKeys.has(w.esWord.toLowerCase()) && !leadHeadwords.has(keyOf(w))))
  const allCandidates = unqueued(pool)
  const slots = Math.max(0, size - lead.length)

  // Below the start rank: its share of the filler, spread over the whole skipped range. A range with less in it than the share (or none) gives
  // what it has, and the window fills the rest; a window with less in it than the slots left asks the range for more.
  const lowAll = below.length > 0 ? unqueued(below) : []
  const m = Math.min(lowAll.length, Math.max(lowerShare(slots), slots - allCandidates.length))
  const lowPicks = pickPerStratum(lowAll, m, dayKey)
  const lowStrata = lowAll.map((_, i) => stratumOf(i, lowAll.length, Math.max(m, 1)))
  const lowKeys = new Set(lowPicks.map((w) => keyOf(w!)))
  const candidates = lowKeys.size === 0 ? allCandidates : allCandidates.filter((w) => !lowKeys.has(keyOf(w)))

  const window = candidates.slice(0, WINDOW_SIZE)
  const reserve = candidates.slice(WINDOW_SIZE)
  const n = Math.min(slots - m, window.length)
  const windowStrata = window.map((_, i) => stratumOf(i, window.length, Math.max(n, 1)))
  const picks = pickPerStratum(window, n, dayKey)

  if (n + m > 0 && !lead.some(isRioplatense) && !picks.some((w) => w && isRioplatense(w)) && !lowPicks.some((w) => w && isRioplatense(w))) {
    const lowestHash = (list: { w: Word; i: number }[]) => list.reduce((a, b) => (rankHash(dayKey, b.w) < rankHash(dayKey, a.w) ? b : a))
    const inWindow = window.map((w, i) => ({ w, i })).filter(({ w }) => isRioplatense(w))
    const inLow = m > 0 ? lowAll.map((w, i) => ({ w, i })).filter(({ w }) => isRioplatense(w)) : []
    if (inWindow.length > 0 && n > 0) {
      const { w, i } = lowestHash(inWindow)
      picks[windowStrata[i]] = w
    } else if (inLow.length > 0) {
      const { w, i } = lowestHash(inLow)
      lowPicks[lowStrata[i]] = w
    } else {
      const widened = reserve.find(isRioplatense)
      if (widened && n > 0) picks[n - 1] = widened
    }
  }

  // The filler is shown in a day-seeded mixed order, so the most common word is not always the first card (and the easy ones are not
  // bunched); queued words lead it, in queue order.
  const filler = [
    ...picks.map((word, stratum) => ({ word: word!, stratum })),
    ...lowPicks.map((word, stratum) => ({ word: word!, stratum: lowerStratum(stratum) })),
  ].sort((a, b) => rankHash(dayKey, a.word) - rankHash(dayKey, b.word))
  return {
    words: [...lead, ...filler.map((o) => o.word)],
    strata: [...lead.map(() => QUEUED), ...filler.map((o) => o.stratum)],
    window,
    windowStrata,
    reserve,
    overflow,
    known: [],
    dayKey,
    size: n,
    lowWindow: m > 0 ? lowAll : [],
    lowStrata: m > 0 ? lowStrata : [],
    lowSize: m,
  }
}

/** One word per stratum of `list` cut into `count` equal slices: the one with the lowest hash of (local date, word). */
function pickPerStratum(list: readonly Word[], count: number, dayKey: string): (Word | null)[] {
  const picks: (Word | null)[] = []
  for (const [start, end] of strataBounds(list.length, count)) {
    let best: Word | null = null
    for (let i = start; i < end; i++) {
      if (!best || rankHash(dayKey, list[i]) < rankHash(dayKey, best)) best = list[i]
    }
    picks.push(best)
  }
  return picks
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

  // A queued word has no stratum to keep: every filler candidate is equally near (then the lowest hash wins). A word from below the start rank is
  // replaced from there first (the stratum is its slice of the skipped range), and from the window when that range has nothing left.
  const wasLower = isLowerStratum(stratum)
  const needRio = !batch.words.some((w, i) => i !== index && isRioplatense(w))
  const fromOverflow = (rioOnly: boolean): { w: Word; s: number } | null => {
    const w = wasQueued ? batch.overflow.find((c) => free(c) && (!rioOnly || isRioplatense(c))) : undefined
    return w ? { w, s: QUEUED } : null
  }
  // The best unused candidate of one list: nearest stratum to `near` (null: no preference), then the lowest hash.
  const nearest = (list: readonly Word[], listStrata: readonly number[], encode: (s: number) => number, near: number | null, rioOnly: boolean): { w: Word; s: number } | null => {
    let best: { w: Word; s: number; distance: number } | null = null
    for (let i = 0; i < list.length; i++) {
      const w = list[i]
      if (!free(w) || (rioOnly && !isRioplatense(w))) continue
      const s = listStrata[i]
      const distance = near === null ? 0 : Math.abs(s - near)
      if (best === null || distance < best.distance || (distance === best.distance && rankHash(batch.dayKey, w) < rankHash(batch.dayKey, best.w))) best = { w, s, distance }
    }
    return best === null ? null : { w: best.w, s: encode(best.s) }
  }
  const fromWindow = (rioOnly: boolean): { w: Word; s: number } | null =>
    nearest(batch.window, batch.windowStrata, (s) => s, wasQueued || wasLower ? null : stratum, rioOnly)
  const fromLower = (rioOnly: boolean): { w: Word; s: number } | null =>
    nearest(batch.lowWindow, batch.lowStrata, lowerStratum, wasLower ? lowerIndex(stratum) : null, rioOnly)
  const fromReserve = (rioOnly: boolean): { w: Word; s: number } | null => {
    const w = batch.reserve.find((c) => free(c) && (!rioOnly || isRioplatense(c)))
    return w ? { w, s: wasLower ? Math.max(0, batch.size - 1) : stratum } : null
  }

  // The next queued word first, but a batch that would be left without a Rioplatense word takes one before anything else.
  let chosen: { w: Word; s: number } | null = null
  if (needRio) chosen = fromOverflow(true) ?? (wasLower ? fromLower(true) ?? fromWindow(true) : fromWindow(true) ?? fromLower(true)) ?? fromReserve(true)
  chosen ??= fromOverflow(false) ?? (wasLower ? fromLower(false) ?? fromWindow(false) : fromWindow(false)) ?? fromReserve(false)

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
