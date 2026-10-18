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

afterEach(() => setLanguage('en'))

describe('a list row: two actions that are different things', () => {
  it('a word that can be started has the queue control and the save star, side by side, the queue first', () => {
    const html = render(casa, { queueable: true, queued: false, onToggleQueue: () => {} })
    expect(html).toContain('<button type="button" class="word-row-queue" aria-pressed="false" aria-label="Queue casa for Learn">')
    expect(html).toContain('<span>Queue</span>')
    expect(html).toContain('class="word-row-star" aria-pressed="false" aria-label="Save casa"')
    expect(html.indexOf('word-row-queue')).toBeLessThan(html.indexOf('word-row-star'))
  })

  it('a queued word shows the marker: the control reads "Queued", is pressed, and offers to take the word out', () => {
    const html = render(casa, { queueable: true, queued: true, onToggleQueue: () => {} })
    expect(html).toContain('<button type="button" class="word-row-queue is-on" aria-pressed="true" aria-label="Take casa out of the Learn queue">')
    expect(html).toContain('<span>Queued</span>')
    expect(html).not.toContain('<span>Queue</span>')
  })

  it('a word that cannot be started has no queue control at all, not a disabled one', () => {
    for (const html of [render(casa), render(casa, { queueable: false, onToggleQueue: () => {} }), render(casa, { queueable: true })]) {
      expect(html).not.toContain('word-row-queue')
      expect(html).not.toContain('disabled')
      expect(html).toContain('word-row-star') // the save star is still there
    }
  })

  it('a hidden word has only "Bring back": no star, no queue', () => {
    const html = render({ ...casa, isHidden: true }, { queueable: true, onToggleQueue: () => {} })
    expect(html).toContain('word-row-bring')
    expect(html).not.toContain('word-row-queue')
    expect(html).not.toContain('word-row-star')
  })

  it('the star is a save and says nothing of teaching; the queue says it is for Learn', () => {
    const html = render({ ...casa, isFavorite: true }, { queueable: true, queued: false, onToggleQueue: () => {} })
    const star = html.match(/<button[^>]*word-row-star[^>]*>/)![0]
    const queue = html.match(/<button[^>]*word-row-queue[^>]*>/)![0]
    expect(star).toContain('aria-label="Remove casa from saved"')
    expect(star).not.toMatch(/learn|queue/i)
    expect(queue).toContain('for Learn')
  })

  it('in Russian: «В очередь» / «В очереди», and «Сохранить» for the star', () => {
    setLanguage('ru')
    const idle = render(casa, { queueable: true, queued: false, onToggleQueue: () => {} })
    expect(idle).toContain('aria-label="В очередь Learn: «casa»"')
    expect(idle).toContain('<span>В очередь</span>')
    expect(idle).toContain('aria-label="Сохранить «casa»"')
    const queued = render(casa, { queueable: true, queued: true, onToggleQueue: () => {} })
    expect(queued).toContain('aria-label="Убрать «casa» из очереди Learn"')
    expect(queued).toContain('<span>В очереди</span>')
  })
})
