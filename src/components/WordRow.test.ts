import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { setLanguage } from '../lib/language'
import { makeWord } from '../testing/makeWord'
import { wordState } from '../data/wordState'
import type { Word } from '../data/types'
import { WordRow } from './WordRow'

const BOTH = { showRuTranslation: true, showEnTranslation: true }
const render = (word: Word, extra: Partial<Parameters<typeof WordRow>[0]> = {}) =>
  renderToStaticMarkup(createElement(WordRow, { row: { word, state: wordState(word, new Date()), via: null }, settings: BOTH, onOpen: () => {}, onToggleFavourite: () => {}, onBringBack: () => {}, ...extra }))
const casa = makeWord('casa', { rank: 1 })
const starButton = (html: string) => html.match(/<button[^>]*word-row-star[^>]*>.*?<\/button>/)![0]

afterEach(() => setLanguage('en'))

describe('a list row: one action, "Learn sooner"', () => {
  it('a word Learn can still teach has the star, named for what it does, and nothing else beside it', () => {
    const html = render(casa)
    expect(html).toContain('class="word-row-star" aria-pressed="false" aria-label="Learn casa sooner"')
    expect(html).not.toContain('word-row-queue')
    expect(html.match(/<button/g)).toHaveLength(2) // the row itself, and the star
  })

  it('pressed, the star is filled and looks active, and says the same words: it never claims anything has happened', () => {
    const on = render({ ...casa, isFavorite: true, starredAt: 1 })
    expect(on).toContain('class="word-row-star is-on" aria-pressed="true" aria-label="Learn casa sooner"')
    expect(starButton(on)).toContain('fill="currentColor"')
    expect(starButton(render(casa))).toContain('fill="none"')
    // the name is the same pressed or not: the state is carried by aria-pressed
    expect(on.match(/aria-label="Learn casa sooner"/)).not.toBeNull()
    expect(on).not.toMatch(/Saved|Queued|Remove casa/)
  })

  it('the star has no visible label on the row: the translation needs the room', () => {
    expect(starButton(render(casa)).replace(/<[^>]*>/g, '')).toBe('')
  })

  it('a word Learn can no longer teach has no star at all, not a disabled one: learned, in progress, known, reference-only, untranslated', () => {
    const cannot: [string, Word][] = [
      ['learned', makeWord('casa', { rank: 1, repetitions: 4, interval: 30, nextReview: new Date(2030, 0, 1) })],
      ['in progress', makeWord('casa', { rank: 1, repetitions: 1, nextReview: new Date(2030, 0, 1) })],
      ['reference only', makeWord('casa', { rank: 1, pos: 'prep' })],
      ['untranslated', makeWord('casa', { rank: 1, enTranslation: '', ruTranslation: '' })],
    ]
    for (const [label, word] of cannot) {
      const html = render(word)
      expect(html, label).not.toContain('word-row-star')
      expect(html, label).not.toContain('disabled')
      expect(html, label).not.toContain('Learn casa sooner')
    }
    // even a word that still carries a star from before shows no control
    expect(render({ ...cannot[0][1], isFavorite: true, starredAt: 1 })).not.toContain('word-row-star')
  })

  it('a hidden word has only "Bring back": no star', () => {
    const html = render({ ...casa, isHidden: true })
    expect(html).toContain('word-row-bring')
    expect(html).not.toContain('word-row-star')
  })

  it('a word you typed in, not started, has the star like any other', () => {
    expect(render(makeWord('zapallito', { rank: null, isCustom: true }))).toContain('aria-label="Learn zapallito sooner"')
  })

  it('in Russian: «Учить «casa» раньше»', () => {
    setLanguage('ru')
    expect(render(casa)).toContain('aria-label="Учить «casa» раньше"')
    expect(render({ ...casa, isFavorite: true, starredAt: 1 })).toContain('aria-label="Учить «casa» раньше"')
  })
})
