import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * The swipe, driven the way a phone drives it: real touch input through the browser's own input pipeline
 * (Chrome DevTools Input.dispatchTouchEvent), not synthetic pointer events. That matters: touch-action,
 * scroll containers and "the browser claims the gesture" only exist on this path. A swipe that passed with
 * synthetic pointer events shipped broken: the card (a scroll container) reset touch-action to `auto`, Chrome
 * took the gesture for a pan after two moves and sent pointercancel, and the card never advanced.
 *
 * Needs a Chrome or Chromium; without one these tests are skipped (set CHROME_PATH to point at it).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('swiping Learn with real touch input', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5179, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(options: string): Promise<Page> {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 700, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/swipeHarness.html?${options}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.swipe-layer .wc-headword')
    await new Promise((r) => setTimeout(r, 500)) // let the card's entrance animation finish
    return page
  }

  const headword = (page: Page) => page.$eval('.swipe-layer .wc-headword', (e) => e.textContent ?? '')
  const events = (page: Page) => page.evaluate(() => (window as never as { __log: Record<string, number> }).__log)

  /** One finger drag: down, `steps` moves of (dx, dy) each, up. */
  async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, steps = 14, delay = 16) {
    await page.touchscreen.touchStart(from.x, from.y)
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, delay))
      await page.touchscreen.touchMove(from.x + (dx * i) / steps, from.y + (dy * i) / steps)
    }
    await page.touchscreen.touchEnd()
    await new Promise((r) => setTimeout(r, 550)) // the leaving card and the arriving one finish
  }

  async function cardCentre(page: Page) {
    return page.$eval('.swipe-layer .word-card', (e) => {
      const r = e.getBoundingClientRect()
      return { x: r.x + r.width * 0.8, y: r.y + r.height * 0.5 }
    })
  }

  const variants: [string, string][] = [
    ['a short card', ''],
    ['a long card that scrolls inside itself', 'long=1'],
    ['a short card inside another scrollable container', 'wrap=1'],
    ['a long card inside another scrollable container', 'long=1&wrap=1'],
  ]

  describe.each(variants)('%s', (_label, options) => {
    it('a swipe to the left advances to the next card and the browser never cancels it', async () => {
      const page = await open(options)
      const before = await headword(page)
      expect(before).toMatch(/^palabra\d\d$/)
      await drag(page, await cardCentre(page), -160, 0)

      const log = await events(page)
      expect(log.pointercancel ?? 0, JSON.stringify(log)).toBe(0)
      expect(log.touchcancel ?? 0).toBe(0)
      expect(log.pointermove, JSON.stringify(log)).toBeGreaterThanOrEqual(10) // the whole drag reached the handlers, not "two moves and gone"
      expect(log.pointerup).toBe(1)
      expect(await headword(page)).not.toBe(before)
      expect(await page.$eval('.learn-progress span', (e) => e.textContent)).toBe('Word 2 of 10')
      await page.close()
    }, 30_000)
  })

  describe('the other gestures, on the hardest layout: a long card inside another scrollable container', () => {
    const options = 'long=1&wrap=1'

    it('a swipe to the right goes back to the previous card', async () => {
      const page = await open(options)
      const first = await headword(page)
      await drag(page, await cardCentre(page), -160, 0)
      await drag(page, await cardCentre(page), 160, 0)
      const log = await events(page)
      expect(log.pointercancel ?? 0, JSON.stringify(log)).toBe(0)
      expect(await headword(page)).toBe(first)
      await page.close()
    }, 30_000)

    it('a short, slow drag is not a swipe: it springs back (and is not cancelled either)', async () => {
      const page = await open(options)
      const before = await headword(page)
      await drag(page, await cardCentre(page), -30, 0, 10, 30)
      const log = await events(page)
      expect(log.pointercancel ?? 0).toBe(0)
      expect(await headword(page)).toBe(before)
      expect(await page.$eval('.swipe-layer', (e) => getComputedStyle(e).transform)).toBe('none') // back in place
      await page.close()
    }, 30_000)

    it('a quick flick commits from a short distance', async () => {
      const page = await open(options)
      const before = await headword(page)
      await drag(page, await cardCentre(page), -70, 0, 4, 8)
      expect(await headword(page)).not.toBe(before)
      await page.close()
    }, 30_000)
  })

  it('a vertical drag in a long card scrolls the card and is not a swipe', async () => {
    const page = await open('long=1')
    const before = await headword(page)
    expect(await page.$eval('.swipe-layer .word-card', (e) => e.scrollHeight > e.clientHeight)).toBe(true) // it does scroll
    await drag(page, await cardCentre(page), 0, -200)
    expect(await page.$eval('.swipe-layer .word-card', (e) => e.scrollTop)).toBeGreaterThan(40)
    expect(await headword(page)).toBe(before)
    await page.close()
  }, 30_000)

  it('the swipe area and everything in it keep touch-action pan-y, including the scroll container', async () => {
    const page = await open('long=1&wrap=1')
    const chain = await page.evaluate(() => {
      const out: string[] = []
      for (const el of document.querySelectorAll('.swipe-area, .swipe-area *')) if (getComputedStyle(el).touchAction !== 'pan-y') out.push(`${el.tagName}.${el.className}`)
      return out
    })
    expect(chain).toEqual([])
    await page.close()
  }, 30_000)

  it('control: with the old styling (descendants back to touch-action: auto) the same swipe is cancelled and never advances — the test sees the real failure', async () => {
    const page = await open('long=1&raw=1')
    const before = await headword(page)
    await drag(page, await cardCentre(page), -160, 0)
    const log = await events(page)
    expect(log.pointercancel, JSON.stringify(log)).toBeGreaterThanOrEqual(1)
    expect(log.pointermove).toBeLessThan(10)
    expect(await headword(page)).toBe(before)
    await page.close()
  }, 30_000)
})
