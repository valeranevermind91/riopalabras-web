import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { customWordFromRow } from '../data/words'
import { rowFromValues, blankValues, type WordValues } from '../data/customWords'
import { headword } from '../data/headword'
import { rowTitle } from '../data/rowTitle'
import { BOTH } from '../testing/translationFlags'
import { makeWord } from '../testing/makeWord'
import { WordCard } from './WordCard'
import { ReviewCard } from './ReviewCard'
import { WordRow } from './WordRow'
import { strings } from '../strings'
import type { Word } from '../data/types'
import { wordState } from '../data/wordState'

const values = (over: Partial<WordValues>): WordValues => ({ ...blankValues(), esWord: 'zapallito', pos: 'n', enTranslation: 'little squash', ruTranslation: 'кабачок', ...over })
const custom = (over: Partial<WordValues>): Word => customWordFromRow(rowFromValues(values(over)))
const card = (word: Word) => renderToStaticMarkup(createElement(WordCard, { word, settings: BOTH }))

const pill = (html: string) => html.includes('class="wc-rio"')
const tags = (html: string) => [...html.matchAll(/<span class="wc-tag"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1])
const register = (html: string) => [...html.matchAll(/<span class="wc-register">([^<]+)<\/span>/g)].map((m) => m[1])
const standard = (html: string) => [...html.matchAll(/<p>standard: <span>([^<]+)<\/span>/g)].map((m) => m[1])

describe('a custom word that is itself Rioplatense carries the marks a dictionary word does', () => {
  it('all of them: the "rioplatense" chip, the region chip, the register, and the "standard: …" line', () => {
    const html = card(custom({ isRioplatenseVariant: true, region: 'uy', register: 'informal', esStandard: 'calabacín' }))
    expect(pill(html)).toBe(true)
    expect(html).toContain(`>${strings.rio.pill}<`)
    expect(tags(html)).toEqual([strings.rio.tag.uy])
    expect(register(html)).toEqual(['informal'])
    expect(standard(html)).toEqual(['calabacín'])
    expect(html).toContain('<h2 class="wc-headword">zapallito</h2>') // the typed word stays the headword
  })

  it('the region chip is the same one the dictionary uses, for each region', () => {
    expect(tags(card(custom({ isRioplatenseVariant: true, region: 'ar' })))).toEqual([strings.rio.tag.ar])
    expect(tags(card(custom({ isRioplatenseVariant: true, region: 'uy' })))).toEqual([strings.rio.tag.uy])
  })

  it('each register the dictionary labels is labelled the same way; neutral and unknown have no label', () => {
    for (const r of ['informal', 'vulgar', 'offensive', 'pejorative'] as const) expect(register(card(custom({ isRioplatenseVariant: true, register: r })))).toEqual([strings.rio.register[r]])
    expect(register(card(custom({ isRioplatenseVariant: true, register: 'neutral' })))).toEqual([])
    expect(register(card(custom({ isRioplatenseVariant: true, register: null })))).toEqual([])
  })

  it('and nothing more: only the marks that are set show', () => {
    const bare = card(custom({ isRioplatenseVariant: true }))
    expect(pill(bare)).toBe(true)
    expect([tags(bare), register(bare), standard(bare)]).toEqual([[], [], []])
    expect(bare).not.toContain('wc-relation')

    const onlyStandard = card(custom({ isRioplatenseVariant: true, esStandard: 'calabacín' }))
    expect([pill(onlyStandard), tags(onlyStandard), register(onlyStandard), standard(onlyStandard)]).toEqual([true, [], [], ['calabacín']])

    const onlyRegion = card(custom({ isRioplatenseVariant: true, region: 'ar' }))
    expect([pill(onlyRegion), tags(onlyRegion), register(onlyRegion), standard(onlyRegion)]).toEqual([true, [strings.rio.tag.ar], [], []])
  })

  it('the review card shows the same marks', () => {
    const word = custom({ isRioplatenseVariant: true, region: 'ar', register: 'vulgar', esStandard: 'calabacín' })
    const html = renderToStaticMarkup(createElement(ReviewCard, { word, settings: BOTH, revealed: true } as never))
    expect(html).toContain('class="wc-rio"')
    // the review card repeats the headword row on both faces, as it does for a dictionary word
    expect([...new Set(tags(html))]).toEqual([strings.rio.tag.ar])
    expect([...new Set(register(html))]).toEqual(['vulgar'])
    expect([...new Set(standard(html))]).toEqual(['calabacín'])
  })
})

