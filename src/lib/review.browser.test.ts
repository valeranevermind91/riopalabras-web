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
})
