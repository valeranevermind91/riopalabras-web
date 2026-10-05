import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ClozeQuestion } from '../components/ClozeQuestion'
import { buildClozeSession, clozePool } from '../data/practice'
import { parseSettings } from '../data/settings'
import type { Word } from '../data/types'
import { makeWord } from '../testing/makeWord'
import { ClozeScreen } from './Cloze'
import { HomeScreen } from './Home'
import { MatchingScreen } from './Matching'

const past = new Date('2026-10-01T03:00:00.000Z')
/** Ten learned words with distinct glosses and sentences that contain them. */
const words = (n: number): Word[] =>
  Array.from({ length: n }, (_, i) =>
    makeWord(`palabra${i}`, {
      repetitions: 1,
      nextReview: past,
      rank: i + 1,
      ruTranslation: `слово${'абвгдежзик'[i % 10]}${'абвгдежзик'[Math.floor(i / 10)]}, другое`,
      enTranslation: `word${i}, other`,
      exampleSentence: `Esta es la palabra${i} del día.`,
      wordFormInExample: `palabra${i}`,
    }),
  )

const dataFor = (list: Word[], raw: Record<string, unknown> = {}) =>
  ({ words: list, settings: parseSettings(raw), getSettings: () => parseSettings(raw), applySettings: () => {}, applyProgress: () => {}, degraded: [], retryDegraded: () => {} }) as never
const queue = { enqueueSettings: () => {} } as never

const home = (list: Word[], raw: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(HomeScreen, {
      auth: { status: 'signed-in', userId: 'u', telegramFirstName: null, source: 'existing' },
      data: { status: 'ready', data: dataFor(list, raw) },
      onLearn: () => {},
      onReview: () => {},
      onMatching: () => {},
      onCloze: () => {},
      queue: null,
      metrics: null,
    }),
  )

describe('Home: the two practice buttons', () => {
  it('are disabled with "Need 5+ words" below 5 eligible words, in English whatever the translation language', () => {
    const en = home(words(4), { show_ru_translation: false, show_en_translation: true })
    expect(en.match(/Need 5\+ words/g)).toHaveLength(2)
    expect(en).not.toContain('Practice Matching')
    const ru = home(words(4)) // Russian translations are the default: the buttons are still English
    expect(ru.match(/Need 5\+ words/g)).toHaveLength(2)
    expect(ru).not.toMatch(/[А-Яа-яЁё]/)
    const needs = en.split('<button').filter((b) => b.includes('Need 5+ words'))
    expect(needs.every((b) => b.includes('disabled'))).toBe(true)
  })

  it('are enabled and named once 5 words qualify, in English with either translation language', () => {
    const en = home(words(6), { show_ru_translation: false, show_en_translation: true })
    expect(en).toContain('Practice Matching')
    expect(en).toContain('Practice Cloze')
    expect(en).not.toContain('Need 5+ words')
    const ru = home(words(6)) // default settings: Russian translations
    expect(ru).toContain('Practice Matching')
    expect(ru).toContain('Practice Cloze')
    expect(ru).not.toMatch(/[А-Яа-яЁё]/) // no Russian chrome anywhere on Home
  })

  it('count words independently: Matching needs 5 words with different glosses, Cloze needs 5 with a blank', () => {
    const sameGloss = words(6).map((w) => ({ ...w, ruTranslation: 'одно и то же' }))
    const html = home(sameGloss, { show_ru_translation: false, show_en_translation: true })
    expect(html).toContain('Need 5+ words') // Matching: all six collide
    expect(html).toContain('Practice Cloze') // Cloze still has six usable blanks
    const noBlank = words(6).map((w) => ({ ...w, exampleSentence: 'Una frase sin la palabra buscada.' }))
    const html2 = home(noBlank, { show_ru_translation: false, show_en_translation: true })
    expect(html2).toContain('Practice Matching')
    expect(html2).toContain('Need 5+ words')
  })

  it('sit below Review and Learn', () => {
    const html = home(words(6), { show_ru_translation: false, show_en_translation: true })
    expect(html.indexOf('Review')).toBeLessThan(html.indexOf('Practice Matching'))
    expect(html.indexOf('Practice Matching')).toBeLessThan(html.indexOf('Practice Cloze'))
  })
})

