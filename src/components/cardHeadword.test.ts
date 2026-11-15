import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from '../data/dictionary'
import { parseNounGender } from '../data/gender'
import { headword } from '../data/headword'
import { parseFallbackExamples, parseRioOverlay } from '../data/rio'
import { rowTitle } from '../data/rowTitle'
import { matchItem } from '../data/practice'
import type { Word } from '../data/types'
import { makeWord } from '../testing/makeWord'
import { BOTH } from '../testing/translationFlags'
import { CardHeadword } from './CardHeadword'
import { ReviewCard } from './ReviewCard'
import { WordCard } from './WordCard'

// A noun's article stands before the headword on the cards that show the word big (Learn, the Review front and back, the word's page: all of them WordCard or ReviewCard), in
// its own span so it can be set lighter. The lists, Matching and the search results show the bare word, as before.

const read = (file: string) => JSON.parse(readFileSync(`public/${file}`, 'utf8'))
const words = parseDictionary(read('words_enriched.json'), parseRioOverlay(read('rio_overlay.json')), parseFallbackExamples(read('examples_fallback.json')), parseNounGender(read('noun_gender.json')))
const word = (key: string): Word => words.find((w) => w.esWord === key)!
const casa = makeWord('casa', { gender: { article: 'la', form: 'casa' } })

const card = (w: Word) => renderToStaticMarkup(createElement(WordCard, { word: w, settings: BOTH }))
const review = (w: Word, revealed: boolean) => renderToStaticMarkup(createElement(ReviewCard, { word: w, settings: BOTH, revealed, onReveal: () => {} }))
const ARTICLED = '<h2 class="wc-headword"><span class="wc-article">la</span> casa</h2>'

describe('the article before the headword', () => {
  it('CardHeadword: the article in its own span, a space, the word', () => {
    expect(renderToStaticMarkup(createElement(CardHeadword, { word: casa }))).toBe(ARTICLED)
    expect(renderToStaticMarkup(createElement(CardHeadword, { word: casa, className: 'rf-headword' }))).toBe('<h2 class="wc-headword rf-headword"><span class="wc-article">la</span> casa</h2>')
  })

  it('a word with none is the title it always was', () => {
    expect(renderToStaticMarkup(createElement(CardHeadword, { word: makeWord('casa') }))).toBe('<h2 class="wc-headword">casa</h2>')
  })

  it('Learn, the Review answer, the word of the day and the word\'s page (WordCard) show it', () => {
    expect(card(casa)).toContain(ARTICLED)
    expect(card(word('agua'))).toContain('<span class="wc-article">el</span> agua</h2>')
    expect(card(word('estudiante'))).toContain('<span class="wc-article">el/la</span> estudiante</h2>')
  })

  it('the Review card shows it on the front and on the back', () => {
    const front = review(casa, false)
    const back = review(casa, true)
    expect(front).toContain('<h2 class="wc-headword rf-headword"><span class="wc-article">la</span> casa</h2>')
    expect(front).toContain(ARTICLED) // the back is in the page from the start, flipped over
    expect(back).toContain(ARTICLED)
    expect((front.match(/wc-article/g) ?? []).length).toBe(2)
  })

  it('the article is the one of the form the card leads with: the Rioplatense word\'s article on a card that leads with it, none on one that does not', () => {
    expect(headword(word('metro')).text).toBe('subte')
    expect(card(word('metro'))).toContain('<span class="wc-article">el</span> subte</h2>')
    expect(card(word('tontería'))).not.toContain('wc-article') // the entry is for another word than the one the card leads with
  })

  it('a word the user added has none', () => {
    expect(card({ ...casa, isCustom: true })).not.toContain('wc-article')
  })

  it('what is built on the headword does not see it: the row title, the Matching tile, the headword text', () => {
    expect(headword(casa).text).toBe('casa')
    expect(rowTitle(casa, null).title).toBe('casa')
    expect(matchItem(casa, BOTH).spanish).toBe('casa')
  })
})
