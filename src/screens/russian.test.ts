import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { FiltersSheet, SortSheet } from '../components/WordsSheets'
import { parseSettings } from '../data/settings'
import { computeStats } from '../data/stats'
import type { Word } from '../data/types'
import { NO_FILTERS } from '../data/wordList'
import { createWriteQueue } from '../data/writeQueue'
import { setLanguage } from '../lib/language'
import { strings } from '../strings'
import { makeWord } from '../testing/makeWord'
import { ClozeScreen } from './Cloze'
import { HomeScreen } from './Home'
import { HowItWorks } from './HowItWorks'
import { LearnScreen } from './Learn'
import { MatchingScreen } from './Matching'
import { Onboarding } from './Onboarding'
import { STEPS, type StepProps } from './onboardingSteps'
import { PlacementScreen } from './PlacementScreen'
import { ReviewScreen } from './Review'
import { SettingsScreen } from './Settings'
import { WordDetail } from './WordDetail'
import { WordsScreen } from './Words'

// Every screen drawn in Russian: none of the interface is left in English, except the names of the app's own screens (Learn, Review,
// Matching, Cloze, Words) and the Spanish words and example sentences, which are content. Debug is not here: it stays English.

afterEach(() => setLanguage('en'))

const noop = () => {}
const past = new Date('2026-10-01T03:00:00.000Z')
const learned = (n: number): Word[] =>
  Array.from({ length: n }, (_, i) =>
    makeWord(`palabra${i}`, {
      repetitions: 1,
      nextReview: past,
      rank: i + 1,
      ruTranslation: `слово${'абвгдежзик'[i % 10]}${'абвгдежзик'[Math.floor(i / 10)]}`,
      enTranslation: `word${i}`,
      exampleSentence: `Esta es la palabra${i} del día.`,
      wordFormInExample: `palabra${i}`,
    }),
  )
const unlearned = (n: number) => Array.from({ length: n }, (_, i) => makeWord(`nueva${i}`, { rank: 100 + i, ruTranslation: `новое${i}`, enTranslation: `new${i}` }))

/** The English words that may stay: screen names, and the Spanish of the content and examples. */
const KEEP = new Set(['Learn', 'Review', 'Matching', 'Cloze', 'Words', 'Riopalabras', 'English', 'Telegram', 'boom', 'palabra', 'nueva', 'nuevo', 'para', 'Esta', 'del', 'día', 'aprender', 'repasar', 'parejas', 'completar', 'calle', 'vos', 'tenés', 'tú', 'tienes'])

/** What a person reads or hears on a screen: its text, plus the labels that are not text (aria-label, placeholder, title). */
function visible(html: string): string[] {
  const texts = [...html.matchAll(/>([^<>]+)</g)].map((m) => m[1])
  const labels = [...html.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/g)].map((m) => m[1])
  return [...texts, ...labels]
    .map((t) => t.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim())
    .filter((t) => t && !/^@\w+$/.test(t) && !/^v?[0-9a-f]{7}\b/.test(t) && !/^dev · /.test(t)) // a bot handle and the build version are not interface text
}
const latinLeft = (html: string) =>
  visible(html)
    .flatMap((t) => (t.match(/\p{Script=Latin}{3,}\d*/gu) ?? []).map((w) => ({ w: w.replace(/\d+$/, ''), t })))
    .filter(({ w }) => !KEEP.has(w))
    .map(({ w, t }) => `${w} ← “${t}”`)

const settingsRaw = { show_ru_translation: true, show_en_translation: false, onboarding_done: true }
const dataFor = (words: readonly Word[], raw: Record<string, unknown> = settingsRaw) =>
  ({ words, settings: parseSettings(raw), stats: computeStats(words, parseSettings(raw), new Date()), getSettings: () => parseSettings(raw), applySettings: noop, applyProgress: noop, applyHidden: noop, applyFavorite: noop, upsertCustomWord: noop, removeCustomWord: noop, degraded: [], retryDegraded: noop }) as never
const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })

