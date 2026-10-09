import { headword } from './headword'
import { isInLearnPool } from './stats'
import type { SettingsPatch, UserSettings, Word } from './types'
import { compareByRank, wordKey } from './words'

// The placement test: find where in the frequency order a person stops knowing words, and start Learn from there.
// 25 words from five bands of five, ascending in rarity; the person marks the ones they know; the first band with two or fewer marked
// decides where Learn starts. (Nothing is right or wrong, and nothing is scored: the marks are the only input.)

export const START_RANK_KEY = 'start_rank'
export const BAND_COUNT = 5
export const BAND_SIZE = 5
/** A band with this many words marked, or fewer, is where the person's vocabulary runs out (of the five shown). */
export const WALL = 2

export interface PlacementBand {
  /** The lowest rank in this band's part of the frequency list: where Learn starts if this band is the wall. */
  readonly startRank: number
  /** Its five words, in the order they are shown. */
  readonly words: readonly Word[]
}

/** Words the test may show: ones Learn could teach (translations in both languages, not learned, not hidden, a part of speech that is drilled), the dictionary's own, ranked. */
export const placementPool = (words: readonly Word[]): Word[] => words.filter((w) => isInLearnPool(w) && !w.isCustom && w.rank !== null).sort(compareByRank)

/**
 * The five bands. The pool, most common first, is cut into five equal parts: band 1 draws from the most frequent part, band 5 from the
 * rare end, the others from the parts between. Within a part the five words are picked at random (so a second run differs), never two
 * with the same headword anywhere in the run. Null when a part has fewer than five words to pick from (a dictionary that is nearly used up).
 */
export function buildPlacement(words: readonly Word[], random: () => number = Math.random): PlacementBand[] | null {
  const pool = placementPool(words)
  const bands: PlacementBand[] = []
  const seen = new Set<string>() // headwords already in this run: a word that reads like another is not shown twice, in any band
  for (let k = 0; k < BAND_COUNT; k++) {
    const part = pool.slice(Math.floor((k * pool.length) / BAND_COUNT), Math.floor(((k + 1) * pool.length) / BAND_COUNT))
    if (part.length < BAND_SIZE) return null
    const order = [...part]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    const picked: Word[] = []
    for (const word of order) {
      const key = wordKey(headword(word).text)
      if (seen.has(key)) continue
      seen.add(key)
      picked.push(word)
      if (picked.length === BAND_SIZE) break
    }
    if (picked.length < BAND_SIZE) return null
    bands.push({ startRank: part[0].rank!, words: picked })
  }
  return bands
}

/**
 * Where Learn starts, from how many words were marked in each band: the first band with two or fewer decides it, and the start is that
 * band's lowest rank. Null when the first band is that band (a beginner: the default start is right). When every band has three or more
 * marked the last band's lowest rank is used. So a lucky mark in a rare band moves nothing, and a real wall in the middle stops it there.
 */
export function startRankFor(counts: readonly number[], bandStarts: readonly number[]): number | null {
  const wall = counts.findIndex((n) => n <= WALL)
  if (wall === 0) return null
  return bandStarts[wall === -1 ? bandStarts.length - 1 : wall] ?? null
}

export interface PlacementResult {
  /** The new start rank, or null when the answers leave it where it is. */
  startRank: number | null
  /** The words marked as known (their es_word, as stored): they are hidden so they never come up. */
  marked: string[]
}

/** What the answers amount to. `selected[k]` holds the es_word marked in band k. */
export function placementResult(bands: readonly PlacementBand[], selected: readonly ReadonlySet<string>[]): PlacementResult {
  const inBand = bands.map((band, k) => band.words.filter((w) => selected[k]?.has(w.esWord)))
  return { startRank: startRankFor(inBand.map((words) => words.length), bands.map((b) => b.startRank)), marked: inBand.flat().map((w) => w.esWord) }
}

export interface PlacementDeps {
  /** The latest settings: whether a start_rank is there to be cleared. */
  getSettings: () => Pick<UserSettings, 'raw'>
  /** Hides words in the in-memory data at once. */
  applyHidden: (esWords: readonly string[], hidden: boolean) => void
  applySettings: (patch: SettingsPatch) => void
  queue: {
    /** All the words in one go (one request, not one per word): the same hidden lane "Already know it" uses. */
    enqueueHiddenBatch: (esWords: readonly string[], hidden: boolean) => void
    enqueueSettings: (patch: SettingsPatch) => void
  }
}

/**
 * Keeps what the test found: `start_rank` through the settings lane (it replaces an earlier one), and the marked words hidden through the
 * hidden lane, in one batch. Taking the test again only ever hides more: nothing is un-hidden. With nothing to keep, nothing is written; a beginner
 * result on a retake clears the start_rank an earlier run left.
 */
export function savePlacement(result: PlacementResult, deps: PlacementDeps): void {
  if (result.marked.length > 0) {
    deps.applyHidden(result.marked, true)
    deps.queue.enqueueHiddenBatch(result.marked, true)
  }
  // A beginner's answers (null) after an earlier result mean that start was too high: the key is removed (patched to null), so Learn starts
  // at the beginning again. With no earlier result there is nothing to clear and nothing is written.
  const patch: SettingsPatch | null = result.startRank !== null ? { [START_RANK_KEY]: result.startRank } : START_RANK_KEY in deps.getSettings().raw ? { [START_RANK_KEY]: null } : null
  if (patch) {
    deps.applySettings(patch)
    deps.queue.enqueueSettings(patch)
  }
}

/**
 * The pool split at the start rank: `window` is what Learn mostly draws from (the pool from the start rank on; custom words, which have no
 * rank, stay in it), `below` the skipped range (unlearned, not hidden, not custom) that a share of every batch is still drawn from, since 25
 * words are a crude test. If nothing is left from the start rank on, the whole pool is the window and nothing is below.
 */
export function splitAtStartRank(pool: readonly Word[], startRank: number | null): { window: readonly Word[]; below: readonly Word[] } {
  if (startRank === null) return { window: pool, below: [] }
  const isBelow = (w: Word) => !w.isCustom && w.rank !== null && w.rank < startRank
  const window = pool.filter((w) => !isBelow(w))
  return window.length > 0 ? { window, below: pool.filter(isBelow) } : { window: pool, below: [] }
}

/** The pool from the start rank on (see splitAtStartRank). */
export function fromStartRank(pool: readonly Word[], startRank: number | null): readonly Word[] {
  return startRank === null ? pool : splitAtStartRank(pool, startRank).window
}
