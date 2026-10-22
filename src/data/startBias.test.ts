import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DataSection } from '../DataSection'
import { makeWord } from '../testing/makeWord'
import { parseDictionary } from './dictionary'
import { markKnown, selectLearnBatch, undoKnown, type KnownDeps } from './learn'
import { LOWER_SHARE, isLowerStratum, lowerShare, pickBatch } from './learnPick'
import { STARRED_SHARE, starredSlots } from './starred'
import { applyHiddenFlag } from './mutations'
import { splitAtStartRank } from './placement'
import { parseRioOverlay, parseFallbackExamples } from './rio'
import { parseSettings } from './settings'
import { settingsEntries } from './settingsEntries'
import { getLearnPool } from './stats'
import type { UserSettings, Word } from './types'

// start_rank is a bias, not a wall: about 30% of a batch's filler comes from the words below it, spread across that range.

const rio = { type: 'regional_only', form: 'x', altForm: null, altRegion: null, region: 'uy', register: 'neutral', notes: null, stdMeaning: null, translation: null, stdUsage: null, example: null, confidence: 'high' } as never
const name = (rank: number) => `w${String(rank).padStart(4, '0')}`
const dictionary = (n: number, over: (rank: number) => Partial<Word> = () => ({})): Word[] => Array.from({ length: n }, (_, i) => makeWord(name(i + 1), { rank: i + 1, ...over(i + 1) }))
const day = (d: number) => new Date(2026, 9, 1 + d, 9, 0)
const settingsOf = (raw: Record<string, unknown>): UserSettings => parseSettings({ daily_new_word_limit: 10, ...raw })
const ranks = (words: readonly Word[]) => words.map((w) => w.rank!)

describe('how many come from below', () => {
  it('about 30% of the filler: a batch of 10 gives 3, a batch of 3 gives 1', () => {
    expect(LOWER_SHARE).toBe(0.3)
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(lowerShare)).toEqual([0, 1, 1, 1, 2, 2, 2, 2, 3, 3])
    expect(lowerShare(0)).toBe(0)
  })

  it('a batch of 10 with a start rank is 7 from the window and 3 from below it, on every day', () => {
    const words = dictionary(3000)
    for (let d = 0; d < 30; d++) {
      const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d))
      const r = ranks(batch.words)
      expect(r, `day ${d}`).toHaveLength(10)
      expect(r.filter((x) => x >= 1000), `day ${d}`).toHaveLength(7)
      expect(r.filter((x) => x < 1000), `day ${d}`).toHaveLength(3)
      for (const x of r.filter((x) => x >= 1000)) expect(x).toBeLessThanOrEqual(1149) // the window is still the 150 words from the start rank
    }
  })

  it('a batch of 3 takes 1 from below, and a batch of 1 takes none', () => {
    const words = dictionary(3000)
    const three = selectLearnBatch(words, settingsOf({ start_rank: 1000, daily_new_word_limit: 3 }), day(0))
    expect(ranks(three.words).filter((x) => x < 1000)).toHaveLength(1)
    expect(three.words).toHaveLength(3)
    const one = selectLearnBatch(words, settingsOf({ start_rank: 1000, daily_new_word_limit: 1 }), day(0))
    expect(ranks(one.words).filter((x) => x < 1000)).toHaveLength(0)
    expect(one.words).toHaveLength(1)
  })

  it('scales with what is left of the day: 4 words left gives 1 from below', () => {
    const words = dictionary(3000)
    const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000, daily_new_word_limit: 10, new_words_learned_today_count: 6, new_words_learned_today_date: '2026-10-01' }), day(0))
    expect(batch.words).toHaveLength(4)
    expect(ranks(batch.words).filter((x) => x < 1000)).toHaveLength(1)
  })
})

