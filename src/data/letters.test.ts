import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from './dictionary'
import { buildPlacement, placementPool } from './placement'
import { isInLearnPool, isReviewDue } from './stats'
import { wordState } from './wordState'

// The real dictionary has entries for the letters of the alphabet ("c (letter)", "The letter C is the third in the alphabet."). They are not words
// to learn, and the placement test once asked whether you know "c".
const words = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')))
const letters = words.filter((w) => w.pos === 'letter')
const NOW = new Date('2026-10-17T12:00:00Z')

describe('the letters of the alphabet are reference only', () => {
  it('the dictionary has them (so the rest of this file is not vacuous)', () => {
    expect(letters.length).toBeGreaterThanOrEqual(10)
    expect(letters.map((w) => w.esWord)).toContain('c')
  })

  it('none is in the Learn pool or in the placement pool', () => {
    expect(letters.filter(isInLearnPool)).toEqual([])
    expect(placementPool(words).filter((w) => w.pos === 'letter')).toEqual([])
  })

  it('no placement set, in a few hundred draws, contains one', () => {
    for (let draw = 0; draw < 300; draw++) {
      const bands = buildPlacement(words)!
      for (const band of bands) expect(band.words.filter((w) => w.pos === 'letter')).toEqual([])
    }
  })

  it('one already learned is never due for Review, and the word list calls it reference only', () => {
    const learned = { ...letters[0], repetitions: 3, interval: 6, nextReview: new Date(NOW.getTime() - 86_400_000) }
    expect(isReviewDue(learned, NOW)).toBe(false)
    expect(wordState(learned, NOW)).toBe('reference')
  })

  it('only the part of speech decides: an abbreviation such as OK or pm is left as it was', () => {
    for (const abbreviation of ['OK', 'pm']) {
      const word = words.find((w) => w.esWord === abbreviation)!
      expect(word.pos, abbreviation).not.toBe('letter')
      expect(isInLearnPool(word), abbreviation).toBe(true)
    }
  })
})
