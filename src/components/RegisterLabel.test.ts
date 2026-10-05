import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from '../data/dictionary'
import { headwordRegister, relationFor } from '../data/relation'
import { parseRioOverlay, type Lang } from '../data/rio'
import { strings } from '../strings'
import { RelationBlock } from './RelationBlock'
import { RegisterLabel } from './RegisterLabel'
import { ReviewCard } from './ReviewCard'
import { WordCard } from './WordCard'

const rawOverlay = JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))
const words = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')), parseRioOverlay(rawOverlay))
const word = (esWord: string) => words.find((w) => w.esWord === esWord)!
const card = (esWord: string, lang: Lang) => renderToStaticMarkup(createElement(WordCard, { word: word(esWord), lang }))
const relation = (esWord: string, lang: Lang) => renderToStaticMarkup(createElement(RelationBlock, { relation: relationFor(word(esWord)), lang }))
const review = (esWord: string, lang: Lang, revealed: boolean) => renderToStaticMarkup(createElement(ReviewCard, { word: word(esWord), lang, revealed, onReveal: () => {} }))

describe('register label next to the headword', () => {
  it('linyera is pejorative and carries a note naming the neutral phrase, in both languages', () => {
    const w = word('vagabundo')
    expect(w.rio).toMatchObject({ form: 'linyera', register: 'pejorative' })
    expect(headwordRegister(w)).toBe('pejorative')
    expect(card('vagabundo', 'en')).toContain('<span class="wc-register">pejorative</span>')
    expect(card('vagabundo', 'ru')).toContain('<span class="wc-register">pejorative</span>') // chrome: English whatever the translation language
    expect(card('vagabundo', 'ru')).not.toContain('пренебрежительное')
    expect(relation('vagabundo', 'en')).toMatch(/Dismissive word\. The neutral phrase is &quot;persona en situación de calle&quot;\./)
    expect(relation('vagabundo', 'ru')).toMatch(/Пренебрежительное слово\. Нейтральное выражение: &quot;persona en situación de calle&quot;\./)
  })

  it('pucho is informal and its note says cigarro / cigarrillo is the usual everyday word', () => {
    const w = word('cigarrillo')
    expect(w.rio).toMatchObject({ form: 'pucho', register: 'informal' })
    expect(card('cigarrillo', 'en')).toContain('<span class="wc-register">informal</span>')
    expect(card('cigarrillo', 'ru')).toContain('<span class="wc-register">informal</span>')
    expect(relation('cigarrillo', 'en')).toMatch(/&quot;Cigarro&quot; or &quot;cigarrillo&quot; is the more usual everyday word; &quot;pucho&quot; is the colloquial one\./)
    expect(relation('cigarrillo', 'ru')).toMatch(/более обычное слово в повседневной речи; &quot;pucho&quot; — разговорное/)
  })

  it('cigarro → pucho carries the same register and note as cigarrillo → pucho', () => {
    const w = word('cigarro')
    expect(w.rio).toMatchObject({ form: 'pucho', register: 'informal', notes: word('cigarrillo').rio!.notes })
    expect(relation('cigarro', 'en')).toMatch(/&quot;Cigarro&quot; or &quot;cigarrillo&quot; is the more usual everyday word/)
    expect(relation('cigarro', 'ru')).toMatch(/более обычное слово в повседневной речи/)
    expect(headwordRegister(w)).toBe('informal')
  })

  it('shows on the review card too: on the front next to the headword and on the back', () => {
    expect(review('vagabundo', 'en', false)).toContain('wc-register">pejorative<')
    expect(review('vagabundo', 'ru', true)).toContain('wc-register">pejorative<')
  })

  it('every register value used by the overlay has an English label (the Russian ones are kept for later), and neutral shows nothing', () => {
    const used = new Set<string>(rawOverlay.map((e: { register: string }) => e.register))
    for (const r of used) {
      if (r === 'neutral') continue
      for (const lang of ['en', 'ru'] as const) expect(strings.rio[lang].register[r], `${r} ${lang}`).toBeTruthy()
    }
    expect(renderToStaticMarkup(createElement(RegisterLabel, { register: 'neutral' }))).toBe('')
    expect(renderToStaticMarkup(createElement(RegisterLabel, { register: null }))).toBe('')
    expect(headwordRegister(word('guapo'))).toBe(word('guapo').rio!.register === 'neutral' ? null : word('guapo').rio!.register)
  })

  it('the label describes the headword: no label when the card keeps the standard word and the form is only a note', () => {
    const base = word('cigarrillo')
    expect(headwordRegister(base)).toBe('informal') // the overlay example shows pucho, so pucho leads
    const w = { ...base, rio: { ...base.rio!, example: null } } // as if pass 2 had failed: cigarrillo keeps the headword
    expect(w.exampleSentence).not.toMatch(/pucho/i)
    expect(headwordRegister(w)).toBeNull()
    expect(headwordRegister({ ...base, rio: null })).toBeNull()
  })
})
