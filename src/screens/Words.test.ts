import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from '../data/dictionary'
import { parseRioOverlay } from '../data/rio'
import { parseSettings } from '../data/settings'
import type { Word } from '../data/types'
import { NO_FILTERS, type ListView } from '../data/wordList'
import { createWriteQueue } from '../data/writeQueue'
import { setLanguage } from '../lib/language'
import { makeWord } from '../testing/makeWord'
import { FiltersSheet, SortSheet } from '../components/WordsSheets'
import { WordDetail } from './WordDetail'
import { WordsScreen } from './Words'

const real = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')), parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))))
const day = 86_400_000
const word = (esWord: string) => real.find((w) => w.esWord === esWord)!
const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
const noop = () => {}

const dataFor = (words: readonly Word[], settings = parseSettings({}), degraded: string[] = []) => ({ words, settings, degraded, applyFavorite: noop, applyHidden: noop }) as never

// Five ordinary words (nouns, verbs, adjectives) with progress: the first just seen (learning, interval 0), the third due, the rest well learned (interval 30).
const ordinary = real.filter((w) => ['n', 'v', 'adj'].includes(w.pos)).slice(0, 5)
const learnedSome = (): Word[] => {
  const keys = new Set(ordinary.map((w) => w.esWord))
  return [
    ...ordinary.map((w, i) => ({ ...w, repetitions: i === 0 ? 1 : 3, interval: i === 0 ? 0 : 30, nextReview: new Date(Date.now() + (i === 2 ? -day : 5 * day)) }) as Word),
    ...real.filter((w) => !keys.has(w.esWord)),
  ]
}

const render = (words: readonly Word[], savedView: ListView | null = null, settings = parseSettings({}), degraded: string[] = []) =>
  renderToStaticMarkup(createElement(WordsScreen, { data: dataFor(words, settings, degraded), queue, savedView, onViewChange: noop, onOpen: noop }))
const view = (over: Partial<ListView> = {}): ListView => ({ segment: 'all', sort: 'frequency', seed: 1, filters: NO_FILTERS, query: '', scrollTop: 0, ...over })

