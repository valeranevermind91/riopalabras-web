import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { parseDictionary } from '../data/dictionary'
import { parseFallbackExamples, parseRioOverlay } from '../data/rio'
import { parseSettings } from '../data/settings'
import { wordOfTheDay } from '../data/wordOfDay'

/**
 * Home takes the date again when the app returns to the foreground, in a real browser (src/testing/reviewHarness.tsx with the real dictionary and
 * overlay, so the word of the day shows). A Mini App is often left open in the background overnight; nothing used to re-read the date, so Home kept
 * yesterday's word. The page runs on a clock the test moves (a Date that can be set a day ahead), in the time zone these tests use everywhere
 * (America/Montevideo), so the word it shows can be compared with what the code picks for that day. Needs a Chrome or Chromium; skipped without one.
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

const words = parseDictionary(
  JSON.parse(readFileSync('public/words_enriched.json', 'utf8')),
  parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))),
  parseFallbackExamples(JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))),
)
const DAY = 86_400_000
const wordOn = (date: Date) => wordOfTheDay(words, parseSettings({}), date)!.headword

// A page's clock: `new Date()` and Date.now() are the real time plus an offset the test sets.
const CLOCK = `(() => {
  const Real = Date
  const clock = { offset: 0 }
  window.__clock = clock
  class Fake extends Real {
    constructor(...args) { if (args.length === 0) super(Real.now() + clock.offset); else super(...args) }
    static now() { return Real.now() + clock.offset }
  }
  window.Date = Fake
})()`

// A Telegram that can re-activate the Mini App: the page registers a listener, the test calls it.
const TELEGRAM = `window.Telegram = { WebApp: { initData: 'test', initDataUnsafe: { user: { id: 1, first_name: 'T' } }, colorScheme: 'light', themeParams: {}, version: '8.0',
  isVersionAtLeast: () => true, ready() {}, expand() {}, onEvent(name, cb) { (window.__telegramEvents ||= {})[name] = cb }, offEvent() {}, HapticFeedback: undefined } }`

describe.skipIf(!CHROME)('Home when the app returns to the foreground', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5216, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(extraScript = '') {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateTimezone('America/Montevideo')
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.evaluateOnNewDocument(CLOCK)
    if (extraScript) await page.evaluateOnNewDocument(extraScript)
    await page.goto(`${base}/src/testing/reviewHarness.html?real=1&due=12`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.wotd-word')
    return page
  }
  const shownWord = (page: Page) => page.$eval('.wotd-word', (e) => e.textContent)
  const goForward = (page: Page, ms: number) => page.evaluate((n) => ((window as never as { __clock: { offset: number } }).__clock.offset += n), ms)
  const returnToForeground = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  const setVisibility = (page: Page, state: 'visible' | 'hidden') => page.evaluate((s) => Object.defineProperty(document, 'visibilityState', { get: () => s, configurable: true }), state)
  const settle = (page: Page) => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)))

  it('shows the new day\'s word when the page becomes visible again after midnight, and not before', async () => {
    const page = await open()
    const today = await shownWord(page)
    expect(today).toBe(wordOn(new Date()))

    await goForward(page, DAY) // the app has been left open overnight
    await settle(page)
    expect(await shownWord(page)).toBe(today) // nothing has asked for the date again: this is what was wrong

    await returnToForeground(page) // the user comes back
    await page.waitForFunction((old) => document.querySelector('.wotd-word')?.textContent !== old, {}, today)
    expect(await shownWord(page)).toBe(wordOn(new Date(Date.now() + DAY)))
    expect(await shownWord(page)).not.toBe(today)
    await page.close()
  }, 90_000)

  it('moves on again for each further day, and only when the page is visible: becoming hidden changes nothing', async () => {
    const page = await open()
    const first = await shownWord(page)
    await goForward(page, DAY)
    await setVisibility(page, 'hidden')
    await returnToForeground(page) // a visibilitychange to "hidden" is the app leaving, not coming back
    await settle(page)
    expect(await shownWord(page)).toBe(first)

    await setVisibility(page, 'visible')
    await returnToForeground(page)
    await page.waitForFunction((old) => document.querySelector('.wotd-word')?.textContent !== old, {}, first)
    const second = await shownWord(page)
    expect(second).toBe(wordOn(new Date(Date.now() + DAY)))

    await goForward(page, DAY)
    await returnToForeground(page)
    await page.waitForFunction((old) => document.querySelector('.wotd-word')?.textContent !== old, {}, second)
    expect(await shownWord(page)).toBe(wordOn(new Date(Date.now() + 2 * DAY)))
    await page.close()
  }, 90_000)

  it('the same day, coming back changes nothing: the word stays', async () => {
    const page = await open()
    const today = await shownWord(page)
    for (let i = 0; i < 3; i++) {
      await returnToForeground(page)
      await settle(page)
      expect(await shownWord(page)).toBe(today)
    }
    await page.close()
  }, 60_000)

  it('also moves on when Telegram re-activates the Mini App (the page may never become "hidden" there)', async () => {
    const page = await open(TELEGRAM)
    const today = await shownWord(page)
    expect(await page.evaluate(() => typeof (window as never as { __telegramEvents?: Record<string, unknown> }).__telegramEvents?.activated)).toBe('function')
    await goForward(page, DAY)
    await settle(page)
    expect(await shownWord(page)).toBe(today)
    await page.evaluate(() => (window as never as { __telegramEvents: Record<string, () => void> }).__telegramEvents.activated())
    await page.waitForFunction((old) => document.querySelector('.wotd-word')?.textContent !== old, {}, today)
    expect(await shownWord(page)).toBe(wordOn(new Date(Date.now() + DAY)))
    await page.close()
  }, 90_000)
})
