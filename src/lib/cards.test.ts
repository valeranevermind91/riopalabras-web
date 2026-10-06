import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RatingButtons } from '../components/RatingButtons'
import { WordCard } from '../components/WordCard'
import { parseDictionary } from '../data/dictionary'
import { parseFallbackExamples, parseRioOverlay } from '../data/rio'
import { createWriteQueue } from '../data/writeQueue'
import { parseSettings } from '../data/settings'
import type { Word } from '../data/types'
import { ReviewScreen } from '../screens/Review'
import { makeWord } from '../testing/makeWord'

const css = readFileSync('src/index.css', 'utf8')

/** The declarations of the rule that starts with `selector {`. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  if (start === -1) throw new Error(`no ${selector} rule`)
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

describe('the Review card and the rating buttons', () => {
  const dictionary = parseDictionary(
    JSON.parse(readFileSync('public/words_enriched.json', 'utf8')),
    parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))),
    parseFallbackExamples(JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))),
  )
  const withNote = dictionary.find((w) => w.esWord === 'tú')!

  it('the card reads: pills, the headword, the standard line, a divider, the sentence, the translations, then the note in its own box', () => {
    const card = renderToStaticMarkup(createElement(WordCard, { word: withNote, lang: 'en' }))
    const order = ['wc-meta', 'wc-headword', 'wc-relation', 'wc-divider', 'wc-example', 'wc-translations', 'wc-note'].map((c) => card.indexOf(`class="${c}`))
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(card).toMatch(/<p class="wc-note"><span>Note:<\/span>/)
  })

  it('the pills row carries the rioplatense pill and the region, the register in italics', () => {
    const pucho = dictionary.find((w) => w.esWord === 'cigarrillo')!
    const card = renderToStaticMarkup(createElement(WordCard, { word: pucho, lang: 'en' }))
    expect(card).toMatch(/<div class="wc-meta"><span class="wc-rio">Rioplatense<\/span>.*<span class="wc-register">informal<\/span>/)
  })

  it('the four ratings are Again (bad), Hard (amber), Good (soft teal), Easy (teal), each with its interval under the label', () => {
    const w = makeWord('x', { repetitions: 1, interval: 6, easeFactor: 2.5 })
    const html = renderToStaticMarkup(createElement(RatingButtons, { word: w, onRate: () => {} }))
    expect([...html.matchAll(/class="rate-btn rate-(\w+)"/g)].map((m) => m[1])).toEqual(['again', 'hard', 'good', 'easy'])
    expect(html.match(/<span class="rate-label">/g)).toHaveLength(4)
    expect(html.match(/<small class="rate-interval">/g)).toHaveLength(4)
    expect(rule('.rate-btn')).toMatch(/height: 58px/)
    expect(rule('.rate-again')).toMatch(/background: var\(--bad-bg\)/)
    expect(rule('.rate-hard')).toMatch(/background: var\(--hl-bg\)/)
    expect(rule('.rate-good')).toMatch(/background: var\(--teal-soft\)/)
    expect(rule('.rate-easy')).toMatch(/background: var\(--teal\)/)
  })

  it('the Review header is a thin teal progress bar with "n / m" (and the back button where Telegram has none)', () => {
    const due: Word[] = Array.from({ length: 12 }, (_, i) => makeWord(`palabra${i}`, { repetitions: 1, nextReview: new Date('2026-10-01T03:00:00.000Z') }))
    const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
    const settings = parseSettings({})
    const data = { words: due, settings, getSettings: () => settings, applyProgress: () => {}, applySettings: () => {} } as never
    const props = { data, queue, metrics: null, onHome: () => {}, onLearn: () => {} }
    const html = renderToStaticMarkup(createElement(ReviewScreen, props))
    expect(html).toContain('<header class="review-head">')
    expect(html).toMatch(/<div class="bar" role="progressbar"[^>]*aria-valuemax="12"[^>]*aria-valuenow="1"/)
    expect(html).toContain('<span class="review-count">1 / 12</span>')
    expect(html).not.toContain('back-link') // Telegram's own back button
    expect(renderToStaticMarkup(createElement(ReviewScreen, { ...props, onBack: () => {} }))).toContain('back-link')
    expect(rule('.bar')).toMatch(/height: 4px/)
    expect(rule('.bar-fill')).toMatch(/background: var\(--teal\)/)
    expect(rule('.review-slot')).toBeTruthy()
  })
})

describe('Cloze: lavender, with a fixed-width blank', () => {
  it('the blank is a 2.5px lavender rule of fixed width, never sized by the answer', () => {
    const r = rule('.cz-blank')
    expect(r).toMatch(/border-bottom: 2\.5px solid var\(--lav\)/)
    expect(r).toMatch(/width: 3\.4em/)
    expect(css).toMatch(/\.cz-screen \.bar-fill \{\s*background: var\(--lav\)/)
  })

  it('the answer input is a 1.5px lavender box in the display face, Continue is a filled lavender 54px', () => {
    expect(rule('.cz-input')).toMatch(/border: 1\.5px solid var\(--lav\)/)
    expect(rule('.cz-secondary .btn')).toMatch(/border: 1\.5px solid var\(--lav\)/)
    expect(rule('.practice .btn-primary')).toMatch(/background: var\(--lav\)/)
    expect(rule('.cz-dock > .btn-primary')).toMatch(/min-height: 54px/)
  })

  it('feedback uses the ok / bad token sets', () => {
    expect(rule('.cz-ok')).toMatch(/var\(--ok-bg\)/)
    expect(rule('.cz-ok')).toMatch(/var\(--ok-border\)/)
    expect(rule('.cz-ok')).toMatch(/var\(--ok-text\)/)
    expect(rule('.cz-bad')).toMatch(/var\(--bad-bg\)/)
    expect(rule('.cz-bad')).toMatch(/var\(--bad-border\)/)
  })
})

