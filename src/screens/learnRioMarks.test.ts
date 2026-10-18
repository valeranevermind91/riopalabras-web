import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { WordCard } from '../components/WordCard'
import { parseDictionary } from '../data/dictionary'
import { headword } from '../data/headword'
import { parseRioOverlay } from '../data/rio'
import { headwordRegion } from '../data/relation'
import { isInLearnPool } from '../data/stats'
import { parseSettings } from '../data/settings'
import type { Word } from '../data/types'
import { createWriteQueue } from '../data/writeQueue'
import { setLanguage } from '../lib/language'
import { LearnScreen } from './Learn'

/**
 * The Learn card is the word's first meeting with the person, and for a Rioplatense word that is where the app should say so. It does, with the same
 * component every surface uses (WordCard: the pill, the UY / AR tag, the register), not a second set of marks. These pin that on real words.
 */
const words = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')), parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))))
const settings = parseSettings({ daily_new_word_limit: 10 })
const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
const learnable = words.filter((w) => w.rio && isInLearnPool(w))

const withRegion = (region: 'uy' | 'ar') => learnable.find((w) => headword(w).form === 'rioplatense' && headwordRegion(w) === region)!
const noRegion = learnable.find((w) => headword(w).form === 'rioplatense' && headwordRegion(w) === null)!
const standardHeadword = learnable.find((w) => headword(w).form === 'standard' && w.rio!.type === 'meaning_shift')!

/** The Learn screen with this one word as the only thing to learn, so its card is the first. */
const learnCard = (word: Word) => renderToStaticMarkup(createElement(LearnScreen, { data: { words: [word], settings, getSettings: () => settings, applyProgress: () => {}, applySettings: () => {} } as never, queue, metrics: null, onHome: () => {}, onReview: () => {} }))
const metaOf = (html: string) => html.match(/<div class="wc-meta">.*?<\/div>/)![0]
const cardElsewhere = (word: Word) => renderToStaticMarkup(createElement(WordCard, { word, settings }))

afterEach(() => setLanguage('en'))

describe('the Learn card shows what makes a word Rioplatense, as the other surfaces do', () => {
  it('there are real words of each kind to check (so none of this is vacuous)', () => {
    for (const word of [withRegion('uy'), withRegion('ar'), noRegion, standardHeadword]) expect(word).toBeDefined()
  })

  it('a Rioplatense word with a region: the "Rioplatense" pill and its UY / AR tag, with the tag\'s own title', () => {
    const uy = metaOf(learnCard(withRegion('uy')))
    expect(uy).toContain('<span class="wc-rio">Rioplatense</span>')
    expect(uy).toContain('<span class="wc-tag" title="Used in Uruguay">UY</span>')
    expect(uy.indexOf('wc-rio')).toBeLessThan(uy.indexOf('wc-tag')) // the pill first, then the region
    const ar = metaOf(learnCard(withRegion('ar')))
    expect(ar).toContain('<span class="wc-rio">Rioplatense</span>')
    expect(ar).toContain('<span class="wc-tag" title="Used in Argentina">AR</span>')
  })

  it('a Rioplatense word with no region: the pill, and nothing in place of the region (no tag, no "unknown")', () => {
    const html = learnCard(noRegion)
    expect(metaOf(html)).toContain('<span class="wc-rio">Rioplatense</span>')
    expect(metaOf(html)).not.toContain('wc-tag')
    expect(html).not.toMatch(/unknown|both countries/i)
  })

  it('a word whose headword stays the standard one carries no pill, as everywhere else', () => {
    expect(metaOf(learnCard(standardHeadword))).not.toContain('wc-rio')
  })

  it('the marks are exactly the ones every other surface draws for the same word: Learn\'s card holds the card the word has elsewhere', () => {
    for (const word of [withRegion('uy'), withRegion('ar'), noRegion, standardHeadword]) {
      const learn = learnCard(word)
      expect(learn, word.esWord).toContain(cardElsewhere(word)) // the very same markup, from the same component
      expect(metaOf(learn)).toBe(metaOf(cardElsewhere(word)))
    }
  })

  it('in Russian, the same marks in the same words as the Russian card elsewhere («риоплатское», UY)', () => {
    setLanguage('ru')
    const html = learnCard(withRegion('uy'))
    expect(metaOf(html)).toContain('<span class="wc-rio">риоплатское</span>')
    expect(metaOf(html)).toContain('title="Употребляется в Уругвае">UY</span>')
    expect(html).toContain(cardElsewhere(withRegion('uy')))
  })

  it('Learn draws the shared card and has no marks of its own: no second visual language for the same fact', () => {
    const source = readFileSync('src/screens/Learn.tsx', 'utf8')
    expect(source).toContain('<WordCard word={words[index]} settings={data.settings} />')
    expect(source).not.toMatch(/wc-rio|wc-tag|RegionTag|strings\.rio|isRioplatense|headwordRegion/)
  })
})
