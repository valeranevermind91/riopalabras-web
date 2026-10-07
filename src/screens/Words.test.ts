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
import { WordDetail } from './WordDetail'
import { WordsScreen } from './Words'

const real = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')), parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))))
const day = 86_400_000
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
const view = (over: Partial<ListView> = {}): ListView => ({ segment: 'all', filters: NO_FILTERS, query: '', scrollTop: 0, ...over })

describe('the Words screen', () => {
  it('has the header, a search field, the three segments with their counts, the chips and the list', () => {
    const html = render(learnedSome())
    expect(html).toContain('<h1>Words</h1>')
    expect(html).toMatch(/<input type="search" class="words-search"[^>]*placeholder="Search Spanish, English or Russian"/)
    for (const label of ['Learned', 'All', 'Hidden']) expect(html).toContain(`>${label} <span class="segment-count">`)
    expect(html).toContain('<span class="segment-count">5</span>') // Learned: five words with progress
    expect(html).toContain('<span class="segment-count">4753</span>')
    for (const chip of ['New', 'Learning', 'Established', 'Due', 'Favourites', 'Verbs', 'Nouns', 'Adjectives', 'Adverbs']) expect(html).toContain(`>${chip}</button>`)
    expect(html).toContain('role="list"')
  })

  it('opens on the learned words when there are some, else on all words with a note saying so', () => {
    const learned = render(learnedSome())
    expect(learned).toMatch(/class="segment is-active" aria-pressed="true">Learned/)
    expect(learned.match(/class="word-row"/g)).toHaveLength(5)

    const fresh = render(real)
    expect(fresh).toMatch(/class="segment is-active" aria-pressed="true">All/)
    expect(fresh).toContain('Nothing learned yet')
  })

  it('renders only a screenful of 4,753 words: a window, not the list', () => {
    const html = render(real, view())
    const rows = html.match(/class="word-row"/g) ?? []
    expect(rows.length).toBeGreaterThan(5)
    expect(rows.length).toBeLessThan(40)
    expect(html).toContain(`style="height:${4753 * 72}px"`) // but the scroll height is the whole list
  })

  it('a row: the headword in the display face, a part-of-speech tag, a state dot, one translation in the user\'s language, a star', () => {
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
    const html = render(learnedSome(), view({ segment: 'learned' }), parseSettings({ show_ru_translation: false }))
    expect(html).toContain(ordinary[0].enTranslation)
    expect(html).not.toContain(`>${ordinary[0].ruTranslation}</span>`)
  })

  it('a due word has a Due badge, and a favourite star is filled and pressed', () => {
    const words = learnedSome().map((w) => (w.esWord === ordinary[2].esWord ? ({ ...w, isFavorite: true } as Word) : w))
    const html = render(words, view({ segment: 'learned' }))
    expect(html).toContain('<span class="word-row-due">Due</span>')
    expect(html).toMatch(/word-row-star is-on" aria-pressed="true" aria-label="Remove [^"]+ from favourites"/)
  })

  it('the Hidden list has "Bring back" on each row in place of the star, and no state chips', () => {
    const words = [makeWord('siete', { rank: 1, isHidden: true, repetitions: 2, nextReview: new Date(Date.now() + day) }), makeWord('uno', { rank: 2 })]
    const html = render(words, view({ segment: 'hidden' }))
    expect(html).toContain('Bring back</button>')
    expect(html).toContain('aria-label="Bring back siete"')
    expect(html).not.toContain('word-row-star')
    for (const chip of ['>New</button>', '>Learning</button>', '>Established</button>', '>Due</button>']) expect(html).not.toContain(chip)
    expect(html).toContain('>Favourites</button>')
    expect(html.match(/class="word-row"/g)).toHaveLength(1)
  })

  it('an empty Hidden list says what goes there', () => {
    expect(render([makeWord('uno')], view({ segment: 'hidden' }))).toContain('Nothing hidden. Words you mark as known appear here.')
  })

  it('active chips are marked (lavender), inactive ones are not, and the filters narrow the list', () => {
    const html = render(real, view({ filters: { ...NO_FILTERS, pos: 'verb', favourites: false } }))
    expect(html).toContain('class="chip is-active" aria-pressed="true">Verbs')
    expect(html).toContain('class="chip" aria-pressed="false">Nouns')
    expect(html).toMatch(/<span class="word-row-pos">verb<\/span>/)
    expect(html).not.toContain('<span class="word-row-pos">noun</span>')
  })

  it('a search overrides the segment (no segment is lit) and marks a Rioplatense match', () => {
    const html = render(real, view({ segment: 'learned', query: 'aca' }))
    expect(html).not.toContain('segment is-active')
    expect(html).toMatch(/\d+ words/) // the count line
    expect(html).toContain('<span class="pill" title="acá">Rioplatense</span>')
  })

  it('comes back as it was left: the saved query, segment, filters and scroll position are used, not the defaults', () => {
    const saved = view({ segment: 'learned', query: 'ca', filters: { ...NO_FILTERS, favourites: true, state: 'due' }, scrollTop: 0 })
    const html = render(learnedSome(), saved)
    expect(html).toContain('value="ca"')
    expect(html).toContain('class="chip is-active" aria-pressed="true">Favourites')
    expect(html).toContain('class="chip is-active" aria-pressed="true">Due')
  })

  it('no hex colours or Telegram theme variables in the new styles (tokens only), and the headword is the only display-face text', () => {
    const css = readFileSync('src/index.css', 'utf8')
    const words = css.slice(css.indexOf('/* ---- Words:'))
    expect(words).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(words).not.toMatch(/rgba?\(/)
    expect(words).not.toContain('--tg-')
    expect([...words.matchAll(/([^{}]+)\{[^}]*font-family: var\(--font-display\)[^}]*\}/g)].map((m) => m[1].trim())).toEqual(['.word-row-head'])
    expect(words).toMatch(/\.word-row-head \{[^}]*font-size: 18px/)
    expect(words).toMatch(/\.words-search \{[^}]*border: 1px solid var\(--border\)[^}]*border-radius: var\(--radius-button\)/s)
    expect(words).toMatch(/\.words-search \{[^}]*background: var\(--surface\)/s)
    expect(words).toMatch(/\.chip \{[^}]*background: var\(--surface-2\)/s)
    expect(words).toMatch(/\.chip\.is-active \{[^}]*background: var\(--lav-soft\)/s)
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
    for (const label of ['State', 'Repetitions', 'Interval', 'Next review']) expect(html).toContain(`<dt>${label}</dt>`)
    expect(html).toContain('<dd>New</dd>')
    expect(html).toContain('Not scheduled')
    expect(html).toContain('Add to favourites')
    expect(html).not.toContain('Bring back')
  })

  it('shows repetitions, interval and the next review date for a learned word, and the ease factor behind a disclosure', () => {
    const html = detail({ ...base, repetitions: 3, interval: 12, easeFactor: 2.36, nextReview: new Date(NOWISH + 3 * day) })
    expect(html).toContain('<dd>Established</dd>')
    expect(html).toContain('<dt>Repetitions</dt><dd>3</dd>')
    expect(html).toContain('<dt>Interval</dt><dd>12d</dd>')
    expect(html).toMatch(/<details class="state-more"><summary>More<\/summary><dl><dt>Ease factor<\/dt><dd>2\.36<\/dd>/)
    expect(html.indexOf('<details')).toBeGreaterThan(html.indexOf('Next review'))
  })

  it('a due word says so next to its date', () => {
    const html = detail({ ...base, repetitions: 2, interval: 6, nextReview: new Date(NOWISH - day) })
    expect(html).toContain('<dd>Due</dd>')
    expect(html).toContain('· due now')
  })

  it('a lapsed word reads as new and shows its history, so it is not confusing', () => {
    const html = detail({ ...base, repetitions: 0, interval: 0, easeFactor: 2.18, nextReview: new Date(NOWISH - day) })
    expect(html).toContain('<dd>New</dd>')
    expect(html).toContain('You learned this word before. An “Again” rating set it back to new (ease 2.18')
    expect(html).toContain('so it is in the Learn pool again')
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
