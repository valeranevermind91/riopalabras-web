import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ReviewCard } from '../components/ReviewCard'
import { WordCard } from '../components/WordCard'
import { parseDictionary } from '../data/dictionary'
import { headword } from '../data/headword'
import { parseRioOverlay } from '../data/rio'
import { headwordRegion, isRioplatenseWord } from '../data/relation'
import { isInLearnPool } from '../data/stats'
import { parseSettings } from '../data/settings'
import type { Word } from '../data/types'
import { createWriteQueue } from '../data/writeQueue'
import { setLanguage } from '../lib/language'
import { strings } from '../strings'
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
const boleto = learnable.find((w) => w.esWord === 'boleto')! // a meaning shift: it looks ordinary and means something else here
const ordinary = words.find((w) => w.esWord === 'casa' && !w.rio)! // an ordinary dictionary word
const shifts = words.filter((w) => w.rio?.type === 'meaning_shift')
const regionalOnly = words.filter((w) => w.rio?.type === 'regional_only')

/** The Learn screen with this one word as the only thing to learn, so its card is the first. */
const learnCard = (word: Word) => renderToStaticMarkup(createElement(LearnScreen, { data: { words: [word], settings, getSettings: () => settings, applyProgress: () => {}, applySettings: () => {} } as never, queue, metrics: null, onHome: () => {}, onReview: () => {} }))
const metaOf = (html: string) => html.match(/<div class="wc-meta">.*?<\/div>/)![0]
const cardElsewhere = (word: Word) => renderToStaticMarkup(createElement(WordCard, { word, settings }))

afterEach(() => setLanguage('en'))

describe('the Learn card shows what makes a word Rioplatense, as the other surfaces do', () => {
  it('there are real words of each kind to check (so none of this is vacuous)', () => {
    for (const word of [withRegion('uy'), withRegion('ar'), noRegion, boleto, ordinary]) expect(word).toBeDefined()
    expect([shifts.length, regionalOnly.length]).toEqual([11, 2])
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

  it('a word whose meaning shifts keeps the standard headword and still carries the pill: this word works differently here', () => {
    const html = learnCard(boleto)
    expect(headword(boleto).form).toBe('standard') // the headword is "boleto" itself
    expect(metaOf(html)).toContain('<span class="wc-rio">Rioplatense</span>')
    expect(metaOf(html)).not.toContain('wc-tag') // and no country: the overlay has none for it, and none is invented
  })

  it('the marks are exactly the ones every other surface draws for the same word: Learn\'s card holds the card the word has elsewhere', () => {
    for (const word of [withRegion('uy'), withRegion('ar'), noRegion, boleto, ordinary]) {
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

describe('every overlay entry carries the pill, and an ordinary dictionary word carries nothing', () => {
  const overlay = words.filter((w) => w.rio)

  it('all 76 overlay entries do: the local headwords (63), the meaning shifts (11) and the two regional-only words', () => {
    expect(overlay).toHaveLength(76)
    for (const word of overlay) expect(isRioplatenseWord(word), word.esWord).toBe(true)
    for (const word of overlay) expect(cardElsewhere(word), word.esWord).toContain('<span class="wc-rio">Rioplatense</span>')
  })

  it('no ordinary dictionary word does: a word with no overlay entry and no local headword shows nothing Rioplatense, flagged or not in the old data', () => {
    const ordinaryWords = words.filter((w) => !w.rio)
    expect(ordinaryWords.length).toBeGreaterThan(4000)
    expect(ordinaryWords.filter(isRioplatenseWord).map((w) => w.esWord)).toEqual([])
    const card = cardElsewhere(ordinary)
    expect(card).not.toContain('wc-rio')
    expect(card).not.toContain('wc-tag')
    expect(card).not.toContain('wc-shift')
    expect(card).not.toContain('wc-relation')
  })

  it('the country tag is exactly as it was: five overlay entries carry one (two UY, three AR), the meaning shifts and the regional-only words none', () => {
    const tagged = overlay.filter((w) => cardElsewhere(w).includes('wc-tag'))
    expect(tagged).toHaveLength(5)
    expect(tagged.map((w) => headwordRegion(w)).sort()).toEqual(['ar', 'ar', 'ar', 'uy', 'uy'])
    for (const word of [...shifts, ...regionalOnly]) expect(cardElsewhere(word), word.esWord).not.toContain('wc-tag')
  })

  it('a meaning shift says so in a line of its own, above the standard meaning it differs from: "A different meaning in this region"', () => {
    for (const word of shifts) {
      const card = cardElsewhere(word)
      expect(card, word.esWord).toContain('<p class="wc-shift">A different meaning in this region</p>')
    }
    const html = learnCard(boleto)
    expect(html.indexOf('wc-shift')).toBeLessThan(html.indexOf('Standard meaning'))
    expect(html).toContain('Standard meaning: ') // the standard meaning is still given
    expect(html).toContain('bus ticket') // and so is the local one
    expect(html.indexOf('wc-headword')).toBeLessThan(html.indexOf('wc-shift')) // under the headword
  })

  it('only a meaning shift says it: not a local headword, not a regional-only word, not an ordinary word', () => {
    for (const word of [withRegion('uy'), withRegion('ar'), noRegion, ...regionalOnly, ordinary]) expect(cardElsewhere(word), word.esWord).not.toContain('wc-shift')
  })

  it('in Russian: the pill «риоплатское» and the line «В этом регионе другое значение», above «Обычное значение»', () => {
    setLanguage('ru')
    const html = learnCard(boleto)
    expect(metaOf(html)).toContain('<span class="wc-rio">риоплатское</span>')
    expect(html).toContain('<p class="wc-shift">В этом регионе другое значение</p>')
    expect(html.indexOf('wc-shift')).toBeLessThan(html.indexOf('Обычное значение'))
  })

  it('the line says "region" and names no country: no UY, no AR, no Uruguay or Argentina (the overlay has no country for a shift, and none is claimed)', () => {
    for (const text of [strings.rio.meaningShift, ...(['en', 'ru'] as const).map((l) => { setLanguage(l); return strings.rio.meaningShift })]) {
      expect(text).toMatch(/region|регион/)
      expect(text).not.toMatch(/\b(UY|AR)\b|Urugua|Argentin|Уругва|Аргентин/)
    }
  })

  it('Review shows the same on its card: the pill on the front and the back, the line on the back', () => {
    const card = (revealed: boolean) => renderToStaticMarkup(createElement(ReviewCard, { word: boleto, settings, revealed, onReveal: () => {} }))
    const html = card(true)
    expect(html.match(/<span class="wc-rio">Rioplatense<\/span>/g)).toHaveLength(2) // front and back
    expect(html).toContain('<p class="wc-shift">A different meaning in this region</p>')
    const ordinaryHtml = renderToStaticMarkup(createElement(ReviewCard, { word: ordinary, settings, revealed: true, onReveal: () => {} }))
    expect(ordinaryHtml).not.toContain('wc-rio')
    expect(ordinaryHtml).not.toContain('wc-shift')
  })
})
