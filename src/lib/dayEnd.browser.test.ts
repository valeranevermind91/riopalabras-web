import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * Home at the end of the day, in a real browser (src/testing/settingsHarness.tsx, `endofday=N`: N of the learned words are today's, the allowance is spent, and window.__taps
 * records which Home handler each tile calls). Once the day's new words are done, Home says what was done and what comes next, Matching is the one filled tile, and it and
 * Cloze open on today's words (the `...Today` handlers) when there are enough of them; Learn and Review stay disabled, because nothing is due and the goal is spent. On any
 * other day the tiles open the usual practice. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('Home at the end of the day, in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5272, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(query: string) {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/settingsHarness.html?ready=1&lang=en&${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.home-advice')
    return page
  }
  const advice = (page: Page) => page.$eval('.home-advice', (e) => e.textContent)
  const primaries = (page: Page) => page.$$eval('[data-tile]', (els) => els.filter((e) => e.classList.contains('is-primary')).map((e) => e.getAttribute('data-tile')))
  const disabled = (page: Page) => page.$$eval('[data-tile]', (els) => els.filter((e) => (e as HTMLButtonElement).disabled).map((e) => e.getAttribute('data-tile')))
  const taps = (page: Page) => page.evaluate(() => (window as never as { __taps: string[] }).__taps)
  const press = async (page: Page, id: string) => {
    await page.click(`[data-tile="${id}"]`)
  }

  it('says what was done and what comes next, makes Matching the one filled tile, and leaves Learn and Review disabled', async () => {
    const page = await open('endofday=8&goal=10')
    expect(await advice(page)).toBe('Today: 10 new words. Tomorrow: 8 reviews and 10 new. Today\'s words are ready to practise.')
    expect(await primaries(page)).toEqual(['matching'])
    expect(await disabled(page)).toEqual(['learn', 'review'])
    await page.close()
  }, 60_000)

  it('Matching and Cloze open on today\'s words; the disabled Learn and Review do nothing', async () => {
    const page = await open('endofday=8&goal=10')
    await press(page, 'matching')
    await press(page, 'cloze')
    await press(page, 'learn')
    await press(page, 'review')
    expect(await taps(page)).toEqual(['matching-today', 'cloze-today'])
    await page.close()
  }, 60_000)

  it('with fewer than five of today\'s words the tiles open the usual practice, not a round too small to run', async () => {
    const page = await open('endofday=3&goal=10')
    expect(await advice(page)).toBe('Today: 10 new words. Tomorrow: 3 reviews and 10 new.') // no pointer to a practice on today\'s words
    expect(await primaries(page)).toEqual(['matching'])
    await press(page, 'matching')
    await press(page, 'cloze')
    expect(await taps(page)).toEqual(['matching', 'cloze'])
    await page.close()
  }, 60_000)

  it('part-way through the day (the allowance not yet spent) Learn is what is advised, and the practice tiles open the usual practice, not today\'s words', async () => {
    const page = await open('endofday=8&goal=18&todaycount=8')
    expect(await advice(page)).toMatch(/^Nothing to review/)
    expect(await primaries(page)).toEqual(['learn'])
    await press(page, 'matching')
    await press(page, 'cloze')
    expect(await taps(page)).toEqual(['matching', 'cloze'])
    await page.close()
  }, 60_000)

  // The other advice lines may wrap to two lines at 320px and never more (review.browser.test.ts). This one says more (what was done, what comes, and where to practise) and takes three,
  // in English and in Russian, at the narrowest width; at 390px it is two.
  it('the longest form of the line, at 320px, in both languages: it fits the card and takes no more than three lines', async () => {
    for (const lang of ['en', 'ru']) {
      const page = await open(`endofday=8&goal=10&lang=${lang}`)
      await page.setViewport({ width: 320, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
      const seen = await page.evaluate(() => {
        const line = document.querySelector('.home-advice') as HTMLElement
        const style = getComputedStyle(line)
        const rect = line.getBoundingClientRect()
        const text = (rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 2 * parseFloat(style.borderTopWidth)) / parseFloat(style.lineHeight)
        return { text: line.textContent, lines: Math.round(text), overflows: line.scrollWidth > line.clientWidth, right: Math.round(rect.right), pageScrolls: document.documentElement.scrollWidth > window.innerWidth }
      })
      expect(seen.overflows).toBe(false)
      expect(seen.pageScrolls).toBe(false)
      expect(seen.right).toBeLessThanOrEqual(320)
      expect(seen.lines).toBeLessThanOrEqual(3)
      await page.close()
    }
  }, 60_000)

  it('on an ordinary day nothing changes: reviews first, and the tiles open the usual practice', async () => {
    const page = await open('goal=10')
    expect(await advice(page)).toMatch(/^Review first/)
    expect(await primaries(page)).toEqual(['review'])
    await press(page, 'matching')
    await press(page, 'cloze')
    expect(await taps(page)).toEqual(['matching', 'cloze'])
    await page.close()
  }, 60_000)
})