describe('the words from below are spread over the skipped range', () => {
  it('one from each third of it: not clustered at the start, and not all in one place', () => {
    const words = dictionary(3000)
    const seen = new Set<number>()
    for (let d = 0; d < 40; d++) {
      const low = ranks(selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d)).words)
        .filter((x) => x < 1000)
        .sort((a, b) => a - b)
      expect(low).toHaveLength(3)
      expect(low[0]).toBeLessThanOrEqual(333) // 999 words cut into three equal slices
      expect(low[1]).toBeGreaterThan(333)
      expect(low[1]).toBeLessThanOrEqual(666)
      expect(low[2]).toBeGreaterThan(666)
      for (const x of low) seen.add(x)
    }
    expect(Math.max(...seen)).toBeGreaterThan(900) // it reaches the top of the range
    expect(Math.min(...seen)).toBeLessThan(100) // and the bottom
    expect(seen.size).toBeGreaterThan(40) // and it moves from day to day
  })

  it('the same day brings the same batch back', () => {
    const words = dictionary(3000)
    const a = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), new Date(2026, 9, 3, 8, 0))
    const b = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), new Date(2026, 9, 3, 21, 0))
    expect(a.words.map((w) => w.esWord)).toEqual(b.words.map((w) => w.esWord))
  })

  it('the easy words are mixed in with the others, not bunched at one end of the batch', () => {
    const words = dictionary(3000)
    const positions = new Set<number>()
    for (let d = 0; d < 40; d++) ranks(selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d)).words).forEach((x, i) => x < 1000 && positions.add(i))
    expect(positions.size).toBeGreaterThan(6)
  })
})

describe('when the range below runs out', () => {
  const words = dictionary(400)

  it('every word there learned: the whole batch comes from the window', () => {
    const learned = words.map((w) => (w.rank! < 200 ? { ...w, repetitions: 1 } : w))
    const batch = selectLearnBatch(learned, settingsOf({ start_rank: 200 }), day(0))
    expect(batch.words).toHaveLength(10)
    expect(ranks(batch.words).every((x) => x >= 200)).toBe(true)
  })

  it('every word there hidden: the same', () => {
    const hidden = applyHiddenFlag(words, words.filter((w) => w.rank! < 200).map((w) => w.esWord), true)
    const batch = selectLearnBatch(hidden, settingsOf({ start_rank: 200 }), day(0))
    expect(batch.words).toHaveLength(10)
    expect(ranks(batch.words).every((x) => x >= 200)).toBe(true)
  })

  it('only two left there: it takes the two, and the window fills the rest', () => {
    const hidden = applyHiddenFlag(words, words.filter((w) => w.rank! < 198).map((w) => w.esWord), true) // 198 and 199 are left below 200
    const batch = selectLearnBatch(hidden, settingsOf({ start_rank: 200 }), day(0))
    expect(batch.words).toHaveLength(10)
    expect(ranks(batch.words).filter((x) => x < 200).sort()).toEqual([198, 199])
  })

  it('a window with fewer words than the batch needs asks the range below for more', () => {
    const small = dictionary(60)
    const batch = selectLearnBatch(small, settingsOf({ start_rank: 55 }), day(0)) // 6 words from 55 on, 54 below
    expect(batch.words).toHaveLength(10)
    expect(ranks(batch.words).filter((x) => x >= 55)).toHaveLength(6)
  })

  it('nothing from the start rank on: the whole pool is the window, and nothing is taken twice', () => {
    const batch = selectLearnBatch(words, settingsOf({ start_rank: 99999 }), day(0))
    expect(batch.words).toHaveLength(10)
    expect(new Set(batch.words.map((w) => w.esWord)).size).toBe(10)
    expect(batch.lowSize).toBe(0)
  })
})

