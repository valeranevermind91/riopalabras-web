import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type HTTPRequest, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { UNDO_WINDOW_MS } from '../data/learn'

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
    const page = await (await browser.createBrowserContext()).newPage() // its own context: what one test stores (the language) is not there for the next
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
          // everything written so far (the first cards are counted as they are reached, not at the end) has gone through before the network drops, or how many rows are held after it would depend on timing
          await page.waitForFunction(() => (window as never as { __queue: { getStatus: () => { pendingHidden: number; unsaved: boolean } } }).__queue.getStatus().unsaved === false, { timeout: 5000 })
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

        // what was learned since the network went is held by the queue, nothing was lost. Cards are counted as they are reached, so with the network gone from the start that is
        // the ten words of the batch plus the one that was put back when it was marked as known; when it dropped after the first two cards, the eight reached after that.
        const held = await pending(page)
        const learnedRows = (held.progress as { repetitions: number }[]).filter((u) => u.repetitions > 0)
        const putBack = (held.progress as { repetitions: number }[]).filter((u) => u.repetitions === 0)
        expect(learnedRows).toHaveLength(startsUp ? 8 : 10)
        expect(putBack).toHaveLength(startsUp ? 0 : 1)
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

  describe('Again in Review', () => {
    const counter = (page: Page) => page.$eval('.review-count', (e) => e.textContent ?? '')
    const headword = (page: Page) => page.$eval('.flip-front .wc-headword', (e) => e.textContent ?? '')
    /** Reveals the card and rates it; resolves once the next card (or the end) is on screen. */
    async function rate(page: Page, tone: 'again' | 'hard' | 'good' | 'easy') {
      const before = await counter(page)
      await page.click('.flip')
      await page.waitForSelector(`.rating:not(.is-hidden) .rate-${tone}`)
      await page.click(`.rate-${tone}`)
      await page.waitForFunction((b) => !document.querySelector('.review-count') || document.querySelector('.review-count')!.textContent !== b, { timeout: 10_000 }, before)
    }
    /** The state the queue holds for a word, as the rating wrote it (nextReview as a timestamp: a Date does not cross from the page). */
    const progressOf = (page: Page, word: string) =>
      page.evaluate((w) => {
        const rows = (window as never as { __queue: { pending: () => { progress: { esWord: string; interval: number; repetitions: number; easeFactor: number; nextReview: Date }[] } } }).__queue.pending().progress
        const row = rows.find((p) => p.esWord === w)!
        return { interval: row.interval, repetitions: row.repetitions, easeFactor: row.easeFactor, nextReview: row.nextReview.getTime() }
      }, word)

    it('the button says Soon, and the word comes back at the end of the same session once; a second Again lets it leave, its ten minutes already set', async () => {
      const { page } = await open('review', false) // the network is down: every write waits in the queue, where it can be read
      await page.waitForSelector('.flip')
      expect(await page.$$eval('.rate-btn .rate-interval', (els) => els.map((e) => e.textContent))).toEqual(['Soon', '4d', '8d', '10d']) // the others preview from interval 3, ease 2.5
      expect(await counter(page)).toBe('1 / 6')
      const word = await headword(page)

      await rate(page, 'again')
      expect(await counter(page)).toBe('2 / 7') // the session is one card longer: the word is queued behind the rest
      const first = await progressOf(page, word)
      expect(first).toMatchObject({ interval: 0, repetitions: 1 })
      expect(first.easeFactor).toBeCloseTo(2.18, 10)
      const wait = first.nextReview - Date.now()
      expect(wait).toBeGreaterThan(9 * 60 * 1000)
      expect(wait).toBeLessThanOrEqual(10 * 60 * 1000)

      for (let i = 0; i < 5; i++) {
        expect(await headword(page)).not.toBe(word) // the other five come first
        await rate(page, 'good')
      }
      expect(await counter(page)).toBe('7 / 7')
      expect(await headword(page)).toBe(word) // and then it is back, last

      // this time its buttons preview from repetitions 1 at the lowered ease
      await page.click('.flip')
      await page.waitForSelector('.rating:not(.is-hidden) .rate-again')
      expect(await page.$$eval('.rate-btn .rate-interval', (els) => els.map((e) => e.textContent))).toEqual(['Soon', '1d', '2d', '3d'])

      await page.click('.rate-again') // Again a second time: it leaves the session (a word returns once), and the session is over
      await page.waitForSelector('.post-batch')
      expect(await page.$('.review-count')).toBeNull() // no 8 / 8
      const second = await progressOf(page, word)
      expect(second).toMatchObject({ interval: 0, repetitions: 1 }) // still relearning, not forgotten: it was scheduled again
      expect(second.easeFactor).toBeLessThan(first.easeFactor) // and the ease kept dropping from the lowered value, not from the snapshot's 2.5
      expect(second.easeFactor).toBeCloseTo(1.86, 2) // 2.5 → 2.18 → 1.86
      const wait2 = second.nextReview - Date.now()
      expect(wait2).toBeGreaterThan(9 * 60 * 1000) // its ten minutes, so it comes back on its own in a later session
      expect(wait2).toBeLessThanOrEqual(10 * 60 * 1000)
      await page.close()
    }, 60_000)

    for (const [language, again, labels] of [
      ['English', 'Again', ['Soon', '4d', '8d', '10d']],
      ['Russian', 'Снова', ['Скоро', '4 д', '8 д', '10 д']],
    ] as const) {
      it(`${language}, 320px: the four buttons show ${labels[0]} · ${labels[1]} · ${labels[2]} · ${labels[3]}, each fits its button and none repeats another`, async () => {
        const { page } = await open('review', false)
        await page.waitForSelector('.flip')
        await page.setViewport({ width: 320, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
        if (language === 'Russian') {
          await page.evaluate(() => localStorage.setItem('riopalabras.language.v1', 'ru'))
          await page.reload({ waitUntil: 'networkidle0' })
          await page.waitForSelector('.flip')
        }
        await page.click('.flip')
        await page.waitForSelector('.rating:not(.is-hidden) .rate-again')
        const look = await page.$$eval('.rate-btn', (buttons) =>
          buttons.map((b) => {
            const box = b.getBoundingClientRect()
            const label = b.querySelector('.rate-label') as HTMLElement
            const interval = b.querySelector('.rate-interval') as HTMLElement
            return { label: label.textContent, interval: interval.textContent, left: box.left, right: box.right, labelFits: label.scrollWidth <= label.clientWidth, intervalFits: interval.scrollWidth <= interval.clientWidth, intervalHeight: interval.getBoundingClientRect().height, page: document.documentElement.scrollWidth <= window.innerWidth }
          }),
        )
        expect(look.map((b) => b.interval)).toEqual(labels)
        expect(look[0].label).toBe(again)
        expect(new Set(look.map((b) => b.interval)).size).toBe(4) // "Soon" repeats no other button's number
        expect(new Set([...look.map((b) => b.label), ...look.map((b) => b.interval)]).size).toBe(8) // and no interval reads like a button's name
        for (const b of look) {
          expect(b.labelFits && b.intervalFits).toBe(true)
          expect(b.left).toBeGreaterThanOrEqual(0)
          expect(b.right).toBeLessThanOrEqual(320)
          expect(b.page).toBe(true)
          expect(b.intervalHeight).toBeLessThan(24) // one line
        }
        await page.close()
      }, 60_000)
    }

    it('the Russian label says Скоро', async () => {
      const { page } = await open('review', false)
      await page.waitForSelector('.flip')
      await page.evaluate(() => localStorage.setItem('riopalabras.language.v1', 'ru'))
      await page.reload({ waitUntil: 'networkidle0' })
      await page.waitForSelector('.flip')
      expect((await page.$$eval('.rate-btn .rate-interval', (els) => els.map((e) => e.textContent)))[0]).toBe('Скоро')
      await page.close()
    }, 60_000)
  })
  describe('the Undo after "Already know it" in Learn', () => {
    const bar = (page: Page) => page.$('.learn-undo')
    const headword = (page: Page) => page.$eval('.swipe-layer .wc-headword', (e) => e.textContent ?? '')
    const markKnown = async (page: Page) => {
      await page.click('.known-btn')
      await page.waitForSelector('.learn-undo')
    }
    const gone = (page: Page, timeout = 3000) => page.waitForFunction(() => !document.querySelector('.learn-undo'), { timeout })

    it('is offered at once, and goes the moment the user moves to another card', async () => {
      const { page } = await open('learn', true)
      await page.waitForSelector('.swipe-layer .wc-headword')
      expect(await bar(page)).toBeNull()
      await markKnown(page)
      expect(await text(page, '.learn-undo')).toContain('Undo')
      await page.click('.learn-nav .btn-icon:last-child') // next card
      await gone(page)
      await page.close()
    }, 60_000)

    it('goes by itself after a few seconds, and is still there just before', async () => {
      const { page } = await open('learn', true)
      await page.waitForSelector('.swipe-layer .wc-headword')
      await markKnown(page)
      await new Promise((resolve) => setTimeout(resolve, UNDO_WINDOW_MS - 1500))
      expect(await bar(page)).not.toBeNull() // still inside the window
      await gone(page, 4000) // and gone after it
      expect(UNDO_WINDOW_MS).toBeGreaterThanOrEqual(3000)
      expect(UNDO_WINDOW_MS).toBeLessThanOrEqual(8000) // "a few seconds"
      await page.close()
    }, 60_000)

    it('Undo inside the window brings the word back, and then the bar is gone', async () => {
      const { page } = await open('learn', true)
      await page.waitForSelector('.swipe-layer .wc-headword')
      const before = await headword(page)
      await markKnown(page)
      expect(await headword(page)).not.toBe(before) // the next candidate took its place
      await page.click('.learn-undo .link-btn')
      await gone(page)
      expect(await headword(page)).toBe(before)
      await page.close()
    }, 60_000)

    it('each new mark restarts the window and offers Undo for that mark only: after undoing the latest, the one before is not offered', async () => {
      const { page } = await open('learn', true)
      await page.waitForSelector('.swipe-layer .wc-headword')
      await markKnown(page)
      await new Promise((resolve) => setTimeout(resolve, UNDO_WINDOW_MS - 1500))
      await page.click('.known-btn') // a second mark, 3.5 s into the first one's window
      await new Promise((resolve) => setTimeout(resolve, 2500)) // past where the first window would have ended
      expect(await bar(page)).not.toBeNull() // the second mark has its own full window
      await page.click('.learn-undo .link-btn')
      await gone(page)
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(await bar(page)).toBeNull() // the first mark is not offered again
      await page.close()
    }, 60_000)

    it('is not there after the batch is finished', async () => {
      const { page } = await open('learn', true)
      await page.waitForSelector('.swipe-layer .wc-headword')
      await markKnown(page)
      for (let i = 0; i < 9; i++) await page.click('.learn-nav .btn-icon:last-child')
      await page.click('.learn-finish .btn-primary')
      await page.waitForSelector('.post-batch')
      expect(await bar(page)).toBeNull()
      await page.close()
    }, 60_000)
  })
})
