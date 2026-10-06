import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { parseDictionary } from '../data/dictionary'
import { highlightTarget } from '../data/headword'
import { parseFallbackExamples, parseRioOverlay } from '../data/rio'
import { hashString, pickWordOfTheDay, wordOfTheDayPool } from '../data/wordOfDay'
import { createWriteQueue } from '../data/writeQueue'
import { parseSettings } from '../data/settings'
import type { Word } from '../data/types'
import { makeWord } from '../testing/makeWord'
import { HomeScreen } from './Home'

const NOW = new Date(2026, 9, 5, 12, 0) // local noon, 5 October 2026
const TODAY = '2026-10-05'
const past = new Date('2026-10-01T03:00:00.000Z')
const future = new Date(NOW.getTime() + 5 * 86_400_000)

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

const real = parseDictionary(
  JSON.parse(readFileSync('public/words_enriched.json', 'utf8')),
  parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))),
  parseFallbackExamples(JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))),
)

const dataFor = (words: readonly Word[], raw: Record<string, unknown> = {}, degraded: string[] = []) =>
  ({ status: 'ready', data: { words, settings: parseSettings(raw), getSettings: () => parseSettings(raw), degraded, retryDegraded: () => {} } }) as never

const render = (over: Record<string, unknown> = {}, words: readonly Word[] = [...learnedWords(8, 3), ...unlearned(20)], raw: Record<string, unknown> = {}, degraded: string[] = []) =>
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
      now: NOW,
      ...over,
    } as never),
  )

const tile = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-tile="${id}"[^>]*>.*?</button>`))![0]
const part = (html: string, id: string, cls: string) => tile(html, id).match(new RegExp(`${cls}">(.*?)</span>`))?.[1]

