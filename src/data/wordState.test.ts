import { describe, expect, it } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { hasHistory, hasProgress, isReferenceOnly, wordStage, wordState } from './wordState'

const NOW = new Date('2026-10-06T15:00:00Z')
const past = new Date('2026-10-05T03:00:00Z')
const future = new Date('2026-10-12T03:00:00Z')
const word = (over = {}) => makeWord('casa', { pos: 'n', ...over })

describe('wordState: hidden, reference-only, due, established, learning, new — in that order', () => {
  it('a word nobody has touched is new', () => {
    expect(wordState(word(), NOW)).toBe('new')
    expect(hasProgress(word())).toBe(false)
    expect(hasHistory(word())).toBe(false)
  })

  it('one repetition is learning, two or more is established, when nothing is due yet', () => {
    expect(wordState(word({ repetitions: 1, nextReview: future }), NOW)).toBe('learning')
    expect(wordState(word({ repetitions: 2, nextReview: future }), NOW)).toBe('established')
    expect(wordState(word({ repetitions: 9, nextReview: future }), NOW)).toBe('established')
  })

  it('a learned word whose next review has come is due, whatever its stage; one with no stored schedule counts as due', () => {
    expect(wordState(word({ repetitions: 1, nextReview: past }), NOW)).toBe('due')
    expect(wordState(word({ repetitions: 5, nextReview: past }), NOW)).toBe('due')
    expect(wordState(word({ repetitions: 2, nextReview: NOW }), NOW)).toBe('due') // exactly now
    expect(wordState(word({ repetitions: 2, nextReview: null }), NOW)).toBe('due')
    expect(wordState(word({ repetitions: 2, nextReview: new Date(NOW.getTime() + 1) }), NOW)).toBe('established')
  })

  it('a due word still has a stage (the row dot shows it, the Due badge says the rest)', () => {
    expect(wordStage(word({ repetitions: 1, nextReview: past }))).toBe('learning')
    expect(wordStage(word({ repetitions: 4, nextReview: past }))).toBe('established')
    expect(wordStage(word())).toBe('new')
  })

  it('a lapsed word reads as new — and carries its history, so the detail can say why', () => {
    const lapsed = word({ repetitions: 0, interval: 0, easeFactor: 2.18, nextReview: past })
    expect(wordState(lapsed, NOW)).toBe('new') // not due: due needs repetitions
    expect(hasHistory(lapsed)).toBe(true)
    expect(hasProgress(lapsed)).toBe(true) // so it is in the Learned list
    expect(hasHistory(word({ repetitions: 1, nextReview: past }))).toBe(false) // a learned word has progress, not a lapse
  })

  describe('reference-only: it can never enter Learn or Review', () => {
    it.each(['prep', 'art', 'conj', 'pron', 'determiner', 'contraction'])('the part of speech %s', (pos) => {
      expect(isReferenceOnly(word({ pos }))).toBe(true)
      expect(wordState(word({ pos }), NOW)).toBe('reference')
    })

    it('a word with no translation, or only one of the two', () => {
      expect(wordState(word({ enTranslation: '', ruTranslation: '' }), NOW)).toBe('reference')
      expect(wordState(word({ enTranslation: 'house', ruTranslation: '' }), NOW)).toBe('reference')
      expect(wordState(word({ enTranslation: '', ruTranslation: 'дом' }), NOW)).toBe('reference')
    })

    it('beats due, established and learning (it is never practised, whatever is stored for it)', () => {
      expect(wordState(word({ pos: 'prep', repetitions: 3, nextReview: past }), NOW)).toBe('reference')
    })

    it('an ordinary noun, verb, adjective or adverb is not reference-only', () => {
      for (const pos of ['n', 'v', 'adj', 'adv', 'num', 'interj', 'letter']) expect(isReferenceOnly(word({ pos }))).toBe(false)
    })
  })

  describe('hidden beats everything', () => {
    it('hidden, with or without progress, is hidden — even when it is also due or reference-only', () => {
      expect(wordState(word({ isHidden: true }), NOW)).toBe('hidden')
      expect(wordState(word({ isHidden: true, repetitions: 3, nextReview: past }), NOW)).toBe('hidden')
      expect(wordState(word({ isHidden: true, pos: 'prep' }), NOW)).toBe('hidden')
    })
    it('hiding does not touch progress: the stage under a hidden word is still there to come back to', () => {
      const hidden = word({ isHidden: true, repetitions: 3, nextReview: future })
      expect(wordStage(hidden)).toBe('established')
      expect(wordState({ ...hidden, isHidden: false }, NOW)).toBe('established')
    })
  })
})
