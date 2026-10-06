import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { parseDictionary } from './dictionary'
import { headword } from './headword'
import { selectLearnBatch } from './learn'
import { WINDOW_SIZE, pickBatch, strataBounds, stratumOf } from './learnPick'
import { parseFallbackExamples, parseRioOverlay } from './rio'
import { parseSettings } from './settings'
import type { Word } from './types'

const DAY = new Date(2026, 9, 5, 9, 0)
const dayN = (n: number) => new Date(2026, 9, 1 + n, 9, 0)

/** n unlearned words in rank order; `rio` lists the (1-based) ranks that are Rioplatense overlay words. */
function pool(n: number, rio: number[] = []): Word[] {
  return Array.from({ length: n }, (_, i) =>
    makeWord(`palabra${String(i + 1).padStart(3, '0')}`, {
      rank: i + 1,
      rio: rio.includes(i + 1)
        ? ({ type: 'regional_only', form: `palabra${String(i + 1).padStart(3, '0')}`, altForm: null, altRegion: null, region: 'uy', register: 'neutral', notes: null, stdMeaning: null, translation: null, stdUsage: null, example: null, confidence: 'high' } as never)
        : null,
    }),
  )
}
const names = (words: readonly Word[]) => words.map((w) => w.esWord)
const isRio = (w: Word) => w.rio !== null

