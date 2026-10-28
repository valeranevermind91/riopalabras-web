import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDictionary } from './dictionary'
import { computeRemainingToday } from './stats'
import { createBatchFinisher, createBatchKeeper, markKnown, selectLearnBatch, undoKnown, type BatchKeeper, type LearnBatch } from './learn'
import { applyFavoriteFlag, applyHiddenFlag, applyProgressUpdates, applySettingsPatch } from './mutations'
import { parseSettings } from './settings'
import { learnedToday } from './daily'
import { wordKey } from './words'
import type { ProgressUpdate, Word } from './types'
import type { ReviewLog } from './reviewLog'

// A batch is counted as it is read: a word is learned the moment its card is reached. These run the keeper (and Learn's two ways of changing the batch under it, hiding a
// word and Undo) on the real dictionary against in-memory state, so that what a person sees on coming back is what these say: seven cards read are seven words kept, and
// the next batch is the three that are left.

const dictionary = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')))
const NOW = new Date(2026, 9, 27, 14, 30)

function sitting(raw: Record<string, unknown> = {}, startWords: readonly Word[] = dictionary) {
  let words: readonly Word[] = startWords
  let settings = parseSettings({ daily_new_word_limit: 10, ...raw })
  const batches: { updates: ProgressUpdate[]; patch: Record<string, unknown> }[] = []
  const hidden: { esWord: string; hidden: boolean }[] = []
  const stars: { esWord: string; favorite: boolean }[] = []
  const logged: string[] = []
  const events = { kept: 0, finished: 0 }
  const log = { learned: (learned: readonly Word[]) => void logged.push(...learned.map((w) => w.esWord)) } as unknown as ReviewLog
  const queue = {
    enqueueBatch: (updates: readonly ProgressUpdate[], patch: Record<string, unknown>) => {
      batches.push({ updates: [...updates], patch })
      return { saved: () => true }
    },
    enqueueFavorite: (esWord: string, favorite: boolean) => void stars.push({ esWord, favorite }),
    enqueueHidden: (esWord: string, isHidden: boolean) => void hidden.push({ esWord, hidden: isHidden }),
  }
  const deps = {
    queue,
    getSettings: () => settings,
    getWords: () => words,
    applyProgress: (updates: readonly ProgressUpdate[]) => void (words = applyProgressUpdates(words, updates)),
    applySettings: (patch: Record<string, unknown>) => void (settings = applySettingsPatch(settings, patch)),
    applyFavorite: (esWords: readonly string[], favorite: boolean) => void (words = applyFavoriteFlag(words, esWords, favorite)),
    onKept: () => void events.kept++,
    onFinished: () => void events.finished++,
    log,
    sessionId: 's1',
  }
  const knownDeps = { queue, applyHidden: (esWords: readonly string[], isHidden: boolean) => void (words = applyHiddenFlag(words, esWords, isHidden)), applyFavorite: deps.applyFavorite }
  let batch: LearnBatch = selectLearnBatch(words, settings, NOW)
  const keeper: BatchKeeper = createBatchKeeper(deps)
  return {
    keeper,
    deps,
    knownDeps,
    batches,
    hidden,
    stars,
    logged,
    events,
    words: () => words,
    settings: () => settings,
    batch: () => batch,
    setBatch: (next: LearnBatch) => void (batch = next),
    /** The person reaches the card at `index`. */
    reach: (index: number) => keeper.reach(batch, index),
    /** ...and hides it ("Already know it"), as Learn does: the batch changes, then the keeper looks at it again from the same place. */
    hide: (index: number) => {
      batch = markKnown(batch, index, knownDeps)
      keeper.reach(batch, Math.min(index, batch.words.length - 1))
    },
    undo: (index: number) => {
      const last = batch.known[batch.known.length - 1]
      batch = undoKnown(batch, knownDeps)
      keeper.reach(batch, Math.min(last?.index ?? index, batch.words.length - 1))
    },
    learned: () => words.filter((w) => w.repetitions > 0),
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a card reached is a word learned', () => {
  it('opening Learn counts the first card: its progress due tomorrow at local midnight, today\'s counter at 1, one card done, one log row', () => {
    const s = sitting()
    const first = s.batch().words[0]
    s.reach(0)
    expect(s.batches).toHaveLength(1)
    expect(s.batches[0].updates).toEqual([{ esWord: first.esWord, easeFactor: 2.5, interval: 0, repetitions: 1, nextReview: new Date(2026, 9, 28) }])
    expect(learnedToday(s.settings(), NOW)).toBe(1)
    expect(s.settings()).toMatchObject({ cardsDoneTodayCount: 1, newWordsLearnedTodayCount: 1 })
    expect(s.logged).toEqual([]) // its log row is written when the person leaves the card, not while it is in front of them
    expect(s.events.kept).toBe(1)
    s.reach(1)
    expect(s.logged).toEqual([first.esWord])
  })

  it('seven cards read are seven words kept: seven progress rows, the counter at 7, "3 more today"', () => {
    const s = sitting()
    const seen = s.batch().words.slice(0, 7).map((w) => w.esWord)
    for (let i = 0; i < 7; i++) s.reach(i)
    expect(s.learned().map((w) => w.esWord).sort()).toEqual([...seen].sort())
    expect(learnedToday(s.settings(), NOW)).toBe(7)
    expect(computeRemainingToday(s.settings(), NOW)).toBe(3)
    expect(s.logged).toEqual(seen.slice(0, 6)) // the card in front is not logged until it is left
    expect([...s.keeper.kept()].sort()).toEqual(seen.map(wordKey).sort())
  })

  it('every kept word is due tomorrow like any other: repetitions 1, no interval yet, ease 2.5, the first review at the start of tomorrow, not due today', () => {
    const s = sitting()
    for (let i = 0; i < 4; i++) s.reach(i)
    for (const word of s.learned()) {
      expect([word.repetitions, word.interval, word.easeFactor]).toEqual([1, 0, 2.5])
      expect(word.nextReview).toEqual(new Date(2026, 9, 28))
    }
  })

  it('going back and forth counts nothing twice', () => {
    const s = sitting()
    for (const i of [0, 1, 2, 1, 0, 2, 3, 2]) s.reach(i)
    expect(learnedToday(s.settings(), NOW)).toBe(4)
    expect(s.batches).toHaveLength(4) // one step for each card reached the first time
    expect(s.logged).toHaveLength(4)
  })

  it('the settings of each step are absolute values from the settings as they were, so a step sent twice counts the same', () => {
    const s = sitting()
    s.reach(0)
    s.reach(1)
    expect(s.batches.map((b) => b.patch.new_words_learned_today_count)).toEqual([1, 2])
    expect(s.batches.map((b) => b.patch.cards_done_today_count)).toEqual([1, 2])
  })

  it('a starred word that is reached loses its star, like a word the batch taught', () => {
    const s = sitting()
    const second = s.batch().words[1]
    s.deps.applyFavorite([second.esWord], true)
    s.reach(0)
    s.reach(1)
    expect(s.stars).toEqual([{ esWord: second.esWord, favorite: false }])
  })

  it('ten cards read make the day count for the streak', () => {
    const s = sitting()
    for (let i = 0; i < 10; i++) s.reach(i)
    expect(s.settings()).toMatchObject({ streakCount: 1, streakLastActivityDate: '2026-10-27', newWordsLearnedTodayCount: 10 })
  })
})

