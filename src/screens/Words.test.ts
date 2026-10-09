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
import { makeWord } from '../testing/makeWord'
import { FiltersSheet, SortSheet } from '../components/WordsSheets'
import { WordDetail } from './WordDetail'
import { WordsScreen } from './Words'

const real = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')), parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))))
const day = 86_400_000
const word = (esWord: string) => real.find((w) => w.esWord === esWord)!
const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
const noop = () => {}

const dataFor = (words: readonly Word[], settings = parseSettings({})) => ({ words, settings, applyFavorite: noop, applyHidden: noop }) as never

// Five ordinary words (nouns, verbs, adjectives) with progress: the first learning, the third due, the rest established.
const ordinary = real.filter((w) => ['n', 'v', 'adj'].includes(w.pos)).slice(0, 5)
const learnedSome = (): Word[] => {
  const keys = new Set(ordinary.map((w) => w.esWord))
  return [
    ...ordinary.map((w, i) => ({ ...w, repetitions: i === 0 ? 1 : 3, nextReview: new Date(Date.now() + (i === 2 ? -day : 5 * day)) }) as Word),
    ...real.filter((w) => !keys.has(w.esWord)),
  ]
}

const render = (words: readonly Word[], savedView: ListView | null = null, settings = parseSettings({})) =>
  renderToStaticMarkup(createElement(WordsScreen, { data: dataFor(words, settings), queue, savedView, onViewChange: noop, onOpen: noop }))
const view = (over: Partial<ListView> = {}): ListView => ({ segment: 'all', sort: 'frequency', seed: 1, filters: NO_FILTERS, query: '', scrollTop: 0, ...over })