const screens: [string, () => string][] = [
  ['Home', () => renderToStaticMarkup(createElement(HomeScreen, { auth: { status: 'signed-in', userId: 'u', telegramFirstName: null, source: 'existing' }, data: { status: 'ready', data: dataFor([...learned(8), ...unlearned(10)]) }, onLearn: noop, onReview: noop, onMatching: noop, onCloze: noop, onWords: noop, onSettings: noop, queue: null, metrics: null, activity: new Set(['2026-10-05']) } as never))],
  ['Home with too few words for practice', () => renderToStaticMarkup(createElement(HomeScreen, { auth: { status: 'signed-in', userId: 'u', telegramFirstName: null, source: 'existing' }, data: { status: 'ready', data: dataFor(learned(3)) }, onLearn: noop, onReview: noop, onMatching: noop, onCloze: noop, queue: null, metrics: null } as never))],
  ['Home while loading', () => renderToStaticMarkup(createElement(HomeScreen, { auth: { status: 'loading' }, data: { status: 'loading' }, onLearn: noop, onReview: noop, onMatching: noop, onCloze: noop, queue: null, metrics: null } as never))],
  ['Home when the load failed', () => renderToStaticMarkup(createElement(HomeScreen, { auth: { status: 'signed-in', userId: 'u', telegramFirstName: null, source: 'existing' }, data: { status: 'error', message: 'boom' }, onLearn: noop, onReview: noop, onMatching: noop, onCloze: noop, queue: null, metrics: null } as never))],
  ['Home signed out', () => renderToStaticMarkup(createElement(HomeScreen, { auth: { status: 'no-telegram' }, data: { status: 'signed-out', dictionaryCount: 4753 }, onLearn: noop, onReview: noop, onMatching: noop, onCloze: noop, queue: null, metrics: null } as never))],
  ['Settings', () => renderToStaticMarkup(createElement(SettingsScreen, { data: dataFor([]), queue, theme: { choice: 'system', set: noop }, debugAllowed: false, onOpenDebug: noop, onOpenHow: noop, onRunIntro: noop, botUsername: 'riopalabras_bot', onBack: noop } as never))],
  ['How it works', () => renderToStaticMarkup(createElement(HowItWorks, { onBack: noop }))],
  ['Intro, first run', () => renderToStaticMarkup(createElement(Onboarding, { data: dataFor([], {}), queue, mode: 'first' } as never))],
  ['Intro, replay', () => renderToStaticMarkup(createElement(Onboarding, { data: dataFor([], settingsRaw), queue, mode: 'replay' } as never))],
  ...STEPS.map((s): [string, () => string] => [
    `Intro step: ${s.id}`,
    () => renderToStaticMarkup(createElement(s.Body, { settings: parseSettings({ daily_new_word_limit: 18 }), saveSetting: noop, stepGoal: noop, onHow: noop, words: [], savePlacement: noop, advance: noop, retreat: noop, interceptBack: noop } satisfies StepProps)),
  ]),
  ['Words', () => renderToStaticMarkup(createElement(WordsScreen, { data: dataFor([...learned(5), ...unlearned(5)]), queue, savedView: null, onViewChange: noop, onOpen: noop, onBack: noop } as never))],
  ['Words, nothing found', () => renderToStaticMarkup(createElement(WordsScreen, { data: dataFor([]), queue, savedView: null, onViewChange: noop, onOpen: noop } as never))],
  ['Filters sheet', () => renderToStaticMarkup(createElement(FiltersSheet, { filters: NO_FILTERS, segment: 'all', searching: false, onChange: noop, onClearAll: noop, onClose: noop }))],
  ['Sort sheet', () => renderToStaticMarkup(createElement(SortSheet, { sort: 'frequency', onSelect: noop, onClose: noop }))],
  ['Word detail, a new word', () => renderToStaticMarkup(createElement(WordDetail, { word: unlearned(1)[0], data: dataFor(unlearned(1)), queue, onBack: noop } as never))],
  ['Word detail, a learned word', () => renderToStaticMarkup(createElement(WordDetail, { word: { ...learned(1)[0], interval: 6, easeFactor: 2.4, repetitions: 3, nextReview: new Date(2026, 9, 12) }, data: dataFor(learned(1)), queue } as never))],
  ['Word detail, a lapsed word', () => renderToStaticMarkup(createElement(WordDetail, { word: { ...unlearned(1)[0], nextReview: new Date(2026, 9, 1), easeFactor: 2.1 }, data: dataFor(unlearned(1)), queue } as never))],
  ['Word detail, a hidden word', () => renderToStaticMarkup(createElement(WordDetail, { word: { ...unlearned(1)[0], isHidden: true }, data: dataFor(unlearned(1)), queue } as never))],
  ['Word detail, a reference word', () => renderToStaticMarkup(createElement(WordDetail, { word: makeWord('para', { pos: 'prep', ruTranslation: 'для', enTranslation: 'for' }), data: dataFor([]), queue } as never))],
  ['Word detail, a word the user added', () => renderToStaticMarkup(createElement(WordDetail, { word: { ...unlearned(1)[0], isCustom: true, isRioplatenseVariant: true, region: 'uy', register: 'informal', esStandard: 'nuevo' }, data: dataFor(unlearned(1)), queue } as never))],
  ['Placement test, on its own', () => renderToStaticMarkup(createElement(PlacementScreen, { data: dataFor(Array.from({ length: 300 }, (_, i) => makeWord(`nueva${i}`, { rank: i + 1, ruTranslation: `новое${i}`, enTranslation: `new${i}` }))), queue, onExit: noop, onBack: noop } as never))],
  ['Placement test, too few words', () => renderToStaticMarkup(createElement(PlacementScreen, { data: dataFor(unlearned(3)), queue, onExit: noop } as never))],
  ['Learn', () => renderToStaticMarkup(createElement(LearnScreen, { data: dataFor(unlearned(40)), queue, metrics: null, onHome: noop, onReview: noop, onBack: noop } as never))],
  ['Learn, nothing left', () => renderToStaticMarkup(createElement(LearnScreen, { data: dataFor([]), queue, metrics: null, onHome: noop, onReview: noop } as never))],
  ['Review', () => renderToStaticMarkup(createElement(ReviewScreen, { data: dataFor(learned(4)), queue, metrics: null, onHome: noop, onLearn: noop, onBack: noop } as never))],
  ['Review, nothing due', () => renderToStaticMarkup(createElement(ReviewScreen, { data: dataFor([]), queue, metrics: null, onHome: noop, onLearn: noop } as never))],
  ['Matching', () => renderToStaticMarkup(createElement(MatchingScreen, { data: dataFor(learned(8)), queue, metrics: null, onHome: noop, onBack: noop } as never))],
  ['Matching, too few words', () => renderToStaticMarkup(createElement(MatchingScreen, { data: dataFor(learned(2)), queue, metrics: null, onHome: noop } as never))],
  ['Cloze', () => renderToStaticMarkup(createElement(ClozeScreen, { data: dataFor(learned(8)), queue, metrics: null, onHome: noop, onBack: noop } as never))],
  ['Cloze, too few words', () => renderToStaticMarkup(createElement(ClozeScreen, { data: dataFor(learned(2)), queue, metrics: null, onHome: noop } as never))],
]

