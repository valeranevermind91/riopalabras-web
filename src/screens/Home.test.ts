import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { parseDictionary } from '../data/dictionary'
import { headword, highlightTarget } from '../data/headword'
import { lastDays } from '../data/metrics'
import { parseFallbackExamples, parseRioOverlay } from '../data/rio'
import { hashString, pickWordOfTheDay, wordOfTheDay, wordOfTheDayPool } from '../data/wordOfDay'
import { createWriteQueue } from '../data/writeQueue'
import { parseSettings } from '../data/settings'
import type { Word } from '../data/types'
import { setLanguage } from '../lib/language'
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
  it('header, status row, word of the day, then the action grid', () => {
    const html = render({ onOpenWord: () => {}, activity: new Set<string>() }, real)
    const order = ['screen-header', 'home-status', 'class="wotd"', 'class="home-grid"'].map((c) => html.indexOf(c))
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('the app name is the brand title, in the display face', () => {
    expect(render()).toContain('<h1 class="brand home-title">Riopalabras</h1>')
  })

  it('has no Debug link, for anyone: Settings is the only way to Debug', () => {
    expect(render()).not.toContain('debug-link')
    expect(render({ onSettings: () => {}, onWords: () => {} })).not.toMatch(/>Debug</)
    expect(readFileSync('src/screens/Home.tsx', 'utf8')).not.toMatch(/onDebug|debugLink/)
  })

  it('while the data is loading there is a status card and no tiles', () => {
    const html = renderToStaticMarkup(
      createElement(HomeScreen, { auth: { status: 'loading' }, data: { status: 'loading' }, onLearn: () => {}, onReview: () => {}, onMatching: () => {}, onCloze: () => {}, queue: null, metrics: null }),
    )
    expect(html).not.toContain('class="tile')
    expect(html).toContain('Loading your words…')
  })
})