describe('the streak is never taken away', () => {
  it('a day that reached ten cards keeps its streak when a counted word is hidden afterwards, and the words still add up', () => {
    const s = sitting()
    for (let i = 0; i < 10; i++) s.reach(i)
    expect(s.settings()).toMatchObject({ streakCount: 1, streakLastActivityDate: '2026-10-27' })
    s.hide(9)
    expect(s.settings()).toMatchObject({ streakCount: 1, streakLastActivityDate: '2026-10-27' })
    expect(s.settings().cardsDoneTodayCount).toBeGreaterThanOrEqual(10)
    expect(learnedToday(s.settings(), NOW)).toBe(s.learned().length)
  })

  it('before the day counts for the streak, cards done go down with the word that was taken out', () => {
    const s = sitting()
    for (let i = 0; i < 4; i++) s.reach(i)
    expect(s.settings().cardsDoneTodayCount).toBe(4)
    s.hide(3)
    expect(s.settings().cardsDoneTodayCount).toBe(4) // one out, the word that took its place in
    expect(s.settings().streakCount).toBe(0)
  })
})

describe('the review log', () => {
  it('a word hidden as soon as its card is reached is never logged: "Already know it" is not a rating', () => {
    const s = sitting()
    s.reach(0)
    const hiddenWord = s.batch().words[0].esWord
    s.hide(0)
    for (let i = 1; i < 10; i++) s.reach(i)
    s.keeper.finish(s.batch())
    expect(s.logged).not.toContain(hiddenWord)
    expect(s.logged).toHaveLength(10)
    expect(new Set(s.logged).size).toBe(10)
  })

  it('finishing logs the card that was still in front, so every word kept has its one row', () => {
    const s = sitting()
    for (let i = 0; i < 10; i++) s.reach(i)
    expect(s.logged).toHaveLength(9)
    s.keeper.finish(s.batch())
    expect(s.logged).toHaveLength(10)
    expect(new Set(s.logged).size).toBe(10)
  })
})