describe('the Words screen', () => {
  it('has the header, a search field, the segments All · Started · Hidden with their counts, the two buttons and the list', () => {
    const html = render(learnedSome())
    expect(html).toContain('<h1>Words</h1>')
    expect(html).toMatch(/<input type="search" class="words-search"[^>]*placeholder="Search Spanish, English, Russian"/)
    expect([...html.matchAll(/class="segment[^"]*"[^>]*>(\w+) <span class="segment-count">(\d+)/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual(['All 4753', 'Started 5', 'Hidden 0'])
    expect(html).toContain('role="list"')
  })

  it('opens on All, most common first, with nothing filtered', () => {
    const html = render(learnedSome())
    expect(html).toMatch(/class="segment is-active" aria-pressed="true">All/)
    expect(html).toContain('aria-label="Sort: Frequency"')
  })

  it('has one row of two buttons where the chips were: Filters and Sort: <current>', () => {
    const html = render(real)
    const controls = html.match(/<div class="words-controls">.*?<\/div>/)![0]
    expect(controls.match(/<button/g)).toHaveLength(2)
    expect(controls).toMatch(/class="control-btn"[^>]*><span class="control-label">Filters<\/span><\/button>/)
    // the Sort button: an icon and the value alone on its face, the whole phrase as its name
    expect(controls).toMatch(/class="control-btn"[^>]*aria-label="Sort: Frequency"[^>]*><svg[^>]*aria-hidden="true">.*?<\/svg><span class="control-label">Frequency<\/span><\/button>/)
    expect(controls).not.toContain('>Sort: ') // "Sort:" is no longer on the face
    // the mixed chip strip is gone: nothing but the segments and these two buttons sits above the list
    expect(html).not.toContain('class="chips"')
    expect(html).not.toContain('class="chip')
    expect(html).not.toContain('class="sheet') // and no sheet until one is asked for
  })

  it('the Started count is the studied words that are not hidden: a studied word that is hidden is counted under Hidden, not under Started', () => {
    const words = learnedSome().map((w) => (w.esWord === ordinary[1].esWord ? ({ ...w, isHidden: true } as Word) : w))
    const html = render(words)
    expect([...html.matchAll(/class="segment[^"]*"[^>]*>(\w+) <span class="segment-count">(\d+)/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual(['All 4753', 'Started 4', 'Hidden 1'])
  })

  it('Filters shows how many are on, and Sort names the current order', () => {
    const html = render(real, view({ sort: 'recent', filters: { stage: 'learning', due: true, favourites: true, custom: false, pos: 'verb' } }))
    expect(html).toMatch(/class="control-btn is-active"[^>]*><span class="control-label">Filters<\/span><span class="control-count" aria-label="4 filters on">4<\/span>/)
    expect(html).toContain('aria-label="Sort: Recently studied"')
    expect(html).toContain('<span class="control-label">Recently studied</span>')
    expect(render(real, view({ filters: { ...NO_FILTERS, favourites: true } }))).toContain('aria-label="1 filter on">1</span>')
  })

  it('while a search is on, the order is "Best match" and the Sort button is off', () => {
    const html = render(real, view({ query: 'casa', sort: 'az' }))
    expect(html).toMatch(/class="control-btn" aria-haspopup="dialog" aria-label="Sort: Best match" disabled="">/)
    expect(html).toContain('<span class="control-label">Best match</span>')
  })

  it('renders only a screenful of 4,753 words: a window, not the list', () => {
    const html = render(real, view())
    const rows = html.match(/class="word-row"/g) ?? []
    expect(rows.length).toBeGreaterThan(5)
    expect(rows.length).toBeLessThan(40)
    expect(html).toContain(`style="height:${4753 * 72}px"`) // but the scroll height is the whole list
  })

  it('a row: the headword in the display face, a part-of-speech tag, a state dot, one muted line with the translation in the user\'s language, a star', () => {
    const html = render(learnedSome(), view({ segment: 'started' }))
    expect(html).toContain(`<span class="word-row-head">${ordinary[0].esWord}</span>`)
    expect(html).toMatch(/<span class="word-row-pos">(noun|verb|adj)<\/span>/)
    expect(html).toMatch(/class="state-dot is-learning"/) // one repetition
    expect(html).toMatch(/class="state-dot is-wellLearned"/) // interval 30
    expect(html).toContain('<span class="word-row-line">') // one line, not two
    expect(html).toContain(ordinary[0].ruTranslation) // Russian by default
    expect(html).not.toContain(`>${ordinary[0].enTranslation}</span>`)
    expect(html).not.toContain('word-row-star') // a word that has been learned has nothing left to be learned sooner
  })

  it('shows the English line instead when the user has switched Russian off', () => {
    const html = render(learnedSome(), view({ segment: 'started' }), parseSettings({ show_ru_translation: false, show_en_translation: true }))
    expect(html).toContain(ordinary[0].enTranslation)
    expect(html).not.toContain(`>${ordinary[0].ruTranslation}</span>`)
  })

  it('a due word has a "Due now" badge', () => {
    expect(render(learnedSome(), view({ segment: 'started' }))).toContain('<span class="word-row-due">Due now</span>')
  })

  it('the Hidden list has "Bring back" on each row in place of the star', () => {
    const words = [makeWord('siete', { rank: 1, isHidden: true, repetitions: 2, nextReview: new Date(Date.now() + day) }), makeWord('uno', { rank: 2 })]
    const html = render(words, view({ segment: 'hidden' }))
    expect(html).toContain('Bring back</button>')
    expect(html).toContain('aria-label="Bring back siete"')
    expect(html).not.toContain('word-row-star')
    expect(html.match(/class="word-row"/g)).toHaveLength(1)
  })

  describe('the line above the list about the star: only until a word has one', () => {
    const LINE = '<p class="words-note words-star-hint">Tap the star on a word: it goes into Learn ahead of the others.</p>'
    const plain = [makeWord('uno', { rank: 1 }), makeWord('tres', { rank: 3 })]

    it('nothing starred yet and a star to point at: the line is there, above the list', () => {
      const html = render(plain, view({ segment: 'all' }))
      expect(html).toContain(LINE)
      expect(html.indexOf(LINE)).toBeLessThan(html.indexOf('word-row-star'))
      expect(html.indexOf('words-controls')).toBeLessThan(html.indexOf(LINE))
    })

    it('once a word is starred it is gone, in every segment and filter', () => {
      const starred = [...plain, makeWord('dos', { rank: 2, isFavorite: true, starredAt: 5 })]
      for (const v of [view({ segment: 'all' }), view({ segment: 'started' }), view({ segment: 'hidden' }), view({ filters: { ...NO_FILTERS, favourites: true } })]) expect(render(starred, v)).not.toContain('words-star-hint')
    })

    it('not while the stars could not be read: nothing starred would be a guess', () => {
      expect(render(plain, view({ segment: 'all' }), parseSettings({}), ['user_favorites'])).not.toContain('words-star-hint')
      expect(render(plain, view({ segment: 'all' }), parseSettings({}), ['user_hidden_words'])).toContain(LINE) // another table failing does not matter
    })

    it('not over a list with no star on it: learned words only, the hidden list, an empty list', () => {
      const learned = [makeWord('cuatro', { rank: 4, repetitions: 3, nextReview: new Date(Date.now() + 5 * day) })]
      expect(render(learned, view({ segment: 'all' }))).not.toContain('words-star-hint')
      expect(render([...plain, makeWord('seis', { rank: 6, isHidden: true })], view({ segment: 'hidden' }))).not.toContain('words-star-hint')
      expect(render(plain, view({ query: 'zzzzz' }))).not.toContain('words-star-hint')
    })

    it('in Russian', () => {
      setLanguage('ru')
      try {
        expect(render(plain, view({ segment: 'all' }))).toContain('<p class="words-note words-star-hint">Нажмите звездочку у слова — оно попадет в Learn раньше остальных.</p>')
      } finally {
        setLanguage('en')
      }
    })
  })

  describe('the star on the row: "Learn sooner"', () => {
    const fresh = [makeWord('uno', { rank: 1 }), makeWord('dos', { rank: 2, isFavorite: true, starredAt: 5 }), makeWord('tres', { rank: 3 })]
    const learnedWord = makeWord('cuatro', { rank: 4, repetitions: 3, nextReview: new Date(Date.now() + 5 * day) })
    const reference = makeWord('de', { rank: 5, pos: 'prep' }) // a word that is never taught
    const hiddenWord = makeWord('seis', { rank: 6, isHidden: true })
    const noTranslation = makeWord('siete', { rank: 7, enTranslation: '', ruTranslation: '' })
    const all = [...fresh, learnedWord, reference, hiddenWord, noTranslation]
    const rowOf = (html: string, name: string) => html.match(new RegExp(`<div class="word-row">(?:(?!<div class="word-row">).)*?>${name}</span>.*?</div>(?=<div class="word-row">|</div></div>|$)`, 's'))?.[0] ?? ''

    it('only words Learn can still teach have it: not a learned word, not a reference-only one, not a hidden one, not one with no translation', () => {
      const html = render(all, view({ segment: 'all' }))
      for (const name of ['uno', 'dos', 'tres']) expect(rowOf(html, name), name).toContain('word-row-star')
      for (const name of ['cuatro', 'de', 'siete']) {
        expect(rowOf(html, name), name).toContain('word-row-main') // the row is found
        expect(rowOf(html, name), name).not.toContain('word-row-star') // and has no control at all, not a dead one
        expect(rowOf(html, name), name).not.toContain('disabled')
      }
      expect(html.match(/word-row-star/g)).toHaveLength(3) // one star on each of the three rows, and no other
      const known = render(all, view({ segment: 'hidden' }))
      expect(known).not.toContain('word-row-star') // a hidden word has "Bring back" only
      expect(known).toContain('word-row-bring')
    })

    it('a starred word shows a filled, pressed star; the others an empty one; the name is the same either way, and there is no second control', () => {
      const html = render(all, view({ segment: 'all' }))
      expect(rowOf(html, 'dos')).toContain('class="word-row-star is-on" aria-pressed="true" aria-label="Learn dos sooner"')
      for (const name of ['uno', 'tres']) expect(rowOf(html, name)).toContain(`class="word-row-star" aria-pressed="false" aria-label="Learn ${name} sooner"`)
      expect(html).not.toContain('word-row-queue')
      expect(html).not.toMatch(/Queue|Queued|Saved|Save /)
    })

    it('every star points at one description of what it does, in the screen: hidden, so only a screen reader reads it', () => {
      const html = render(all, view({ segment: 'all' }))
      expect(html.match(/aria-describedby="learn-sooner-hint-list"/g)).toHaveLength(3) // one on each star
      expect(html.match(/id="learn-sooner-hint-list"/g)).toHaveLength(1) // and the one description they share
      expect(html).toContain('<span id="learn-sooner-hint-list" hidden="">The word goes into Learn ahead of the others.</span>')
    })

    it('the row and the "Learn sooner" filter agree: the filter lists exactly the rows with a pressed star', () => {
      const everything = render(all, view({ segment: 'all' }))
      const filtered = render(all, view({ segment: 'all', filters: { ...NO_FILTERS, favourites: true } }))
      const pressedInAll = [...everything.matchAll(/aria-pressed="true" aria-label="Learn ([^ ]+) sooner"/g)].map((m) => m[1]).sort()
      const listedByFilter = [...filtered.matchAll(/aria-label="Open ([^"]+)"/g)].map((m) => m[1]).sort()
      expect(pressedInAll).toEqual(['dos'])
      expect(listedByFilter).toEqual(pressedInAll)
    })

    it('a star that is left over on a word Learn can no longer teach shows no star and is not listed by the filter', () => {
      const stale = [makeWord('uno', { rank: 1, isFavorite: true, starredAt: 1, repetitions: 2, nextReview: new Date(Date.now() + 5 * day) }), makeWord('dos', { rank: 2, isFavorite: true, starredAt: 2, isHidden: true })]
      expect(render(stale, view({ segment: 'all' }))).not.toContain('word-row-star')
      const filtered = render(stale, view({ segment: 'all', filters: { ...NO_FILTERS, favourites: true } }))
      expect(filtered).not.toContain('aria-label="Open uno"')
      expect(filtered).toContain('No words match')
    })
  })

  it('a list empty because of the search or the filters offers to clear them; one empty by nature does not', () => {
    const button = 'Clear search and filters</button>'
    expect(render([makeWord('uno')], view({ query: 'zzz' }))).toContain(button)
    expect(render([makeWord('uno')], view({ filters: { ...NO_FILTERS, favourites: true } }))).toContain(button)
    expect(render([makeWord('uno')], view({ segment: 'hidden' }))).not.toContain(button) // nothing is known yet: there is nothing to clear
    expect(render([makeWord('uno')], view({ segment: 'started' }))).not.toContain(button)
    expect(render(learnedSome())).not.toContain(button) // a list with rows
  })

  it('an empty list says what goes there', () => {
    expect(render([makeWord('uno')], view({ segment: 'hidden' }))).toContain('No hidden words yet. Words you hide with “Hide this word”, or tick in the placement test, appear here.')
    expect(render([makeWord('uno')], view({ segment: 'started' }))).toContain('Nothing started yet.')
    expect(render([makeWord('uno')], view({ query: 'zzz' }))).toContain('No words match.')
  })

  it('a filter narrows the list', () => {
    const html = render(real, view({ filters: { ...NO_FILTERS, pos: 'verb' } }))
    expect(html).toMatch(/<span class="word-row-pos">verb<\/span>/)
    expect(html).not.toContain('<span class="word-row-pos">noun</span>')
  })

  it('a search overrides the segment (no segment is lit) and a row leads with the form that matched, with no "Rioplatense" marker', () => {
    const html = render(real, view({ segment: 'started', query: 'pucho' }))
    expect(html).not.toContain('segment is-active')
    expect(html).toMatch(/\d+ words/) // the count line
    expect(html).toContain('<span class="word-row-head">pucho</span>')
    expect(html).toContain('<span class="word-row-alt">cigarro</span>')
    expect(html).toContain('<span class="word-row-alt">cigarrillo</span>')
    expect(html).not.toContain('class="pill"')
    expect(html).not.toContain('>Rioplatense<')

    const ciga = render(real, view({ query: 'ciga' }))
    expect(ciga).toContain('<span class="word-row-head">cigarrillo</span>')
    expect(ciga).toContain('<span class="word-row-alt">pucho</span>')
  })

  it('outside a search the standard word sits first in the muted line when the headword is not it', () => {
    const forCigarro = render([word('cigarro')], view())
    expect(forCigarro).toContain('<span class="word-row-head">pucho</span>')
    expect(forCigarro).toContain('<span class="word-row-alt">cigarro</span><span class="word-row-tr">')
  })

  it('comes back as it was left: the saved query, segment, sort, filters and scroll position are used, not the defaults', () => {
    const saved = view({ segment: 'started', sort: 'due', query: 'ca', filters: { ...NO_FILTERS, favourites: true, stage: 'learning', due: true } })
    const html = render(learnedSome(), saved)
    expect(html).toContain('value="ca"')
    expect(html).toContain('aria-label="3 filters on"')
    expect(html).toContain('aria-label="Sort: Best match"') // a query is on, so the sort name steps aside
    expect(render(learnedSome(), view({ sort: 'due' }))).toContain('aria-label="Sort: Due soonest"')
  })

  it('no hex colours or Telegram theme variables in the new styles (tokens only), and only Spanish words use the display face', () => {
    const css = readFileSync('src/index.css', 'utf8')
    const words = css.slice(css.indexOf('/* ---- Words:')).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(words).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(words).not.toMatch(/rgba?\(/)
    expect(words).not.toContain('--tg-')
    expect([...words.matchAll(/([^{}]+)\{[^}]*font-family: var\(--font-display\)[^}]*\}/g)].map((m) => m[1].trim().replace(/\s+/g, ' ')).sort()).toEqual(['.intro-es', '.place-chip', '.word-row-alt', '.word-row-head']) // the slice runs to the end of the stylesheet: the intro's Spanish words are in it too
    expect(words).toMatch(/\.word-row-head \{[^}]*font-size: 18px/)
    expect(words).toMatch(/\.words-search \{[^}]*border: 1px solid var\(--border\)[^}]*border-radius: var\(--radius-button\)/s)
    expect(words).toMatch(/\.words-search \{[^}]*background: var\(--surface\)/s)
    expect(words).toMatch(/\.chip \{[^}]*background: var\(--surface-2\)/s)
    expect(words).toMatch(/\.chip\.is-active \{[^}]*background: var\(--lav-soft\)/s)
    expect(words).toMatch(/\.sheet \{[^}]*background: var\(--surface\)/s)
  })
})

describe('the filters sheet', () => {
  const sheet = (props: Partial<Parameters<typeof FiltersSheet>[0]> = {}) =>
    renderToStaticMarkup(createElement(FiltersSheet, { filters: NO_FILTERS, segment: 'all', searching: false, onChange: noop, onClearAll: noop, onClose: noop, ...props }))

  it('has "Clear all" at the top and three groups with headings, in this order: Progress, Show only, Part of speech', () => {
    const html = sheet()
    expect(html).toContain('role="dialog" aria-modal="true" aria-label="Filters"')
    expect(html.indexOf('Clear all')).toBeLessThan(html.indexOf('>Progress<'))
    const headings = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1])
    expect(headings).toEqual(['Progress', 'Show only', 'Part of speech'])
  })

  it('Progress: Any · New · Learning · Well learned · Reference only; Show only: Due now · Learn sooner · Custom; Part of speech: Verbs · Nouns · Adjectives · Adverbs', () => {
    const html = sheet()
    const group = (id: string) => [...html.match(new RegExp(`aria-labelledby="${id}">.*?</section>`))![0].matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1])
    expect(group('sheet-progress')).toEqual(['Any', 'New', 'Learning', 'Well learned', 'Reference only'])
    expect(group('sheet-show-only')).toEqual(['Due now', 'Learn sooner', 'Custom'])
    expect(group('sheet-pos')).toEqual(['Verbs', 'Nouns', 'Adjectives', 'Adverbs'])
  })

  it('marks what is on: Any when no progress filter is set, the chosen option otherwise', () => {
    expect(sheet()).toMatch(/class="chip is-active" aria-pressed="true">Any/)
    const on = sheet({ filters: { stage: 'wellLearned', due: true, favourites: true, custom: false, pos: 'adj' } })
    expect(on).toMatch(/class="chip is-active" aria-pressed="true">Well learned/)
    expect(on).toMatch(/class="chip is-active" aria-pressed="true">Due now/) // Due is a switch of its own: on together with a stage
    expect(on).toMatch(/class="chip" aria-pressed="false">Any/)
    expect(on).toMatch(/class="chip is-active" aria-pressed="true">Learn sooner/)
    expect(on).toMatch(/class="chip is-active" aria-pressed="true">Adjectives/)
  })

  it('"Clear all" is off when nothing is on', () => {
    expect(sheet()).toMatch(/class="link-btn" disabled="">Clear all/)
    expect(sheet({ filters: { ...NO_FILTERS, favourites: true } })).toMatch(/class="link-btn">Clear all/)
  })

  it('in the Hidden list the Progress group is left out, and it is back while searching', () => {
    expect(sheet({ segment: 'hidden' })).not.toContain('Progress')
    expect(sheet({ segment: 'hidden' })).not.toContain('Well learned')
    expect(sheet({ segment: 'hidden' })).not.toContain('Due now') // hidden words are never due: the switch is left out with the group
    expect(sheet({ segment: 'hidden' })).toContain('Part of speech')
    expect(sheet({ segment: 'hidden', searching: true })).toContain('>Progress<')
  })
})