describe('with no start rank nothing changes', () => {
  it('the batch is the one pickBatch draws from the whole pool, on every day', () => {
    const words = dictionary(400, (r) => (r === 30 ? { rio } : {}))
    for (let d = 0; d < 20; d++) {
      const batch = selectLearnBatch(words, settingsOf({}), day(d))
      const before = pickBatch(getLearnPool(words), 10, day(d))
      expect(batch.words.map((w) => w.esWord)).toEqual(before.words.map((w) => w.esWord))
      expect(batch.strata).toEqual(before.strata)
      expect(batch.lowSize).toBe(0)
      expect(batch.lowWindow).toEqual([])
      expect(batch.strata.some(isLowerStratum)).toBe(false)
    }
  })

  it('a start_rank of null (or a value the parser drops) is no start rank', () => {
    const words = dictionary(400)
    for (const bad of [null, 0, 1, 'x']) {
      const batch = selectLearnBatch(words, settingsOf({ start_rank: bad }), day(0))
      expect(batch.words.map((w) => w.esWord)).toEqual(pickBatch(getLearnPool(words), 10, day(0)).words.map((w) => w.esWord))
    }
  })
})

// "Learn sooner": starred words take up to 70% of a batch (round(0.7 x size), at least one), oldest star first. The other slots are the usual pick:
// the share from below the start rank is taken of THOSE slots, and so is the Rioplatense guarantee.
const star = (rank: number, order = rank) => ({ isFavorite: true, starredAt: 1_000_000 + order })
const starred = (n: number, from = 2000) => (r: number) => (r >= from && r < from + n ? star(r) : {})