describe('the Words screen', () => {
  it('has the header, a search field, the segments All · Learned · Hidden with their counts, the two buttons and the list', () => {
    const html = render(learnedSome())
    expect(html).toContain('<h1>Words</h1>')
    expect(html).toMatch(/<input type="search" class="words-search"[^>]*placeholder="Search Spanish, English or Russian"/)
    expect([...html.matchAll(/class="segment[^"]*"[^>]*>(\w+) <span class="segment-count">(\d+)/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual(['All 4753', 'Learned 5', 'Hidden 0'])
    expect(html).toContain('role="list"')
  })

  it('opens on All, most common first, with nothing filtered', () => {
    const html = render(learnedSome())
    expect(html).toMatch(/class="segment is-active" aria-pressed="true">All/)
    expect(html).toContain('Sort: Frequency')
  })

  it('has one row of two buttons where the chips were: Filters and Sort: <current>', () => {
    const html = render(real)
    const controls = html.match(/<div class="words-controls">.*?<\/div>/)![0]
    expect(controls.match(/<button/g)).toHaveLength(2)
    expect(controls).toMatch(/class="control-btn"[^>]*>Filters<\/button>/)
    expect(controls).toMatch(/class="control-btn"[^>]*>Sort: Frequency<\/button>/)
    // the mixed chip strip is gone: nothing but the segments and these two buttons sits above the list
    expect(html).not.toContain('class="chips"')
    expect(html).not.toContain('class="chip')
    expect(html).not.toContain('class="sheet') // and no sheet until one is asked for
  })

  it('Filters shows how many are on, and Sort names the current order', () => {
    const html = render(real, view({ sort: 'recent', filters: { state: 'due', favourites: true, queued: false, custom: false, pos: 'verb' } }))
    expect(html).toMatch(/class="control-btn is-active"[^>]*>Filters<span class="control-count" aria-label="3 filters on">3<\/span>/)
    expect(html).toContain('Sort: Recently learned')
    expect(render(real, view({ filters: { ...NO_FILTERS, favourites: true } }))).toContain('aria-label="1 filter on">1</span>')
  })

  it('while a search is on, the order is "Best match" and the Sort button is off', () => {
    const html = render(real, view({ query: 'casa', sort: 'az' }))
    expect(html).toMatch(/class="control-btn" aria-haspopup="dialog" disabled="">Sort: Best match/)
  })

  it('renders only a screenful of 4,753 words: a window, not the list', () => {
    const html = render(real, view())
    const rows = html.match(/class="word-row"/g) ?? []
    expect(rows.length).toBeGreaterThan(5)
    expect(rows.length).toBeLessThan(40)
    expect(html).toContain(`style="height:${4753 * 72}px"`) // but the scroll height is the whole list
  })

  it('a row: the headword in the display face, a part-of-speech tag, a state dot, one muted line with the translation in the user\'s language, a star', () => {
    const html = render(learnedSome(), view({ segment: 'learned' }))
    expect(html).toContain(`<span class="word-row-head">${ordinary[0].esWord}</span>`)
    expect(html).toMatch(/<span class="word-row-pos">(noun|verb|adj)<\/span>/)
    expect(html).toMatch(/class="state-dot is-learning"/) // one repetition
    expect(html).toMatch(/class="state-dot is-established"/)
    expect(html).toContain('<span class="word-row-line">') // one line, not two
    expect(html).toContain(ordinary[0].ruTranslation) // Russian by default
    expect(html).not.toContain(`>${ordinary[0].enTranslation}</span>`)
    expect(html).toContain(`aria-pressed="false" aria-label="Add ${ordinary[0].esWord} to favourites"`)
  })

  it('shows the English line instead when the user has switched Russian off', () => {
    const html = render(learnedSome(), view({ segment: 'learned' }), parseSettings({ show_ru_translation: false, show_en_translation: true }))
    expect(html).toContain(ordinary[0].enTranslation)
    expect(html).not.toContain(`>${ordinary[0].ruTranslation}</span>`)
  })

  it('a due word has a "Due now" badge, and a favourite star is filled and pressed', () => {
    const words = learnedSome().map((w) => (w.esWord === ordinary[2].esWord ? ({ ...w, isFavorite: true } as Word) : w))
    const html = render(words, view({ segment: 'learned' }))
    expect(html).toContain('<span class="word-row-due">Due now</span>')
    expect(html).toMatch(/word-row-star is-on" aria-pressed="true" aria-label="Remove [^"]+ from favourites"/)
  })

  it('the Hidden list has "Bring back" on each row in place of the star', () => {
    const words = [makeWord('siete', { rank: 1, isHidden: true, repetitions: 2, nextReview: new Date(Date.now() + day) }), makeWord('uno', { rank: 2 })]
    const html = render(words, view({ segment: 'hidden' }))
    expect(html).toContain('Bring back</button>')
    expect(html).toContain('aria-label="Bring back siete"')
    expect(html).not.toContain('word-row-star')
    expect(html.match(/class="word-row"/g)).toHaveLength(1)
  })

  it('an empty list says what goes there', () => {
    expect(render([makeWord('uno')], view({ segment: 'hidden' }))).toContain('Nothing hidden. Words you mark as known appear here.')
    expect(render([makeWord('uno')], view({ segment: 'learned' }))).toContain('Nothing learned yet.')
    expect(render([makeWord('uno')], view({ query: 'zzz' }))).toContain('No words match.')
  })

  it('a filter narrows the list', () => {
    const html = render(real, view({ filters: { ...NO_FILTERS, pos: 'verb' } }))
    expect(html).toMatch(/<span class="word-row-pos">verb<\/span>/)
    expect(html).not.toContain('<span class="word-row-pos">noun</span>')
  })

  it('a search overrides the segment (no segment is lit) and a row leads with the form that matched, with no "Rioplatense" marker', () => {
    const html = render(real, view({ segment: 'learned', query: 'pucho' }))
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
    const saved = view({ segment: 'learned', sort: 'due', query: 'ca', filters: { ...NO_FILTERS, favourites: true, state: 'due' } })
    const html = render(learnedSome(), saved)
    expect(html).toContain('value="ca"')
    expect(html).toContain('aria-label="2 filters on"')
    expect(html).toContain('Sort: Best match') // a query is on, so the sort name steps aside
    expect(render(learnedSome(), view({ sort: 'due' }))).toContain('Sort: Due soonest')
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

  it('Progress: Any · Not started · In progress · Known well · Due now; Show only: Favourites · Queued · Custom; Part of speech: Verbs · Nouns · Adjectives · Adverbs', () => {
    const html = sheet()
    const group = (id: string) => [...html.match(new RegExp(`aria-labelledby="${id}">.*?</section>`))![0].matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1])
    expect(group('sheet-progress')).toEqual(['Any', 'Not started', 'In progress', 'Known well', 'Due now'])
    expect(group('sheet-show-only')).toEqual(['Favourites', 'Queued', 'Custom'])
    expect(group('sheet-pos')).toEqual(['Verbs', 'Nouns', 'Adjectives', 'Adverbs'])
  })

  it('marks what is on: Any when no progress filter is set, the chosen option otherwise', () => {
    expect(sheet()).toMatch(/class="chip is-active" aria-pressed="true">Any/)
    const on = sheet({ filters: { state: 'due', favourites: true, queued: false, custom: false, pos: 'adj' } })
    expect(on).toMatch(/class="chip is-active" aria-pressed="true">Due now/)
    expect(on).toMatch(/class="chip" aria-pressed="false">Any/)
    expect(on).toMatch(/class="chip is-active" aria-pressed="true">Favourites/)
    expect(on).toMatch(/class="chip is-active" aria-pressed="true">Adjectives/)
  })

  it('"Clear all" is off when nothing is on', () => {
    expect(sheet()).toMatch(/class="link-btn" disabled="">Clear all/)
    expect(sheet({ filters: { ...NO_FILTERS, favourites: true } })).toMatch(/class="link-btn">Clear all/)
  })

  it('in the Hidden list the Progress group is left out, and it is back while searching', () => {
    expect(sheet({ segment: 'hidden' })).not.toContain('Progress')
    expect(sheet({ segment: 'hidden' })).not.toContain('Not started')
    expect(sheet({ segment: 'hidden' })).toContain('Part of speech')
    expect(sheet({ segment: 'hidden', searching: true })).toContain('>Progress<')
  })
})

describe('the sort sheet', () => {
  const sheet = (sort: 'frequency' | 'az' | 'due' | 'recent' | 'random' = 'frequency') => renderToStaticMarkup(createElement(SortSheet, { sort, onSelect: noop, onClose: noop }))

  it('offers Frequency · A to Z · Due soonest · Recently learned · Random, Random last', () => {
    const html = sheet()
    expect([...html.matchAll(/role="radio"[^>]*><span>([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(['Frequency', 'A to Z', 'Due soonest', 'Recently learned', 'Random'])
    expect(html).toContain('aria-label="Sort by"')
  })

  it('checks the current one', () => {
    expect(sheet('frequency')).toMatch(/class="sheet-row is-active" role="radio" aria-checked="true"><span>Frequency/)
    expect(sheet('recent')).toMatch(/aria-checked="true"><span>Recently learned/)
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
    expect(html).toContain('Add to favourites')
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
      expect(inside).toContain('<dt>State</dt><dd>Known well</dd>')
      expect(inside).toContain('<dt>Repetitions</dt><dd>3</dd>')
      expect(inside).toContain('<dt>Interval</dt><dd>12d</dd>')
      expect(inside).toContain('<dt>Ease factor</dt><dd>2.36</dd>')
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
    expect(html).toContain('<dt>State</dt><dd>Due now</dd>')
    expect(html).toContain('· due now')
  })

  it('a word rated Again reads as in progress, with the lowered ease, and nothing claims it went back to Learn', () => {
    const html = detail({ ...base, repetitions: 1, interval: 0, easeFactor: 2.18, nextReview: new Date(NOWISH + 10 * 60 * 1000) })
    expect(html).toContain('<dt>State</dt><dd>In progress</dd>')
    expect(html).toContain('2.18')
    expect(html).not.toContain('Not started')
    expect(html).not.toContain('Learn pool')
    expect(html).not.toContain('set it back to new')
  })

  it('once its ten minutes are up it is due', () => {
    const html = detail({ ...base, repetitions: 1, interval: 0, easeFactor: 2.18, nextReview: new Date(NOWISH - 1000) })
    expect(html).toContain('<dt>State</dt><dd>Due now</dd>')
  })

  it('a word an earlier version sent back to new still reads as not started, and says nothing about Learn', () => {
    const html = detail({ ...base, repetitions: 0, interval: 0, easeFactor: 2.18, nextReview: new Date(NOWISH - day) })
    expect(html).toContain('<dd>Not started</dd>')
    expect(html).not.toContain('Learn pool')
    expect(html).not.toContain('Again')
  })

  it('a hidden word explains that its progress is kept, and offers "Bring back"; a favourite offers to remove the star', () => {
    const html = detail({ ...base, isHidden: true, isFavorite: true, repetitions: 2, nextReview: new Date(NOWISH + day) })
    expect(html).toContain('<dd>Hidden</dd>')
    expect(html).toContain('Its progress is kept')
    expect(html).toContain('aria-label="Bring back casa"')
    expect(html).toContain('Remove from favourites')
    expect(html).toContain('aria-pressed="true"')
  })

  it('a reference-only word says why it is never in Learn or Review', () => {
    expect(detail(makeWord('de', { pos: 'prep', rank: 1 }))).toContain('Reference only: this kind of word is not drilled, so it is never in Learn or Review.')
    expect(detail(makeWord('casa', { enTranslation: 'house', ruTranslation: '' }))).toContain('it has no translation yet')
  })
})