describe('the sort sheet', () => {
  const sheet = (sort: 'frequency' | 'az' | 'due' | 'recent' | 'random' = 'frequency') => renderToStaticMarkup(createElement(SortSheet, { sort, onSelect: noop, onClose: noop }))

  it('offers Frequency · A to Z · Due soonest · Recently studied · Random, Random last', () => {
    const html = sheet()
    expect([...html.matchAll(/role="radio"[^>]*><span>([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(['Frequency', 'A to Z', 'Due soonest', 'Recently studied', 'Random'])
    expect(html).toContain('aria-label="Sort by"')
  })

  it('checks the current one', () => {
    expect(sheet('frequency')).toMatch(/class="sheet-row is-active" role="radio" aria-checked="true"><span>Frequency/)
    expect(sheet('recent')).toMatch(/aria-checked="true"><span>Recently studied/)
    expect(sheet('recent')).toMatch(/aria-checked="false"><span>Frequency/)
    expect(sheet('random')).toMatch(/aria-checked="true"><span>Random/)
  })
})

describe('the word detail', () => {
  const NOWISH = Date.now()
  const detail = (word: Word) => renderToStaticMarkup(createElement(WordDetail, { word, data: dataFor([word]), queue }))
  const base = makeWord('casa', { pos: 'n', enTranslation: 'house', ruTranslation: 'дом', rank: 1 })

  it('is the full card, then the state block, then the actions', () => {
    const html = detail(base)
    expect(html.indexOf('wc-headword')).toBeLessThan(html.indexOf('state-block'))
    expect(html.indexOf('state-block')).toBeLessThan(html.indexOf('detail-actions'))
    expect(html).toContain('Learn sooner')
    expect(html).not.toContain('Bring back')
  })

  describe('the scheduling details: one collapsed disclosure holding the five rows', () => {
    const learned = { ...base, repetitions: 3, interval: 12, easeFactor: 2.36, nextReview: new Date(NOWISH + 3 * day) }
    const details = (html: string) => html.match(/<details class="sched">.*?<\/details>/)![0]

    it('is a real <details>, closed (no "open"), with the summary "Scheduling details" — not "More"', () => {
      const html = detail(learned)
      expect(html.match(/<details/g)).toHaveLength(1)
      expect(html).toMatch(/<details class="sched"><summary>Scheduling details<\/summary>/)
      expect(details(html)).not.toMatch(/^<details[^>]*\bopen\b/)
      expect(html).not.toContain('>More<')
    })

    it('holds all five rows: State, Repetitions, Interval, Next review and Ease factor', () => {
      const inside = details(detail(learned))
      expect([...inside.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1])).toEqual(['State', 'Repetitions', 'Interval', 'Next review', 'Ease factor'])
      expect(inside).toContain('<dt>State</dt><dd>Learning</dd>') // interval 12 days: under the 21 that make a word well learned
      expect(inside).toContain('<dt>Repetitions</dt><dd>3</dd>')
      expect(inside).toContain('<dt>Interval</dt><dd>12d</dd>')
      // the number, and beside it what it means (no bands are invented: the hint says which way the number works)
      expect(inside).toContain('<dt>Ease factor</dt><dd>2.36 <span class="sched-hint">· the higher, the less often the word comes back</span></dd>')
    })

    it('shows none of them outside it: nothing in the card is a visible row any more', () => {
      const html = detail(learned)
      const outside = html.replace(details(html), '')
      for (const label of ['State', 'Repetitions', 'Interval', 'Next review', 'Ease factor']) expect(outside).not.toContain(`<dt>${label}</dt>`)
    })

    it('is the same for every kind of word: new, hidden and reference-only ones get all five rows too', () => {
      for (const word of [base, { ...base, isHidden: true }, makeWord('de', { pos: 'prep', rank: 1 })]) {
        const inside = details(detail(word))
        expect(inside.match(/<dt>/g)).toHaveLength(5)
        expect(inside).toContain('Ease factor')
      }
      expect(details(detail(base))).toContain('Not scheduled')
    })

    it('has no card of its own: quiet text under the card, in the muted colour and a smaller size', () => {
      const html = detail(learned)
      expect(html).not.toMatch(/class="card state-block"/)
      const css = readFileSync('src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(css).toMatch(/\.sched \{[^}]*color: var\(--muted\)[^}]*font-size: 13px/s)
      expect(css).toMatch(/\.sched summary \{[^}]*color: var\(--muted\)/s)
      expect(css).not.toMatch(/\.sched \{[^}]*background/s)
      expect(css).not.toMatch(/\.sched \{[^}]*border:/s)
    })

    it('nothing remembers whether it was open: no storage, and the disclosure is not driven by any state', () => {
      const source = readFileSync('src/screens/WordDetail.tsx', 'utf8')
      expect(source).not.toMatch(/localStorage|sessionStorage/)
      expect(source).not.toMatch(/<details[^>]*\bopen\b/)
    })
  })

  it('a due word says so next to its date', () => {
    const html = detail({ ...base, repetitions: 2, interval: 6, nextReview: new Date(NOWISH - day) })
    expect(html).toContain('<dt>State</dt><dd>Learning</dd>') // due is not a stage: the word keeps its own
    expect(html).toContain('· due now') // and says so next to its date
  })

  it('a word rated Again reads as learning, with the lowered ease, and nothing claims it went back to Learn', () => {
    const html = detail({ ...base, repetitions: 1, interval: 0, easeFactor: 2.18, nextReview: new Date(NOWISH + 10 * 60 * 1000) })
    expect(html).toContain('<dt>State</dt><dd>Learning</dd>')
    expect(html).toContain('2.18')
    expect(html).not.toContain('<dd>New</dd>')
    expect(html).not.toContain('Learn pool')
    expect(html).not.toContain('set it back to new')
  })

  it('once its ten minutes are up it is due, and still learning', () => {
    const html = detail({ ...base, repetitions: 1, interval: 0, easeFactor: 2.18, nextReview: new Date(NOWISH - 1000) })
    expect(html).toContain('<dt>State</dt><dd>Learning</dd>')
    expect(html).toContain('· due now')
  })

  it('a word an earlier version sent back to new still reads as new (Learn can teach it again), and says nothing about Learn', () => {
    const html = detail({ ...base, repetitions: 0, interval: 0, easeFactor: 2.18, nextReview: new Date(NOWISH - day) })
    expect(html).toContain('<dd>New</dd>')
    expect(html).not.toContain('Learn pool')
    expect(html).not.toContain('Again')
  })

  it('a hidden word explains that its progress is kept, and offers "Bring back" and no star: a hidden word is not waiting to be taught', () => {
    const html = detail({ ...base, isHidden: true, isFavorite: true, repetitions: 2, nextReview: new Date(NOWISH + day) })
    expect(html).toContain('<dd>Hidden</dd>')
    expect(html).toContain('Its progress is kept')
    expect(html).toContain('aria-label="Bring back casa"')
    expect(html).not.toContain('Learn sooner')
    expect(html).not.toContain('aria-pressed')
  })

  describe('the "Learn sooner" button', () => {
    const button = (html: string) => html.match(/<button[^>]*aria-pressed[^>]*>.*?<\/button>/)?.[0] ?? ''

    it('a word that can still be taught has it, with the words on the button, not pressed', () => {
      const html = button(detail(base))
      expect(html).toContain('aria-pressed="false"')
      expect(html.replace(/<[^>]*>/g, '').trim()).toBe('Learn sooner')
      expect(html).not.toContain('is-on')
    })

    it('starred, the button only looks active: same words, pressed', () => {
      const html = button(detail({ ...base, isFavorite: true, starredAt: 3 }))
      expect(html).toContain('aria-pressed="true"')
      expect(html).toContain('is-on')
      expect(html.replace(/<[^>]*>/g, '').trim()).toBe('Learn sooner')
    })

    it('a word in progress, learned, reference-only or untranslated has no button at all', () => {
      const none: Word[] = [
        { ...base, repetitions: 1, nextReview: new Date(NOWISH + day) },
        { ...base, repetitions: 4, interval: 30, nextReview: new Date(NOWISH + 30 * day) },
        makeWord('de', { pos: 'prep', rank: 1 }),
        { ...base, enTranslation: '', ruTranslation: '' },
      ]
      for (const word of none) {
        const html = detail(word)
        expect(html).not.toContain('Learn sooner')
        expect(html).not.toContain('aria-pressed')
      }
    })

    it('a line next to the button says what it does, pressed or not, and the button points at it', () => {
      for (const word of [base, { ...base, isFavorite: true, starredAt: 3 }]) {
        const html = detail(word)
        expect(html).toContain('<p id="learn-sooner-hint" class="detail-hint">The word goes into Learn ahead of the others.</p>')
        expect(button(html)).toContain('aria-describedby="learn-sooner-hint"')
        expect(html).toContain(`${button(html)}<p id="learn-sooner-hint"`) // right under the button, not elsewhere on the page
      }
    })

    it('in Russian the line is Russian', () => {
      setLanguage('ru')
      try {
        expect(detail(base)).toContain('<p id="learn-sooner-hint" class="detail-hint">Слово попадет в Learn раньше остальных.</p>')
      } finally {
        setLanguage('en')
      }
    })

    it('where there is no button there is no line', () => {
      expect(detail({ ...base, repetitions: 4, interval: 30, nextReview: new Date(NOWISH + 30 * day) })).not.toContain('learn-sooner-hint')
    })

    it('there is no queue on the detail any more: no place in line, no "beyond today\'s batch"', () => {
      expect(detail({ ...base, isFavorite: true, starredAt: 3 })).not.toMatch(/queue|in line|Beyond/i)
    })
  })

  it('a reference-only word says why it is never in Learn or Review', () => {
    expect(detail(makeWord('de', { pos: 'prep', rank: 1 }))).toContain('Reference only: this kind of word is not drilled, so it is never in Learn or Review.')
    expect(detail(makeWord('casa', { enTranslation: 'house', ruTranslation: '' }))).toContain('it has no translation yet')
  })
})
