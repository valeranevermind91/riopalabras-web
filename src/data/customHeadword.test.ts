import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReviewCard } from '../components/ReviewCard'
import { WordCard } from '../components/WordCard'
import { WordRow } from '../components/WordRow'
import { wordStatus } from './wordState'
import { BOTH } from '../testing/translationFlags'
import { makeWord } from '../testing/makeWord'
import { blankValues, rowFromValues, type WordValues } from './customWords'
import { headword, headwordDecision, highlightTarget } from './headword'
import { rowTitle } from './rowTitle'
import { relationFor } from './relation'
import { matchItem } from './practice'
import { customWordFromRow } from './words'
import type { Word } from './types'

// A word the user added keeps the headword they typed. The Rioplatense equivalent the lookup found (or they typed) is a note on the card, "Rioplatense: …", and the example may
// show it, highlighted; it never takes the title, the pairs in Matching, the sort order or anything else that is built on the headword.

const values = (over: Partial<WordValues>): WordValues => ({ ...blankValues(), esWord: 'coger', pos: 'v', enTranslation: 'to take', ruTranslation: 'брать', ...over })
const custom = (over: Partial<WordValues>): Word => customWordFromRow(rowFromValues(values(over)))
const COGER = { esRioplatense: 'agarrar', exampleSentence: 'Voy a agarrar el colectivo.', wordFormInExample: 'agarrar' }
const shown = (word: Word) => {
  const r = highlightTarget(word)
  return r.range ? r.sentence.slice(r.range.start, r.range.end) : null
}

describe('the headword of a word the user added', () => {
  it('is what they typed, even when the lookup found an equivalent and the example shows it', () => {
    const word = custom(COGER)
    expect(word.isCustom).toBe(true)
    expect(headword(word)).toEqual({ text: 'coger', form: 'standard', secondary: null })
    expect(headwordDecision(word)).toMatchObject({ switched: false, reason: 'custom-word' })
  })

  it('the case that was found: the equivalent the lookup gave for encurdelarse does not take the title, whatever form is stored', () => {
    const word = custom({ esWord: 'encurdelarse', enTranslation: 'to get drunk', ruTranslation: 'напиться', esRioplatense: 'curarse', exampleSentence: 'Si seguís tomando así, te vas a curar mal', wordFormInExample: 'curar' })
    expect(headword(word).text).toBe('encurdelarse')
    expect(rowTitle(word, null).title).toBe('encurdelarse')
  })

  it('stays so for every way the form and the equivalent can line up', () => {
    for (const over of [COGER, { ...COGER, wordFormInExample: null }, { ...COGER, esRioplatense: 'agarrar la cosa' }, { ...COGER, esRioplatense: 'COGER' }, { esRioplatense: null }]) {
      expect(headword(custom(over)).text, JSON.stringify(over)).toBe('coger')
    }
  })

  it('a dictionary word without an overlay entry still follows the legacy rule: the equivalent leads when its own example shows it', () => {
    const word = makeWord('coger', { esRioplatense: 'agarrar', exampleSentence: 'Voy a agarrar el colectivo.', wordFormInExample: 'agarrar' })
    expect(word.isCustom).toBe(false)
    expect(headword(word)).toEqual({ text: 'agarrar', form: 'rioplatense', secondary: 'coger' })
    expect(headwordDecision(word)).toMatchObject({ switched: true, reason: 'legacy' })
  })

  it('a word the user added and marked Rioplatense is as before: the typed word, with its standard equivalent in the relation line', () => {
    const word = custom({ esWord: 'zapallito', isRioplatenseVariant: true, esStandard: 'calabacín' })
    expect(headword(word)).toEqual({ text: 'zapallito', form: 'rioplatense', secondary: null })
    expect(headwordDecision(word).reason).toBe('own-rioplatense')
    expect(relationFor(word)).toEqual({ type: 'replacement', standardWord: 'calabacín' })
  })
})

describe('everything built on the headword uses the typed word', () => {
  it('the pair in Matching shows the typed word, with its gloss', () => {
    expect(matchItem(custom(COGER), BOTH)).toMatchObject({ spanish: 'coger' })
    expect(matchItem(makeWord('coger', { esRioplatense: 'agarrar', exampleSentence: 'Voy a agarrar el colectivo.', wordFormInExample: 'agarrar', ruTranslation: 'брать' }), BOTH)).toMatchObject({ spanish: 'agarrar' }) // a dictionary word is as before
  })
})

describe('the equivalent is a note, and the example may show it', () => {
  it('the relation is the Rioplatense form as a note, the same line a dictionary word shows when its form does not lead', () => {
    expect(relationFor(custom(COGER))).toEqual({ type: 'replacement', rioForm: 'agarrar' })
  })

  it('there is no note without a usable equivalent: none, the word itself, or something that is not a word', () => {
    for (const esRioplatense of [null, 'coger', ' Coger ', 'esto es una frase larga de cinco palabras', '']) expect(relationFor(custom({ esRioplatense })), String(esRioplatense)).toBeNull()
  })

  it('the example highlights the equivalent while the title is the typed word', () => {
    expect(shown(custom(COGER))).toBe('agarrar')
    const encurdelarse = custom({ esWord: 'encurdelarse', esRioplatense: 'curarse', exampleSentence: 'Si seguís tomando así, te vas a curar mal', wordFormInExample: 'curar' })
    expect(shown(encurdelarse)).toBe('curar')
  })

  it('and highlights it even with no stored form: the equivalent is a candidate of its own', () => {
    expect(shown(custom({ ...COGER, wordFormInExample: null }))).toBe('agarrar')
  })
})

describe('what the person sees', () => {
  const card = (word: Word) => renderToStaticMarkup(createElement(WordCard, { word, settings: BOTH }))

  it('the card leads with the typed word, says "Rioplatense: agarrar", and highlights agarrar in the example', () => {
    const html = card(custom(COGER))
    expect(html).toContain('<h2 class="wc-headword">coger</h2>')
    expect(html).toMatch(/<p>[^<]*: <span>agarrar<\/span>/) // the note: label, then the form
    expect(html).toContain('<mark>agarrar</mark>')
    expect(html).not.toContain('<h2 class="wc-headword">agarrar</h2>')
  })

  it('the Review card and the list row do the same', () => {
    const word = custom(COGER)
    const review = renderToStaticMarkup(createElement(ReviewCard, { word, settings: BOTH, revealed: true, onReveal: () => {} }))
    expect(review).toContain('coger')
    expect(review).not.toMatch(/<h2[^>]*>agarrar<\/h2>/)
    const row = renderToStaticMarkup(createElement(WordRow, { row: { word, status: wordStatus(word, new Date()), via: null }, settings: BOTH, onOpen: () => {}, onToggleFavourite: () => {}, onBringBack: () => {} }))
    expect(row).toContain('coger')
    expect(row).not.toContain('>agarrar<')
  })

  it('a word with no equivalent has no note', () => {
    expect(card(custom({ esRioplatense: null }))).not.toContain('wc-relation')
  })
})
