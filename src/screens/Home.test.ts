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
import { learnedState } from '../sm2/sm2'
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
/** n words learned today, in the state a finished Learn batch leaves them in: one repetition, no interval yet, first review at the start of tomorrow. */
const learnedTodayWords = (n: number): Word[] => learnedWords(n, 0).map((w) => ({ ...w, interval: 0, nextReview: learnedState(NOW).nextReview }))
const unlearned = (n: number) => Array.from({ length: n }, (_, i) => makeWord(`nueva${i}`, { rank: 1000 + i }))

const real = parseDictionary(
  JSON.parse(readFileSync('public/words_enriched.json', 'utf8')),
  parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))),
  parseFallbackExamples(JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))),
)

// The screens are checked at a goal of 10 unless a test says otherwise (the default for a new account is 5; its own tests are in dailyGoalDefault.test.ts and below).
const dataFor = (words: readonly Word[], raw: Record<string, unknown> = {}, degraded: string[] = []) => {
  const settings = parseSettings({ daily_new_word_limit: 10, ...raw })
  return { status: 'ready', data: { words, settings, getSettings: () => settings, degraded, retryDegraded: () => {} } } as never
}

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
      news: [], // the real entries would put a dot on the gear; what that looks like is tested below with entries of its own
      ...over,
    } as never),
  )

const tile = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-tile="${id}"[^>]*>.*?</button>`))![0]
const part = (html: string, id: string, cls: string) => tile(html, id).match(new RegExp(`${cls}">(.*?)</span>`))?.[1]