describe('finishing', () => {
  it('after every card was reached it writes nothing more, hands back the ticket of the last write, and says it finished once', () => {
    const s = sitting()
    for (let i = 0; i < 10; i++) s.reach(i)
    const writes = s.batches.length
    const ticket = s.keeper.finish(s.batch())
    expect(s.batches).toHaveLength(writes)
    expect(ticket.saved()).toBe(true)
    expect(s.keeper.finish(s.batch())).toBe(ticket) // a second tap
    expect(s.events.finished).toBe(1)
    expect(learnedToday(s.settings(), NOW)).toBe(10)
  })

  it('with nothing reached it counts the whole batch in ONE step, exactly as before (this is the single-step finisher)', () => {
    const s = sitting()
    const finish = createBatchFinisher(s.batch(), s.deps)
    const ticket = finish()
    expect(s.batches).toHaveLength(1)
    expect(s.batches[0].updates).toHaveLength(10)
    expect(finish()).toBe(ticket)
    expect(learnedToday(s.settings(), NOW)).toBe(10)
    expect(s.events.finished).toBe(1)
  })

  it('an empty batch finishes with an empty write and nothing counted', () => {
    const s = sitting({ daily_new_word_limit: 0 })
    expect(s.batch().words).toHaveLength(0)
    const ticket = s.keeper.finish(s.batch())
    expect(ticket.saved()).toBe(true)
    expect(learnedToday(s.settings(), NOW)).toBe(0)
  })
})

describe('hiding a word that was already counted', () => {
  it('takes it back out: it goes back to a word nobody has learned, the counters go down by one, and the word that takes its place is counted when it is reached', () => {
    const s = sitting()
    for (let i = 0; i < 4; i++) s.reach(i)
    const hiddenWord = s.batch().words[3].esWord
    expect(learnedToday(s.settings(), NOW)).toBe(4)
    s.hide(3)
    const word = s.words().find((w) => w.esWord === hiddenWord)!
    expect([word.isHidden, word.repetitions]).toEqual([true, 0])
    expect(s.hidden).toEqual([{ esWord: hiddenWord, hidden: true }])
    // the replacement took the place of the hidden word and was counted on arrival: four distinct words are learned, none of them the hidden one
    expect(s.learned()).toHaveLength(4)
    expect(s.learned().map((w) => w.esWord)).not.toContain(hiddenWord)
    expect(learnedToday(s.settings(), NOW)).toBe(4)
    expect(s.settings().cardsDoneTodayCount).toBe(4)
    expect(s.batch().words.slice(0, 4).map((w) => w.esWord)).not.toContain(hiddenWord)
  })

  it('does not make the goal count the word the person said they already know', () => {
    const s = sitting()
    for (let i = 0; i < 10; i++) {
      s.reach(i)
      if (i % 3 === 0) s.hide(i) // three of the ten are hidden as they are met
    }
    expect(s.learned()).toHaveLength(learnedToday(s.settings(), NOW))
    expect(learnedToday(s.settings(), NOW)).toBe(10) // ten distinct words learned, the hidden ones replaced
    expect(new Set(s.learned().map((w) => w.esWord)).size).toBe(10)
    expect(s.learned().some((w) => w.isHidden)).toBe(false)
  })

  it('Undo brings the word back and counts it again, and the word that had taken its place is taken back out', () => {
    const s = sitting()
    for (let i = 0; i < 3; i++) s.reach(i)
    const original = s.batch().words[2].esWord
    s.hide(2)
    const replacement = s.batch().words[2].esWord
    expect(replacement).not.toBe(original)
    expect(s.learned().map((w) => w.esWord)).toContain(replacement)
    s.undo(2)
    expect(s.batch().words[2].esWord).toBe(original)
    expect(s.learned().map((w) => w.esWord).sort()).toEqual(s.batch().words.slice(0, 3).map((w) => w.esWord).sort())
    expect(s.learned().map((w) => w.esWord)).not.toContain(replacement)
    expect(learnedToday(s.settings(), NOW)).toBe(3)
    expect(s.words().find((w) => w.esWord === original)!.isHidden).toBe(false)
    expect(s.logged.filter((w) => w === original)).toHaveLength(0) // it was hidden while it was the card in front, and is the card in front again: no row yet
    s.reach(3)
    expect(s.logged.filter((w) => w === original)).toHaveLength(1) // and one row per word per batch once it is left
    s.reach(2)
    s.reach(3)
    expect(s.logged.filter((w) => w === original)).toHaveLength(1)
  })
})