describe('Home structure', () => {
  it('header, status row, word of the day, the action grid, then the Debug link', () => {
    const html = render({ onDebug: () => {}, onOpenWord: () => {}, activity: new Set<string>() }, real)
    const order = ['screen-header', 'home-status', 'class="wotd"', 'class="home-grid"', 'debug-link'].map((c) => html.indexOf(c))
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('the app name is the brand title, in the display face', () => {
    expect(render()).toContain('<h1 class="brand home-title">Riopalabras</h1>')
  })

  it('the Debug link is last on the page and only rendered when allowed', () => {
    const html = render({ onDebug: () => {} })
    expect(html).toContain('class="debug-link"')
    expect(html.indexOf('debug-link')).toBeGreaterThan(html.indexOf('home-grid'))
    expect(render()).not.toContain('debug-link')
  })

  it('while the data is loading there is a status card and no tiles', () => {
    const html = renderToStaticMarkup(
      createElement(HomeScreen, { auth: { status: 'loading' }, data: { status: 'loading' }, onLearn: () => {}, onReview: () => {}, onMatching: () => {}, onCloze: () => {}, queue: null, metrics: null }),
    )
    expect(html).not.toContain('class="tile')
    expect(html).toContain('Loading your words…')
  })
})

describe('the status row', () => {
  it('shows the streak and today\'s new words against the daily limit', () => {
    const html = render({}, undefined, { streak_count: 4, streak_last_activity_date: TODAY, new_words_learned_today_count: 3, new_words_learned_today_date: TODAY, daily_new_word_limit: 12 })
    expect(html).toMatch(/<span>4-day streak<\/span>/)
    expect(html).toContain('<span>Today 3 / 12</span>')
  })

  it('counts nothing learned today when the stored counter is from another day, and a lapsed streak as 0', () => {
    const html = render({}, undefined, { streak_count: 4, streak_last_activity_date: '2026-09-20', new_words_learned_today_count: 9, new_words_learned_today_date: '2026-10-04' })
    expect(html).toContain('<span>0-day streak</span>')
    expect(html).toContain('<span>Today 0 / 10</span>')
  })

  it('seven dots for the last seven days, active ones teal, from the server read', () => {
    const activity = new Set(['2026-10-05', '2026-10-03', '2026-09-30'])
    const html = render({ activity })
    expect(html.match(/class="streak-dot[ "]/g)).toHaveLength(7)
    expect(html.match(/streak-dot is-active/g)).toHaveLength(3)
    expect(html).toContain('aria-label="Active on 3 of the last 7 days"')
    // today is the last dot
    expect(html.lastIndexOf('streak-dot is-active')).toBeGreaterThan(html.lastIndexOf('class="streak-dot"') - 1)
    // days outside the week are ignored
    expect(render({ activity: new Set(['2026-09-01']) }).match(/streak-dot is-active/g)).toBeNull()
  })

  it("today's dot is lit by this device's own row even before the server has it", () => {
    const html = render({ activity: new Set<string>(), metrics: { captureStartOfDaySnapshotIfNeeded: () => {}, today: () => ({ active: true }) } })
    expect(html.match(/streak-dot is-active/g)).toHaveLength(1)
    const idle = render({ activity: new Set<string>(), metrics: { captureStartOfDaySnapshotIfNeeded: () => {}, today: () => null } })
    expect(idle.match(/streak-dot is-active/g)).toBeNull()
  })

  it('without the server read (failed, or not yet back) there are no dots, and nothing else changes', () => {
    const html = render({ activity: null })
    expect(html).not.toContain('streak-dot')
    expect(html).not.toContain('streak-dots')
    expect(html).toContain('-day streak')
    expect(html).toContain('Today ')
    expect(html.match(/class="tile /g)).toHaveLength(4)
  })
})

describe('the action tiles', () => {
  it('Learn, Review / Matching, Cloze, each with its label, its Spanish word and the right class', () => {
    const html = render()
    expect([...html.matchAll(/data-tile="(\w+)"/g)].map((m) => m[1])).toEqual(['learn', 'review', 'matching', 'cloze'])
    expect([part(html, 'learn', 'tile-label'), part(html, 'review', 'tile-label'), part(html, 'matching', 'tile-label'), part(html, 'cloze', 'tile-label')]).toEqual(['Learn', 'Review', 'Matching', 'Cloze'])
    expect([part(html, 'learn', 'tile-sub'), part(html, 'review', 'tile-sub'), part(html, 'matching', 'tile-sub'), part(html, 'cloze', 'tile-sub')]).toEqual(['aprender', 'repasar', 'parejas', 'completar'])
    for (const id of ['learn', 'review', 'matching', 'cloze']) expect(tile(html, id)).toContain(`class="tile tile-${id}"`)
    for (const id of ['learn', 'review', 'matching', 'cloze']) expect(tile(html, id)).toMatch(/<svg class="tile-icon"[^>]*aria-hidden="true"/)
  })

  it('Learn and Review show their counts; the practice tiles never do', () => {
    const html = render()
    expect(part(html, 'learn', 'tile-count')).toBe('10') // the daily limit, with a bigger pool behind it
    expect(part(html, 'review', 'tile-count')).toBe('3')
    expect(tile(html, 'matching')).not.toContain('tile-count')
    expect(tile(html, 'cloze')).not.toContain('tile-count')
    const more = render({}, [...learnedWords(8, 8), ...unlearned(4)])
    expect(part(more, 'learn', 'tile-count')).toBe('4')
    expect(part(more, 'review', 'tile-count')).toBe('8')
  })

  describe('disabled tiles say why, in place of the Spanish word, with no count', () => {
    it('Daily limit reached', () => {
      const html = render({}, [...learnedWords(8, 3), ...unlearned(20)], { daily_new_word_limit: 5, new_words_learned_today_count: 5, new_words_learned_today_date: TODAY })
      expect(tile(html, 'learn')).toContain('disabled=""')
      expect(part(html, 'learn', 'tile-sub')).toBe('Daily limit reached')
      expect(tile(html, 'learn')).not.toContain('tile-count')
      expect(tile(html, 'learn')).not.toContain('aprender')
    })

    it('No new words available', () => {
      const html = render({}, learnedWords(8, 3))
      expect(part(html, 'learn', 'tile-sub')).toBe('No new words available')
      expect(tile(html, 'learn')).toContain('disabled=""')
    })

    it('Nothing to review', () => {
      const html = render({}, [...learnedWords(8, 0), ...unlearned(5)])
      expect(part(html, 'review', 'tile-sub')).toBe('Nothing to review')
      expect(tile(html, 'review')).toContain('disabled=""')
      expect(tile(html, 'review')).not.toContain('tile-count')
    })

    it('Need 5+ words, on each practice tile', () => {
      const html = render({}, [...learnedWords(4, 4), ...unlearned(5)])
      for (const id of ['matching', 'cloze']) {
        expect(part(html, id, 'tile-sub')).toBe('Need 5+ words')
        expect(tile(html, id)).toContain('disabled=""')
        expect(tile(html, id)).not.toContain('parejas')
        expect(tile(html, id)).not.toContain('completar')
      }
    })

    it('Matching and Cloze count their words independently', () => {
      const sameGloss = learnedWords(6).map((w) => ({ ...w, ruTranslation: 'одно и то же' }))
      const a = render({}, sameGloss)
      expect(tile(a, 'matching')).toContain('disabled=""') // six words, one gloss: no group
      expect(tile(a, 'cloze')).not.toContain('disabled')
      const noBlank = learnedWords(6).map((w) => ({ ...w, exampleSentence: 'Una frase sin la palabra buscada.' }))
      const b = render({}, noBlank)
      expect(tile(b, 'matching')).not.toContain('disabled')
      expect(tile(b, 'cloze')).toContain('disabled=""')
    })

    it('enabled tiles are not disabled', () => {
      const html = render()
      for (const id of ['learn', 'review', 'matching', 'cloze']) expect(tile(html, id), id).not.toContain('disabled')
    })
  })
})

describe('notices', () => {
  const stuckQueue = async () => {
    const queue = createWriteQueue({ sendProgress: async () => { throw new Error('down') }, sendSettings: async () => {} }, { retryDelaysMs: [], sleep: () => Promise.resolve() })
    queue.enqueueProgress({ esWord: 'a', easeFactor: 2.5, interval: 0, repetitions: 1, nextReview: past })
    await new Promise((r) => setTimeout(r, 5))
    return queue
  }

  it('the hidden-words notice sits between the status row and the word card, and nothing is lost', () => {
    const html = render({}, real, {}, ['user_hidden_words'])
    expect(html).toContain('class="notice"')
    expect(html).toContain('hidden words')
    const [status, notice, card, grid] = ['home-status', 'class="notice"', 'class="wotd"', 'class="home-grid"'].map((c) => html.indexOf(c))
    expect(status).toBeLessThan(notice)
    expect(notice).toBeLessThan(card)
    expect(card).toBeLessThan(grid)
    expect(html.match(/class="tile /g)).toHaveLength(4)
  })

  it('the unsaved-progress notice appears once the queue is stuck, in the same place, with its Retry button', async () => {
    const html = render({ queue: await stuckQueue() }, real)
    expect(html).toContain("Some progress hasn&#x27;t been saved yet. Retrying…")
    expect(html).toContain('Retry now')
    expect(html.indexOf('class="notice"')).toBeGreaterThan(html.indexOf('home-status'))
    expect(html.indexOf('class="notice"')).toBeLessThan(html.indexOf('class="wotd"'))
  })

  it('both notices together keep the word card and all four tiles', async () => {
    const html = render({ queue: await stuckQueue() }, real, {}, ['user_favorites', 'user_hidden_words'])
    expect(html.match(/class="notice"/g)).toHaveLength(2)
    expect(html).toContain('class="wotd"')
    expect(html.match(/class="tile /g)).toHaveLength(4)
  })

  it('no notices, no notice markup', () => {
    expect(render()).not.toContain('class="notice"')
  })
})

describe('the theme toggle', () => {
  it('sits in the header; the icon shows the scheme on screen, the label the choice and what a tap does', () => {
    const html = render({ theme: { choice: 'system', scheme: 'dark', onCycle: () => {} } })
    expect(html).toMatch(/<header class="screen-header"><h1[^>]*>Riopalabras<\/h1><div class="screen-header-actions"><button[^>]*class="icon-btn"/)
    expect(html).toContain('aria-label="Theme: System. Tap to switch to Light."')
    expect(html).toContain('data-scheme="dark"')
    expect(render({ theme: { choice: 'light', scheme: 'light', onCycle: () => {} } })).toContain('Theme: Light. Tap to switch to Dark.')
    expect(render({ theme: { choice: 'dark', scheme: 'dark', onCycle: () => {} } })).toContain('Theme: Dark. Tap to switch to System.')
  })

  it('draws a moon in the dark scheme and a sun in the light one', () => {
    const moon = render({ theme: { choice: 'dark', scheme: 'dark', onCycle: () => {} } }).match(/<button[^>]*icon-btn.*?<\/button>/)![0]
    const sun = render({ theme: { choice: 'light', scheme: 'light', onCycle: () => {} } }).match(/<button[^>]*icon-btn.*?<\/button>/)![0]
    expect(moon).toContain('M20 14.5A8')
    expect(moon).not.toContain('<circle')
    expect(sun).toContain('<circle')
  })

  it('without a theme prop there is no toggle', () => {
    expect(render()).not.toContain('icon-btn')
  })
})

describe('the word of the day card', () => {
  const card = (html: string) => html.match(/<section class="wotd".*?<\/section>/)?.[0] ?? ''
  const headwordOf = (html: string) => card(html).match(/class="wotd-word">(.*?)</)?.[1]

  it('has the headword, the pill, the sentence with the target highlighted, a divider, the translation and a link to the card', () => {
    const html = card(render({ onOpenWord: () => {} }, real))
    expect(html).toMatch(/<h2 class="wotd-word">[^<]+<\/h2><span class="pill">palabra del día<\/span>/)
    expect(html).toMatch(/<p class="wotd-sentence">[^<]*<mark>[^<]+<\/mark>/)
    expect(html).toContain('<hr class="wotd-divider"/>')
    expect(html).toMatch(/<p class="wotd-translation">[^<]+<\/p>/)
    expect(html).toContain('See the card →')
  })

  it('the highlighted text is a word of the sentence', () => {
    const html = card(render({}, real))
    const sentence = html.match(/<p class="wotd-sentence">(.*?)<\/p>/)![1].replace(/<\/?mark>/g, '')
    const marked = html.match(/<mark>(.*?)<\/mark>/)![1]
    expect(sentence.toLowerCase()).toContain(marked.toLowerCase())
  })

  it('the same date gives the same word however often (and however it is rendered)', () => {
    const first = headwordOf(render({}, real))
    expect(first).toBeTruthy()
    expect(headwordOf(render({}, real))).toBe(first)
    expect(headwordOf(render({ now: new Date(2026, 9, 5, 0, 1) }, real))).toBe(first) // early morning, same local date
    expect(headwordOf(render({ now: new Date(2026, 9, 5, 23, 59) }, real))).toBe(first) // late night, same local date
  })

  it('a different date gives (over a month) different words', () => {
    const picks = new Set(Array.from({ length: 30 }, (_, i) => headwordOf(render({ now: new Date(2026, 9, 1 + i, 12) }, real))))
    expect(picks.size).toBeGreaterThan(5)
  })

  it('does not depend on the user\'s progress, the order of the words, or what else is in the dictionary', () => {
    const base = pickWordOfTheDay(real, NOW)?.esWord
    expect(base).toBeTruthy()
    const learnedEverything = real.map((w) => ({ ...w, repetitions: 3, nextReview: past }))
    expect(pickWordOfTheDay(learnedEverything, NOW)?.esWord).toBe(base)
    expect(pickWordOfTheDay(real.map((w) => ({ ...w, repetitions: 0, nextReview: null })), NOW)?.esWord).toBe(base)
    expect(pickWordOfTheDay([...real].reverse(), NOW)?.esWord).toBe(base)
    expect(pickWordOfTheDay(real.filter((w) => w.rio?.example), NOW)?.esWord).toBe(base)
    expect(headwordOf(render({}, real))).toBeTruthy()
  })

  it('the pick comes only from overlay words with an example whose target can be highlighted', () => {
    const pool = wordOfTheDayPool(real)
    expect(pool.length).toBeGreaterThan(10)
    for (const w of pool) {
      expect(w.rio?.example).toBeTruthy()
      expect(highlightTarget(w).range).not.toBeNull()
    }
    expect(pool.map((w) => w.esWord.toLowerCase())).toEqual([...pool.map((w) => w.esWord.toLowerCase())].sort())
  })

  it('the hash is stable (a known date gives a known number, so every device agrees)', () => {
    expect(hashString('2026-10-05')).toBe(hashString('2026-10-05'))
    expect(hashString('2026-10-05')).not.toBe(hashString('2026-10-06'))
    expect(hashString('')).toBe(0x811c9dc5)
  })

  it('shows the translation per the translation settings', () => {
    const ru = card(render({}, real)).match(/wotd-translation">(.*?)</)![1]
    expect(ru).toMatch(/[А-Яа-яЁё]/)
    const en = card(render({}, real, { show_ru_translation: false, show_en_translation: true })).match(/wotd-translation">(.*?)</)![1]
    expect(en).not.toMatch(/[А-Яа-яЁё]/)
  })

  it('"See the card" is only offered when it can open something', () => {
    expect(card(render({}, real))).not.toContain('link-btn')
  })

  it('without an overlay word that has an example the card is simply not there, and the tiles still sit at the bottom', () => {
    const html = render({}, [...learnedWords(8, 3), ...unlearned(20)])
    expect(html).not.toContain('class="wotd"')
    expect(html).toContain('class="home-spacer"')
    expect(html.match(/class="tile /g)).toHaveLength(4)
  })

  it('is read-only: it has no write path (no queue, no progress)', () => {
    const enqueue = vi.fn()
    render({ queue: { getStatus: () => ({ stuck: false }), subscribe: () => () => {}, enqueueProgress: enqueue, enqueueSettings: enqueue, enqueueBatch: enqueue } }, real)
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('Home layout rules in the stylesheet', () => {
  const css = readFileSync('src/index.css', 'utf8')
  const block = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`)
    if (start === -1) throw new Error(`no ${selector} rule`)
    return css.slice(css.indexOf('{', start), css.indexOf('}', start))
  }

  it('the page is a column with 16px between blocks and 20px side padding, filling the viewport', () => {
    expect(block('.home')).toMatch(/display: flex/)
    expect(block('.home')).toMatch(/flex-direction: column/)
    expect(block('.home')).toMatch(/gap: var\(--block-gap\)/)
    expect(block('.home')).toMatch(/min-height: 100dvh/)
    expect(block('.screen')).toMatch(/padding: 18px var\(--page-pad\) 40px/)
  })

  it('the word card absorbs all leftover height', () => {
    expect(block('.wotd')).toMatch(/flex: 1 1 auto/)
    expect(block('.wotd')).toMatch(/border-radius: var\(--radius-card\)/)
    expect(block('.wotd')).toMatch(/padding: 22px 20px/)
    expect(block('.wotd')).toMatch(/gap: 14px/)
  })

  it('the tiles are 96px tall in a two-column grid with 14px gaps, and labels wrap instead of overflowing', () => {
    expect(block('.home-grid')).toMatch(/grid-template-columns: 1fr 1fr/)
    expect(block('.home-grid')).toMatch(/gap: 14px/)
    expect(block('.tile')).toMatch(/height: 96px/)
    expect(block('.tile')).toMatch(/border-radius: var\(--radius-tile\)/)
    expect(block('.tile')).toMatch(/min-width: 0/)
    expect(block('.tile-label')).toMatch(/overflow-wrap: anywhere/)
    expect(block('.tile-text')).toMatch(/min-width: 0/)
  })

  it('the tile colours follow the design: Learn teal, Review soft teal, practice lavender, disabled neutral and muted', () => {
    expect(block('.tile-learn')).toMatch(/background: var\(--teal\)/)
    expect(block('.tile-learn')).toMatch(/color: var\(--teal-ink\)/)
    expect(block('.tile-review')).toMatch(/background: var\(--teal-soft\)/)
    expect(block('.tile-review')).toMatch(/border-color: var\(--teal-soft-border\)/)
    expect(css).toMatch(/\.tile-matching,\s*\.tile-cloze \{[^}]*background: var\(--lav-soft\)[^}]*color: var\(--lav-on-soft\)/)
    const d = block('.tile:disabled')
    expect(d).toMatch(/background: var\(--surface-2\)/)
    expect(d).toMatch(/color: var\(--muted\)/)
  })

  it('the Spanish word under a tile label is Fraunces italic; a disabled tile\'s reason is plain UI type', () => {
    expect(block('.tile-sub')).toMatch(/font-family: var\(--font-display\)/)
    expect(block('.tile-sub')).toMatch(/font-style: italic/)
    expect(block('.tile:disabled .tile-sub')).toMatch(/font-family: var\(--font-ui\)/)
  })

  it('amber is the highlight and nothing else on Home: only the word card uses --hl-*', () => {
    const uses = [...css.matchAll(/--hl-(?:bg|text)/g)].length
    expect(uses).toBeGreaterThan(0)
    expect(block('mark')).toMatch(/background: var\(--hl-bg\)/)
    for (const selector of ['.tile', '.tile-learn', '.tile-review', '.home-status']) expect(block(selector)).not.toMatch(/--hl-/)
  })
})