describe('starred words ("Learn sooner") and the Rioplatense guarantee', () => {
  it('take round(0.7 x the batch), at least one: 7 of a goal of 10, 4 of 5, 2 of 3, 1 of 1 (and never more than a batch holds)', () => {
    expect([10, 5, 3, 1, 2, 4, 6, 7, 8, 9, 12].map((size) => starredSlots(size))).toEqual([7, 4, 2, 1, 1, 3, 4, 5, 6, 6, 8])
    expect(starredSlots(0)).toBe(0)
    expect(STARRED_SHARE).toBe(0.7)
    // the two guards are the rule, whatever the share is: at least one slot while there is a batch, and never more slots than the batch has
    expect([1, 2, 3].map((size) => starredSlots(size, 0.1))).toEqual([1, 1, 1])
    expect([1, 2, 3].map((size) => starredSlots(size, 1.6))).toEqual([1, 2, 3])
    const words = dictionary(3000, starred(200)) // 200 starred words: far more than any day holds
    for (const [goal, lead] of [[10, 7], [5, 4], [3, 2], [1, 1]] as const) {
      for (let d = 0; d < 10; d++) {
        const batch = selectLearnBatch(words, settingsOf({ daily_new_word_limit: goal }), day(d))
        expect(batch.words, `goal ${goal}, day ${d}`).toHaveLength(goal)
        const stars = batch.words.filter((w) => w.isFavorite)
        expect(stars, `goal ${goal}, day ${d}`).toHaveLength(lead)
        expect(batch.words.slice(0, lead).every((w) => w.isFavorite)).toBe(true) // they lead the batch
        expect(batch.words.slice(lead).some((w) => w.isFavorite)).toBe(false) // and the filler is never starred
      }
    }
  })

  it('are taught oldest star first, not by rank: the rank only breaks a tie or stands in for a missing time', () => {
    const words = dictionary(3000, (r) => (r >= 2000 && r < 2020 ? star(r, 3000 - r) : {})) // the higher the rank, the older the star
    const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(0))
    expect(ranks(batch.words.slice(0, 7))).toEqual([2019, 2018, 2017, 2016, 2015, 2014, 2013])
    const tied = dictionary(3000, (r) => (r >= 2000 && r < 2020 ? { isFavorite: true, starredAt: 5 } : {}))
    expect(ranks(selectLearnBatch(tied, settingsOf({ start_rank: 1000 }), day(0)).words.slice(0, 7))).toEqual([2000, 2001, 2002, 2003, 2004, 2005, 2006])
    const unknown = dictionary(3000, (r) => (r >= 2000 && r < 2020 ? { isFavorite: true, starredAt: r === 2010 ? 7 : null } : {}))
    expect(ranks(selectLearnBatch(unknown, settingsOf({ start_rank: 1000 }), day(0)).words.slice(0, 3))).toEqual([2010, 2000, 2001]) // a known time first, then by rank
  })

  it('have no cap: 200 stars are taught over the days, 7 at a time, each one once, in the order they were set', () => {
    let words = dictionary(3000, (r) => (r >= 1500 && r < 1700 ? star(r, 1700 - r) : {})) // the oldest star is the highest rank
    const seen: number[] = []
    for (let d = 0; d < 29; d++) {
      const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d))
      const lead = ranks(batch.words.filter((w) => w.isFavorite))
      expect(lead, `day ${d}`).toHaveLength(Math.min(7, 200 - seen.length))
      seen.push(...lead)
      // what Learn does when the batch is finished: the words are learned and their stars go
      const taught = new Set(batch.words.map((w) => w.esWord))
      words = words.map((w) => (taught.has(w.esWord) ? makeWord(w.esWord, { rank: w.rank, repetitions: 1, nextReview: day(d + 1), isFavorite: false }) : w))
    }
    expect(seen).toHaveLength(200)
    expect(new Set(seen).size).toBe(200)
    expect(seen).toEqual(Array.from({ length: 200 }, (_, i) => 1699 - i)) // oldest first, all the way down
  })

  it('leave the below-start share on the remaining slots: the 3 left of a goal of 10 are 2 from the window and 1 from below, on every day', () => {
    const words = dictionary(3000, starred(200))
    for (let d = 0; d < 30; d++) {
      const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d))
      const filler = ranks(batch.words.slice(7))
      expect(filler, `day ${d}`).toHaveLength(3)
      expect(filler.filter((x) => x < 1000), `day ${d}`).toHaveLength(1) // lowerShare(3)
      expect(filler.filter((x) => x >= 1000)).toHaveLength(2)
    }
  })

  it('a star below the start rank leads like any other and takes nothing from the below-start share of the filler', () => {
    const words = dictionary(3000, (r) => (r === 40 || r === 2500 ? star(r) : {}))
    for (let d = 0; d < 20; d++) {
      const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d))
      expect(batch.words.slice(0, 2).map((w) => w.esWord), `day ${d}`).toEqual([name(40), name(2500)]) // oldest first: rank 40 was starred first
      expect(batch.words).toHaveLength(10)
      const filler = ranks(batch.words.slice(2))
      expect(filler.filter((x) => x < 1000), `day ${d}`).toHaveLength(2) // round(0.3 x 8), as when nothing is starred
      expect(filler.filter((x) => x >= 1000)).toHaveLength(6)
      expect(filler).not.toContain(40) // a starred word is never drawn again as filler
    }
  })

  it('fewer stars than the share leave the rest as it always was: 2 stars, 8 slots split 30/70', () => {
    const words = dictionary(3000, starred(2))
    const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(0))
    expect(ranks(batch.words.slice(0, 2))).toEqual([2000, 2001])
    expect(batch.words).toHaveLength(10)
    expect(ranks(batch.words.slice(2)).filter((x) => x < 1000)).toHaveLength(2)
  })

  it('stars that do not fit today are not drawn as filler either: they wait for their turn', () => {
    const words = dictionary(3000, starred(20))
    const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(0))
    expect(ranks(batch.words.slice(0, 7))).toEqual([2000, 2001, 2002, 2003, 2004, 2005, 2006])
    for (const x of ranks(batch.words.slice(7))) expect(x < 2000 || x >= 2020).toBe(true)
  })

  it('a Rioplatense word in the window still gets into the batch when 7 stars lead it, on every day (the 3 remaining slots carry the guarantee)', () => {
    const words = dictionary(3000, (r) => ({ ...starred(200)(r), ...(r === 1100 ? { rio } : {}) }))
    for (let d = 0; d < 30; d++) {
      const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d))
      expect(ranks(batch.words), `day ${d}`).toContain(1100)
      expect(batch.words).toHaveLength(10)
    }
  })

  it('and at goals of 5 and 3, where one slot is left, that slot is the Rioplatense word', () => {
    const words = dictionary(3000, (r) => ({ ...starred(200)(r), ...(r === 1100 ? { rio } : {}) }))
    for (const goal of [5, 3]) {
      for (let d = 0; d < 20; d++) {
        const batch = selectLearnBatch(words, settingsOf({ daily_new_word_limit: goal, start_rank: 1000 }), day(d))
        expect(ranks(batch.words), `goal ${goal}, day ${d}`).toContain(1100)
        expect(batch.words.filter((w) => w.isFavorite)).toHaveLength(goal === 5 ? 4 : 2)
      }
    }
  })

  it('a Rioplatense word only below the start rank is found for the remaining slots too', () => {
    const words = dictionary(3000, (r) => ({ ...starred(200)(r), ...(r === 300 ? { rio } : {}) }))
    for (let d = 0; d < 20; d++) expect(ranks(selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d)).words), `day ${d}`).toContain(300)
  })

  it('a starred Rioplatense word counts: the filler is not forced to add another', () => {
    // the oldest star is an overlay word, and so is a word in the window; the batch already has one, so the window's is only there when the day's draw picks it
    const words = dictionary(3000, (r) => ({ ...starred(200)(r), ...(r === 2000 || r === 1100 ? { rio } : {}) }))
    let forced = 0
    for (let d = 0; d < 30; d++) {
      const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d))
      expect(batch.words[0].rio).not.toBeNull()
      if (batch.words.filter((w) => w.rio !== null).length > 1) forced++
    }
    expect(forced).toBeLessThan(10) // it is not there every day, as it would be if the guarantee ignored the star
  })

  it('a batch of one is the star alone: the user chose it, and no Rioplatense word is forced in', () => {
    const words = dictionary(3000, (r) => ({ ...starred(200)(r), ...(r === 1100 ? { rio } : {}) }))
    for (let d = 0; d < 10; d++) {
      const batch = selectLearnBatch(words, settingsOf({ daily_new_word_limit: 1, start_rank: 1000 }), day(d))
      expect(ranks(batch.words)).toEqual([2000])
    }
  })

  it('stars below the start rank that do not fit today are not drawn as filler either: 300 of the 999 words below it are starred', () => {
    const words = dictionary(3000, (r) => (r <= 300 ? star(r) : {}))
    for (let d = 0; d < 40; d++) {
      const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d))
      expect(ranks(batch.words.slice(0, 7)), `day ${d}`).toEqual([1, 2, 3, 4, 5, 6, 7])
      expect(batch.words.slice(7).some((w) => w.isFavorite), `day ${d}`).toBe(false)
      expect(new Set(ranks(batch.words)).size).toBe(10)
    }
  })

  it('stars that Learn cannot teach (learned, known, no translation) are not in the line at all', () => {
    const words = dictionary(3000, (r) =>
      r === 2000 ? { ...star(r), repetitions: 2, nextReview: day(5) } : r === 2001 ? { ...star(r), isHidden: true } : r === 2002 ? { ...star(r), pos: 'prep' } : r === 2003 ? star(r) : {},
    )
    const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(0))
    expect(ranks(batch.words.filter((w) => w.isFavorite))).toEqual([2003])
  })

  it('a Rioplatense word in the window is in the batch, whichever day', () => {
    const words = dictionary(3000, (r) => (r === 1100 ? { rio } : {}))
    for (let d = 0; d < 30; d++) expect(ranks(selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d)).words), `day ${d}`).toContain(1100)
  })

  it('a Rioplatense word only below the start rank is in the batch too: the guarantee is for the batch as a whole', () => {
    const words = dictionary(3000, (r) => (r === 300 ? { rio } : {}))
    for (let d = 0; d < 30; d++) {
      const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d))
      expect(ranks(batch.words), `day ${d}`).toContain(300)
      expect(batch.words).toHaveLength(10)
      expect(ranks(batch.words).filter((x) => x < 1000)).toHaveLength(3) // it took the place of the pick of its slice
    }
  })

  it('one of the three from below being Rioplatense is enough: the window is not forced to add another', () => {
    const words = dictionary(3000, (r) => (r % 2 === 0 && r < 1000 ? { rio } : r === 1100 ? { rio } : {}))
    for (let d = 0; d < 20; d++) {
      const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(d))
      expect(batch.words.some((w) => w.rio !== null)).toBe(true)
      expect(batch.words).toHaveLength(10)
    }
  })

  it('a custom word (no rank) leads from the window side and is never taken as one of the easy words', () => {
    const custom = makeWord('mia', { rank: null, isCustom: true })
    const words = [...dictionary(3000), custom]
    const { window, below } = splitAtStartRank(getLearnPool(words), 1000)
    expect(window).toContain(custom)
    expect(below).not.toContain(custom)
    // a custom word that happens to carry a rank is still not "below"
    const ranked = makeWord('suya', { rank: 5, isCustom: true })
    expect(splitAtStartRank([ranked, ...dictionary(3000)], 1000).below).not.toContain(ranked)
  })
})

