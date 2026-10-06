import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RatingButtons } from '../components/RatingButtons'
import { createWriteQueue } from '../data/writeQueue'
import { parseSettings } from '../data/settings'
import type { Word } from '../data/types'
import { LearnScreen } from '../screens/Learn'
import { ReviewScreen } from '../screens/Review'
import { makeWord } from '../testing/makeWord'

const css = readFileSync('src/index.css', 'utf8')

function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  if (start === -1) throw new Error(`no ${selector} rule`)
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

describe('reach: Review and Learn fill the screen', () => {
  it('the page is exactly the viewport tall, as a column, with the page padding (plus the safe area) below the controls', () => {
    const fill = rule('.fill')
    expect(fill).toMatch(/display: flex/)
    expect(fill).toMatch(/flex-direction: column/)
    expect(fill).toMatch(/height: 100dvh/)
    expect(fill).toMatch(/padding-bottom: calc\(var\(--page-pad\) \+ env\(safe-area-inset-bottom, 0px\)\)/)
  })

  it('the Review card takes all the height above the rating row', () => {
    expect(rule('.review-slot')).toMatch(/flex: 1 1 0/)
    expect(rule('.review-slot')).toMatch(/min-height: 0/)
    expect(rule('.flip')).toMatch(/flex: 1/)
    expect(rule('.flip-inner')).toMatch(/height: 100%/)
    expect(rule('.flip-inner')).toMatch(/grid-template-rows: minmax\(0, 1fr\)/)
  })

  it('a card whose content is too tall scrolls inside itself, on the Review faces and on the Learn card', () => {
    expect(rule('.flip-face')).toMatch(/overflow-y: auto/)
    expect(rule('.flip-face')).toMatch(/min-height: 0/)
    expect(css).toMatch(/\.swipe-layer \.word-card,\s*\.swipe-ghost \.word-card \{[^}]*height: 100%[^}]*overflow-y: auto/)
  })

  it('the Learn card area takes the leftover height, with its controls (arrows, Finish) below it', () => {
    expect(rule('.swipe-area')).toMatch(/flex: 1 1 0/)
    expect(rule('.swipe-area')).toMatch(/min-height: 0/)
    expect(rule('.swipe-stage')).toMatch(/height: 100%/)
  })

  it('nothing but the card flexes: the header, banner and controls keep their size', () => {
    expect(rule('.fill > *')).toMatch(/flex: none/)
  })
})

describe('reach: the markup', () => {
  const settings = parseSettings({})
  const data = (words: Word[]) => ({ words, settings, getSettings: () => settings, applyProgress: () => {}, applySettings: () => {} }) as never
  const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
  const due = Array.from({ length: 5 }, (_, i) => makeWord(`palabra${i}`, { repetitions: 1, nextReview: new Date('2026-10-01T03:00:00.000Z'), rank: i + 1 }))
  const fresh = Array.from({ length: 12 }, (_, i) => makeWord(`nueva${i}`, { rank: i + 1 }))

  it('Review: a full-height page, the card slot, and the rating row last (with only the page padding below)', () => {
    const html = renderToStaticMarkup(createElement(ReviewScreen, { data: data(due), queue, metrics: null, onHome: () => {}, onLearn: () => {}, registerLeaveGuard: () => {} }))
    expect(html).toContain('<main class="screen fill">')
    const order = ['review-head', 'review-slot', 'class="rating'].map((c) => html.indexOf(c))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(html.endsWith('</div></main>')).toBe(true) // the rating row is the last thing on the page
  })

  it('Review: the rating row is laid out from the start but hidden until the answer is shown, so the card does not jump', () => {
    const w = makeWord('x', { repetitions: 1 })
    const hidden = renderToStaticMarkup(createElement(RatingButtons, { word: w, onRate: () => {}, hidden: true }))
    expect(hidden).toContain('class="rating is-hidden"')
    expect(hidden).toContain('aria-hidden="true"')
    expect(renderToStaticMarkup(createElement(RatingButtons, { word: w, onRate: () => {} }))).toContain('class="rating"')
    expect(rule('.rating.is-hidden')).toMatch(/visibility: hidden/)
    const review = renderToStaticMarkup(createElement(ReviewScreen, { data: data(due), queue, metrics: null, onHome: () => {}, onLearn: () => {}, registerLeaveGuard: () => {} }))
    expect(review).toContain('rating is-hidden') // nothing is revealed yet
  })

  it('Learn: a full-height page whose card sits in a stage with room for the leaving card, controls below', () => {
    const html = renderToStaticMarkup(createElement(LearnScreen, { data: data(fresh), queue, metrics: null, onHome: () => {}, onReview: () => {} }))
    expect(html).toContain('<main class="screen fill">')
    const order = ['learn-progress', 'swipe-area', 'swipe-stage', 'swipe-layer', 'word-card', 'learn-nav'].map((c) => html.indexOf(c))
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(html).not.toContain('swipe-ghost') // nothing is leaving before a swipe
  })
})

describe('motion: transform and opacity only, with a cross-fade for reduced motion', () => {
  it('the swiping layer and the arriving card animate transform and opacity only (no layout properties)', () => {
    for (const name of ['card-enter-next', 'card-enter-prev', 'card-arrive', 'card-fade']) {
      const start = css.indexOf(`@keyframes ${name}`)
      const body = css.slice(start, css.indexOf('\n}\n', start))
      expect(body, name).toMatch(/opacity|transform/)
      expect(body, name).not.toMatch(/\b(width|height|top|left|right|bottom|margin|padding)\s*:/)
    }
    expect(css).toMatch(/\.swipe-ghost \{[^}]*will-change: transform, opacity/)
  })

  it('the ghost animation is transform and opacity (source check)', () => {
    const ghost = readFileSync('src/components/SwipeGhost.tsx', 'utf8')
    expect(ghost).toMatch(/transform: `translateX/)
    expect(ghost).toMatch(/opacity/)
    expect(ghost).not.toMatch(/\b(width|height|margin|padding|left|top)\s*:/)
  })

  it('under prefers-reduced-motion the arriving card fades instead of travelling', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(block).toMatch(/\.card-enter-next,\s*\.card-enter-prev,\s*\.card-arrive \{\s*animation: card-fade/)
  })

  it('the hook asks for reduced motion at release and the leaving card then cross-fades (planExit mode "fade")', () => {
    expect(readFileSync('src/lib/useSwipe.ts', 'utf8')).toContain("(prefers-reduced-motion: reduce)")
    expect(readFileSync('src/components/SwipeGhost.tsx', 'utf8')).toMatch(/plan\.mode === 'fade'/)
  })

  it('below the threshold the card springs back on a transform transition; while dragging there is none', () => {
    const hook = readFileSync('src/lib/useSwipe.ts', 'utf8')
    expect(hook).toMatch(/dragging \|\| !spring \? 'none' : 'transform 240ms/)
    expect(hook).toMatch(/reset\(decision === 'cancel'\)/) // a committed swipe snaps, so the next card does not inherit the drag offset
  })
})
