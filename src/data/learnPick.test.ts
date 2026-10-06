import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '../testing/fakeSupabase'
import { makeWord } from '../testing/makeWord'
import { parseDictionary } from './dictionary'
import { headword } from './headword'
import { learnSettingsPatch, markKnown, selectLearnBatch, undoKnown, createBatchFinisher } from './learn'
import { WINDOW_SIZE, pickBatch, replaceKnown, restoreKnown, strataBounds, stratumOf } from './learnPick'
import { applyHiddenFlag, applyProgressUpdates, applySettingsPatch } from './mutations'
import { clozePool, isPracticeWord, matchingPool } from './practice'
import { parseFallbackExamples, parseRioOverlay } from './rio'
import { parseSettings } from './settings'
import { getLearnPool, isReviewDue } from './stats'
import type { Word } from './types'
import { createSupabaseWriteQueue } from './writeQueue'
import { LearnScreen } from '../screens/Learn'

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

describe('"already know it": replacement keeps the batch size', () => {
  const base = () => pickBatch(pool(300), 10, DAY)

  it('the word leaves, a candidate from the window takes its place, and the batch stays at ten', () => {
    const batch = base()
    const target = batch.words[3]
    const next = replaceKnown(batch, 3)
    expect(next.words).toHaveLength(10)
    expect(names(next.words)).not.toContain(target.esWord)
    expect(next.words[3].esWord).not.toBe(target.esWord)
    expect(batch.window.map((w) => w.esWord)).toContain(next.words[3].esWord)
    expect(new Set(names(next.words)).size).toBe(10)
    expect(next.known.map((k) => k.word.esWord)).toEqual([target.esWord])
    for (let i = 0; i < 10; i++) if (i !== 3) expect(next.words[i]).toBe(batch.words[i]) // everything else is untouched
  })

  it('the replacement comes from the same stratum while it has candidates (the mix of common and rare is kept)', () => {
    const batch = base()
    const next = replaceKnown(batch, 5)
    expect(next.strata[5]).toBe(batch.strata[5])
  })

  it('works over and over: marking many words as known keeps ten until the candidates run out', () => {
    let batch = base()
    const known: string[] = []
    for (let i = 0; i < 40; i++) {
      known.push(batch.words[i % 10].esWord)
      batch = replaceKnown(batch, i % 10)
      expect(batch.words, `after ${i + 1}`).toHaveLength(10)
      expect(new Set(names(batch.words)).size).toBe(10)
    }
    expect(names(batch.words).some((n) => known.includes(n))).toBe(false)
  })

  it('past the window it reaches into the rest of the queue, and only then does the batch get shorter', () => {
    let batch = pickBatch(pool(160), 10, DAY)
    const seen = new Set<string>()
    for (let i = 0; i < 155; i++) {
      batch = replaceKnown(batch, 0)
      names(batch.words).forEach((n) => seen.add(n))
      expect(batch.words, `after ${i + 1}`).toHaveLength(Math.min(10, 160 - (i + 1))) // full until fewer than ten candidates are left
    }
    expect([...seen].some((n) => Number(n.slice(7)) > WINDOW_SIZE)).toBe(true) // it did use words beyond the window
    expect(batch.words).toHaveLength(5)
  })

  it('a known Rioplatense word is replaced by another overlay word when one exists (the guarantee holds), widening past the window if needed', () => {
    const words = pool(400, [30, 90, 260])
    let batch = pickBatch(words, 10, DAY)
    const only = pickBatch(pool(400, [30, 260]), 10, DAY)
    expect(only.words.filter(isRio)).toHaveLength(1)
    const idx = only.words.findIndex(isRio)
    const next = replaceKnown(only, idx)
    expect(next.words.some(isRio)).toBe(true) // 260 is outside the window: the search widened for this slot
    expect(next.words).toHaveLength(10)
    batch = replaceKnown(batch, batch.words.findIndex(isRio))
    expect(batch.words.some(isRio)).toBe(true)
  })
})

describe('undo', () => {
  it('puts the word back in its place and the replacement back among the candidates', () => {
    const batch = pickBatch(pool(300), 10, DAY)
    const marked = replaceKnown(batch, 4)
    const undone = restoreKnown(marked)
    expect(names(undone.words)).toEqual(names(batch.words))
    expect(undone.strata).toEqual(batch.strata)
    expect(undone.known).toHaveLength(0)
    // and the replacement is available again for the next "already know it"
    expect(names(replaceKnown(undone, 4).words)).toEqual(names(marked.words))
  })

  it('undoes one step at a time, newest first', () => {
    const batch = pickBatch(pool(300), 10, DAY)
    const two = replaceKnown(replaceKnown(batch, 1), 7)
    expect(two.known).toHaveLength(2)
    const one = restoreKnown(two)
    expect(one.words[7].esWord).toBe(batch.words[7].esWord)
    expect(one.words[1].esWord).not.toBe(batch.words[1].esWord)
    expect(names(restoreKnown(one).words)).toEqual(names(batch.words))
  })

  it('also restores a batch that had to get shorter', () => {
    const batch = pickBatch(pool(3), 3, DAY)
    const shorter = replaceKnown(batch, 1)
    expect(shorter.words).toHaveLength(2)
    expect(names(restoreKnown(shorter).words)).toEqual(names(batch.words))
  })

  it('does nothing when there is nothing to undo', () => {
    const batch = pickBatch(pool(30), 10, DAY)
    expect(restoreKnown(batch)).toBe(batch)
  })
})