describe('"Already know it" on an easy word', () => {
  const words = dictionary(3000)
  const deps = (): KnownDeps & { hidden: string[] } => {
    const hidden: string[] = []
    return {
      hidden,
      queue: { enqueueHidden: (w: string) => void hidden.push(w), enqueueFavorite: vi.fn() },
      applyHidden: vi.fn(),
      applyFavorite: vi.fn(),
    }
  }

  it('hides it as usual, and the word that takes its place is also from below, so the batch keeps its 7 and 3', () => {
    const d = deps()
    const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(0))
    const at = batch.words.findIndex((w) => w.rank! < 1000)
    const target = batch.words[at]
    const next = markKnown(batch, at, d)
    expect(d.hidden).toEqual([target.esWord])
    expect(next.words).toHaveLength(10)
    expect(next.words).not.toContain(target)
    expect(ranks(next.words).filter((x) => x < 1000)).toHaveLength(3)
    expect(ranks(next.words).filter((x) => x >= 1000)).toHaveLength(7)
    expect(isLowerStratum(next.strata[at])).toBe(true)
    // the replacement comes from the same slice of the range when it has one
    const slice = (w: Word) => batch.lowStrata[batch.lowWindow.indexOf(w)]
    expect(slice(next.words[at])).toBe(slice(target))
  })

  it('and Undo puts the word back where it was', () => {
    const d = deps()
    const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(0))
    const at = batch.words.findIndex((w) => w.rank! < 1000)
    const undone = undoKnown(markKnown(batch, at, d), d)
    expect(undone.words.map((w) => w.esWord)).toEqual(batch.words.map((w) => w.esWord))
    expect(undone.strata).toEqual(batch.strata)
  })

  it('the skipped range shrinks: a word marked as known is not a candidate in the next batch, on any day', () => {
    const d = deps()
    const batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(0))
    const at = batch.words.findIndex((w) => w.rank! < 1000)
    const gone = batch.words[at].esWord
    const hidden = applyHiddenFlag(words, [gone], true)
    markKnown(batch, at, d)
    for (let n = 0; n < 40; n++) expect(selectLearnBatch(hidden, settingsOf({ start_rank: 1000 }), day(n)).words.map((w) => w.esWord)).not.toContain(gone)
    expect(splitAtStartRank(getLearnPool(hidden), 1000).below).toHaveLength(998)
  })

  it('marking every easy word of a batch known one after another never leaves the batch short', () => {
    const d = deps()
    let batch = selectLearnBatch(words, settingsOf({ start_rank: 1000 }), day(0))
    const seen = new Set(batch.words.map((w) => w.esWord))
    for (let step = 0; step < 12; step++) {
      const at = batch.words.findIndex((w) => w.rank! < 1000)
      if (at < 0) break
      batch = markKnown(batch, at, d)
      expect(batch.words, `step ${step}`).toHaveLength(10)
      expect(new Set(batch.words.map((w) => w.esWord)).size).toBe(10)
      for (const w of batch.words) seen.add(w.esWord)
    }
  })

  it('with the range empty, the replacement for a word from below comes from the window', () => {
    const d = deps()
    const small = dictionary(400)
    const lowOnly = applyHiddenFlag(small, small.filter((w) => w.rank! < 198).map((w) => w.esWord), true) // two words left below 200
    let batch = selectLearnBatch(lowOnly, settingsOf({ start_rank: 200 }), day(0))
    expect(ranks(batch.words).filter((x) => x < 200)).toHaveLength(2)
    batch = markKnown(batch, batch.words.findIndex((w) => w.rank! < 200), d)
    batch = markKnown(batch, batch.words.findIndex((w) => w.rank! < 200), d)
    expect(batch.words).toHaveLength(10)
    expect(ranks(batch.words).every((x) => x >= 200)).toBe(true)
  })
})

