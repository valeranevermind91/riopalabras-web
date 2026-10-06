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

  interface Frame {
    t: number
    ghost: number | null
    card: number
  }

  /**
   * Records, every animation frame, the left edge of the card that is leaving (if any) and of the one in front.
   * Start it before the finger lifts; read it back with `frames`.
   */
  const startRecording = (page: Page) =>
    page.evaluate(() => {
      const w = window as never as { __frames: unknown[]; __rec: boolean }
      w.__frames = []
      w.__rec = true
      const t0 = performance.now()
      const tick = () => {
        const ghost = document.querySelector('.swipe-ghost .word-card')
        const card = document.querySelector('.swipe-layer .word-card')
        if (card) w.__frames.push({ t: performance.now() - t0, ghost: ghost ? ghost.getBoundingClientRect().left : null, card: card.getBoundingClientRect().left })
        if (w.__rec) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  const frames = (page: Page) => page.evaluate(() => ((window as never as { __frames: Frame[] }).__frames))

  /** A swipe of `dx` with the frames recorded around the release; returns the frames and the width of the swipe area. */
  async function swipeRecorded(page: Page, dx: number) {
    const from = await cardCentre(page)
    const area = await page.$eval('.swipe-area', (e) => e.clientWidth)
    const rest = await page.$eval('.swipe-layer .word-card', (e) => e.getBoundingClientRect().left)
    await startRecording(page)
    await drag(page, from, dx, 0)
    await page.evaluate(() => ((window as never as { __rec: boolean }).__rec = false))
    // Positions as offsets from where a card rests, so 0 means "in its place".
    const offsets = (await frames(page)).map((f) => ({ ...f, card: f.card - rest, ghost: f.ghost === null ? null : f.ghost - rest }))
    return { frames: offsets, area }
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

  describe('the arriving card comes from the edge the old one left by, as one strip', () => {
    // Swipe left: the old card goes off the left edge, the new one slides in from the right. Swipe right: the mirror.
    it.each([
      ['left (next card)', -160, 1],
      ['right (previous card)', 160, -1],
    ] as const)('a swipe to the %s', async (_label, dx, side) => {
      const page = await open('wrap=1')
      if (dx > 0) await drag(page, await cardCentre(page), -160, 0) // be on card 2 so there is a previous one
      const { frames: all, area } = await swipeRecorded(page, dx)
      const together = all.filter((f) => f.ghost !== null)
      expect(together.length, JSON.stringify(all.slice(0, 8))).toBeGreaterThanOrEqual(4)

      // From the very first frame the new card is on the far side (never on the side the old card leaves by)…
      const first = together[0]
      expect(Math.sign(first.card), JSON.stringify(first)).toBe(side)
      expect(Math.abs(first.card)).toBeGreaterThan(area * 0.5)
      // …it travels towards the middle, never away from it, and arrives at rest…
      for (let i = 1; i < together.length; i++) expect(Math.abs(together[i].card)).toBeLessThanOrEqual(Math.abs(together[i - 1].card) + 1)
      expect(Math.abs(all[all.length - 1].card)).toBeLessThan(2)
      // …and it stays one strip with the old card: a constant gap of one screen (plus the gutter), on the right side.
      for (const f of together) expect((f.card - (f.ghost as number)) * side, JSON.stringify(f)).toBeGreaterThan(area - 12)
      const gaps = together.map((f) => (f.card - (f.ghost as number)) * side)
      expect(Math.max(...gaps) - Math.min(...gaps), JSON.stringify(gaps)).toBeLessThan(14)
      await page.close()
    }, 30_000)
    it('with reduced motion nothing travels: the old card fades in place and the new one fades in, both at rest', async () => {
      const page = await open('wrap=1')
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
      const before = await headword(page)
      const { frames: all } = await swipeRecorded(page, -160)
      const together = all.filter((f) => f.ghost !== null)
      expect(together.length, JSON.stringify(all.slice(0, 8))).toBeGreaterThanOrEqual(2)
      for (const f of together) {
        expect(Math.abs(f.card), JSON.stringify(f)).toBeLessThan(2) // the new card is in its place from the first frame
        expect(Math.abs(f.ghost as number), JSON.stringify(f)).toBeLessThan(2) // and the old one never moves
      }
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