describe('Matching screen', () => {
  const render = (list: Word[], raw: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(MatchingScreen, { data: dataFor(list, raw), queue, metrics: null, onHome: () => {} }))

  it('shows two columns of five: the Spanish headwords and the first Russian glosses', () => {
    const html = render(words(8))
    expect(html.match(/class="match-tile"/g)).toHaveLength(10)
    expect(html.match(/palabra\d/g)!.length).toBe(5)
    expect(html).not.toContain('другое') // first gloss only, never the full translation
    expect(html).toMatch(/слово[а-к]{2}/) // the gloss itself is word content: Russian
    expect(html).toContain('<h1>Matching</h1>') // chrome: English, although the translations are Russian
    expect(html).toContain('Tap a word, then its translation.')
    expect(html).not.toContain('Сопоставление')
  })

  it('the chrome is the same with the Russian translation switched off', () => {
    const html = render(words(8), { show_ru_translation: false, show_en_translation: true })
    expect(html).toContain('<h1>Matching</h1>')
    expect(html).toContain('Tap a word, then its translation.')
  })

  it('with fewer than 5 usable words it says so and offers the way home', () => {
    const html = render(words(4), { show_ru_translation: false, show_en_translation: true })
    expect(html).toContain('Learn and review some words first')
    expect(html).toContain('Back home')
    expect(html).not.toContain('match-tile')
  })
})

describe('Cloze screen and question', () => {
  const render = (list: Word[], raw: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(ClozeScreen, { data: dataFor(list, raw), queue, metrics: null, onHome: () => {} }))

  it('shows a progress bar and the first question with the blank, the cue and the controls', () => {
    const html = render(words(12), { show_ru_translation: false, show_en_translation: true })
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuemax="10"') // ten questions from twelve words
    expect(html).toContain('_____')
    expect(html).toMatch(/\(EN: word\d+, other\)/)
    for (const label of ['Hint', 'Reveal', 'Check']) expect(html).toContain(label)
    expect(html).not.toContain('Continue') // there is only Check until an answer exists
  })

  it('never shows the answer in the question', () => {
    const items = buildClozeSession(words(12))!
    for (const item of items) {
      const html = renderToStaticMarkup(createElement(ClozeQuestion, { item, settings: parseSettings({}), lang: 'en', onAnswered: () => {} }))
      expect(html).not.toContain(item.target.target)
      expect(html).toContain('_____')
      expect(html).not.toMatch(/<mark/)
    }
  })

  it('the cue follows the translation settings (RU, EN, both)', () => {
    const item = clozePool(words(6))[0]
    const cue = (raw: Record<string, unknown>) => renderToStaticMarkup(createElement(ClozeQuestion, { item, settings: parseSettings(raw), lang: 'ru', onAnswered: () => {} }))
    expect(cue({ show_ru_translation: true, show_en_translation: false })).toMatch(/\(RU: слово/)
    expect(cue({ show_ru_translation: true, show_en_translation: false })).not.toContain('(EN:')
    const both = cue({ show_ru_translation: true, show_en_translation: true })
    expect(both).toContain('(RU:')
    expect(both).toContain('(EN:')
  })

  it('the controls are English even when the translations are Russian (the default); only the cue is Russian', () => {
    const html = render(words(12))
    for (const label of ['Hint', 'Reveal', 'Check']) expect(html).toContain(label)
    for (const label of ['Подсказка', 'Показать', 'Проверить', 'Твой ответ']) expect(html).not.toContain(label)
    expect(html).toContain('<h1>Cloze</h1>')
    expect(html).toMatch(/\(RU: слово/) // word content follows the translation setting
  })

  it('with fewer than 5 usable words it says so and offers the way home', () => {
    const html = render(words(4), { show_ru_translation: false, show_en_translation: true })
    expect(html).toContain('Learn and review some words with example sentences first')
    expect(html).toContain('Back home')
    expect(html).not.toContain('cz-card')
  })
})