describe('coming back after leaving part-way', () => {
  it('after seven cards the next batch is the three that are left, and none of them is a word already read', () => {
    const s = sitting()
    const read = s.batch().words.slice(0, 7).map((w) => w.esWord)
    for (let i = 0; i < 7; i++) s.reach(i)
    const back = selectLearnBatch(s.words(), s.settings(), NOW)
    expect(back.words).toHaveLength(3)
    expect(back.words.map((w) => w.esWord).filter((w) => read.includes(w))).toEqual([])
    expect(back.newCount).toBe(3)
  })

  it('with nothing read it is the same ten in the same order, as before', () => {
    const s = sitting()
    expect(selectLearnBatch(s.words(), s.settings(), new Date(2026, 9, 27, 21, 0)).words.map((w) => w.esWord)).toEqual(s.batch().words.map((w) => w.esWord))
  })

  it('after ten cards there is nothing left to learn today', () => {
    const s = sitting()
    for (let i = 0; i < 10; i++) s.reach(i)
    expect(selectLearnBatch(s.words(), s.settings(), NOW).words).toHaveLength(0)
  })

  it('a word already seen never comes back in that day\'s later draws, however the sitting went (reaching, going back, hiding, Undo, leaving at any card)', () => {
    // a small deterministic generator: every script is the same on every run
    let seed = 12345
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let run = 0; run < 60; run++) {
      const s = sitting({ daily_new_word_limit: 10 + (run % 3) * 5 })
      const seen = new Set<string>()
      const steps = 4 + Math.floor(random() * 25)
      let index = 0
      s.reach(0) // Learn opens on the first card, and that one is counted
      seen.add(s.batch().words[0].esWord)
      for (let step = 0; step < steps; step++) {
        const roll = random()
        const last = s.batch().words.length - 1
        if (roll < 0.55) index = Math.min(last, index + 1)
        else if (roll < 0.7) index = Math.max(0, index - 1)
        else if (roll < 0.9) {
          s.hide(index)
          index = Math.min(index, s.batch().words.length - 1)
        } else if (s.batch().known.length > 0) {
          s.undo(index)
          index = Math.min(index, s.batch().words.length - 1)
        }
        if (s.batch().words[index]) {
          s.reach(index)
          seen.add(s.batch().words[index].esWord)
        }
        // whatever is on screen when the person stops is either learned or, for a word that was hidden, out of the pool: both leave the draw
        const redraw = selectLearnBatch(s.words(), s.settings(), NOW)
        const learned = new Set(s.learned().map((w) => w.esWord))
        const hiddenNow = new Set(s.words().filter((w) => w.isHidden).map((w) => w.esWord))
        for (const word of redraw.words) {
          expect(learned.has(word.esWord), `run ${run} step ${step}: ${word.esWord} is learned and drawn again`).toBe(false)
          expect(hiddenNow.has(word.esWord), `run ${run} step ${step}: ${word.esWord} is hidden and drawn again`).toBe(false)
        }
        // and the words reached are all accounted for: learned, or hidden
        for (const word of s.batch().words.slice(0, index + 1)) expect(learned.has(word.esWord) || hiddenNow.has(word.esWord), `run ${run}: ${word.esWord} was reached and is neither learned nor hidden`).toBe(true)
        // the counter is the number of words that are learned
        expect(learnedToday(s.settings(), NOW), `run ${run} step ${step}`).toBe(learned.size)
      }
    }
  })
})
