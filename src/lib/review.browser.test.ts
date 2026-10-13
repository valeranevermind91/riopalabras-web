import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { setLanguage } from './language'
import { en } from '../strings'
import { ru } from '../strings.ru'

/**
 * Review's session limit in a real browser (src/testing/reviewHarness.tsx: the real Home and Review screens over a word list that changes as words
 * are rated): a long backlog is worked through in sessions of 20, the most overdue words first, shuffled; the end of a session says how many are still
 * due and offers "Continue"; the Home tile keeps showing the real total. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('the Review session limit', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5251, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(query: string, language?: 'ru') {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setViewport({ width: 390, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    if (language) await page.evaluateOnNewDocument((code) => localStorage.setItem('riopalabras.language.v1', code), language)
    await page.goto(`${base}/src/testing/reviewHarness.html?${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-tile="review"]')
    return page
  }

  const tile = (page: Page) => page.$eval('[data-tile="review"] .tile-count', (e) => Number(e.textContent))
  const counter = (page: Page) => page.$eval('.review-count', (e) => e.textContent ?? '')
  const headword = (page: Page) => page.$eval('.flip-front .wc-headword', (e) => e.textContent ?? '')
  const postBatch = (page: Page) => page.$eval('.post-batch', (e) => ({ title: e.querySelector('h2')!.textContent, subtitle: e.querySelector('.subtitle')!.textContent, buttons: Array.from(e.querySelectorAll('button')).map((b) => b.textContent?.trim()) }))

  /** Reveals the card and rates it; resolves once the next card (or the end screen) is up. */
  async function rate(page: Page, tone: 'again' | 'hard' | 'good' | 'easy' = 'good') {
    const before = await counter(page)
    await page.click('.flip')
    await page.waitForSelector(`.rating:not(.is-hidden) .rate-${tone}`)
    await page.click(`.rate-${tone}`)
    await page.waitForFunction((b) => !document.querySelector('.review-count') || document.querySelector('.review-count')!.textContent !== b, { timeout: 10_000 }, before)
  }
  /** Works through a session with `tone`, returning the words in the order they were shown (a re-queued word shows again), until the end screen. */
  async function playSession(page: Page, tone: 'again' | 'hard' | 'good' | 'easy' = 'good') {
    const shown: string[] = []
    while (await page.$('.review-count')) {
      shown.push(await headword(page))
      await rate(page, tone)
    }
    await page.waitForSelector('.post-batch')
    return shown
  }
  const number = (esWord: string) => Number(esWord.replace('vieja', ''))
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `vieja${from + i}`)

  it('a backlog of 50 is worked through in sessions of 20, 20 and 10, the most overdue first; the tile shows the real total throughout', async () => {
    const page = await open('due=50')
    expect(await tile(page)).toBe(50) // not 20

    await page.click('[data-tile="review"]')
    await page.waitForSelector('.flip')
    expect(await counter(page)).toBe('1 / 20')
    const first = await playSession(page)
    expect(first).toHaveLength(20)
    expect([...first].sort()).toEqual(range(31, 50).sort()) // the 20 most overdue (vieja50 has waited longest)
    // shuffled for presentation: not in order of overdue-ness, in either direction
    const sorted = [...first].sort((a, b) => number(b) - number(a))
    expect(first).not.toEqual(sorted)
    expect(first).not.toEqual([...sorted].reverse())

    // the end of a session with more due: how many are left, Continue, and the way home
    expect(await postBatch(page)).toEqual({ title: 'Done for now', subtitle: '30 words are still due.', buttons: ['Continue', 'Back to home'] })
    await page.evaluate(() => (Array.from(document.querySelectorAll('.post-batch button')).find((b) => b.textContent?.trim() === 'Back to home') as HTMLElement).click())
    await page.waitForSelector('[data-tile="review"]')
    expect(await tile(page)).toBe(30) // the real total waiting, not 20 and not the session

    await page.click('[data-tile="review"]')
    await page.waitForSelector('.flip')
    expect(await counter(page)).toBe('1 / 20')
    const second = await playSession(page)
    expect([...second].sort()).toEqual(range(11, 30).sort())
    expect((await postBatch(page)).subtitle).toBe('10 words are still due.')

    // Continue starts the next session at once, of what is left
    await page.evaluate(() => (Array.from(document.querySelectorAll('.post-batch button')).find((b) => b.textContent?.trim() === 'Continue') as HTMLElement).click())
    await page.waitForSelector('.flip')
    expect(await counter(page)).toBe('1 / 10')
    const third = await playSession(page)
    expect([...third].sort()).toEqual(range(1, 10).sort())

    // nothing left: the existing screen, unchanged
    expect(await postBatch(page)).toEqual({ title: en.review.allCaughtUp, subtitle: en.review.allCaughtUpSubtitle, buttons: [en.common.backToHome, en.review.refresh] })
    await page.close()
  }, 180_000)

  it('the end-of-session screen in Russian', async () => {
    const page = await open('due=25', 'ru')
    await page.click('[data-tile="review"]')
    await page.waitForSelector('.flip')
    expect(await counter(page)).toBe('1 / 20')
    await playSession(page)
    setLanguage('ru') // the plural form follows the language of the process, as it does in the page
    try {
      expect(await postBatch(page)).toEqual({ title: ru.review.sessionDone, subtitle: ru.review.sessionLeft(5), buttons: [ru.review.continue, ru.common.backToHome] })
      expect(ru.review.sessionDone).toBe('Пока всё')
      expect(ru.review.sessionLeft(5)).toBe('Осталось повторить: 5 слов.')
      expect(ru.review.sessionLeft(1)).toBe('Осталось повторить: 1 слово.')
      expect(ru.review.sessionLeft(2)).toBe('Осталось повторить: 2 слова.')
      expect(ru.review.continue).toBe('Продолжить')
    } finally {
      setLanguage('en')
    }
    await page.close()
  }, 120_000)

  it('a backlog of fewer than 20 behaves as it always did: every due word, then "All caught up"', async () => {
    const page = await open('due=12')
    expect(await tile(page)).toBe(12)
    await page.click('[data-tile="review"]')
    await page.waitForSelector('.flip')
    expect(await counter(page)).toBe('1 / 12')
    const shown = await playSession(page)
    expect([...shown].sort()).toEqual(range(1, 12).sort())
    expect(await page.$eval('.post-batch h2', (e) => e.textContent)).toBe(en.review.allCaughtUp) // no "Continue" screen
    expect(await page.$$eval('.post-batch button', (els) => els.map((e) => e.textContent?.trim()))).toEqual([en.common.backToHome, en.review.refresh])
    await page.close()
  }, 120_000)

  it('rating Again over and over ends at 40 cards, and says nothing about a ceiling; the words left over are still due', async () => {
    const page = await open('due=30')
    await page.click('[data-tile="review"]')
    await page.waitForSelector('.flip')
    expect(await counter(page)).toBe('1 / 20')
    const shown = await playSession(page, 'again')
    expect(shown).toHaveLength(40) // 20 words, each shown twice: the session did not grow past 40
    expect(new Set(shown).size).toBe(20)
    // the end screen says how many are still due (the 10 of the 30 that were never in the session), and nothing about 40
    const end = await postBatch(page)
    expect(end).toEqual({ title: 'Done for now', subtitle: '10 words are still due.', buttons: ['Continue', 'Back to home'] })
    expect(JSON.stringify(end)).not.toMatch(/40|limit|ceiling|maximum/i)
    await page.close()
  }, 180_000)

  it('Continue draws from what is due then: a word that came due during the last session is in the next one', async () => {
    const page = await open('due=25&soon=4')
    await page.click('[data-tile="review"]')
    await page.waitForSelector('.flip')
    const shown: string[] = []
    for (let i = 0; i < 19; i++) {
      shown.push(await headword(page))
      await rate(page)
    }
    await new Promise((resolve) => setTimeout(resolve, 4500)) // "pronta" comes due while the session is still on
    shown.push(await headword(page))
    await rate(page)
    await page.waitForSelector('.post-batch')
    expect(shown).not.toContain('pronta') // it was not due when the session was drawn
    expect((await postBatch(page)).subtitle).toBe('6 words are still due.') // the 5 left over and the one that came due
    await page.evaluate(() => (Array.from(document.querySelectorAll('.post-batch button')).find((b) => b.textContent?.trim() === 'Continue') as HTMLElement).click())
    await page.waitForSelector('.flip')
    expect(await counter(page)).toBe('1 / 6')
    const next = await playSession(page)
    expect([...next].sort()).toEqual([...range(1, 5), 'pronta'].sort())
    await page.close()
  }, 180_000)
  describe('what counts the day for the streak', () => {
    /** The streak row's words: the streak and, until the day counts, how far today is. */
    const statusWords = (page: Page) => page.$$eval('.streak > span:not(.streak-dots)', (els) => els.map((e) => e.textContent))
    const goHome = async (page: Page) => {
      await page.evaluate(() => (Array.from(document.querySelectorAll('.post-batch button')).find((b) => b.textContent?.trim() === 'Back to home') as HTMLElement).click())
      await page.waitForSelector('[data-tile="review"]')
    }
    const startReview = async (page: Page) => {
      await page.click('[data-tile="review"]')
      await page.waitForSelector('.flip')
    }

    it('Home starts the day at "0 / 10 today" next to the streak', async () => {
      const page = await open('due=9')
      expect(await statusWords(page)).toEqual(['4-day streak', '0 / 10 today'])
      await page.close()
    }, 120_000)

    it('a word rated Again and then Good is one card: nine words, ten ratings, nine cards, and the day has not counted', async () => {
      const page = await open('due=9')
      await startReview(page)
      await rate(page, 'again') // the first word, back at the end of the session
      const shown = await playSession(page, 'good')
      expect(shown).toHaveLength(9) // the other eight, then the word again
      await goHome(page)
      expect(await statusWords(page)).toEqual(['4-day streak', '9 / 10 today']) // nine cards: ten ratings, but one word twice
      await page.close()
    }, 180_000)

    it('ten different cards count the day: the streak goes up and the "today" words are gone', async () => {
      const page = await open('due=10')
      await startReview(page)
      await playSession(page)
      await goHome(page)
      expect(await statusWords(page)).toEqual(['5-day streak']) // written when the tenth was rated
      await page.close()
    }, 180_000)

    it('a light day counts: three due words and the goal already met is everything there was', async () => {
      const page = await open('due=3&met=1')
      expect(await statusWords(page)).toEqual(['4-day streak', '0 / 10 today'])
      await startReview(page)
      await playSession(page)
      await goHome(page)
      expect(await statusWords(page)).toEqual(['5-day streak'])
      await page.close()
    }, 180_000)

    it('three due words and the goal NOT met is not a light day: 3 / 10 today', async () => {
      const page = await open('due=3')
      await startReview(page)
      await playSession(page)
      await goHome(page)
      expect(await statusWords(page)).toEqual(['4-day streak', '3 / 10 today'])
      await page.close()
    }, 180_000)
  })
  describe('the line of advice on Home, at 320px, in both languages', () => {
    const states = [
      { name: 'reviewFirst', query: 'due=50', primary: 'review', en: 'Review first — 50 words are waiting', ru: 'Сначала повторение — ждут 50 слов' },
      { name: 'learnNew', query: 'due=0&pool=30', primary: 'learn', en: 'Nothing to review — 10 new words ready', ru: 'Повторять нечего — готово 10 новых слов' },
      { name: 'allDoneToday', query: 'due=0&pool=30&met=1', primary: null, en: 'Done for today', ru: 'На сегодня всё' },
      { name: 'poolEmpty', query: 'due=0', primary: null, en: 'No new words left — add your own, or practise', ru: 'Новые слова кончились — добавьте свои или потренируйтесь' },
      { name: 'allClear', query: 'due=0&met=1', primary: null, en: 'All clear', ru: 'Всё чисто' },
    ] as const

    /** How the line and the tiles look right now: its text, whether it overflows or runs past the screen, how many lines it takes, and which tile is filled. */
    const look = (page: Page) =>
      page.evaluate(() => {
        const line = document.querySelector('.home-advice') as HTMLElement
        const rect = line.getBoundingClientRect()
        const lineHeight = parseFloat(getComputedStyle(line).lineHeight)
        const tiles = Array.from(document.querySelectorAll('.tile')) as HTMLElement[]
        const background = (t: HTMLElement) => getComputedStyle(t).backgroundColor
        return {
          text: line.textContent,
          overflows: line.scrollWidth > line.clientWidth,
          right: Math.round(rect.right),
          left: Math.round(rect.left),
          lines: Math.round(rect.height / lineHeight),
          pageScrolls: document.documentElement.scrollWidth > window.innerWidth,
          primary: tiles.filter((t) => t.classList.contains('is-primary')).map((t) => t.dataset.tile),
          filled: tiles.filter((t) => background(t) === background(tiles.find((x) => x.classList.contains('is-primary')) ?? t) && t.classList.contains('is-primary')).length,
          learnReviewBackgrounds: ['learn', 'review'].map((id) => background(document.querySelector(`[data-tile="${id}"]`) as HTMLElement)),
          above: line.compareDocumentPosition(document.querySelector('.home-grid')!) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
          below: document.querySelector('.home-status')!.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
        }
      })

    for (const language of ['en', 'ru'] as const) {
      for (const state of states) {
        it(`${state.name} in ${language === 'en' ? 'English' : 'Russian'}: the line fits in 320px, is under the streak and above the tiles, and the right tile is primary`, async () => {
          const page = await open(state.query, language === 'ru' ? 'ru' : undefined)
          await page.setViewport({ width: 320, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
          const seen = await look(page)
          expect(seen.text).toBe(state[language])
          expect(seen.overflows).toBe(false)
          expect(seen.pageScrolls).toBe(false)
          expect(seen.left).toBeGreaterThanOrEqual(0)
          expect(seen.right).toBeLessThanOrEqual(320)
          expect(seen.lines).toBeLessThanOrEqual(2) // it may wrap to two lines, never more
          expect(seen.above && seen.below).toBe(true)
          expect(seen.primary).toEqual(state.primary ? [state.primary] : [])
          await page.close()
        }, 60_000)
      }
    }

    it('the primary tile looks different from the other: filled where the other is soft', async () => {
      const filledOf = async (query: string) => {
        const page = await open(query)
        const seen = await look(page)
        await page.close()
        return seen.learnReviewBackgrounds
      }
      const [learnWhenReview, reviewWhenReview] = await filledOf('due=50&pool=30')
      const [learnWhenLearn, reviewWhenLearn] = await filledOf('due=0&pool=30')
      const [learnQuiet, reviewQuiet] = await filledOf('due=0&pool=30&met=1')
      expect(reviewWhenReview).not.toBe(learnWhenReview) // review is the filled one
      expect(learnWhenLearn).not.toBe(reviewWhenLearn) // learn is the filled one
      expect(learnQuiet).toBe(reviewQuiet) // neither: both soft, the same
      expect(reviewWhenReview).toBe(learnWhenLearn) // the filled colour is the same whichever tile has it
      expect(learnWhenReview).not.toBe(reviewWhenReview) // Learn is the soft teal when Review is advised (and Review is the disabled grey when Learn is: nothing is due)
    }, 60_000)
  })
})