describe('on the real dictionary', () => {
  const real = parseDictionary(
    JSON.parse(readFileSync('public/words_enriched.json', 'utf8')),
    parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))),
    parseFallbackExamples(JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))),
  )

  it('a stored start_rank of 2422 reaches Learn through the settings parser: 7 words from rank 2422 on and 3 from below, whole batches, many days', () => {
    // the blob exactly as the settings lane writes it: start_rank next to the other keys
    const stored = parseSettings({ daily_new_word_limit: 10, start_rank: 2422, streak_count: 3 })
    expect(stored.startRank).toBe(2422)
    for (let d = 0; d < 30; d++) {
      const batch = selectLearnBatch(real, stored, day(d))
      const r = batch.words.map((w) => w.rank).filter((x): x is number => x !== null)
      expect(batch.words).toHaveLength(10)
      expect(r.filter((x) => x >= 2422), `day ${d}`).toHaveLength(7)
      expect(r.filter((x) => x < 2422), `day ${d}`).toHaveLength(3)
    }
  })
})

describe('Debug data lists every settings key', () => {
  const entries = (raw: Record<string, unknown>) => Object.fromEntries(settingsEntries(raw))

  it('whatever the blob holds, including start_rank and a key nothing here knows', () => {
    const e = entries({ start_rank: 2422, daily_new_word_limit: 12, some_future_key: { a: 1 }, learn_picks: ['a', 'b'] })
    expect(Object.keys(e)).toEqual(['daily_new_word_limit', 'learn_picks', 'some_future_key', 'start_rank']) // sorted
    expect(e.start_rank).toBe('2422')
    expect(e.some_future_key).toBe('{"a":1}')
    expect(e.learn_picks).toBe('["a","b"]')
  })

  it('a long value is cut, and an empty blob lists nothing', () => {
    const long = entries({ learn_picks: Array.from({ length: 50 }, (_, i) => `palabra${i}`) })
    expect(long.learn_picks.length).toBeLessThanOrEqual(80)
    expect(long.learn_picks.endsWith('…')).toBe(true)
    expect(settingsEntries({})).toEqual([])
  })

  it('renders on the screen: start_rank is a line of the Data section when it is stored, and absent when it is not', () => {
    const render = (raw: Record<string, unknown>) =>
      renderToStaticMarkup(
        createElement(DataSection, {
          state: {
            status: 'ready',
            data: {
              words: [],
              settings: parseSettings(raw),
              stats: { total: 0, started: 0, reviewDue: 0, learnPool: 0, newToLearn: 0, favorites: 0, hidden: 0, custom: 0, streak: 0, dailyLimit: 10, remainingToday: 10 },
              diagnostics: { baseCount: 0, orphanProgress: 0, orphanFavorites: 0, orphanHidden: 0 },
            } as never,
          },
        }),
      )
    expect(render({ start_rank: 2422 })).toContain('start_rank: 2422')
    expect(render({ daily_new_word_limit: 10 })).not.toMatch(/start_rank: \d/) // the batch preview says "none"; no stored key is listed
    expect(render({})).toContain('(none)')
  })
})