describe('a known word never comes back, anywhere', () => {
  const real = parseDictionary(
    JSON.parse(readFileSync('public/words_enriched.json', 'utf8')),
    parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))),
    parseFallbackExamples(JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))),
  )

  function know(words: readonly Word[], esWord: string): readonly Word[] {
    return applyHiddenFlag(words, [esWord], true)
  }

  it('it leaves the Learn pool, and no later batch (on any day) contains it', () => {
    const settings = parseSettings({})
    const batch = selectLearnBatch(real, settings, DAY)
    const target = batch.words[0].esWord
    const after = know(real, target)
    expect(getLearnPool(after).map((w) => w.esWord)).not.toContain(target)
    for (let d = 0; d < 30; d++) {
      const later = selectLearnBatch(after, settings, dayN(d))
      expect(names(later.words), `day ${d}`).not.toContain(target)
      expect(names(later.window)).not.toContain(target)
    }
  })

  it('it never reappears in Review, even if it had been learned and was due', () => {
    const learned = real.map((w) => (w.esWord === 'casa' ? { ...w, repetitions: 3, nextReview: new Date('2026-09-01T03:00:00.000Z') } : w))
    const casa = (words: readonly Word[]) => words.find((w) => w.esWord === 'casa')!
    expect(isReviewDue(casa(learned), DAY)).toBe(true)
    expect(isReviewDue(casa(know(learned, 'casa')), DAY)).toBe(false)
  })

  it('it never reappears in Matching or Cloze', () => {
    const learned = real.filter((w) => (w.rank ?? 1e9) <= 400).map((w) => ({ ...w, repetitions: 2, nextReview: new Date('2026-09-01T03:00:00.000Z') }))
    const inBoth = matchingPool(learned).find((m) => clozePool(learned).some((i) => i.word.esWord.toLowerCase() === m.id))!
    const target = learned.find((w) => w.esWord.toLowerCase() === inBoth.id)!.esWord
    expect(isPracticeWord(learned.find((w) => w.esWord === target)!)).toBe(true)
    const after = know(learned, target)
    expect(isPracticeWord(after.find((w) => w.esWord === target)!)).toBe(false)
    expect(matchingPool(after).some((m) => m.id === target.toLowerCase())).toBe(false)
    expect(clozePool(after).some((i) => i.word.esWord === target)).toBe(false)
  })

  it('within one batch, however many times the user taps "already know it", no known word comes back as a replacement', () => {
    let batch = pickBatch(pool(300), 10, DAY)
    const known: string[] = []
    for (let i = 0; i < 60; i++) {
      known.push(batch.words[0].esWord)
      batch = replaceKnown(batch, 0)
      expect(names(batch.words).some((n) => known.includes(n)), `after ${i + 1}`).toBe(false)
    }
  })

  it('applyHiddenFlag is case-insensitive, leaves other words untouched, and undoes cleanly', () => {
    const words = pool(5)
    const hidden = applyHiddenFlag(words, ['PALABRA002'], true)
    expect(hidden.map((w) => w.isHidden)).toEqual([false, true, false, false, false])
    expect(hidden[0]).toBe(words[0])
    expect(applyHiddenFlag(hidden, ['palabra002'], false).map((w) => w.isHidden)).toEqual([false, false, false, false, false])
    expect(applyHiddenFlag(words, ['palabra002'], false)).toBe(words) // nothing to change: the same list back
    expect(applyHiddenFlag(words, [], true)).toBe(words)
  })
})