describe('every screen in Russian', () => {
  for (const [name, render] of screens) {
    it(`${name}: nothing is left in English`, () => {
      setLanguage('ru')
      const html = render()
      expect(html.length).toBeGreaterThan(40)
      expect(latinLeft(html)).toEqual([])
      expect(html).toMatch(/[А-Яа-яЁё]/) // and there is Russian on it
    })
  }

  it('the same screens in English have no Russian chrome (the Russian words above are the interface\'s, not the content\'s)', () => {
    setLanguage('en')
    for (const [name, render] of screens) {
      const withoutContent = render().replace(/слово[а-я]+|новое\d+|для/g, '').replace(/Русский/g, '')
      expect(withoutContent, name).not.toMatch(/[А-Яа-яЁё]/)
    }
  })

  it('each screen differs between the two languages (the language really reaches it)', () => {
    for (const [name, render] of screens) {
      setLanguage('en')
      const english = render()
      setLanguage('ru')
      expect(render(), name).not.toBe(english)
    }
  })
})

describe('Russian interface, English-only translations', () => {
  it('the chrome is Russian and the words show their English translation only', () => {
    setLanguage('ru')
    const raw = { show_ru_translation: false, show_en_translation: true, onboarding_done: true }
    const words = [...learned(6), ...unlearned(4)]
    const home = renderToStaticMarkup(createElement(HomeScreen, { auth: { status: 'signed-in', userId: 'u', telegramFirstName: null, source: 'existing' }, data: { status: 'ready', data: dataFor(words, raw) }, onLearn: noop, onReview: noop, onMatching: noop, onCloze: noop, queue: null, metrics: null } as never))
    expect(home).toContain('0 дней подряд') // the chrome is Russian
    const list = renderToStaticMarkup(createElement(WordsScreen, { data: dataFor(words, raw), queue, savedView: null, onViewChange: noop, onOpen: noop } as never))
    expect(list).toContain('Поиск: испанский, английский или русский')
    expect(list).toContain('word0') // the translation shown is English
    expect(list).not.toMatch(/слово[а-я]/) // and no Russian translation
    const detail = renderToStaticMarkup(createElement(WordDetail, { word: unlearned(1)[0], data: dataFor(unlearned(1), raw), queue } as never))
    expect(detail).toContain('new0')
    expect(detail).not.toContain('новое0')
    expect(detail).toContain('В избранное') // chrome: Russian
    expect(detail).toContain('EN:') // the label of a translation row is word content: it follows the flags
    expect(detail).not.toContain('RU:')
  })

  it('and the other way: an English interface with Russian-only translations', () => {
    setLanguage('en')
    const raw = { show_ru_translation: true, show_en_translation: false, onboarding_done: true }
    const detail = renderToStaticMarkup(createElement(WordDetail, { word: unlearned(1)[0], data: dataFor(unlearned(1), raw), queue } as never))
    expect(detail).toContain('новое0')
    expect(detail).toContain('Add to favourites')
    expect(strings.words.addFavourite).toBe('Add to favourites')
  })
})