describe('strata cover the window', () => {
  it.each([
    [150, 10],
    [149, 10],
    [147, 7],
    [37, 10],
    [10, 10],
    [3, 3],
    [150, 1],
  ])('a window of %s split into %s strata tiles it exactly, with sizes differing by at most one', (length, size) => {
    const bounds = strataBounds(length, size)
    expect(bounds).toHaveLength(size)
    expect(bounds[0][0]).toBe(0)
    expect(bounds[size - 1][1]).toBe(length)
    for (let i = 1; i < size; i++) expect(bounds[i][0]).toBe(bounds[i - 1][1]) // no gap, no overlap
    const sizes = bounds.map(([a, b]) => b - a)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(1)
    for (let s = 0; s < size; s++) for (let i = bounds[s][0]; i < bounds[s][1]; i++) expect(stratumOf(i, length, size), `${length}/${size} @${i}`).toBe(s)
  })

  it('a batch holds one word from each stratum, spread from the most common to the least common end of the window', () => {
    const batch = pickBatch(pool(400), 10, DAY)
    expect(batch.window).toHaveLength(WINDOW_SIZE)
    expect(batch.reserve).toHaveLength(400 - WINDOW_SIZE)
    expect(batch.words).toHaveLength(10)
    expect([...batch.strata].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

    const bounds = strataBounds(WINDOW_SIZE, 10)
    batch.words.forEach((word, i) => {
      const at = batch.window.findIndex((w) => w.esWord === word.esWord)
      expect(at, word.esWord).toBeGreaterThanOrEqual(bounds[batch.strata[i]][0])
      expect(at).toBeLessThan(bounds[batch.strata[i]][1])
    })
    const positions = batch.words.map((w) => batch.window.findIndex((x) => x.esWord === w.esWord))
    expect(Math.min(...positions)).toBeLessThan(15) // one very common word…
    expect(Math.max(...positions)).toBeGreaterThanOrEqual(135) // …and one from the far end of the window
  })

  it('the window is the next 150 candidates in rank order, whatever came before them', () => {
    const later = pool(400).slice(40) // the first 40 are already learned
    const batch = pickBatch(later, 10, DAY)
    expect(names(batch.window)).toEqual(names(later.slice(0, 150)))
  })

  it('a pool smaller than the window or the batch still gives a full draw of what exists', () => {
    expect(pickBatch(pool(80), 10, DAY).window).toHaveLength(80)
    const tiny = pickBatch(pool(4), 10, DAY)
    expect(tiny.words).toHaveLength(4)
    expect(new Set(names(tiny.words)).size).toBe(4)
    expect(pickBatch([], 10, DAY).words).toHaveLength(0)
    expect(pickBatch(pool(50), 0, DAY).words).toHaveLength(0)
  })

  it('one card per headword in the window: a word showing the same headword as an earlier one is left out', () => {
    const words = [makeWord('chico', { rank: 1, esRioplatense: 'pibe', wordFormInExample: 'pibe' }), makeWord('niño', { rank: 2, esRioplatense: 'pibe', wordFormInExample: 'pibe' }), ...pool(20).map((w, i) => ({ ...w, rank: i + 3 }))]
    const batch = pickBatch(words, 10, DAY)
    expect(names(batch.window)).not.toContain('niño')
    const heads = batch.words.map((w) => headword(w).text.toLowerCase())
    expect(new Set(heads).size).toBe(heads.length)
  })
})

describe('determinism', () => {
  it('the same state on the same day gives the same batch, in the same order, at any time of day', () => {
    const a = pickBatch(pool(300), 10, DAY)
    const b = pickBatch(pool(300), 10, DAY)
    expect(names(b.words)).toEqual(names(a.words))
    expect(names(pickBatch(pool(300), 10, new Date(2026, 9, 5, 0, 5)).words)).toEqual(names(a.words))
    expect(names(pickBatch(pool(300), 10, new Date(2026, 9, 5, 23, 55)).words)).toEqual(names(a.words))
  })

  it('reopening Learn the same day brings the same batch back (through selectLearnBatch with the same user state)', () => {
    const words = pool(300)
    const settings = parseSettings({})
    expect(names(selectLearnBatch(words, settings, DAY).words)).toEqual(names(selectLearnBatch(words, settings, new Date(2026, 9, 5, 18, 0)).words))
  })

  it('another day gives another mix', () => {
    const batches = new Set(Array.from({ length: 10 }, (_, d) => names(pickBatch(pool(300), 10, dayN(d)).words).sort().join(',')))
    expect(batches.size).toBeGreaterThan(7)
  })

  it('the batch follows the user\'s state: learned words leave the pool, the window moves on, the batch changes', () => {
    const words = pool(300)
    const first = pickBatch(words, 10, DAY)
    const afterLearning = pickBatch(words.slice(10), 10, DAY)
    expect(names(afterLearning.window)[0]).toBe('palabra011')
    expect(names(afterLearning.words)).not.toEqual(names(first.words))
  })

  it('takes nothing from the order the words arrive in: only the pool\'s rank order and the date', () => {
    const words = pool(200)
    expect(names(pickBatch([...words], 10, DAY).words)).toEqual(names(pickBatch(words.map((w) => w), 10, DAY).words))
  })

  it('removing one word from the window leaves the other picks almost untouched (so a known word does not reshuffle the batch)', () => {
    const words = pool(300)
    const before = pickBatch(words, 10, DAY)
    const removed = words.find((w) => !names(before.words).includes(w.esWord) && words.indexOf(w) < 100)!
    const after = pickBatch(words.filter((w) => w !== removed), 10, DAY)
    const kept = names(before.words).filter((n) => names(after.words).includes(n))
    expect(kept.length).toBeGreaterThanOrEqual(7)
  })
})

describe('a Rioplatense word in every batch', () => {
  it('when the window has overlay words, every batch has at least one, on every day', () => {
    const words = pool(300, [12, 70, 140])
    for (let d = 0; d < 40; d++) expect(pickBatch(words, 10, dayN(d)).words.some(isRio), `day ${d}`).toBe(true)
  })

  it('a single overlay word in the window is always in the batch, in its own stratum', () => {
    const words = pool(300, [75])
    for (let d = 0; d < 20; d++) {
      const batch = pickBatch(words, 10, dayN(d))
      expect(names(batch.words)).toContain('palabra075')
      expect(batch.words).toHaveLength(10)
      expect(new Set(batch.strata).size).toBe(10) // it took the place of its stratum's pick, not an extra slot
    }
  })

  it('when the window has none, the search is widened for that one slot only: the nearest overlay word after the window', () => {
    const words = pool(400, [190, 260])
    const batch = pickBatch(words, 10, DAY)
    expect(batch.words.filter(isRio)).toHaveLength(1)
    expect(names(batch.words)).toContain('palabra190')
    expect(batch.words).toHaveLength(10)
    expect(batch.words.filter((w) => !isRio(w)).every((w) => batch.window.some((x) => x.esWord === w.esWord))).toBe(true) // the other nine still come from the window
  })

  it('with no overlay word anywhere there is nothing to add, and the batch is still full', () => {
    const batch = pickBatch(pool(300), 10, DAY)
    expect(batch.words.some(isRio)).toBe(false)
    expect(batch.words).toHaveLength(10)
  })

  it('on the real dictionary the first batches of a new user always contain an overlay word', () => {
    const real = parseDictionary(
      JSON.parse(readFileSync('public/words_enriched.json', 'utf8')),
      parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))),
      parseFallbackExamples(JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))),
    )
    const settings = parseSettings({})
    for (let d = 0; d < 20; d++) expect(selectLearnBatch(real, settings, dayN(d)).words.some(isRio), `day ${d}`).toBe(true)
  })
})

