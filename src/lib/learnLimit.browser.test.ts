import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { en } from '../strings'
import { ru } from '../strings.ru'

/**
 * Learn says WHY the day's new words have stopped, in a real browser (src/testing/offerHarness.tsx: the real Learn screen; limit=N is the daily goal).
 * Without it "Today's new words are done" reads as the app holding words back. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('Learn, when the day\'s new words are used up', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5218, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(query: string, width = 390) {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.setViewport({ width, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/offerHarness.html?offered=1&${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.screen-header')
    return page
  }
  async function finishBatch(page: Page) {
    await page.waitForSelector('.learn-progress')
    const total = Number((await page.$eval('.learn-progress span', (e) => e.textContent ?? '')).match(/\d+/g)![1])
    for (let i = 1; i < total; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction((n) => Number(document.querySelector('.learn-progress span')!.textContent!.match(/\d+/)![0]) === n, {}, i + 1)
    }
    await page.click('.learn-finish .btn-primary')
    await page.waitForSelector('.post-batch')
  }
  const endScreen = (page: Page) => page.$eval('.post-batch', (e) => ({ title: e.querySelector('h2')!.textContent, subtitle: e.querySelector('.subtitle')?.textContent ?? null, why: e.querySelector('.post-batch-why')?.textContent ?? null, buttons: Array.from(e.querySelectorAll('.post-batch-actions button')).map((b) => b.textContent?.trim()), practiceOffer: e.querySelector('.practice-offer button')?.textContent ?? null }))

  it('says why, under the line that says it is done, once the goal is reached by a batch', async () => {
    const page = await open('limit=10&pool=14&lang=en')
    await finishBatch(page)
    expect(await endScreen(page)).toEqual({ title: en.learn.capReachedTitle, subtitle: en.learn.capReachedSubtitle, why: en.learn.capReachedWhy, buttons: [en.common.backToHome], practiceOffer: en.learn.practiceButton }) // the offer to practise the batch is made here too, above the buttons
    expect(en.learn.capReachedWhy).toBe("New words are limited each day so that tomorrow's review stays manageable: every word you learn comes back for review, and too many at once pile up.")
    await page.close()
  }, 60_000)

  it('says it too when Learn is opened with the goal already reached (nothing to learn today)', async () => {
    const page = await open('limit=0&pool=14&lang=en')
    await page.waitForSelector('.post-batch')
    expect(await endScreen(page)).toMatchObject({ title: en.learn.capReachedTitle, why: en.learn.capReachedWhy })
    await page.close()
  }, 60_000)

  it('in Russian, in the same two places', async () => {
    const finished = await open('limit=10&pool=14&lang=ru')
    await finishBatch(finished)
    expect(await endScreen(finished)).toMatchObject({ title: ru.learn.capReachedTitle, subtitle: ru.learn.capReachedSubtitle, why: ru.learn.capReachedWhy })
    await finished.close()
    const reopened = await open('limit=0&pool=14&lang=ru')
    await reopened.waitForSelector('.post-batch')
    expect(await endScreen(reopened)).toMatchObject({ title: ru.learn.capReachedTitle, why: ru.learn.capReachedWhy })
    await reopened.close()
  }, 90_000)

  it('is not there when the goal is not reached (the user can go on), and not when the new words have run out for another reason', async () => {
    const more = await open('limit=20&pool=14&lang=en')
    await finishBatch(more)
    const state = await endScreen(more)
    expect(state.why).toBeNull()
    expect(state.title).not.toBe(en.learn.capReachedTitle)
    expect(state.buttons).toContain(en.learn.learnNextBatch) // there is more to learn today: nothing to explain
    await more.close()

    const none = await open('limit=20&pool=0&lang=en') // no words at all to teach
    await none.waitForSelector('.post-batch')
    expect(await endScreen(none)).toMatchObject({ title: en.learn.poolEmptyTitle, why: null })
    await none.close()
  }, 90_000)

  for (const lang of ['en', 'ru'] as const) {
    it(`fits at 320px in ${lang === 'en' ? 'English' : 'Russian'}: inside the screen, a few quiet lines, the buttons still in reach`, async () => {
      const page = await open(`limit=0&pool=14&lang=${lang}`, 320)
      await page.waitForSelector('.post-batch-why')
      const m = await page.evaluate(() => {
        const why = document.querySelector('.post-batch-why')!
        const r = why.getBoundingClientRect()
        const button = document.querySelector('.post-batch-actions button')!.getBoundingClientRect()
        return { left: r.left, right: r.right, lines: Math.round(r.height / parseFloat(getComputedStyle(why).lineHeight)), scroll: document.documentElement.scrollWidth, width: window.innerWidth, buttonTop: button.top, whyBottom: r.bottom, view: window.innerHeight }
      })
      expect(m.scroll).toBeLessThanOrEqual(m.width)
      expect(m.left).toBeGreaterThanOrEqual(0)
      expect(m.right).toBeLessThanOrEqual(m.width)
      expect(m.lines).toBeLessThanOrEqual(8)
      expect(m.buttonTop).toBeGreaterThan(m.whyBottom) // the button is below the line, not covered by it
      expect(m.buttonTop).toBeLessThan(m.view)
      await page.close()
    }, 60_000)
  }
})
