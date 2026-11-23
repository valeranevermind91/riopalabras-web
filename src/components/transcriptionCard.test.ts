import { readFileSync, readdirSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { parseDictionary } from '../data/dictionary'
import { parseNounGender } from '../data/gender'
import { headword } from '../data/headword'
import { parseFallbackExamples, parseRioOverlay } from '../data/rio'
import { wordStatus } from '../data/wordState'
import type { Word } from '../data/types'
import { setLanguage } from '../lib/language'
import { makeWord } from '../testing/makeWord'
import { BOTH } from '../testing/translationFlags'
import { CardHeadword } from './CardHeadword'
import { ReviewCard } from './ReviewCard'
import { WordCard } from './WordCard'
import { WordRow } from './WordRow'

// The transcription after the headword: «llevar [шеба́р]», small and muted, on the same line, in the Russian interface with the switch on. On the card that shows the word big (Learn,
// the word's page, Review front and back, the Debug preview: WordCard and ReviewCard) and nowhere else.

afterEach(() => setLanguage('en', { remember: false }))

const read = (file: string) => JSON.parse(readFileSync(`public/${file}`, 'utf8'))
const words = parseDictionary(read('words_enriched.json'), parseRioOverlay(read('rio_overlay.json')), parseFallbackExamples(read('examples_fallback.json')), parseNounGender(read('noun_gender.json')))
const word = (key: string): Word => words.find((w) => w.esWord === key)!
const ON = { ...BOTH, showTranscription: true }
const OFF = { ...BOTH, showTranscription: false }
const ru = () => setLanguage('ru', { remember: false })

const head = (w: Word, settings: typeof ON | typeof BOTH = ON, className?: string) => renderToStaticMarkup(createElement(CardHeadword, { word: w, transcribe: settings === ON, className }))
const card = (w: Word, settings: typeof ON | typeof OFF | typeof BOTH) => renderToStaticMarkup(createElement(WordCard, { word: w, settings }))
const review = (w: Word, settings: typeof ON | typeof OFF | typeof BOTH, revealed = false) => renderToStaticMarkup(createElement(ReviewCard, { word: w, settings, revealed, onReveal: () => {} }))
const TR = (inner: string) => `<span class="wc-tr" translate="no" aria-hidden="true">[${inner}]</span>`
const S = (vowel: string) => `<span class="tr-stress">${vowel}</span>`

describe('the headword line', () => {
  it('the transcription follows the headword on the same line: a space, then the muted span in square brackets, the stressed vowel in a span of its own', () => {
    expect(head(word('llevar'))).toBe(`<h2 class="wc-headword">llevar ${TR(`шеб${S('а')}р`)}</h2>`)
    expect(head(word('llevar'), ON, 'rf-headword')).toBe(`<h2 class="wc-headword rf-headword">llevar ${TR(`шеб${S('а')}р`)}</h2>`)
  })

  it('a word of one syllable has no stressed vowel', () => {
    expect(head(word('yo'))).toBe(`<h2 class="wc-headword">yo ${TR('шо')}</h2>`)
  })

  it('a phrase is done word by word, the one-syllable words unmarked', () => {
    const phrase = words.find((w) => w.esWord === 'de veras')!
    expect(head(phrase)).toBe(`<h2 class="wc-headword">de veras ${TR(`де б${S('е')}рас`)}</h2>`)
  })

  it('the article is not transcribed: it is before the headword, the transcription after it', () => {
    const casa = makeWord('casa', { gender: { article: 'la', form: 'casa' } })
    expect(head(casa)).toBe(`<h2 class="wc-headword"><span class="wc-article">la</span> casa ${TR(`к${S('а')}са`)}</h2>`)
  })

  it('a card whose headword is the Rioplatense form transcribes that form, the one it shows', () => {
    const switched = words.find((w) => headword(w).form === 'rioplatense' && /^[a-záéíóúñü]+$/.test(headword(w).text) && headword(w).text !== w.esWord)!
    expect(head(switched)).toContain(`${headword(switched).text} <span class="wc-tr"`)
  })

  it('without the switch, or for a word the person added, the line is what it always was', () => {
    expect(head(word('llevar'), BOTH)).toBe('<h2 class="wc-headword">llevar</h2>')
    expect(renderToStaticMarkup(createElement(CardHeadword, { word: makeWord('llevar', { isCustom: true }), transcribe: true }))).toBe('<h2 class="wc-headword">llevar</h2>')
  })
})

describe('where it shows', () => {
  it('Learn, the word of the day and the word\'s page (WordCard) show it in the Russian interface with the switch on', () => {
    ru()
    expect(card(word('llevar'), ON)).toContain(`llevar ${TR(`шеб${S('а')}р`)}`)
  })

  it('Review shows it on the front and on the back', () => {
    ru()
    const html = review(word('llevar'), ON)
    expect(html.match(/class="wc-tr"/g)).toHaveLength(2)
    expect(html).toContain(`<h2 class="wc-headword rf-headword">llevar ${TR(`шеб${S('а')}р`)}</h2>`)
  })

  it('not in the English interface, not with the switch off, not when the card was given no setting for it', () => {
    for (const html of [card(word('llevar'), ON), review(word('llevar'), ON)]) expect(html).not.toContain('class="wc-tr"') // the language is still English
    ru()
    expect(card(word('llevar'), OFF)).not.toContain('class="wc-tr"')
    expect(card(word('llevar'), BOTH as never)).not.toContain('class="wc-tr"')
    expect(review(word('llevar'), OFF)).not.toContain('class="wc-tr"')
  })

  it('a list row never has it', () => {
    ru()
    const w = word('llevar')
    const row = renderToStaticMarkup(createElement(WordRow, { row: { word: w, status: wordStatus(w, new Date()), via: null }, settings: ON, onOpen: () => {}, onToggleFavourite: () => {}, onBringBack: () => {} }))
    expect(row).not.toContain('class="wc-tr"')
  })

  it('only the two cards draw CardHeadword: Matching, Cloze, the list and the placement test do not', () => {
    const files = [...readdirSync('src/components'), ...readdirSync('src/screens')].filter((f) => f.endsWith('.tsx'))
    const users = [
      ...readdirSync('src/components').filter((f) => f.endsWith('.tsx')).map((f) => `src/components/${f}`),
      ...readdirSync('src/screens').filter((f) => f.endsWith('.tsx')).map((f) => `src/screens/${f}`),
    ].filter((f) => /<CardHeadword/.test(readFileSync(f, 'utf8')))
    expect(files.length).toBeGreaterThan(10)
    expect(users.sort()).toEqual(['src/components/ReviewCard.tsx', 'src/components/WordCard.tsx'])
  })
})