describe('the status row: the week of dots, and the stored streak', () => {
  const dotsOf = (html: string) => [...html.matchAll(/<span class="streak-day[^"]*" data-date="([\d-]+)"><span class="(streak-dot[^"]*)"><\/span><span class="streak-letter">(\w)<\/span><\/span>/g)].map((m) => ({ date: m[1], cls: m[2], letter: m[3] }))
  const YESTERDAY = '2026-10-04'
  const streakOf = (html: string) => html.match(/<span>(\d+)-day streak<\/span>/)?.[1] ?? null
  const withStreak = (count: number, last: string | null, over: Record<string, unknown> = {}) =>
    render({ activity: new Set<string>(), ...over }, undefined, { streak_count: count, ...(last ? { streak_last_activity_date: last } : {}) })

  it('seven dots, six days ago on the left and today on the right, each with a one-letter weekday label (week starts Monday)', () => {
    const dots = dotsOf(render({ activity: new Set<string>() }))
    expect(dots.map((d) => d.date)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'])
    // 5 October 2026 is a Monday: the week reads Tue Wed Thu Fri Sat Sun Mon
    expect(dots.map((d) => d.letter).join('')).toBe('TWTFSSM')
  })

  it('active days are filled, the rest are not, and today is ringed even when inactive', () => {
    const dots = dotsOf(render({ activity: new Set(['2026-10-04', '2026-10-02', '2026-10-01']) }))
    expect(dots.filter((d) => d.cls.includes('is-active')).map((d) => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-04'])
    expect(dots.filter((d) => d.cls.includes('is-today')).map((d) => d.date)).toEqual(['2026-10-05'])
    expect(dots[6].cls).toBe('streak-dot is-today') // today inactive: ringed, not filled
    const active = dotsOf(render({ activity: new Set(['2026-10-05']) }))[6]
    expect(active.cls).toBe('streak-dot is-active is-today') // today active: filled and ringed
  })

  it('days outside the week are ignored, and today\'s dot is lit by this device\'s own row before the server has it', () => {
    expect(dotsOf(render({ activity: new Set(['2026-09-01']) })).some((d) => d.cls.includes('is-active'))).toBe(false)
    const local = render({ activity: new Set<string>(), metrics: { captureStartOfDaySnapshotIfNeeded: () => {}, today: () => ({ active: true }) } })
    expect(dotsOf(local).filter((d) => d.cls.includes('is-active')).map((d) => d.date)).toEqual(['2026-10-05'])
  })

  describe('the number is the stored streak_count, when streak_last_activity_date is today or yesterday', () => {
    it('last activity today: the stored count', () => {
      expect(streakOf(withStreak(5, TODAY))).toBe('5')
      expect(streakOf(withStreak(1, TODAY))).toBe('1')
    })

    it('last activity yesterday: the stored count (today is still to come)', () => {
      expect(streakOf(withStreak(5, YESTERDAY))).toBe('5')
    })

    it('an older date, or no date at all: 0', () => {
      expect(streakOf(withStreak(5, '2026-10-03'))).toBe('0')
      expect(streakOf(withStreak(40, '2026-09-01'))).toBe('0')
      expect(streakOf(withStreak(5, null))).toBe('0')
      expect(streakOf(render({ activity: new Set<string>() }))).toBe('0') // nothing stored at all
    })

    it('a date in the future (another timezone): 0, as in the Flutter app', () => {
      expect(streakOf(withStreak(5, '2026-10-06'))).toBe('0')
    })

    it('a count above 30 is shown whole: no cap, and no "30+"', () => {
      for (const count of [31, 45, 365, 1200]) {
        const html = withStreak(count, TODAY)
        expect(streakOf(html)).toBe(String(count))
        expect(html).not.toContain('+ day streak')
      }
      expect(streakOf(withStreak(100, YESTERDAY))).toBe('100')
    })

    it('does not depend on the metrics: a full week of dots does not make a streak, and an empty week does not end one', () => {
      const days = lastDays(NOW, 7)
      expect(streakOf(withStreak(0, null, { activity: new Set(days) }))).toBe('0')
      expect(streakOf(render({ activity: new Set(['2026-10-05']) }))).toBe('0') // today in the dots, nothing stored
      expect(streakOf(withStreak(12, TODAY, { activity: new Set<string>() }))).toBe('12')
    })

    it('the dots and the number are read from different sources and may disagree: a gap under a number that keeps counting', () => {
      const html = withStreak(9, TODAY, { activity: new Set(['2026-10-05', '2026-10-04', '2026-10-02', '2026-10-01']) }) // 3 October has no metrics row
      expect(streakOf(html)).toBe('9')
      expect(dotsOf(html).map((d) => d.cls.includes('is-active'))).toEqual([false, false, true, true, false, true, true])
    })
  })

  it('the dots are driven by the metrics alone: the stored streak does not light or dim any of them', () => {
    const activity = new Set(['2026-10-05', '2026-10-03'])
    const lit = (html: string) => dotsOf(html).filter((d) => d.cls.includes('is-active')).map((d) => d.date)
    const without = lit(render({ activity }))
    expect(lit(render({ activity }, undefined, { streak_count: 40, streak_last_activity_date: TODAY }))).toEqual(without)
    expect(lit(render({ activity }, undefined, { streak_count: 0 }))).toEqual(without)
    expect(without).toEqual(['2026-10-03', '2026-10-05'])
  })

  it('without the dots\' data (still loading, or the read failed) there are no dots, and the stored number stays', () => {
    for (const activity of [null, undefined]) {
      const html = render({ activity }, undefined, { streak_count: 7, streak_last_activity_date: TODAY })
      expect(html).toContain('home-status')
      expect(html).not.toContain('streak-dots')
      expect(dotsOf(html)).toEqual([])
      expect(streakOf(html)).toBe('7')
    }
    expect(render({ activity: null }).match(/class="tile /g)).toHaveLength(4)
  })

  it('settings not loaded: no status row at all, so no zero where a streak should be', () => {
    for (const data of [{ status: 'loading' }, { status: 'error', message: 'x' }, { status: 'signed-out', dictionaryCount: 0 }]) {
      const html = render({ data, activity: new Set(['2026-10-05']) })
      expect(html).not.toContain('home-status')
      expect(html).not.toContain('streak')
      expect(html).not.toContain('-day streak')
    }
  })

  it('the "Today N / M" text is gone', () => {
    const html = render({ activity: new Set(['2026-10-05']) }, undefined, { new_words_learned_today_count: 3, new_words_learned_today_date: TODAY, daily_new_word_limit: 12 })
    expect(html).not.toContain('Today')
    expect(html).not.toContain('3 / 12')
    expect(readFileSync('src/strings.ts', 'utf8')).not.toMatch(/Today \$\{/)
  })

  it('the dots label for screen readers counts the active days', () => {
    expect(render({ activity: new Set(['2026-10-05', '2026-10-03']) })).toContain('aria-label="Active on 2 of the last 7 days"')
  })

  it('Home reads the stored streak and the week of dots only (no 30-day recomputation is left)', () => {
    const home = readFileSync('src/screens/Home.tsx', 'utf8')
    expect(home).toMatch(/streak=\{stats\.streak\}/)
    expect(home).not.toMatch(/STREAK_WINDOW|streakFromDots/)
    expect(readFileSync('src/lib/useRecentActivity.ts', 'utf8')).toMatch(/fetchRecentActivity\(client, userId, new Date\(\), DOT_COUNT\)/)
  })
})

describe('the action tiles', () => {
  it('Learn, Review / Matching, Cloze, each with its label, its Spanish word and the right class', () => {
    const html = render()
    expect([...html.matchAll(/data-tile="(\w+)"/g)].map((m) => m[1])).toEqual(['learn', 'review', 'matching', 'cloze'])
    expect([part(html, 'learn', 'tile-label'), part(html, 'review', 'tile-label'), part(html, 'matching', 'tile-label'), part(html, 'cloze', 'tile-label')]).toEqual(['Learn', 'Review', 'Matching', 'Cloze'])
    expect([part(html, 'learn', 'tile-sub'), part(html, 'review', 'tile-sub'), part(html, 'matching', 'tile-sub'), part(html, 'cloze', 'tile-sub')]).toEqual(['aprender', 'repasar', 'parejas', 'completar'])
    for (const id of ['learn', 'review', 'matching', 'cloze']) expect(tile(html, id)).toMatch(new RegExp(`class="tile tile-${id}( is-primary)?"`))
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

describe('the header: the app name, then Words and the gear', () => {
  it('Words is a small icon button, and the gear (Settings) is the last one on the right', () => {
    const html = render({ onWords: () => {}, onSettings: () => {} })
    const header = html.match(/<header class="screen-header">.*?<\/header>/)![0]
    expect(header.indexOf('Riopalabras')).toBeLessThan(header.indexOf('aria-label="Words"'))
    expect(header.indexOf('aria-label="Words"')).toBeLessThan(header.indexOf('aria-label="Settings"'))
    const actions = header.match(/<div class="screen-header-actions">.*<\/div>/)![0]
    expect(actions.match(/class="icon-btn"/g)).toHaveLength(2)
    expect(actions).toContain('title="Words"')
    expect(actions).toContain('title="Settings"')
  })

  it('the theme toggle is gone from the header (it lives in Settings now)', () => {
    const html = render({ onWords: () => {}, onSettings: () => {} })
    expect(html).not.toContain('data-theme-choice')
    expect(html).not.toContain('Tap to switch')
    expect(html.match(/class="icon-btn"/g)).toHaveLength(2)
  })

  it('each button is there only when it is given a way to open its screen', () => {
    expect(render({ onWords: () => {} })).toContain('aria-label="Words"')
    expect(render({ onWords: () => {} })).not.toContain('aria-label="Settings"')
    expect(render({ onSettings: () => {} })).not.toContain('aria-label="Words"')
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

  it('does not depend on what the user has learned, the order of the words, or what else is in the dictionary', () => {
    const base = pickWordOfTheDay(real, NOW)?.esWord
    expect(base).toBeTruthy()
    const learnedEverything = real.map((w) => ({ ...w, repetitions: 3, nextReview: past }))
    expect(pickWordOfTheDay(learnedEverything, NOW)?.esWord).toBe(base)
    expect(pickWordOfTheDay(real.map((w) => ({ ...w, repetitions: 0, nextReview: null })), NOW)?.esWord).toBe(base)
    expect(pickWordOfTheDay([...real].reverse(), NOW)?.esWord).toBe(base)
    expect(pickWordOfTheDay(real.filter((w) => w.rio), NOW)?.esWord).toBe(base)
    expect(headwordOf(render({}, real))).toBeTruthy()
  })

  describe('a word marked as known is never the word of the day', () => {
    const pool = wordOfTheDayPool(real)
    const todays = pickWordOfTheDay(real, NOW)!
    const at = pool.findIndex((w) => w.esWord === todays.esWord)
    const hide = (...names: string[]) => real.map((w) => (names.includes(w.esWord) ? { ...w, isHidden: true } : w))

    it('with nothing known, the pick is the date\'s own place in the list', () => {
      expect(at).toBeGreaterThanOrEqual(0)
      expect(todays.isHidden).toBe(false)
    })

    it('if the day\'s pick is known, another word takes its place (never the known one)', () => {
      const replacement = pickWordOfTheDay(hide(todays.esWord), NOW)!
      expect(replacement.esWord).not.toBe(todays.esWord)
      expect(replacement.isHidden).toBe(false)
      expect(pool.map((w) => w.esWord)).toContain(replacement.esWord)
    })

    it('on no day, whatever is known, is a known word shown', () => {
      const known = pool.slice(0, 6).map((w) => w.esWord)
      for (let d = 0; d < 400; d++) expect(known).not.toContain(pickWordOfTheDay(hide(...known), new Date(2026, 9, 1 + d, 12))!.esWord)
    })

    it('is deterministic: the same known words on the same day always give the same fallback', () => {
      const known = hide(todays.esWord, pool[(at + 1) % pool.length].esWord)
      expect(pickWordOfTheDay(known, NOW)?.esWord).toBe(pickWordOfTheDay([...known].reverse(), NOW)?.esWord)
      expect(pickWordOfTheDay(known, NOW)?.esWord).toBe(pickWordOfTheDay(known, new Date(2026, 9, 5, 23, 0))?.esWord)
    })

    it('un-knowing the pick brings it back: after an undo nothing is hidden and the day is as it was', () => {
      expect(pickWordOfTheDay(hide(todays.esWord), NOW)?.esWord).not.toBe(todays.esWord)
      expect(pickWordOfTheDay(real, NOW)?.esWord).toBe(todays.esWord)
    })

    it('with one word known, the others still come once each before any comes again', () => {
      const visible = pool.length - 1
      for (const start of [new Date(2026, 9, 1, 12), new Date(2026, 11, 20, 12), new Date(2027, 1, 20, 12)]) {
        const run = Array.from({ length: visible }, (_, k) => pickWordOfTheDay(hide(todays.esWord), new Date(start.getFullYear(), start.getMonth(), start.getDate() + k, 12))!.esWord)
        expect(new Set(run).size).toBe(visible)
        expect(run).not.toContain(todays.esWord)
      }
    })

    it('with every candidate known there is no word of the day (the card is simply not shown)', () => {
      const everyone = real.map((w) => (w.rio ? { ...w, isHidden: true } : w))
      expect(pickWordOfTheDay(everyone, NOW)).toBeNull()
      expect(wordOfTheDay(everyone, parseSettings({}), NOW)).toBeNull()
      expect(render({}, everyone)).not.toContain('class="wotd"')
    })

    it('the card on Home shows the fallback when the pick is known, never the known word', () => {
      const html = render({}, hide(todays.esWord))
      const shown = html.match(/class="wotd-word">(.*?)</)![1]
      expect(shown).not.toBe(headword(todays).text)
      const replacement = pickWordOfTheDay(hide(todays.esWord), NOW)!
      expect(shown).toBe(headword(replacement).text)
    })

    it('it is still not affected by learning: only the known (hidden) flag matters', () => {
      const learned = real.map((w) => ({ ...w, repetitions: 4, nextReview: past }))
      expect(pickWordOfTheDay(learned, NOW)?.esWord).toBe(todays.esWord)
    })
  })

  it('the pick comes only from overlay words whose card can highlight its example (the overlay\'s or the dictionary\'s), and never a vulgar, offensive or pejorative one', () => {
    const pool = wordOfTheDayPool(real)
    expect(pool.length).toBe(71)
    for (const w of pool) {
      expect(w.rio).toBeTruthy()
      expect(['vulgar', 'offensive', 'pejorative']).not.toContain(w.rio!.register)
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

  it('the tile colours follow the design: Learn and Review soft teal, the advised one filled teal, practice lavender, disabled neutral and muted', () => {
    expect(css).toMatch(/\.tile-learn,\s*\.tile-review \{[^}]*background: var\(--teal-soft\)[^}]*border-color: var\(--teal-soft-border\)[^}]*color: var\(--teal-on-soft\)/)
    expect(block('.tile.is-primary')).toMatch(/background: var\(--teal\)/)
    expect(block('.tile.is-primary')).toMatch(/color: var\(--teal-ink\)/)
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
    for (const selector of ['.tile', '.tile.is-primary', '.home-advice', '.home-status']) expect(block(selector)).not.toMatch(/--hl-/)
  })
})

describe('the status row: how far today is from counting for the streak', () => {
  const YESTERDAY = '2026-10-04'
  const todayOf = (html: string) => html.match(/<span class="streak-today">([^<]*)<\/span>/)?.[1] ?? null
  const withCards = (raw: Record<string, unknown>) => render({ activity: new Set<string>() }, undefined, { streak_count: 5, streak_last_activity_date: YESTERDAY, ...raw })

  it('says "4 / 10 today" next to the streak while the day has not counted', () => {
    expect(todayOf(withCards({ cards_done_today_count: 4, cards_done_today_date: TODAY }))).toBe('4 / 10 today')
    expect(todayOf(withCards({ cards_done_today_count: 9, cards_done_today_date: TODAY }))).toBe('9 / 10 today')
  })

  it('starts the day at 0 / 10: no counter, or one from another day', () => {
    expect(todayOf(withCards({}))).toBe('0 / 10 today')
    expect(todayOf(withCards({ cards_done_today_count: 9, cards_done_today_date: YESTERDAY }))).toBe('0 / 10 today')
  })

  it('in Russian: "4 / 10 сегодня"', () => {
    setLanguage('ru')
    try {
      expect(todayOf(withCards({ cards_done_today_count: 4, cards_done_today_date: TODAY }))).toBe('4 / 10 сегодня')
    } finally {
      setLanguage('en')
    }
  })

  it('says nothing once the day counts (the streak was written today)', () => {
    const counted = withCards({ streak_last_activity_date: TODAY, cards_done_today_count: 10, cards_done_today_date: TODAY })
    expect(todayOf(counted)).toBeNull()
    expect(counted).not.toContain('streak-today')
    expect(counted).toContain('<span>5-day streak</span>') // the streak itself is shown as before
  })

  it('is words next to the dots, not a bar: no progress element, no second bar', () => {
    const html = withCards({ cards_done_today_count: 4, cards_done_today_date: TODAY })
    expect(html.match(/<div class="home-status">.*?<\/div><\/div>/)![0]).not.toMatch(/role="progressbar"|<progress|class="bar/)
    expect(html.indexOf('streak-dots')).toBeLessThan(html.indexOf('streak-today'))
  })

  it('is left out when the settings are not there (no streak number to sit next to)', () => {
    const html = renderToStaticMarkup(createElement(HomeScreen, { auth: { status: 'signed-in', userId: 'u', telegramFirstName: null, source: 'existing' }, data: { status: 'loading' }, onLearn: () => {}, onReview: () => {}, onMatching: () => {}, onCloze: () => {}, queue: null, metrics: null, now: NOW } as never))
    expect(html).not.toContain('streak-today')
  })
})

describe('the line of advice under the streak, and the tile it points at', () => {
  const spent = { new_words_learned_today_count: 10, new_words_learned_today_date: TODAY }
  const adviceOf = (html: string) => html.match(/<p class="home-advice">([^<]*)<\/p>/)?.[1] ?? null
  const primaries = (html: string) => ['learn', 'review', 'matching', 'cloze'].filter((id) => tile(html, id).includes('is-primary'))
  const states = {
    reviewFirst: () => render({}, [...learnedWords(8, 3), ...unlearned(20)]),
    learnNew: () => render({}, [...learnedWords(8, 0), ...unlearned(20)]),
    allDoneToday: () => render({}, [...learnedWords(8, 0), ...unlearned(20)], spent),
    poolEmpty: () => render({}, learnedWords(8, 0)),
    allClear: () => render({}, learnedWords(8, 0), spent),
  }

  it('each of the five states says its line, from hand-made numbers', () => {
    expect(adviceOf(states.reviewFirst())).toBe('Review first — 3 words are waiting')
    expect(adviceOf(states.learnNew())).toBe('Nothing to review — 10 new words ready') // the 10 a batch would offer, not the 20 in the pool
    expect(adviceOf(states.allDoneToday())).toBe('Done for today')
    expect(adviceOf(states.poolEmpty())).toBe('No new words left — add your own, or practise')
    expect(adviceOf(states.allClear())).toBe('All clear')
  })

  it('the number due in review first is the real total, not one session\'s worth', () => {
    expect(adviceOf(render({}, [...learnedWords(60, 57), ...unlearned(5)]))).toBe('Review first — 57 words are waiting')
  })

  it('the primary tile follows the state: Review, Learn, or none; Matching and Cloze never', () => {
    expect(primaries(states.reviewFirst())).toEqual(['review'])
    expect(primaries(states.learnNew())).toEqual(['learn'])
    for (const quiet of [states.allDoneToday, states.poolEmpty, states.allClear]) expect(primaries(quiet())).toEqual([])
  })

  it('is one line, under the streak row and above the tiles, and not an extra card, bar or button', () => {
    const html = states.reviewFirst()
    expect(html.match(/class="home-advice"/g)).toHaveLength(1)
    expect(html.indexOf('home-status')).toBeLessThan(html.indexOf('home-advice'))
    expect(html.indexOf('home-advice')).toBeLessThan(html.indexOf('home-grid'))
    expect(html.match(/<p class="home-advice">.*?<\/p>/)![0]).not.toMatch(/<button|role="progressbar"|<svg/)
  })

  it('in Russian', () => {
    setLanguage('ru')
    try {
      expect(adviceOf(states.reviewFirst())).toBe('Сначала повторение — ждут 3 слова')
      expect(adviceOf(states.learnNew())).toBe('Повторять нечего — готово 10 новых слов')
      expect(adviceOf(states.allDoneToday())).toBe('На сегодня всё')
      expect(adviceOf(states.poolEmpty())).toBe('Новые слова кончились — добавьте свои или потренируйтесь')
      expect(adviceOf(states.allClear())).toBe('Всё чисто')
    } finally {
      setLanguage('en')
    }
  })

  it('is left out while the data is not there', () => {
    const html = renderToStaticMarkup(createElement(HomeScreen, { auth: { status: 'signed-in', userId: 'u', telegramFirstName: null, source: 'existing' }, data: { status: 'loading' }, onLearn: () => {}, onReview: () => {}, onMatching: () => {}, onCloze: () => {}, queue: null, metrics: null, now: NOW } as never))
    expect(html).not.toContain('home-advice')
  })
})

