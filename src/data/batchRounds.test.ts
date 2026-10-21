import { describe, expect, it } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { RU_ONLY } from '../testing/translationFlags'
import { batchPracticeAvailable, buildBatchRounds, glossKey, MATCH_GROUP_SIZE, PRACTICE_MIN_WORDS, type MatchGroup } from './practice'
import type { Word } from './types'
import { wordKey } from './words'

// The rounds that practise a Learn batch: every word of the batch in at least one round, nothing from outside it, the last round filled with repeats from the
// same batch, and a round is a Matching group (five words with pairwise different glosses).

const past = new Date('2026-10-01T03:00:00.000Z')
const letters = 'абвгдежзиклмнопрстуфхцчшщэюя'
/** A learned word with a gloss of its own (the gloss is told by its number). */
const learned = (name: string, gloss: string = `слово ${name}`, over: Partial<Word> = {}) => makeWord(name, { repetitions: 1, nextReview: past, ruTranslation: gloss, ...over })
const batchOfN = (n: number) => Array.from({ length: n }, (_, i) => learned(`lote${String(i).padStart(2, '0')}`, `слово ${letters[i % letters.length]}${letters[Math.floor(i / letters.length)]}`))
/** Words the person has learned before, which must never turn up while a batch is practised. */
const others = Array.from({ length: 60 }, (_, i) => learned(`otra${String(i).padStart(2, '0')}`, `другое ${letters[i % letters.length]}${letters[Math.floor(i / letters.length)]}`))
const keysOf = (words: readonly Word[]) => new Set(words.map((w) => wordKey(w.esWord)))
const ids = (g: MatchGroup) => g.items.map((m) => m.id)

