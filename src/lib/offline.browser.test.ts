import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type HTTPRequest, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * The app with the network gone, in a real browser: the real Learn and Review screens, the real write queue and the
 * real supabase-js client (see src/testing/offlineHarness.tsx). The rule under test: no user action waits on the network.
 * Learning and reviewing run from memory, writes wait in the queue and are sent when they can be; the only sign of being
 * offline is the unsaved-progress banner. Needs a Chrome or Chromium; without one these tests are skipped (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

const API = 'https://fake.supabase.test'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
/** Blocked or slow is the test's whole point: a user action must finish well inside this, whatever the network does. */
const INSTANT_MS = 1500

describe.skipIf(!CHROME)('with the network gone', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5189, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  /** `net.up` is the network: while it is true the fake server accepts every write, once it is false nothing gets through. */
  async function open(screen: 'learn' | 'review', up: boolean) {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 700, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    const net = { up }
    await page.setRequestInterception(true)
    page.on('request', (req: HTTPRequest) => {
      if (!req.url().startsWith(API)) return void req.continue()
      if (!net.up) return void req.abort('internetdisconnected')
      if (req.method() === 'OPTIONS') return void req.respond({ status: 204, headers: CORS })
      return void req.respond({ status: 201, headers: { ...CORS, 'content-type': 'application/json' }, body: '[]' })
    })
    await page.goto(`${base}/src/testing/offlineHarness.html?screen=${screen}`, { waitUntil: 'networkidle0' })
    return { page, net }
  }

  const queueStatus = (page: Page) => page.evaluate(() => (window as never as { __queue: { getStatus: () => Record<string, unknown> } }).__queue.getStatus())
  const pending = (page: Page) => page.evaluate(() => (window as never as { __queue: { pending: () => { progress: unknown[]; settings: unknown; hidden: unknown[] } } }).__queue.pending())
  const text = (page: Page, selector: string) => page.$eval(selector, (e) => e.textContent ?? '')

  /** Clicks and returns how long the page took to show `then`: an action that waits on the network shows up here. */
  async function act(page: Page, click: string, then: string) {
    const started = Date.now()
    await page.click(click)
    await page.waitForSelector(then, { timeout: 10_000 })
    return Date.now() - started
  }

  async function readThroughBatch(page: Page) {
    for (let i = 0; i < 9; i++) await act(page, '.learn-nav .btn-icon:last-child', '.learn-progress span')
  }

  for (const [label, startsUp] of [
    ['off from the start', false],
    ['dropping in the middle of the session', true],
  ] as const) {
    describe(label, () => {
      it('Learn: a whole batch can be read, marked as known and finished, and the next batch starts, without waiting', async () => {
        const { page, net } = await open('learn', startsUp)
        await page.waitForSelector('.swipe-layer .wc-headword')
        await act(page, '.learn-nav .btn-icon:last-child', '.learn-progress span')
        await act(page, '.known-btn', '.learn-undo') // "already know it" is a queued write too
        if (startsUp) {
          await page.waitForFunction(() => (window as never as { __queue: { getStatus: () => { pendingHidden: number } } }).__queue.getStatus().pendingHidden === 0, { timeout: 5000 })
          net.up = false // the network drops here
        }
        await readThroughBatch(page)
        expect(await text(page, '.learn-progress span')).toBe('Word 10 of 10')

        const finished = await act(page, '.learn-finish .btn-primary', '.post-batch')
        expect(finished).toBeLessThan(INSTANT_MS)
        const buttons = await page.$$eval('.post-batch-actions button', (els) => els.map((e) => ({ text: e.textContent, disabled: (e as HTMLButtonElement).disabled })))
        expect(buttons.length).toBeGreaterThan(0)
        expect(buttons.every((b) => !b.disabled)).toBe(true)
        expect(buttons[0].text).toMatch(/next batch/i)

        // the batch is held by the queue, nothing was lost
        const held = await pending(page)
        expect(held.progress).toHaveLength(10)
        expect(held.settings).not.toBeNull()
        expect((await queueStatus(page)).unsaved).toBe(true)

        // and the next batch starts at once from what is in memory
        expect(await act(page, '.post-batch-actions .btn-primary', '.swipe-layer .wc-headword')).toBeLessThan(INSTANT_MS)
        await page.close()
      }, 60_000)

      it('Review: several ratings and the end of the session never wait, and the end offers the way out at once', async () => {
        const { page, net } = await open('review', startsUp)
        await page.waitForSelector('.flip')
        const times: number[] = []
        for (let i = 0; i < 6; i++) {
          if (startsUp && i === 2) net.up = false // the network drops after two ratings
          times.push(await act(page, '.flip', '.rate-good'))
          const next = i < 5 ? '.flip:not(.is-flipped)' : '.post-batch'
          const started = Date.now()
          await page.click('.rate-good')
          await page.waitForSelector(next, { timeout: 10_000 })
          times.push(Date.now() - started)
        }
        for (const t of times) expect(t).toBeLessThan(INSTANT_MS)

        const buttons = await page.$$eval('.post-batch-actions button', (els) => els.map((e) => ({ text: e.textContent, disabled: (e as HTMLButtonElement).disabled })))
        expect(buttons.length).toBeGreaterThan(0)
        expect(buttons.every((b) => !b.disabled)).toBe(true)
        expect(await text(page, '.post-batch h2')).not.toMatch(/saving/i)

        const held = await pending(page)
        expect(held.progress.length).toBeGreaterThanOrEqual(startsUp ? 4 : 6) // the first two may have been sent before the drop
        await page.close()
      }, 60_000)
    })
  }
})