describe('the daily counter counts only words actually learned', () => {
  const NOW = new Date(2026, 9, 5, 14, 30)
  // The batch finisher stamps the real clock: pin it to the test's day, or the stored counter would be "from another day".
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const settings = () => parseSettings({ streak_count: 2, streak_last_activity_date: '2026-10-04', new_words_learned_today_count: 2, new_words_learned_today_date: '2026-10-05' })

  function session() {
    const fake = fakeSupabase()
    let words: readonly Word[] = pool(300)
    let current = settings()
    const getSettings = () => current
    const queue = createSupabaseWriteQueue(fake.client, 'user-1', getSettings, { retryDelaysMs: [], sleep: () => Promise.resolve() })
    const deps = {
      queue,
      applyHidden: (esWords: readonly string[], hidden: boolean) => (words = applyHiddenFlag(words, esWords, hidden)),
    }
    return { fake, queue, deps, getWords: () => words, getSettings, applySettings: (p: Record<string, unknown>) => (current = applySettingsPatch(current, p)), applyProgress: (u: Parameters<typeof applyProgressUpdates>[1]) => (words = applyProgressUpdates(words, u)) }
  }

  it('newCount is the number of words the user will learn, however many were marked known along the way', () => {
    const s = session()
    let batch = selectLearnBatch(s.getWords(), s.getSettings(), NOW)
    for (let i = 0; i < 4; i++) batch = markKnown(batch, i, s.deps)
    expect(batch.known).toHaveLength(4)
    expect(batch.words).toHaveLength(batch.newCount)
    expect(batch.newCount).toBe(8) // the day had 8 left (limit 10, 2 learned): the batch stays at that size
  })

  it('finishing writes progress for the batch only and moves the counter by the batch size, not by the known words', async () => {
    const s = session()
    let batch = selectLearnBatch(s.getWords(), s.getSettings(), NOW)
    const known = [batch.words[0].esWord, batch.words[3].esWord, batch.words[5].esWord]
    batch = markKnown(markKnown(markKnown(batch, 0, s.deps), 3, s.deps), 5, s.deps)
    expect(batch.words).toHaveLength(8)
    expect(learnSettingsPatch(s.getSettings(), batch, NOW)).toMatchObject({ new_words_learned_today_count: 2 + 8 })

    const finish = createBatchFinisher(batch, { queue: s.queue, getSettings: s.getSettings, applyProgress: s.applyProgress, applySettings: s.applySettings })
    finish()
    await vi.waitFor(() => expect(s.queue.getStatus().unsaved).toBe(false))

    const progressRows = s.fake.calls.filter((c) => c.table === 'user_progress').flatMap((c) => c.rows as { es_word: string }[])
    expect(progressRows).toHaveLength(8)
    for (const k of known) expect(progressRows.map((r) => r.es_word)).not.toContain(k) // known words get no progress: they were never "learned"
    const settingsRow = s.fake.calls.find((c) => c.table === 'user_settings')!.rows as { settings: Record<string, unknown> }
    expect(settingsRow.settings.new_words_learned_today_count).toBe(10)
    expect(s.getSettings().newWordsLearnedTodayCount).toBe(10)
    // the known words went to user_hidden_words instead
    const hiddenRows = s.fake.calls.filter((c) => c.table === 'user_hidden_words').flatMap((c) => c.rows as { es_word: string }[])
    expect(hiddenRows.map((r) => r.es_word).sort()).toEqual([...known].sort())
  })

  it('marking words as known does not touch the counter or the streak by itself', () => {
    const s = session()
    const batch = selectLearnBatch(s.getWords(), s.getSettings(), NOW)
    markKnown(batch, 0, s.deps)
    expect(s.getSettings().newWordsLearnedTodayCount).toBe(2)
    expect(s.getSettings().streakCount).toBe(2)
    expect(s.fake.calls.filter((c) => c.table === 'user_settings' || c.table === 'user_progress')).toHaveLength(0)
  })

  it('undo un-hides the word again through the queue, and leaves the counter alone', () => {
    const s = session()
    const batch = selectLearnBatch(s.getWords(), s.getSettings(), NOW)
    const target = batch.words[2]
    const marked = markKnown(batch, 2, s.deps)
    expect(s.getWords().find((w) => w.esWord === target.esWord)!.isHidden).toBe(true)
    const undone = undoKnown(marked, s.deps)
    expect(s.getWords().find((w) => w.esWord === target.esWord)!.isHidden).toBe(false)
    expect(undone.words[2].esWord).toBe(target.esWord)
    expect(s.queue.getStatus().pendingHidden).toBeLessThanOrEqual(1)
    expect(s.getSettings().newWordsLearnedTodayCount).toBe(2)
  })
})

describe('the Learn screen', () => {
  const css = readFileSync('src/index.css', 'utf8')
  const rule = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`)
    return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  }
  const settings = parseSettings({})
  const data = { words: pool(300), settings, getSettings: () => settings, applyProgress: () => {}, applySettings: () => {}, applyHidden: () => {} } as never
  const queue = createSupabaseWriteQueue(fakeSupabase().client, 'u', () => settings)

  it('offers "I already know this word" as a quiet secondary action, apart from the arrows and Finish', () => {
    const html = renderToStaticMarkup(createElement(LearnScreen, { data, queue, metrics: null, onHome: () => {}, onReview: () => {} }))
    expect(html).toContain('class="known-btn"')
    expect(html).toContain('I already know this word')
    expect(html).not.toContain('btn-primary') // never styled as a main action
    const order = ['swipe-area', 'learn-known', 'learn-nav'].map((c) => html.indexOf(c))
    expect(order).toEqual([...order].sort((a, b) => a - b)) // between the card and the arrows
    expect(html).not.toContain('learn-undo') // nothing to undo yet
    expect(rule('.known-btn')).toMatch(/color: var\(--muted\)/)
    expect(rule('.known-btn')).toMatch(/min-height: 44px/)
    expect(rule('.known-btn')).toMatch(/background: none/)
  })

  it('the Undo bar, when there is something to undo, shows the word and an Undo link', () => {
    const strings = readFileSync('src/strings.ts', 'utf8')
    expect(strings).toContain("undo: 'Undo'")
    expect(strings).toContain('marked as known')
    expect(rule('.learn-undo')).toMatch(/display: flex/)
  })
})