/** A small deterministic random, so a failing case can be played again. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

function expectPracticeOf(batch: readonly Word[], rounds: readonly MatchGroup[] | null) {
  expect(rounds).not.toBeNull()
  const inBatch = keysOf(batch)
  const seen = new Set<string>()
  for (const round of rounds!) {
    expect(round.items).toHaveLength(MATCH_GROUP_SIZE)
    expect(new Set(round.items.map((m) => glossKey(m.gloss))).size).toBe(MATCH_GROUP_SIZE) // a round never holds two words with one gloss
    expect(new Set(round.items.map((m) => m.spanish.toLowerCase())).size).toBe(MATCH_GROUP_SIZE)
    expect(ids(round).sort()).toEqual(round.left.map((m) => m.id).sort()) // both columns hold the round's words
    expect(ids(round).sort()).toEqual(round.right.map((m) => m.id).sort())
    for (const id of ids(round)) {
      expect(inBatch.has(id), `${id} is not in the batch`).toBe(true)
      seen.add(id)
    }
  }
  return seen
}

describe('batchPracticeAvailable: Matching can run on the batch', () => {
  it('needs five words with different glosses: four give no offer, five do', () => {
    expect(PRACTICE_MIN_WORDS).toBe(5)
    for (const [n, expected] of [[0, false], [1, false], [4, false], [5, true], [10, true]] as const) {
      const batch = batchOfN(n)
      expect(batchPracticeAvailable([...batch, ...others], keysOf(batch), RU_ONLY), `${n} words`).toBe(expected)
    }
  })

  it('counts the batch only: the person may have hundreds of other practice words, and four in the batch are still four', () => {
    const batch = batchOfN(4)
    expect(batchPracticeAvailable([...batch, ...others], keysOf(batch), RU_ONLY)).toBe(false)
    expect(buildBatchRounds([...batch, ...others], keysOf(batch), RU_ONLY)).toBeNull()
  })

  it('counts words, not repeats of a gloss: six words of which two share a gloss are five; five of which two share a gloss are four', () => {
    const six = [...batchOfN(5), learned('lote05', 'слово аа')] // the same gloss as lote00
    expect(batchPracticeAvailable(six, keysOf(six), RU_ONLY)).toBe(true)
    const five = [...batchOfN(4), learned('lote04', 'слово аа')]
    expect(batchPracticeAvailable(five, keysOf(five), RU_ONLY)).toBe(false)
    expect(buildBatchRounds(five, keysOf(five), RU_ONLY)).toBeNull()
  })

  it('does not count a word Matching cannot use: hidden, without a gloss in the language shown, or not learned', () => {
    const batch = batchOfN(5)
    const hidden = batch.map((w, i) => (i === 0 ? { ...w, isHidden: true } : w))
    expect(batchPracticeAvailable(hidden, keysOf(batch), RU_ONLY)).toBe(false)
    const noGloss = batch.map((w, i) => (i === 0 ? { ...w, ruTranslation: '', enTranslation: '' } : w))
    expect(batchPracticeAvailable(noGloss, keysOf(batch), RU_ONLY)).toBe(false)
    const unlearned = batch.map((w, i) => (i === 0 ? { ...w, repetitions: 0 } : w))
    expect(batchPracticeAvailable(unlearned, keysOf(batch), RU_ONLY)).toBe(false)
  })
})

describe('buildBatchRounds', () => {
  it('a batch of ten: two rounds, every word in exactly one of them', () => {
    const batch = batchOfN(10)
    for (let i = 0; i < 30; i++) {
      const rounds = buildBatchRounds([...others, ...batch], keysOf(batch), RU_ONLY, seeded(i + 1))!
      expect(rounds).toHaveLength(2)
      const all = rounds.flatMap(ids)
      expect(new Set(all).size).toBe(10)
      expect([...expectPracticeOf(batch, rounds)].sort()).toEqual([...keysOf(batch)].sort())
    }
  })

  it('a batch of five is one round of exactly those five', () => {
    const batch = batchOfN(5)
    const rounds = buildBatchRounds([...others, ...batch], keysOf(batch), RU_ONLY)!
    expect(rounds).toHaveLength(1)
    expect(ids(rounds[0]).sort()).toEqual([...keysOf(batch)].sort())
  })

  it('a batch that does not divide by five: the last round is filled with repeats from the same batch, and the rounds are as few as can be', () => {
    for (const n of [6, 7, 8, 9]) {
      const batch = batchOfN(n)
      for (let i = 0; i < 30; i++) {
        const rounds = buildBatchRounds([...others, ...batch], keysOf(batch), RU_ONLY, seeded(100 * n + i))!
        expect(rounds, `${n} words`).toHaveLength(2)
        expect([...expectPracticeOf(batch, rounds)].sort(), `${n} words`).toEqual([...keysOf(batch)].sort())
        const repeats = rounds.flatMap(ids).length - new Set(rounds.flatMap(ids)).size
        expect(repeats, `${n} words`).toBe(10 - n) // the second round is the n - 5 words not yet seen, plus repeats
        expect(ids(rounds[1]).filter((id) => ids(rounds[0]).includes(id))).toHaveLength(10 - n)
      }
    }
  })

  it('nothing from outside the batch: not in a round, and not as a filler either', () => {
    const batch = batchOfN(6)
    const inBatch = keysOf(batch)
    for (let i = 0; i < 100; i++) {
      for (const round of buildBatchRounds([...others, ...batch], inBatch, RU_ONLY, seeded(i + 7))!) {
        for (const m of [...round.items, ...round.left, ...round.right]) expect(inBatch.has(m.id)).toBe(true)
      }
    }
  })

  it('two words with one gloss are never in one round, and both are practised', () => {
    const batch = [...batchOfN(6), learned('lote06', 'слово аа'), learned('lote07', 'слово бб')] // lote06 shares lote00's gloss
    for (let i = 0; i < 100; i++) {
      const rounds = buildBatchRounds(batch, keysOf(batch), RU_ONLY, seeded(i + 3))!
      const seen = expectPracticeOf(batch, rounds)
      expect(seen.size).toBe(batch.length)
    }
  })

  it('every word of the batch is practised, for any pattern of shared glosses (the batch is only five different glosses at the barest)', () => {
    const random = seeded(2026)
    for (let trial = 0; trial < 400; trial++) {
      const n = 5 + Math.floor(random() * 6) // 5..10
      const classes = 1 + Math.floor(random() * n) // how many different glosses the n words share among them
      const batch = Array.from({ length: n }, (_, i) => learned(`lote${String(i).padStart(2, '0')}`, `слово ${letters[Math.floor(random() * classes)]}`))
      const distinct = new Set(batch.map((w) => glossKey(w.ruTranslation))).size
      const rounds = buildBatchRounds(batch, keysOf(batch), RU_ONLY, seeded(trial + 1))
      if (distinct < MATCH_GROUP_SIZE) {
        expect(rounds, `${distinct} glosses`).toBeNull()
        continue
      }
      expect(expectPracticeOf(batch, rounds).size, `${n} words, ${distinct} glosses`).toBe(n)
    }
  })

  it('reads the batch from the words as they are now: the batch is held as it was drawn (not yet learned), the words in use are learned', () => {
    const drawn = batchOfN(5).map((w) => ({ ...w, repetitions: 0 }))
    const now = drawn.map((w) => ({ ...w, repetitions: 1 }))
    expect(buildBatchRounds([...others, ...now], keysOf(drawn), RU_ONLY)).not.toBeNull()
    expect(buildBatchRounds([...others, ...drawn], keysOf(drawn), RU_ONLY)).toBeNull() // before Finish batch there is nothing learned to practise
  })

  it('the gloss is the one the card shows in the language chosen', () => {
    const batch = batchOfN(5).map((w, i) => ({ ...w, enTranslation: `thing${i}` }))
    const rounds = buildBatchRounds(batch, keysOf(batch), { showRuTranslation: false, showEnTranslation: true })!
    expect(rounds[0].items.map((m) => m.gloss).sort()).toEqual(batch.map((_, i) => `thing${i}`).sort())
  })

  it('draws the order at random: the same batch is not always in the same rounds', () => {
    const batch = batchOfN(10)
    const firsts = new Set<string>()
    for (let i = 0; i < 30; i++) firsts.add(ids(buildBatchRounds(batch, keysOf(batch), RU_ONLY, seeded(i + 1))![0]).sort().join())
    expect(firsts.size).toBeGreaterThan(1)
  })
})
