import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { isInLearnPool } from './stats'
import { isReferenceOnly, lastReviewedAt, wordStatus, WELL_LEARNED_DAYS } from './wordState'

const NOW = new Date('2026-10-06T15:00:00Z')
const past = new Date('2026-10-05T03:00:00Z')
const future = new Date('2026-10-12T03:00:00Z')
const word = (over = {}) => makeWord('casa', { pos: 'n', ...over })
const kind = (over = {}, now = NOW) => wordStatus(word(over), now).kind

describe('wordStatus: hidden, reference, new, learning, wellLearned — and due, which overlaps them', () => {
  it('a word nobody has touched is new, not started, not due', () => {
    expect(wordStatus(word(), NOW)).toEqual({ kind: 'new', due: false, started: false })
  })

  it('the stage is decided by the interval, not by the number of repetitions: under WELL_LEARNED_DAYS is learning, from there on well learned', () => {
    expect(kind({ repetitions: 1, interval: 0, nextReview: future })).toBe('learning') // just seen in Learn
    expect(kind({ repetitions: 2, interval: 1, nextReview: future })).toBe('learning') // one successful review
    expect(kind({ repetitions: 3, interval: WELL_LEARNED_DAYS - 1, nextReview: future })).toBe('learning')
    expect(kind({ repetitions: 3, interval: WELL_LEARNED_DAYS, nextReview: future })).toBe('wellLearned')
    expect(kind({ repetitions: 9, interval: 270, nextReview: future })).toBe('wellLearned')
    // a long run of repetitions at short intervals is still learning; two repetitions at a long interval are well learned
    expect(kind({ repetitions: 12, interval: 3, nextReview: future })).toBe('learning')
    expect(kind({ repetitions: 2, interval: 40, nextReview: future })).toBe('wellLearned')
  })

  it('a well learned word that lapses (rated Again: interval 0) goes back to learning', () => {
    expect(kind({ repetitions: 1, interval: 0, easeFactor: 1.9, nextReview: new Date(NOW.getTime() + 10 * 60_000) })).toBe('learning')
  })

  it('due is not a stage: a due word keeps its stage, whatever its next review is', () => {
    for (const nextReview of [past, NOW, null, future]) {
      expect(kind({ repetitions: 1, interval: 0, nextReview })).toBe('learning')
      expect(kind({ repetitions: 4, interval: 30, nextReview })).toBe('wellLearned')
    }
  })

  it('due is true once the next review has arrived (exactly now counts), and for a studied word with no stored schedule; never for a word not studied', () => {
    const due = (over: object) => wordStatus(word(over), NOW).due
    expect(due({ repetitions: 1, nextReview: past })).toBe(true)
    expect(due({ repetitions: 5, interval: 30, nextReview: past })).toBe(true)
    expect(due({ repetitions: 2, nextReview: NOW })).toBe(true)
    expect(due({ repetitions: 2, nextReview: null })).toBe(true)
    expect(due({ repetitions: 2, nextReview: new Date(NOW.getTime() + 1) })).toBe(false)
    expect(due({ repetitions: 0, nextReview: past })).toBe(false)
  })

  it('a word just finished in Learn is learning until its midnight, and learning and due after it — the case that used to empty "in progress" out at midnight', () => {
    const midnight = new Date(2026, 9, 7) // what finishing Learn leaves: start of the next local day
    const learned = word({ repetitions: 1, interval: 0, nextReview: midnight })
    const before = wordStatus(learned, new Date(2026, 9, 6, 23, 59))
    const after = wordStatus(learned, new Date(2026, 9, 7, 0, 0))
    expect(before).toEqual({ kind: 'learning', due: false, started: true })
    expect(after).toEqual({ kind: 'learning', due: true, started: true })
  })

  it('a word rated Again is learning while it waits its ten minutes and after: only the due flag changes', () => {
    const tenMinutes = 10 * 60 * 1000
    const rated = word({ repetitions: 1, interval: 0, easeFactor: 2.18, nextReview: new Date(NOW.getTime() + tenMinutes) })
    expect(wordStatus(rated, NOW)).toMatchObject({ kind: 'learning', due: false })
    expect(wordStatus(rated, new Date(NOW.getTime() + tenMinutes - 1))).toMatchObject({ kind: 'learning', due: false })
    expect(wordStatus(rated, new Date(NOW.getTime() + tenMinutes))).toMatchObject({ kind: 'learning', due: true })
  })

  describe('"started": a word that has been studied (repetitions above 0) and is not hidden', () => {
    it('is true from the first Learn on, whatever the stage or due', () => {
      for (const over of [{ repetitions: 1 }, { repetitions: 2, interval: 3 }, { repetitions: 5, interval: 60, nextReview: past }]) expect(wordStatus(word(over), NOW).started).toBe(true)
    })

    it('a stored schedule alone does not start a word: repetitions 0 is new and not started (a word Learn can still teach must not read as learning)', () => {
      // the case an earlier version left behind: it lapsed a word back to repetitions 0 and kept its next_review
      const lapsed = word({ repetitions: 0, interval: 0, easeFactor: 2.18, nextReview: past })
      expect(wordStatus(lapsed, NOW)).toEqual({ kind: 'new', due: false, started: false })
      expect(isInLearnPool(lapsed)).toBe(true) // Learn will still teach it, so it reads as new
    })

    it('every word Learn can still teach is new, for any stored schedule', () => {
      for (const nextReview of [null, past, future]) {
        for (const interval of [0, 1, 25]) {
          for (const easeFactor of [1.3, 2.5]) {
            const w = word({ repetitions: 0, interval, nextReview, easeFactor })
            expect(isInLearnPool(w)).toBe(true)
            expect(wordStatus(w, NOW).kind, `${nextReview} ${interval} ${easeFactor}`).toBe('new')
            expect(wordStatus(w, NOW).started).toBe(false)
          }
        }
      }
    })

    it('hidden words are not started (they are in Known); reference-only words that were studied are', () => {
      expect(wordStatus(word({ isHidden: true, repetitions: 3, interval: 30 }), NOW).started).toBe(false)
      expect(wordStatus(word({ pos: 'prep', repetitions: 3 }), NOW).started).toBe(true)
    })
  })

  it('last reviewed: a word rated Again was rated ten minutes before it is due; a word just learned, the day before its due midnight', () => {
    const due = new Date(2026, 9, 6, 15, 10) // not on a day boundary: an Again's ten minutes
    expect(lastReviewedAt(word({ repetitions: 1, interval: 0, nextReview: due }))).toEqual(new Date(2026, 9, 6, 15, 0))
    const midnight = new Date(2026, 9, 7) // start of the next day: what finishing Learn leaves
    expect(lastReviewedAt(word({ repetitions: 1, interval: 0, nextReview: midnight }))).toEqual(new Date(2026, 9, 6))
    expect(lastReviewedAt(word({ repetitions: 2, interval: 3, nextReview: new Date(2026, 9, 9, 12) }))).toEqual(new Date(2026, 9, 6, 12))
  })

  describe('reference-only: it can never enter Learn or Review', () => {
    it.each(['prep', 'art', 'conj', 'pron', 'determiner', 'contraction'])('the part of speech %s', (pos) => {
      expect(isReferenceOnly(word({ pos }))).toBe(true)
      expect(kind({ pos })).toBe('reference')
    })

    it('a word with no translation, or only one of the two', () => {
      expect(kind({ enTranslation: '', ruTranslation: '' })).toBe('reference')
      expect(kind({ enTranslation: 'house', ruTranslation: '' })).toBe('reference')
      expect(kind({ enTranslation: '', ruTranslation: 'дом' })).toBe('reference')
    })

    it('beats every stage, and is never due (it is never practised, whatever is stored for it)', () => {
      expect(wordStatus(word({ pos: 'prep', repetitions: 3, interval: 40, nextReview: past }), NOW)).toEqual({ kind: 'reference', due: false, started: true })
    })

    it('an ordinary noun, verb, adjective or adverb is not reference-only', () => {
      for (const pos of ['n', 'v', 'adj', 'adv', 'num', 'interj']) expect(isReferenceOnly(word({ pos }))).toBe(false)
    })

    it('a letter of the alphabet is: "c (letter)" is not a word to learn', () => {
      expect(isReferenceOnly(word({ pos: 'letter' }))).toBe(true)
      expect(kind({ pos: 'letter' })).toBe('reference')
    })
  })

  describe('hidden beats everything', () => {
    it('hidden, with or without progress, is hidden and not due — even when it is also due or reference-only', () => {
      expect(wordStatus(word({ isHidden: true }), NOW)).toEqual({ kind: 'hidden', due: false, started: false })
      expect(wordStatus(word({ isHidden: true, repetitions: 3, interval: 40, nextReview: past }), NOW)).toEqual({ kind: 'hidden', due: false, started: false })
      expect(kind({ isHidden: true, pos: 'prep' })).toBe('hidden')
    })
    it('hiding does not touch progress: the stage under a hidden word is still there to come back to', () => {
      const hidden = word({ isHidden: true, repetitions: 3, interval: 40, nextReview: future })
      expect(wordStatus({ ...hidden, isHidden: false }, NOW)).toEqual({ kind: 'wellLearned', due: false, started: true })
    })
  })
})

describe('WELL_LEARNED_DAYS: the one place the 21-day line is drawn', () => {
  it('is 21 (changing it is a product decision: this test is the place to change on purpose)', () => {
    expect(WELL_LEARNED_DAYS).toBe(21)
  })

  it('is the line the stage is cut at: 20 days is learning, 21 well learned', () => {
    expect(kind({ repetitions: 4, interval: 20 })).toBe('learning')
    expect(kind({ repetitions: 4, interval: 21 })).toBe('wellLearned')
  })

  it('no other source file draws its own line: the number 21 is not compared with an interval anywhere else', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) files.push(path)
      }
    }
    walk('src')
    const offenders = files.filter((f) => !f.endsWith('data/wordState.ts') && /interval[^\n]{0,24}\b21\b|\b21\b[^\n]{0,24}interval|WELL_LEARNED[^\n]{0,24}\b21\b/i.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
    expect(readFileSync('src/data/wordState.ts', 'utf8').match(/WELL_LEARNED_DAYS = 21/g)).toHaveLength(1)
  })
})