describe('Home structure', () => {
  it('header, status row, word of the day, then the action block (the three tiles and the dock)', () => {
    const html = render({ onOpenWord: () => {}, activity: new Set<string>() }, real)
    const order = ['screen-header', 'home-status', 'class="wotd"', 'class="home-actions"'].map((c) => html.indexOf(c))
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
    expect(render({ activity: null }).match(/class="tile /g)).toHaveLength(3)
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
  it('Learn, Review, Practice, each with its label, its Spanish word and the right class; Matching and Cloze are in the panel after them', () => {
    const html = render()
    expect([...html.matchAll(/data-tile="(\w+)"/g)].map((m) => m[1])).toEqual(['learn', 'review', 'practice', 'matching', 'cloze'])
    expect(html.match(/class="tile /g)).toHaveLength(3) // three tiles: the row above the dock
    expect([part(html, 'learn', 'tile-label'), part(html, 'review', 'tile-label'), part(html, 'practice', 'tile-label')]).toEqual(['Learn', 'Review', 'Practice'])
    expect([part(html, 'learn', 'tile-sub'), part(html, 'review', 'tile-sub'), part(html, 'practice', 'tile-sub')]).toEqual(['aprender', 'repasar', 'practicar'])
    expect([part(html, 'matching', 'mode-label'), part(html, 'cloze', 'mode-label')]).toEqual(['Matching', 'Cloze'])
    expect([part(html, 'matching', 'mode-sub'), part(html, 'cloze', 'mode-sub')]).toEqual(['parejas', 'completar'])
    for (const id of ['learn', 'review', 'practice']) expect(tile(html, id)).toMatch(new RegExp(`class="tile tile-${id}( is-primary)?"`))
    for (const id of ['matching', 'cloze']) expect(tile(html, id)).toMatch(new RegExp(`class="mode mode-${id}"`))
    for (const id of ['learn', 'review', 'practice']) expect(tile(html, id)).toMatch(/<svg class="tile-icon"[^>]*aria-hidden="true"/)
  })

  it('Learn and Review show their counts; Practice and the exercises in its panel never do', () => {
    const html = render()
    expect(part(html, 'learn', 'tile-count')).toBe('10') // the daily limit, with a bigger pool behind it
    expect(part(html, 'review', 'tile-count')).toBe('3')
    for (const id of ['practice', 'matching', 'cloze']) expect(tile(html, id)).not.toContain('tile-count')
    const more = render({}, [...learnedWords(8, 8), ...unlearned(4)])
    expect(part(more, 'learn', 'tile-count')).toBe('4')
    expect(part(more, 'review', 'tile-count')).toBe('8')
  })

  describe('the Practice tile and its panel', () => {
    const panel = (html: string) => html.match(/<div[^>]*class="home-panel"[^>]*>/)![0]
    const attr = (el: string, name: string) => el.match(new RegExp(` ${name}="([^"]*)"`))?.[1]

    it('opens a group of Matching and Cloze: the tile says whether it is expanded and names the panel, the panel is a labelled group, closed to begin with', () => {
      const html = render()
      expect(attr(tile(html, 'practice'), 'aria-expanded')).toBe('false')
      expect(attr(tile(html, 'practice'), 'aria-controls')).toBe(attr(panel(html), 'id'))
      expect(attr(panel(html), 'role')).toBe('group')
      expect(attr(panel(html), 'aria-label')).toBe('Practice exercises')
      expect(panel(html)).toContain('hidden=""') // not shown, not focusable, until the tile is pressed
      expect(html.match(/class="mode /g)).toHaveLength(2) // Matching and Cloze: two of the three slots (the grid has room for a third)
    })

    it('is not marked open while the panel is closed (the open state is tested in a browser: homePanel.browser.test.ts)', () => {
      expect(render()).not.toContain('is-open')
      expect(readFileSync('src/screens/Home.tsx', 'utf8')).toMatch(/tile\.id === 'practice' && open \? ' is-open'/)
    })

    it('is available while either exercise can run, and says so in no state of its own: it is enabled, with its Spanish word', () => {
      const html = render() // both can run
      expect(tile(html, 'practice')).not.toContain('disabled')
      expect(part(html, 'practice', 'tile-sub')).toBe('practicar')
      const sameGloss = learnedWords(6).map((w) => ({ ...w, ruTranslation: 'одно и то же' })) // Matching cannot, Cloze can
      expect(tile(render({}, sameGloss), 'practice')).not.toContain('disabled')
      const noBlank = learnedWords(6).map((w) => ({ ...w, exampleSentence: 'Una frase sin la palabra buscada.' })) // Cloze cannot, Matching can
      expect(tile(render({}, noBlank), 'practice')).not.toContain('disabled')
    })

    it('is disabled only when neither can run, and then says why in place of its Spanish word, like the other tiles; the buttons in the panel say the same', () => {
      const html = render({}, [...learnedWords(4, 4), ...unlearned(5)])
      expect(tile(html, 'practice')).toContain('disabled=""')
      expect(part(html, 'practice', 'tile-sub')).toBe('At least 5 words')
      expect(tile(html, 'practice')).not.toContain('practicar')
      for (const id of ['matching', 'cloze']) {
        expect(tile(html, id)).toContain('disabled=""')
        expect(part(html, id, 'mode-sub')).toBe('At least 5 words')
        expect(tile(html, id)).not.toContain('parejas')
        expect(tile(html, id)).not.toContain('completar')
      }
    })

    it('has no "all done" state and no badge: nothing records that practice was finished, so it is enabled or disabled and nothing else', () => {
      const html = render({}, learnedTodayWords(8).concat(unlearned(20)), { new_words_learned_today_count: 10, new_words_learned_today_date: TODAY })
      expect(tile(html, 'practice')).not.toMatch(/tile-count|badge|is-done/)
      expect(readFileSync('src/screens/Home.tsx', 'utf8')).not.toMatch(/is-done|badge/)
    })
  })

  describe('disabled tiles say why, in place of the Spanish word, with no count', () => {
    it('More tomorrow (the daily limit reached), and a goal of 0 says so instead', () => {
      const html = render({}, [...learnedWords(8, 3), ...unlearned(20)], { daily_new_word_limit: 5, new_words_learned_today_count: 5, new_words_learned_today_date: TODAY })
      expect(tile(html, 'learn')).toContain('disabled=""')
      expect(part(html, 'learn', 'tile-sub')).toBe('More tomorrow')
      const off = render({}, [...learnedWords(8, 3), ...unlearned(20)], { daily_new_word_limit: 0 })
      expect(part(off, 'learn', 'tile-sub')).toBe('Daily goal is 0')
      expect(tile(off, 'learn')).toContain('disabled=""')
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

    it('Matching and Cloze (the buttons in the panel) count their words independently', () => {
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
      for (const id of ['learn', 'review', 'practice', 'matching', 'cloze']) expect(tile(html, id), id).not.toContain('disabled')
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

  it('the known-words notice sits between the status row and the word card, and nothing is lost', () => {
    const html = render({}, real, {}, ['user_hidden_words'])
    expect(html).toContain('class="notice"')
    expect(html).toContain('hidden words')
    const [status, notice, card, grid] = ['home-status', 'class="notice"', 'class="wotd"', 'class="home-actions"'].map((c) => html.indexOf(c))
    expect(status).toBeLessThan(notice)
    expect(notice).toBeLessThan(card)
    expect(card).toBeLessThan(grid)
    expect(html.match(/class="tile /g)).toHaveLength(3)
  })

  it('the unsaved-progress notice appears once the queue is stuck, in the same place, with its Retry button', async () => {
    const html = render({ queue: await stuckQueue() }, real)
    expect(html).toContain("Some progress hasn&#x27;t been saved yet. Retrying…")
    expect(html).toContain('Retry now')
    expect(html.indexOf('class="notice"')).toBeGreaterThan(html.indexOf('home-status'))
    expect(html.indexOf('class="notice"')).toBeLessThan(html.indexOf('class="wotd"'))
  })

  it('both notices together keep the word card and all three tiles', async () => {
    const html = render({ queue: await stuckQueue() }, real, {}, ['user_favorites', 'user_hidden_words'])
    expect(html.match(/class="notice"/g)).toHaveLength(2)
    expect(html).toContain('class="wotd"')
    expect(html.match(/class="tile /g)).toHaveLength(3)
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

  describe("the dot on the gear: something in What's new has not been opened", () => {
    const entry = (id: string, at: string) => ({ id, at, en: { title: id, text: id }, ru: { title: id, text: id } })
    const dayAgo = (n: number) => {
      const d = new Date(NOW.getTime() - n * 86_400_000)
      const pad = (v: number) => String(v).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`
    }
    const NEWS = [entry('b', dayAgo(2)), entry('a', dayAgo(20))]
    /** The gear: the last button in the header's actions, whatever the language. */
    const gear = (html: string) => {
      const actions = html.match(/<div class="screen-header-actions">(.*?)<\/div>/)![1]
      return actions.match(/<button .*?<\/button>/g)!.at(-1)!
    }

    it('shows while an entry is unread: a dot inside the gear, and the gear says there is something new', () => {
      const button = gear(render({ onSettings: () => {}, news: NEWS }))
      expect(button).toContain('aria-label="Settings, something new"')
      expect(button).toContain('title="Settings, something new"')
      expect(button).toContain('<span class="news-dot news-dot-corner" aria-hidden="true"></span>')
    })

    it('is gone once the newest entry has been opened, and the gear is the plain one', () => {
      const button = gear(render({ onSettings: () => {}, news: NEWS }, undefined, { whats_new_seen: NEWS[0].at }))
      expect(button).toContain('aria-label="Settings"')
      expect(button).not.toContain('news-dot')
    })

    it('an older watermark still shows it, and a new entry brings it back', () => {
      expect(gear(render({ onSettings: () => {}, news: NEWS }, undefined, { whats_new_seen: NEWS[1].at }))).toContain('news-dot')
      expect(gear(render({ onSettings: () => {}, news: [entry('newest', dayAgo(0)), ...NEWS] }, undefined, { whats_new_seen: NEWS[0].at }))).toContain('news-dot')
    })

    it('no entry is current: no dot, even for an account that has never opened the screen', () => {
      expect(gear(render({ onSettings: () => {}, news: [] }))).not.toContain('news-dot')
      expect(gear(render({ onSettings: () => {}, news: [entry('stale', dayAgo(120))] }))).not.toContain('news-dot')
    })

    it('there is no dot before the settings have loaded (it would say something about an account not yet known)', () => {
      const loading = renderToStaticMarkup(createElement(HomeScreen, { auth: { status: 'signed-in', userId: 'u', telegramFirstName: null, source: 'existing' }, data: { status: 'loading' }, queue: null, metrics: null, now: NOW, news: NEWS, onSettings: () => {} } as never))
      expect(loading).toContain('aria-label="Settings"')
      expect(loading).not.toContain('news-dot')
    })

    it('in Russian the gear says «Настройки, есть новое»', () => {
      setLanguage('ru')
      try {
        expect(gear(render({ onSettings: () => {}, news: NEWS }))).toContain('aria-label="Настройки, есть новое"')
      } finally {
        setLanguage('en')
      }
    })
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

    it('with one word known, every other word still has its own day, and only the known word\'s day shows another one (69 different words in 70 days)', () => {
      const dayAt = (start: Date, k: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + k, 12)
      for (const start of [new Date(2026, 9, 1, 12), new Date(2026, 11, 20, 12), new Date(2027, 1, 20, 12)]) {
        const before = Array.from({ length: pool.length }, (_, k) => pickWordOfTheDay(real, dayAt(start, k))!.esWord)
        const run = Array.from({ length: pool.length }, (_, k) => pickWordOfTheDay(hide(todays.esWord), dayAt(start, k))!.esWord)
        expect(new Set(run).size).toBe(pool.length - 1)
        expect(run).not.toContain(todays.esWord)
        const changed = run.filter((w, k) => w !== before[k])
        expect(changed).toHaveLength(1) // the one day that word fell on; no other day moved
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
    expect(pool.length).toBe(70)
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
    expect(html.match(/class="tile /g)).toHaveLength(3)
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

  // The 2x2 grid of tiles (96px each, two columns, 14px gaps: 206px) became a row of three tiles and a dock under it. The pins below are the same rules for the new shape:
  // the block as a whole is no taller than the grid was, which is what keeps Home from growing.
  it('three equal tiles of at least 104px in a row, a dock of 88px under them with 14px between: together no taller than the 2x2 grid (206px); a label is never split', () => {
    expect(block('.home-actions')).toMatch(/flex-direction: column/)
    expect(block('.home-actions')).toMatch(/gap: 14px/)
    expect(block('.home-tiles')).toMatch(/grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
    expect(block('.tile')).toMatch(/min-height: 104px/)
    expect(block('.home-dock')).toMatch(/height: 88px/)
    expect(104 + 14 + 88).toBeLessThanOrEqual(2 * 96 + 14) // the old grid: two rows of 96 and a gap of 14
    expect(block('.tile')).toMatch(/border-radius: var\(--radius-tile\)/)
    expect(block('.tile')).toMatch(/min-width: 0/)
    expect(block('.tile')).toMatch(/flex-direction: column/) // icon and count on top, the text under them: three tiles are too narrow for the old side-by-side
    expect(block('.tile-label')).toMatch(/overflow-wrap: normal/) // never "anywhere": a word is not broken
    expect(block('.tile-label')).toMatch(/hyphens: none/)
    expect(block('.tile-label')).not.toMatch(/overflow-wrap: anywhere|word-break/)
    expect(block('.tile-text')).toMatch(/min-width: 0/)
    expect(block('.tile-top')).toMatch(/justify-content: space-between/) // the count on the right
    expect(block('.tile')).toMatch(/justify-content: flex-start/) // the text is top-aligned under the icon row: the three labels are level, whatever the reason under them takes
    expect(block('.tile')).not.toMatch(/justify-content: space-between|align-content: center/)
  })

  it('the progress line is at the top of the dock, its box 11px under the tiles (the dock is 14px under them), and the dock keeps its 88px', () => {
    expect(block('.home-dock')).toMatch(/align-items: flex-start/)
    expect(block('.home-dock')).not.toMatch(/align-items: center/)
    expect(block('.home-dock')).toMatch(/height: 88px/)
    expect(block('.home-progress')).toMatch(/margin: -3px 0 0/)
    expect(block('.home-actions')).toMatch(/gap: 14px/)
  })

  it('the Practice tile has an open state that moves nothing: a 2px ring inside its edge, in its own text colour', () => {
    expect(block('.tile.is-open')).toMatch(/box-shadow: inset 0 0 0 2px currentColor/)
    expect(block('.tile.is-open')).not.toMatch(/border-width|padding|margin|width:|height:/) // an inset shadow, not a thicker border, so that the tile does not grow
  })

  it('the panel covers the dock: the same footprint (absolute, inset 0, over a dock of fixed height), three columns for up to three exercises, and gone when closed', () => {
    expect(block('.home-dock')).toMatch(/position: relative/)
    expect(block('.home-panel')).toMatch(/position: absolute/)
    expect(block('.home-panel')).toMatch(/inset: 0/)
    expect(block('.home-panel')).toMatch(/grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
    expect(block('.home-panel')).toMatch(/background: var\(--surface\)/) // opaque: the progress line under it does not show through the empty slot
    expect(block('.home-panel[hidden]')).toMatch(/display: none/)
    expect(block('.mode-label')).toMatch(/overflow-wrap: normal/)
    expect(block('.mode-label')).toMatch(/hyphens: none/)
  })

  it('the tile colours follow the design: Learn and Review soft teal, the advised one filled teal, Practice (and the exercises in its panel) lavender, disabled neutral and muted', () => {
    expect(css).toMatch(/\.tile-learn,\s*\.tile-review \{[^}]*background: var\(--teal-soft\)[^}]*border-color: var\(--teal-soft-border\)[^}]*color: var\(--teal-on-soft\)/)
    expect(block('.tile.is-primary')).toMatch(/background: var\(--teal\)/)
    expect(block('.tile.is-primary')).toMatch(/color: var\(--teal-ink\)/)
    expect(block('.tile-practice')).toMatch(/background: var\(--lav-soft\)/)
    expect(block('.tile-practice')).toMatch(/color: var\(--lav-on-soft\)/)
    expect(block('.mode')).toMatch(/background: var\(--lav-soft\)/)
    expect(block('.mode')).toMatch(/color: var\(--lav-on-soft\)/)
    const d = block('.tile:disabled')
    expect(d).toMatch(/background: var\(--surface-2\)/)
    expect(d).toMatch(/color: var\(--muted\)/)
    expect(block('.mode:disabled')).toMatch(/background: var\(--surface-2\)/)
  })

  it('the Spanish word under a tile label is Fraunces italic; a disabled tile\'s reason is plain UI type', () => {
    expect(block('.tile-sub')).toMatch(/font-family: var\(--font-display\)/)
    expect(block('.tile-sub')).toMatch(/font-style: italic/)
    expect(block('.tile:disabled .tile-sub')).toMatch(/font-family: var\(--font-ui\)/)
    expect(block('.mode-sub')).toMatch(/font-family: var\(--font-display\)/) // the same in the panel
    expect(block('.mode-sub')).toMatch(/font-style: italic/)
    expect(block('.mode:disabled .mode-sub')).toMatch(/font-family: var\(--font-ui\)/)
  })

  it('amber is the highlight and nothing else on Home: only the word card uses --hl-*', () => {
    const uses = [...css.matchAll(/--hl-(?:bg|text)/g)].length
    expect(uses).toBeGreaterThan(0)
    expect(block('mark')).toMatch(/background: var\(--hl-bg\)/)
    for (const selector of ['.tile', '.tile.is-primary', '.mode', '.home-progress', '.home-advice', '.home-status']) expect(block(selector)).not.toMatch(/--hl-/)
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

  it('the bar is the daily goal, up to ten: "4 / 5 today" at a goal of 5, "5 / 7" at 7, and ten at 10, at 20 and at 0', () => {
    const at = (goal: number, done: number) => todayOf(withCards({ daily_new_word_limit: goal, cards_done_today_count: done, cards_done_today_date: TODAY }))
    expect(at(5, 4)).toBe('4 / 5 today')
    expect(at(5, 0)).toBe('0 / 5 today')
    expect(at(7, 5)).toBe('5 / 7 today')
    expect(at(1, 0)).toBe('0 / 1 today')
    expect(at(10, 4)).toBe('4 / 10 today')
    expect(at(20, 4)).toBe('4 / 10 today')
    expect(at(0, 4)).toBe('4 / 10 today')
  })

  it('a new account (no stored goal, intro not finished) sees "0 / 5 today": the default goal is the bar', () => {
    expect(todayOf(withCards({ daily_new_word_limit: undefined }))).toBe('0 / 5 today') // undefined: the fixture\'s goal of 10 is taken out again
    expect(todayOf(withCards({ daily_new_word_limit: undefined, onboarding_done: true }))).toBe('0 / 10 today') // a finished intro with no stored goal has always had 10
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

describe('the dock: today\'s new words against the daily goal, in one quiet line', () => {
  const lineOf = (html: string) => html.match(/<p class="(home-progress[^"]*)"[^>]*>([^<]*)<\/p>/)?.slice(1) ?? null
  const withCount = (count: number | null, raw: Record<string, unknown> = {}) =>
    render({}, undefined, { ...(count === null ? {} : { new_words_learned_today_count: count, new_words_learned_today_date: TODAY }), ...raw })

  it('says how many new words were learned today of the goal, until the goal is reached', () => {
    expect(lineOf(withCount(3, { daily_new_word_limit: 5 }))).toEqual(['home-progress', 'New words today: 3 of 5'])
    expect(lineOf(withCount(0, { daily_new_word_limit: 5 }))).toEqual(['home-progress', 'New words today: 0 of 5'])
    expect(lineOf(withCount(9))).toEqual(['home-progress', 'New words today: 9 of 10'])
  })

  it('says the goal is reached once it is, in its own colour; a count past the goal (the goal was lowered) never reads as more than the goal', () => {
    expect(lineOf(withCount(5, { daily_new_word_limit: 5 }))).toEqual(['home-progress is-reached', 'Daily goal reached: 5 of 5'])
    expect(lineOf(withCount(12, { daily_new_word_limit: 5 }))).toEqual(['home-progress is-reached', 'Daily goal reached: 5 of 5'])
  })

  it('counts from the new words learned today (the settings counter, for today\'s date), not from the cards done in any mode, and not from yesterday', () => {
    expect(lineOf(withCount(null, { cards_done_today_count: 7, cards_done_today_date: TODAY, daily_new_word_limit: 5 }))![1]).toBe('New words today: 0 of 5') // Learn was not opened today: 0, whatever else was done
    expect(lineOf(render({}, undefined, { new_words_learned_today_count: 4, new_words_learned_today_date: '2026-10-04', daily_new_word_limit: 5 }))![1]).toBe('New words today: 0 of 5')
  })

  it('the goal is the account\'s: 10 for an account that finished the intro before there was a stored goal, 5 for a new one', () => {
    expect(lineOf(withCount(3, { daily_new_word_limit: undefined, onboarding_done: true }))![1]).toBe('New words today: 3 of 10')
    expect(lineOf(withCount(3, { daily_new_word_limit: undefined }))![1]).toBe('New words today: 3 of 5')
    expect(lineOf(withCount(3, { daily_new_word_limit: 7 }))![1]).toBe('New words today: 3 of 7') // a stored goal wins
  })

  it('at a goal of 0 there is no line (Learn already says "Daily goal is 0"), and the dock keeps its place', () => {
    const html = withCount(0, { daily_new_word_limit: 0 })
    expect(lineOf(html)).toBeNull()
    expect(html).toContain('class="home-dock"')
  })

  it('in Russian', () => {
    setLanguage('ru')
    try {
      expect(lineOf(withCount(3, { daily_new_word_limit: 5 }))![1]).toBe('Новых слов сегодня: 3 из 5')
      expect(lineOf(withCount(5, { daily_new_word_limit: 5 }))![1]).toBe('Дневная цель выполнена: 5 из 5')
    } finally {
      setLanguage('en')
    }
  })

  it('is a plain line: not a button, link or bar, with nothing to tap; it is read out unless the panel covers it', () => {
    const html = withCount(3, { daily_new_word_limit: 5 })
    expect(html.match(/<div class="home-dock">(.*?)<div[^>]*class="home-panel"/)![1]).toBe('<p class="home-progress">New words today: 3 of 5</p>')
    expect(readFileSync('src/screens/Home.tsx', 'utf8')).toMatch(/aria-hidden=\{covered \|\| undefined\}/)
  })

  it('does not say the same thing as the status row: that counts cards of every kind against the streak\'s goal, this one only new words against the daily goal', () => {
    // 1 new word and 3 reviews: the status row says 4 / 5, the dock says 1 of 5: two numbers, two names
    const html = render({ activity: new Set<string>() }, undefined, { streak_count: 5, streak_last_activity_date: '2026-10-04', daily_new_word_limit: 5, cards_done_today_count: 4, cards_done_today_date: TODAY, new_words_learned_today_count: 1, new_words_learned_today_date: TODAY })
    expect(html.match(/<span class="streak-today">([^<]*)<\/span>/)![1]).toBe('4 / 5 today')
    expect(lineOf(html)![1]).toBe('New words today: 1 of 5')
    // the goal reached through Learn alone: the day counts for the streak, so the status row says nothing more, and the dock says the goal is reached
    const done = render({ activity: new Set<string>() }, undefined, { streak_count: 6, streak_last_activity_date: TODAY, daily_new_word_limit: 5, cards_done_today_count: 5, cards_done_today_date: TODAY, new_words_learned_today_count: 5, new_words_learned_today_date: TODAY })
    expect(done).not.toContain('streak-today')
    expect(lineOf(done)![1]).toBe('Daily goal reached: 5 of 5')
  })
})

describe('the line of advice under the streak, and the tile it points at', () => {
  const spent = { new_words_learned_today_count: 10, new_words_learned_today_date: TODAY }
  const adviceOf = (html: string) => html.match(/<p class="home-advice">([^<]*)<\/p>/)?.[1]?.replaceAll('&#x27;', "'") ?? null
  // only the tiles can be filled; the buttons in the panel never are
  const primaries = (html: string) => ['learn', 'review', 'practice'].filter((id) => tile(html, id).includes('is-primary'))
  const states = {
    reviewFirst: () => render({}, [...learnedWords(8, 3), ...unlearned(20)]),
    learnNew: () => render({}, [...learnedWords(8, 0), ...unlearned(20)]),
    // nothing was learned today (as the words stand), but the counter says 10: the line still says what was done and what comes
    allDoneToday: () => render({}, [...learnedWords(8, 0), ...unlearned(20)], spent),
    // the same, with the 8 words really learned today: they come back tomorrow, and can be practised now
    allDoneTodayWithWords: () => render({}, [...learnedTodayWords(8), ...unlearned(20)], spent),
    poolEmpty: () => render({}, learnedWords(8, 0)),
    allClear: () => render({}, learnedWords(8, 0), spent),
  }

  it('each of the five states says its line, from hand-made numbers', () => {
    expect(adviceOf(states.reviewFirst())).toBe('Review first — 3 words are waiting')
    expect(adviceOf(states.learnNew())).toBe('Nothing to review — 10 new words ready') // the 10 a batch would offer, not the 20 in the pool
    expect(adviceOf(states.allDoneToday())).toBe('Today: 10 new words. Tomorrow: 10 new words.') // no reviews tomorrow: that part is left out
    expect(adviceOf(states.poolEmpty())).toBe('No new words left — add your own, or practise')
    expect(adviceOf(states.allClear())).toBe('All caught up')
  })

  it('the number due in review first is the real total, not one session\'s worth, and past one session the line says how many a session holds', () => {
    expect(adviceOf(render({}, [...learnedWords(60, 57), ...unlearned(5)]))).toBe('Review first — 57 words are waiting (20 per session)')
  })

  it('the boundary: 20 due is the line as it was, 21 due says both numbers — on Home, in both languages', () => {
    const at = (due: number) => adviceOf(render({}, [...learnedWords(due + 5, due), ...unlearned(5)]))
    expect(at(19)).toBe('Review first — 19 words are waiting')
    expect(at(20)).toBe('Review first — 20 words are waiting')
    expect(at(21)).toBe('Review first — 21 words are waiting (20 per session)')
    setLanguage('ru')
    try {
      expect(at(20)).toBe('Сначала повторение — ждут 20 слов')
      expect(at(21)).toBe('Сначала повторение — ждет 21 слово, за раз — 20')
      expect(at(37)).toBe('Сначала повторение — ждут 37 слов, за раз — 20')
    } finally {
      setLanguage('en')
    }
  })

  it('the primary tile follows the state: Review, Learn, Practice at the end of the day, or none', () => {
    expect(primaries(states.reviewFirst())).toEqual(['review'])
    expect(primaries(states.learnNew())).toEqual(['learn'])
    expect(primaries(states.allDoneToday())).toEqual(['practice']) // practice is the one thing left to do: the Practice tile, where Matching was
    expect(primaries(states.allDoneTodayWithWords())).toEqual(['practice'])
    for (const html of [states.reviewFirst(), states.allDoneTodayWithWords()]) expect(html).not.toMatch(/class="mode[^"]*is-primary/) // the panel is not auto-opened and its buttons are never filled
    expect(states.allDoneTodayWithWords()).toMatch(/aria-expanded="false"/) // not opened for the person either
    for (const quiet of [states.poolEmpty, states.allClear]) expect(primaries(quiet())).toEqual([])
  })

  describe('the end of the day, once new words were learned', () => {
    const dayEnd = () => states.allDoneTodayWithWords()

    it('says what was done and what comes next, then points at the practice: tomorrow\'s reviews are the 8 words learned today', () => {
      expect(adviceOf(dayEnd())).toBe('Today: 10 new words. Tomorrow: 8 reviews and 10 new. Today\'s words are ready to practise.')
    })

    it('Practice is the one filled tile, with Matching and Cloze available in its panel; Learn (past the goal) and Review (nothing due) stay disabled', () => {
      const html = dayEnd()
      expect(primaries(html)).toEqual(['practice'])
      expect(tile(html, 'practice')).not.toContain('disabled')
      expect(tile(html, 'matching')).not.toContain('disabled')
      expect(tile(html, 'cloze')).not.toContain('disabled')
      expect(tile(html, 'review')).toContain('disabled') // the app never offers reviews that are not due
      expect(tile(html, 'learn')).toContain('disabled') // and no one-tap "more today": the goal protects tomorrow\'s load
      expect(tile(html, 'review')).not.toContain('is-primary')
    })

    it('with the goal at 0 nothing was learned today: the plain line, and no tile is pushed', () => {
      const html = render({}, [...learnedWords(8, 0), ...unlearned(20)], { daily_new_word_limit: 0, new_words_learned_today_count: 0, new_words_learned_today_date: TODAY })
      expect(adviceOf(html)).toBe('Done for today')
      expect(primaries(html)).toEqual([])
    })

    it('when only Cloze can run on today\'s words (their glosses collide for Matching), the pointer is still there', () => {
      const colliding = learnedTodayWords(8).map((w) => ({ ...w, ruTranslation: 'igual', enTranslation: 'same' }))
      expect(adviceOf(render({}, [...colliding, ...unlearned(20)], spent))).toContain('Today\'s words are ready to practise.')
    })

    it('with too few words to practise, the line still says what was done, no pointer to a practice that cannot run, and no tile is pushed', () => {
      const html = render({}, [...learnedTodayWords(3), ...unlearned(20)], spent)
      expect(adviceOf(html)).toBe('Today: 10 new words. Tomorrow: 3 reviews and 10 new.')
      expect(primaries(html)).toEqual([])
      expect(tile(html, 'matching')).toContain('disabled')
      expect(tile(html, 'practice')).toContain('disabled') // neither exercise can run, so the tile that opens them is the disabled one
    })

    it('in Russian', () => {
      setLanguage('ru')
      try {
        expect(adviceOf(dayEnd())).toBe('Сегодня: 10 новых слов. Завтра: 8 повторений и 10 новых. Сегодняшние слова можно потренировать.')
        expect(adviceOf(states.allDoneToday())).toBe('Сегодня: 10 новых слов. Завтра: 10 новых слов.')
      } finally {
        setLanguage('en')
      }
    })
  })

  it('is one line of text in a card, under the streak row and above the tiles: no icon, heading, button or bar inside it', () => {
    const html = states.reviewFirst()
    expect(html.match(/class="home-advice"/g)).toHaveLength(1)
    expect(html.indexOf('home-status')).toBeLessThan(html.indexOf('home-advice'))
    expect(html.indexOf('home-advice')).toBeLessThan(html.indexOf('home-actions'))
    expect(html.match(/<p class="home-advice">.*?<\/p>/)![0]).not.toMatch(/<button|role="progressbar"|<svg|<h[1-6]|<img|<a /)
  })

  it('in Russian', () => {
    setLanguage('ru')
    try {
      expect(adviceOf(states.reviewFirst())).toBe('Сначала повторение — ждут 3 слова')
      expect(adviceOf(states.learnNew())).toBe('Повторять нечего — можно изучить 10 новых слов')
      expect(adviceOf(states.allDoneToday())).toBe('Сегодня: 10 новых слов. Завтра: 10 новых слов.')
      expect(adviceOf(states.poolEmpty())).toBe('Новые слова закончились — добавьте свои или потренируйтесь')
      expect(adviceOf(states.allClear())).toBe('Всё повторено')
    } finally {
      setLanguage('en')
    }
  })

  it('is left out while the data is not there', () => {
    const html = renderToStaticMarkup(createElement(HomeScreen, { auth: { status: 'signed-in', userId: 'u', telegramFirstName: null, source: 'existing' }, data: { status: 'loading' }, onLearn: () => {}, onReview: () => {}, onMatching: () => {}, onCloze: () => {}, queue: null, metrics: null, now: NOW } as never))
    expect(html).not.toContain('home-advice')
  })
})

describe('the advice card and the word-of-the-day card are one family', () => {
  const css = readFileSync('src/index.css', 'utf8')
  const block = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`)
    if (start === -1) throw new Error(`no ${selector} rule`)
    return css.slice(css.indexOf('{', start), css.indexOf('}', start))
  }
  const px = (value: string) => value.split(/\s+/).map((v) => parseFloat(v))

  it('the same background, border and radius, and a smaller padding', () => {
    const advice = block('.home-advice')
    const wotd = block('.wotd')
    for (const rule of [/border: 1px solid var\(--border\)/, /border-radius: var\(--radius-card\)/, /background: var\(--surface\)/]) {
      expect(advice).toMatch(rule)
      expect(wotd).toMatch(rule)
    }
    const [adviceY, adviceX] = px(advice.match(/padding: ([^;]+);/)![1])
    const [wotdY, wotdX] = px(wotd.match(/padding: ([^;]+);/)![1])
    expect(adviceY).toBeLessThan(wotdY)
    expect(adviceX).toBeLessThan(wotdX)
  })

  it('and it is the quieter of the two: muted text, at the size of the streak row, not louder than the card below', () => {
    const advice = block('.home-advice')
    expect(advice).toMatch(/color: var\(--muted\)/)
    expect(parseFloat(advice.match(/font-size: ([\d.]+)px/)![1])).toBeLessThanOrEqual(13)
    expect(advice).not.toMatch(/font-family|text-transform|letter-spacing|box-shadow|background: var\(--(teal|lav|hl)/)
  })
})

