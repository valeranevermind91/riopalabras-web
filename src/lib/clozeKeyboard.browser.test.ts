import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * Cloze with the on-screen keyboard up, in a real browser (src/testing/logHarness.tsx: the real Cloze screen). A real keyboard cannot be raised here, so the
 * test makes the one change the fix reads: a visual viewport that gets shorter while the layout viewport keeps its height, as on a phone that draws the keyboard
 * over the page (window.__setKeyboard(px), after a stand-in for window.visualViewport is installed before the page loads). What it shows is that the page reacts
 * to that change as it should: Check (and then Continue) end above the keyboard, the page has room to scroll for it, and everything goes back when it is gone.
 * It does not prove how iOS or Android behave: that needs a phone. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((path) => path && existsSync(path))

describe.skipIf(!CHROME)('Cloze with the on-screen keyboard up', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5261, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  /** A short phone (an iPhone SE is 375 x 667), with a stand-in visual viewport installed before the app starts. */
  async function open() {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateTimezone('America/Montevideo')
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.evaluateOnNewDocument(() => {
      const listeners: Record<string, Array<() => void>> = {}
      const stand = {
        offsetTop: 0,
        scale: 1,
        get height() {
          return (window as never as { __vvHeight?: number }).__vvHeight ?? window.innerHeight
        },
        addEventListener: (type: string, fn: () => void) => void (listeners[type] ??= []).push(fn),
        removeEventListener: (type: string, fn: () => void) => void (listeners[type] = (listeners[type] ?? []).filter((x) => x !== fn)),
      }
      Object.defineProperty(window, 'visualViewport', { value: stand, configurable: true })
      ;(window as never as { __setKeyboard: (px: number) => void }).__setKeyboard = (px: number) => {
        ;(window as never as { __vvHeight?: number }).__vvHeight = window.innerHeight - px
        for (const fn of listeners.resize ?? []) fn()
      }
    })
    await page.goto(`${base}/src/testing/logHarness.html?screen=cloze&learned=12`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.cz-dock')
    return page
  }
  const keyboard = (page: Page, px: number) => page.evaluate((n) => (window as never as { __setKeyboard: (px: number) => void }).__setKeyboard(n), px)
  const visibleBottom = (page: Page) => page.evaluate(() => window.visualViewport!.height)
  const dockButtonBottom = (page: Page) => page.$eval('.cz-dock > .btn-primary', (e) => e.getBoundingClientRect().bottom)
  const inset = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--keyboard-inset'))
  const settled = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  it('without a keyboard nothing changes: no inset, and the page is no taller than it was', async () => {
    const page = await open()
    expect(await inset(page)).toBe('0px')
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    expect(height).toBeLessThanOrEqual(667 + 1) // the Cloze page fits a short phone as it always did
    await page.close()
  })

  it('with the keyboard up, Check ends above it (it would be behind it otherwise), and the page has the room to scroll for that', async () => {
    const page = await open()
    // the premise: on this screen the keyboard WOULD cover Check, or the test proves nothing
    expect(await dockButtonBottom(page)).toBeGreaterThan(667 - 320)
    await keyboard(page, 320)
    await settled(page)
    expect(await inset(page)).toBe('320px')
    expect(await dockButtonBottom(page)).toBeLessThanOrEqual(await visibleBottom(page))
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0) // it scrolled to get there
    await page.close()
  })

  it('every control of the dock is in the part that can be seen, not only the primary button', async () => {
    const page = await open()
    await keyboard(page, 320)
    await settled(page)
    const bottom = await visibleBottom(page)
    const tops = await page.$$eval('.cz-input, .cz-secondary .btn, .cz-dock > .btn-primary', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom })))
    expect(tops).toHaveLength(4) // the field, Hint, Reveal, Check
    for (const rect of tops) {
      expect(rect.top).toBeGreaterThanOrEqual(0)
      expect(rect.bottom).toBeLessThanOrEqual(bottom)
    }
    await page.close()
  })

  it('on the next question, with the keyboard still up, Continue and then the next Check are above it too', async () => {
    const page = await open()
    await keyboard(page, 320)
    await settled(page)
    await page.type('.cz-input', 'zzzz')
    await page.click('.cz-dock > .btn-primary') // Check
    await page.waitForSelector('.cz-feedback.cz-bad, .cz-feedback.cz-ok, .cz-feedback.cz-neutral')
    expect(await page.$eval('.cz-dock > .btn-primary', (e) => e.textContent)).toBe('Continue')
    expect(await dockButtonBottom(page)).toBeLessThanOrEqual(await visibleBottom(page))
    await page.click('.cz-dock > .btn-primary') // Continue: the next question mounts, the keyboard stays
    await page.waitForFunction(() => document.querySelector('.cz-dock > .btn-primary')?.textContent === 'Check')
    await settled(page)
    expect(await dockButtonBottom(page)).toBeLessThanOrEqual(await visibleBottom(page))
    await page.close()
  })

  it('when the keyboard goes away the inset is 0 again, and when the screen is left it is removed', async () => {
    const page = await open()
    await keyboard(page, 320)
    await settled(page)
    expect(await inset(page)).toBe('320px')
    await keyboard(page, 0)
    await settled(page)
    expect(await inset(page)).toBe('0px')
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.cz-screen')!).paddingBottom)).toBe('40px')
    await page.close()
  })

  it('a difference that is no keyboard (browser chrome) changes nothing', async () => {
    const page = await open()
    await keyboard(page, 60)
    await settled(page)
    expect(await inset(page)).toBe('0px')
    await page.close()
  })
})