describe('the flag switches the marks on and off without losing them', () => {
  const marks = { region: 'ar', register: 'vulgar', esStandard: 'calabacín' } as const
  const on = custom({ isRioplatenseVariant: true, ...marks })
  const off = { ...on, isRioplatenseVariant: false }

  it('on: all the marks; off: none of them; on again: all of them back, from the same stored values', () => {
    const shown = (word: Word) => {
      const html = card(word)
      return [pill(html), tags(html), register(html), standard(html)]
    }
    expect(shown(on)).toEqual([true, [strings.rio.tag.ar], ['vulgar'], ['calabacín']])
    expect(shown(off)).toEqual([false, [], [], []])
    expect(off).toMatchObject(marks) // hidden, not cleared
    expect(shown({ ...off, isRioplatenseVariant: true })).toEqual(shown(on))
  })
})

describe('without is_rioplatense_variant the marks do not show, whatever else is stored', () => {
  it('a standard custom word shows no chip, no region, no register and no standard line, even with the columns filled', () => {
    const html = card(custom({ isRioplatenseVariant: false, region: 'uy', register: 'vulgar', esStandard: 'calabacín' }))
    expect(pill(html)).toBe(false)
    expect([tags(html), register(html), standard(html)]).toEqual([[], [], []])
  })

  it('a standard word whose es_rioplatense came back keeps what the client does today: nothing extra (no example shows the form)', () => {
    const html = card(custom({ isRioplatenseVariant: false, esRioplatense: 'agarrar' }))
    expect(pill(html)).toBe(false)
    expect([tags(html), register(html), standard(html)]).toEqual([[], [], []])
    expect(headword(custom({ esRioplatense: 'agarrar' })).form).toBe('standard')
  })

  it('a dictionary word is never read this way: its flag means something else', () => {
    const word = makeWord('guapo', { isRioplatenseVariant: true, region: 'uy', register: 'vulgar', esStandard: 'x' })
    const html = card(word)
    expect(pill(html)).toBe(false)
    expect([tags(html), register(html), standard(html)]).toEqual([[], [], []])
  })
})

describe('the Words list row is unchanged', () => {
  const marked = custom({ isRioplatenseVariant: true, region: 'uy', register: 'informal', esStandard: 'calabacín' })
  const plain = custom({})

  it('the title is the typed word and there is no second title: the standard equivalent is not in the row', () => {
    expect(rowTitle(marked, null)).toEqual({ title: 'zapallito', alt: null })
    expect(rowTitle(plain, null)).toEqual({ title: 'zapallito', alt: null })
    const html = renderToStaticMarkup(createElement(WordRow, { row: { word: marked, state: wordState(marked, new Date()), via: null }, settings: BOTH, onOpen: () => {}, onToggleFavourite: () => {}, onBringBack: () => {} }))
    const rowOfPlain = renderToStaticMarkup(createElement(WordRow, { row: { word: plain, state: wordState(plain, new Date()), via: null }, settings: BOTH, onOpen: () => {}, onToggleFavourite: () => {}, onBringBack: () => {} }))
    expect(html).toBe(rowOfPlain)
    for (const absent of ['calabacín', 'wc-rio', 'wc-tag', 'wc-register', 'informal', 'UY']) expect(html).not.toContain(absent)
  })
})
