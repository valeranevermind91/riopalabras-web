import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createWriteQueue } from '../data/writeQueue'
import { parseSettings } from '../data/settings'
import type { Word } from '../data/types'
import { makeWord } from '../testing/makeWord'
import { HomeScreen } from './Home'

const past = new Date('2026-10-01T03:00:00.000Z')
const future = new Date(Date.now() + 5 * 86_400_000)

/** n learned words, `due` of them due now, with distinct glosses and usable sentences. */
function learnedWords(n: number, due = n): Word[] {
  return Array.from({ length: n }, (_, i) =>
    makeWord(`palabra${i}`, {
      repetitions: 1,
      nextReview: i < due ? past : future,
      rank: i + 1,
      ruTranslation: `слово ${'абвгдежзик'[i % 10]}${'абвгдежзик'[Math.floor(i / 10) % 10]}${'абвгдежзик'[Math.floor(i / 100)]}`,
      enTranslation: `word ${i}`,
      exampleSentence: `Esta es la palabra${i} del día.`,
      wordFormInExample: `palabra${i}`,
    }),
  )
}
const unlearned = (n: number) => Array.from({ length: n }, (_, i) => makeWord(`nueva${i}`, { rank: 1000 + i }))

const dataFor = (words: Word[], raw: Record<string, unknown> = {}, degraded: string[] = []) =>
  ({ status: 'ready', data: { words, settings: parseSettings(raw), getSettings: () => parseSettings(raw), degraded, retryDegraded: () => {} } }) as never

const render = (over: Record<string, unknown> = {}, words: Word[] = [...learnedWords(8, 3), ...unlearned(20)], raw: Record<string, unknown> = {}, degraded: string[] = []) =>
  renderToStaticMarkup(
    createElement(HomeScreen, {
      auth: { status: 'signed-in', userId: 'u', telegramFirstName: null, source: 'existing' },
      data: dataFor(words, raw, degraded),
      onLearn: () => {},
      onReview: () => {},
      onMatching: () => {},
      onCloze: () => {},
      queue: null,
      metrics: null,
      ...over,
    } as never),
  )

