import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { en } from '../strings'
import { ru } from '../strings.ru'
import { closeBrowser, closeServer, launchBrowser } from '../testing/browser'

/**
 * The one-time hints in a real browser (src/testing/hintsHarness.tsx: the real Home, word page, Learn and Settings over the real dictionary): the snackbar after adding a word to
 * the learning queue, the strip on the Learn tile, the bubbles on the word page and on the Word of the day, the tour on Home (each step on its element, through a notice, the practice
 * panel, a scroll and a resize), the first Learn batch, and "Show hints again". At 360×740 and at 320×568, in Russian and English. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

const SIZES = [
  { width: 360, height: 740 },
  { width: 320, height: 568 },
] as const

interface Box {
  top: number
  left: number
  right: number
  bottom: number
}

describe.skipIf(!CHROME)('the one-time hints in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5199, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await launchBrowser(CHROME)
  }, 60_000)

  afterAll(async () => {
    await closeBrowser(browser)
    await closeServer(server)
  })

  async function open(query: string, size: (typeof SIZES)[number] = SIZES[0]) {
    const page = await browser.newPage()
    await page.setViewport({ ...size, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/hintsHarness.html?${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('body[data-ready]')
    await page.evaluate(() => document.fonts.ready)
    return page
  }
  const frames = (page: Page, n = 3) => page.evaluate((count) => new Promise<void>((done) => { let left = count; const step = () => (--left <= 0 ? done() : requestAnimationFrame(step)); requestAnimationFrame(step) }), n)
  const made = (page: Page) => page.evaluate(() => (window as never as { __made: Record<string, unknown>[] }).__made)
  const box = (page: Page, selector: string): Promise<Box | null> =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom }
    }, selector)
  const texts = (page: Page, selector: string) => page.$$eval(selector, (els) => els.map((e) => e.textContent ?? ''))
  const click = (page: Page, selector: string) => page.$eval(selector, (el) => (el as HTMLElement).click())
  const inside = (b: Box, w: number, h: number) => b.left >= 0 && b.top >= 0 && b.right <= w && b.bottom <= h
  const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  const near = (a: Box, b: Box, pad: number, slack = 1.5) => Math.abs(a.top - (b.top - pad)) < slack && Math.abs(a.left - (b.left - pad)) < slack && Math.abs(a.right - (b.right + pad)) < slack && Math.abs(a.bottom - (b.bottom + pad)) < slack

  describe.each(SIZES)('word page, $width×$height', (size) => {
    it('the bubble on the queue button shows on the first visit, once: pointing at the button, inside the screen, not on it, counted as seen', async () => {
      const page = await open('user=returning&screen=word', size)
      await page.waitForSelector('.hint-bubble')
      await frames(page)
      expect(await texts(page, '.hint-bubble p')).toEqual([ru.hints.wordQueue])
      const bubble = (await box(page, '.hint-bubble'))!
      const button = (await box(page, '[data-hint="star"]'))!
      expect(inside(bubble, size.width, size.height)).toBe(true)
      expect(overlaps(bubble, button)).toBe(false)
      expect(inside(button, size.width, size.height)).toBe(true) // the page was scrolled to show the button and the bubble together
      expect(await made(page)).toEqual([{ hints_seen: ['word-queue'] }])
      await page.close()
    })

    it('a tap anywhere closes it and still does what it was for; opened again it is gone', async () => {
      const page = await open('user=returning&screen=word', size)
      await page.waitForSelector('.hint-bubble')
      await page.tap('.screen-header') // anywhere
      await page.waitForFunction(() => document.querySelector('.hint-bubble') === null)
      expect(await made(page)).toHaveLength(1)
      await page.close()
      const again = await open('user=returning&screen=word&seen=word-queue', size)
      await frames(again, 5)
      expect(await box(again, '.hint-bubble')).toBeNull()
      expect(await made(again)).toEqual([])
      await again.close()
    })

    it('a tap on the queue button itself closes the bubble and adds the word', async () => {
      const page = await open('user=returning&screen=word', size)
      await page.waitForSelector('.hint-bubble')
      await page.tap('[data-hint="star"]')
      await page.waitForSelector('.snackbar')
      expect(await box(page, '.hint-bubble')).toBeNull()
      expect((await texts(page, '[data-hint="star"]')).map((t) => t.trim())).toEqual([ru.words.learnSoonerOn])
      await page.close()
    })

    it('no bubble on a word that is already in the queue (there is no button to point at), and none is counted as seen', async () => {
      const page = await open('user=returning&screen=word&wordqueued=1', size)
      await frames(page, 5)
      expect(await box(page, '.hint-bubble')).toBeNull()
      expect(await made(page)).toEqual([])
      await page.close()
    })
  })

  describe.each(SIZES)('the snackbar, $width×$height', (size) => {
    it('after the add: «Добавлено в очередь» with «Открыть Learn», at the foot of the screen, not over the page\'s content for good', async () => {
      const page = await open('user=returning&screen=word&seen=word-queue', size)
      await page.tap('[data-hint="star"]')
      await page.waitForSelector('.snackbar')
      expect(await texts(page, '.snackbar-text')).toEqual([ru.hints.queuedNote])
      expect(await texts(page, '.snackbar-action')).toEqual([ru.hints.openLearn])
      const bar = (await box(page, '.snackbar'))!
      expect(inside(bar, size.width, size.height)).toBe(true)
      expect(bar.bottom).toBeGreaterThan(size.height - 24)
      expect(overlaps(bar, (await box(page, '[data-hint="star"]'))!), 'the bar does not cover the button just pressed').toBe(false)
      await page.close()
    })

    it('goes by itself after about five seconds, not before', async () => {
      const page = await open('user=returning&screen=word&seen=word-queue', size)
      await page.tap('[data-hint="star"]')
      await page.waitForSelector('.snackbar')
      await new Promise((r) => setTimeout(r, 4200))
      expect(await box(page, '.snackbar')).not.toBeNull()
      await page.waitForFunction(() => document.querySelector('.snackbar') === null, { timeout: 3000 })
      await page.close()
    })

    it('the action opens Learn', async () => {
      const page = await open('user=returning&screen=word&seen=word-queue', size)
      await page.tap('[data-hint="star"]')
      await page.waitForSelector('.snackbar-action')
      await page.tap('.snackbar-action')
      await page.waitForFunction(() => (window as never as { __screen: () => string }).__screen() === 'learn')
      await page.close()
    })

    it('taking the word out of the queue again shows nothing, and a second add shows it again', async () => {
      const page = await open('user=returning&screen=word&seen=word-queue', size)
      await page.tap('[data-hint="star"]')
      await page.waitForSelector('.snackbar')
      await page.tap('[data-hint="star"]') // off
      await page.waitForFunction(() => document.querySelector('.snackbar') === null)
      await page.tap('[data-hint="star"]') // on again
      await page.waitForSelector('.snackbar')
      await page.close()
    })
  })

  describe.each(SIZES)('the Learn tile, $width×$height', (size) => {
    it('says «в очереди: N» when N words wait, on one line inside the tile', async () => {
      const page = await open('user=returning&stars=3&seen=tour,home-wotd', size)
      expect(await texts(page, '.tile-learn .tile-queued')).toEqual([ru.hints.queuedTile(3)])
      const strip = await page.$eval('.tile-learn .tile-queued', (el) => ({ scroll: el.scrollWidth, client: el.clientWidth, height: el.getBoundingClientRect().height }))
      expect(strip.scroll).toBeLessThanOrEqual(strip.client)
      expect(strip.height).toBeLessThan(26) // one line
      await page.close()
    })

    it('says nothing when none wait', async () => {
      const page = await open('user=returning&seen=tour,home-wotd', size)
      expect(await box(page, '.tile-queued')).toBeNull()
      await page.close()
    })
  })

  describe.each(SIZES)('Home, the bubble on the Word of the day, $width×$height', (size) => {
    it('a person who already learns gets it, once, on the row: inside the screen, counted as seen, and no tour', async () => {
      const page = await open('user=returning', size)
      await page.waitForSelector('.hint-bubble')
      await frames(page)
      expect(await texts(page, '.hint-bubble p')).toEqual([ru.hints.homeWotd])
      expect(await box(page, '.tour-card')).toBeNull()
      const bubble = (await box(page, '.hint-bubble'))!
      const row = (await box(page, '[data-hint="wotd"]'))!
      expect(inside(bubble, size.width, size.height)).toBe(true)
      expect(overlaps(bubble, row)).toBe(false)
      expect(await made(page)).toEqual([{ hints_seen: ['home-wotd'] }])
      await page.close()
    })

    it('not for one who has seen it, nor for one who has had the tour', async () => {
      for (const seen of ['home-wotd', 'tour']) {
        const page = await open(`user=returning&seen=${seen}`, size)
        await frames(page, 5)
        expect(await box(page, '.hint-bubble')).toBeNull()
        expect(await box(page, '.tour-card')).toBeNull()
        await page.close()
      }
    })

    it('a tap anywhere closes it', async () => {
      const page = await open('user=returning', size)
      await page.waitForSelector('.hint-bubble')
      await page.tap('.home-advice')
      await page.waitForFunction(() => document.querySelector('.hint-bubble') === null)
      await page.close()
    })
  })

  describe.each(SIZES)('Home, the tour, $width×$height', (size) => {
    const STEPS = ['tile-learn', 'tile-review', 'tile-practice', 'words', 'wotd']
    const TITLES = ['learn', 'review', 'practice', 'words', 'wotd'] as const

    it('a new person gets it, once: five steps in order, each lit on its own element with its card beside it, «Пропустить» on every step, «Готово» on the last', async () => {
      const page = await open('user=new', size)
      await page.waitForSelector('.tour-card')
      for (let i = 0; i < STEPS.length; i++) {
        await frames(page)
        const t = ru.hints.tour[TITLES[i]]
        expect(await texts(page, '.tour-card h3')).toEqual([t.title])
        expect(await texts(page, '.tour-card p')).toEqual([t.text])
        expect(await texts(page, '.tour-step')).toEqual([ru.hints.tour.step(i + 1, 5)])
        expect(await texts(page, '.tour-skip')).toEqual([ru.hints.tour.skip])
        expect(await texts(page, '.tour-next')).toEqual([i === STEPS.length - 1 ? ru.hints.tour.done : ru.hints.tour.next])
        const target = (await box(page, `[data-hint="${STEPS[i]}"]`))!
        const spot = (await box(page, '.tour-spot'))!
        const card = (await box(page, '.tour-card'))!
        expect(near(spot, target, 3), `step ${i + 1}: the lit area is the element`).toBe(true)
        expect(inside(card, size.width, size.height), `step ${i + 1}: the card is on screen`).toBe(true)
        expect(overlaps(card, target), `step ${i + 1}: the card does not cover its element`).toBe(false)
        expect(inside(target, size.width, size.height), `step ${i + 1}: the element is on screen`).toBe(true)
        await click(page, '.tour-next')
      }
      await page.waitForFunction(() => document.querySelector('.tour-card') === null)
      expect(await made(page)).toEqual([{ hints_seen: ['tour', 'home-wotd'] }])
      await page.close()
    })

    it('«Пропустить» on any step ends it and counts it as seen, the bubble on the Word of the day with it', async () => {
      for (const at of [0, 2, 4]) {
        const page = await open('user=new', size)
        await page.waitForSelector('.tour-card')
        for (let i = 0; i < at; i++) await click(page, '.tour-next')
        await click(page, '.tour-skip')
        await page.waitForFunction(() => document.querySelector('.tour-card') === null)
        expect(await made(page)).toEqual([{ hints_seen: ['tour', 'home-wotd'] }])
        await page.close()
      }
    })

    it('is not given again once seen, nor to a person who already learns', async () => {
      const seen = await open('user=new&seen=tour', size)
      await frames(seen, 5)
      expect(await box(seen, '.tour-card')).toBeNull()
      await seen.close()
      const learning = await open('user=returning&seen=home-wotd', size)
      await frames(learning, 5)
      expect(await box(learning, '.tour-card')).toBeNull()
      await learning.close()
    })

    it('keeps the page behind it out of reach while it is open', async () => {
      const page = await open('user=new', size)
      await page.waitForSelector('.tour-card')
      expect(await page.$eval('main', (el) => el.hasAttribute('inert'))).toBe(true)
      await click(page, '.tour-skip')
      await page.waitForFunction(() => document.querySelector('.tour-card') === null)
      expect(await page.$eval('main', (el) => el.hasAttribute('inert'))).toBe(false)
      await page.close()
    })

    it('stays on its element when a notice appears above the tiles, when the practice panel opens, on a scroll and on a resize', async () => {
      const page = await open('user=new', size)
      await page.waitForSelector('.tour-card')
      const aligned = async (why: string) => {
        await frames(page, 4)
        const target = (await box(page, '[data-hint="tile-learn"]'))!
        expect(near((await box(page, '.tour-spot'))!, target, 3), why).toBe(true)
        expect(inside((await box(page, '.tour-card'))!, await page.evaluate(() => document.documentElement.clientWidth), await page.evaluate(() => window.innerHeight)), `${why}: the card is on screen`).toBe(true)
        return target
      }
      const before = await aligned('at the start')
      await page.evaluate(() => (window as never as { __notice: (on: boolean) => void }).__notice(true))
      await page.waitForSelector('.notice')
      const afterNotice = await aligned('after a notice appeared')
      if (size.height < 600) expect(afterNotice.top, 'the notice moved the tiles on this tight page').not.toBe(before.top) // the point of the test: the element really moved
      await page.evaluate(() => (document.querySelector('[data-tile="practice"]') as HTMLElement).click()) // the page behind is inert for a person; this is the same press
      await aligned('after the practice panel opened')
      await page.evaluate(() => window.scrollBy(0, 40))
      await aligned('after a scroll')
      await page.setViewport({ width: size.width, height: size.height - 90, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
      await aligned('after the window got shorter')
      await page.setViewport({ width: size.width + 30, height: size.height, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
      await aligned('after the window got wider')
      await page.close()
    })

    it('goes through every step with a notice in the way, still on each element', async () => {
      const page = await open('user=new', size)
      await page.waitForSelector('.tour-card')
      await page.evaluate(() => (window as never as { __notice: (on: boolean) => void }).__notice(true))
      for (const step of STEPS) {
        await frames(page, 4)
        expect(near((await box(page, '.tour-spot'))!, (await box(page, `[data-hint="${step}"]`))!, 3), step).toBe(true)
        await click(page, '.tour-next')
      }
      await page.close()
    })

    it('in English, the same steps in English', async () => {
      const page = await open('user=new&lang=en', size)
      await page.waitForSelector('.tour-card')
      for (let i = 0; i < STEPS.length; i++) {
        await frames(page)
        expect(await texts(page, '.tour-card h3')).toEqual([en.hints.tour[TITLES[i]].title])
        expect(await texts(page, '.tour-card p')).toEqual([en.hints.tour[TITLES[i]].text])
        await click(page, '.tour-next')
      }
      await page.close()
    })
  })

  describe.each(SIZES)('the first Learn batch, $width×$height', (size) => {
    const finish = async (page: Page) => {
      for (let i = 0; i < 12; i++) {
        const more = await page.$('.learn-nav .btn-icon:last-child:not([disabled])')
        if (!more) break
        await more.click()
        await frames(page, 2)
      }
      await click(page, '.learn-finish .btn-primary')
    }

    it('for a new person the line under the cards is the louder one, and the end screen says why the words return, in the place of the paragraph about the daily limit', async () => {
      const page = await open('user=new&screen=learn&seen=tour', size)
      await page.waitForSelector('.swipe-area')
      expect(await page.$$eval('.learn-nav .hint-first', (els) => els.length)).toBe(1)
      await finish(page)
      await page.waitForSelector('.post-batch')
      expect(await texts(page, '.post-batch-why')).toEqual([ru.learn.firstBatchWhy])
      await page.close()
    })

    it('not for a person who has learned before: the plain line, and the paragraph about the daily limit', async () => {
      const page = await open('user=returning&screen=learn&seen=tour,home-wotd', size)
      await page.waitForSelector('.swipe-area')
      expect(await page.$$eval('.learn-nav .hint-first', (els) => els.length)).toBe(0)
      await finish(page)
      await page.waitForSelector('.post-batch')
      expect(await texts(page, '.post-batch-why')).toEqual([ru.learn.capReachedWhy])
      await page.close()
    })

    it('the louder line is no smaller than the card allows: it stays inside the screen', async () => {
      const page = await open('user=new&screen=learn&seen=tour', size)
      await page.waitForSelector('.swipe-area')
      expect(inside((await box(page, '.learn-nav .hint'))!, size.width, size.height)).toBe(true)
      await page.close()
    })
  })

  describe.each(SIZES)('Settings → «Показать подсказки снова», $width×$height', (size) => {
    it('clears the list, goes Home and gives the tour, though the person already learns; it ends as any tour does', async () => {
      const page = await open('user=returning&screen=settings&seen=tour,home-wotd,word-queue', size)
      const rowText = () => page.evaluate(() => Array.from(document.querySelectorAll('.setting-row')).map((b) => b.textContent ?? '').find((t) => t.includes('подсказки')) ?? '')
      expect(await rowText()).toContain(ru.settings.showHints)
      await page.evaluate(() => (Array.from(document.querySelectorAll('.setting-row')).find((b) => b.textContent?.includes('подсказки')) as HTMLElement).click())
      await page.waitForSelector('.tour-card')
      expect((await made(page))[0]).toEqual({ hints_seen: null })
      await click(page, '.tour-skip')
      await page.waitForFunction(() => document.querySelector('.tour-card') === null)
      expect((await made(page)).at(-1)).toEqual({ hints_seen: ['tour', 'home-wotd'] })
      await frames(page, 5)
      expect(await box(page, '.hint-bubble')).toBeNull() // the tour covered the bubble on the Word of the day
      await page.close()
    })

    it('after the reset the bubble on a word\'s queue button shows again too', async () => {
      const page = await open('user=returning&screen=settings&seen=tour,home-wotd,word-queue&word=plata', size)
      await page.evaluate(() => (Array.from(document.querySelectorAll('.setting-row')).find((b) => b.textContent?.includes('подсказки')) as HTMLElement).click())
      await page.waitForSelector('.tour-card')
      await click(page, '.tour-skip')
      await page.waitForFunction(() => document.querySelector('.tour-card') === null)
      await click(page, '[data-hint="wotd"]') // opens the word page
      await page.waitForSelector('.hint-bubble')
      await page.close()
    })
  })
})