const tile = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-tile="${id}"[^>]*>.*?</button>`))![0]
const label = (html: string, id: string) => tile(html, id).match(/home-tile-label">(.*?)</)![1]

describe('Home layout', () => {
  it('stats on top, the four actions in a 2x2 grid at the bottom: Learn, Review / Matching, Cloze', () => {
    const html = render({ onDebug: () => {} })
    expect(html).toContain('<h1>Riopalabras</h1>')
    const order = ['stat-grid', 'home-grid-wrap', 'home-grid"', 'debug-link'].map((c) => html.indexOf(c))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(html.match(/class="home-tile[ "]/g)).toHaveLength(4)
    const ids = [...html.matchAll(/data-tile="(\w+)"/g)].map((m) => m[1])
    expect(ids).toEqual(['learn', 'review', 'matching', 'cloze'])
    expect(html).toContain('To review today')
    expect(html).toContain('New to learn')
  })

  it('every tile has an icon and a label (and nothing else that could overflow)', () => {
    const html = render()
    for (const id of ['learn', 'review', 'matching', 'cloze']) {
      const t = tile(html, id)
      expect(t).toContain('<svg class="home-tile-icon"')
      expect(t).toContain('aria-hidden="true"')
      expect(t.match(/home-tile-label/g)).toHaveLength(1)
    }
  })

  it('the labels carry the counts: Learn new words (n), Review due words (n)', () => {
    const html = render()
    expect(label(html, 'learn')).toBe('Learn new words (10)') // the daily limit, with a bigger pool behind it
    expect(label(html, 'review')).toBe('Review due words (3)')
    expect(label(html, 'matching')).toBe('Practice Matching')
    expect(label(html, 'cloze')).toBe('Practice Cloze')
    expect(html).toMatch(/stat-value">3<\/div><div class="stat-label">To review today/)
    expect(html).toMatch(/stat-value">10<\/div><div class="stat-label">New to learn/)
    expect(label(render({}, [...learnedWords(8, 8), ...unlearned(4)]), 'learn')).toBe('Learn new words (4)')
    expect(label(render({}, [...learnedWords(8, 8), ...unlearned(4)]), 'review')).toBe('Review due words (8)')
  })

  it('Learn is the one primary tile', () => {
    const html = render()
    expect(tile(html, 'learn')).toContain('home-tile is-primary')
    for (const id of ['review', 'matching', 'cloze']) expect(tile(html, id)).not.toContain('is-primary')
  })

  describe('disabled states and their reasons', () => {
    it('Daily limit reached: words are left in the pool but today\'s allowance is used up', () => {
      const html = render({}, [...learnedWords(8, 3), ...unlearned(20)], { daily_new_word_limit: 5, new_words_learned_today_count: 5, new_words_learned_today_date: new Date().toLocaleDateString('sv') })
      expect(label(html, 'learn')).toBe('Daily limit reached')
      expect(tile(html, 'learn')).toContain('disabled=""')
    })

    it('No new words available: the pool is empty', () => {
      const html = render({}, learnedWords(8, 3))
      expect(label(render({}, learnedWords(8, 3)), 'learn')).toBe('No new words available')
      expect(tile(html, 'learn')).toContain('disabled=""')
    })

    it('Nothing to review: no word is due', () => {
      const html = render({}, [...learnedWords(8, 0), ...unlearned(5)])
      expect(label(html, 'review')).toBe('Nothing to review')
      expect(tile(html, 'review')).toContain('disabled=""')
    })

    it('Need 5+ words: each practice tile says so below five usable words, and is disabled', () => {
      const html = render({}, [...learnedWords(4, 4), ...unlearned(5)])
      expect(label(html, 'matching')).toBe('Need 5+ words')
      expect(label(html, 'cloze')).toBe('Need 5+ words')
      expect(tile(html, 'matching')).toContain('disabled=""')
      expect(tile(html, 'cloze')).toContain('disabled=""')
    })

    it('enabled tiles are not disabled', () => {
      const html = render()
      for (const id of ['learn', 'review', 'matching', 'cloze']) expect(tile(html, id), id).not.toContain('disabled')
    })
  })

  describe('notices', () => {
    const stuckQueue = async () => {
      const queue = createWriteQueue({ sendProgress: async () => { throw new Error('down') }, sendSettings: async () => {} }, { retryDelaysMs: [], sleep: () => Promise.resolve() })
      queue.enqueueProgress({ esWord: 'a', easeFactor: 2.5, interval: 0, repetitions: 1, nextReview: past })
      await new Promise((r) => setTimeout(r, 5))
      return queue
    }

    it('the hidden-words notice appears between the stats and the grid, and the grid is still there', () => {
      const html = render({}, undefined, {}, ['user_hidden_words'])
      expect(html).toContain('class="notice"')
      expect(html).toContain('hidden words')
      const [stats, notice, grid] = ['stat-grid', 'class="notice"', 'home-grid-wrap'].map((c) => html.indexOf(c))
      expect(stats).toBeLessThan(notice)
      expect(notice).toBeLessThan(grid)
      expect(html.match(/class="home-tile[ "]/g)).toHaveLength(4)
    })

    it('the unsaved-progress notice appears once the queue is stuck, in the same place, with its Retry button', async () => {
      const html = render({ queue: await stuckQueue() })
      expect(html).toContain("Some progress hasn&#x27;t been saved yet. Retrying…")
      expect(html).toContain('Retry now')
      expect(html.indexOf('class="notice"')).toBeLessThan(html.indexOf('home-grid-wrap'))
      expect(html.match(/class="home-tile[ "]/g)).toHaveLength(4)
    })

    it('both notices together keep all four tiles', async () => {
      const html = render({ queue: await stuckQueue() }, undefined, {}, ['user_favorites', 'user_hidden_words'])
      expect(html.match(/class="notice"/g)).toHaveLength(2)
      expect(html.match(/class="home-tile[ "]/g)).toHaveLength(4)
    })

    it('no notices, no notice markup', () => {
      expect(render()).not.toContain('class="notice"')
    })
  })

  describe('header and footer', () => {
    it('the theme toggle sits in the header, with its state in the label', () => {
      const html = render({ theme: { choice: 'system', scheme: 'light', onCycle: () => {} } })
      expect(html).toMatch(/<header class="screen-header"><h1>Riopalabras<\/h1><div class="screen-header-actions"><button[^>]*class="icon-btn"[^>]*aria-label="Theme: System\. Tap to switch to Light\."/)
      expect(render({ theme: { choice: 'light', scheme: 'light', onCycle: () => {} } })).toContain('Theme: Light. Tap to switch to Dark.')
      expect(render({ theme: { choice: 'dark', scheme: 'dark', onCycle: () => {} } })).toContain('Theme: Dark. Tap to switch to System.')
    })

    it('without a theme prop there is no toggle', () => {
      expect(render()).not.toContain('icon-btn')
    })

    it('the Debug link stays, last on the page, only when allowed', () => {
      const html = render({ onDebug: () => {} })
      expect(html).toContain('class="debug-link"')
      expect(html.indexOf('debug-link')).toBeGreaterThan(html.indexOf('home-grid-wrap'))
      expect(render()).not.toContain('debug-link')
    })
  })

  it('while the data is loading there is a status card and no tiles', () => {
    const html = renderToStaticMarkup(
      createElement(HomeScreen, { auth: { status: 'loading' }, data: { status: 'loading' }, onLearn: () => {}, onReview: () => {}, onMatching: () => {}, onCloze: () => {}, queue: null, metrics: null }),
    )
    expect(html).not.toContain('home-tile')
    expect(html).toContain('Loading your words…')
  })
})
