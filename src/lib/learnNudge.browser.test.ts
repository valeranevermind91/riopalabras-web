import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * Two things that sit under the card on the Learn screen, in a real browser at 320px (src/testing/offerHarness.tsx puts the real Learn screen on a page): the swipe hint between the two
 * arrows, and the suggestion to take the placement test (or to retake it) that shows once a person has hidden three of a batch's first five cards, or five anywhere in it.
 * Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('the Learn screen at 320px: the swipe hint and the placement suggestion', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5217, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(query: string, language: 'en' | 'ru') {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.evaluateOnNewDocument((code) => localStorage.setItem('riopalabras.language.v1', code), language)
    await page.goto(`${base}/src/testing/offerHarness.html?lang=${language}&pool=30&limit=300&${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.learn-nav')
    return page
  }
  const nudge = (page: Page) => page.$('.learn-nudge')
  const hide = async (page: Page) => {
    const before = await page.$$eval('.known-btn', (b) => b.length)
    expect(before).toBeGreaterThan(0)
    await page.click('.learn-known .known-btn')
    await page.waitForSelector('.learn-undo')
  }
  /** Lays out what is under the card: how tall the card still is, whether anything runs out of the 320px or the page scrolls sideways. */
  const layout = (page: Page) =>
    page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null
      const card = box('.swipe-area')!
      const nav = box('.learn-nav')!
      const nudgeBox = box('.learn-nudge')
      return {
        pageScrollsX: document.documentElement.scrollWidth > window.innerWidth,
        pageScrollsY: document.documentElement.scrollHeight > window.innerHeight,
        cardHeight: Math.round(card.height),
        navBottom: Math.round(nav.bottom),
        navFits: nav.bottom <= window.innerHeight,
        nudgeInside: nudgeBox ? nudgeBox.left >= 0 && nudgeBox.right <= 320 : null,
        nudgeHeight: nudgeBox ? Math.round(nudgeBox.height) : null,
        nudgeFontSize: nudgeBox ? parseFloat(getComputedStyle(document.querySelector('.learn-nudge')!).fontSize) : null,
      }
    })

  for (const language of ['en', 'ru'] as const) {
    describe(language === 'en' ? 'English' : 'Russian', () => {
      it('the swipe hint takes two lines between two full-size arrows, and nothing runs out of the screen', async () => {
        const page = await open('', language)
        const seen = await page.evaluate(() => {
          const hint = document.querySelector('.learn-nav .hint') as HTMLElement
          const arrows = Array.from(document.querySelectorAll('.learn-nav .btn-icon')).map((b) => b.getBoundingClientRect().width)
          const lineHeight = parseFloat(getComputedStyle(hint).lineHeight)
          return { text: hint.textContent, lines: Math.round(hint.getBoundingClientRect().height / lineHeight), arrows, overflows: hint.scrollWidth > hint.clientWidth, align: getComputedStyle(hint).textAlign }
        })
        expect(seen.text).toBe(language === 'en' ? 'Just swipe: a word counts when you reach it' : 'Слово засчитывается, когда вы до него дошли')
        expect(seen.lines).toBeLessThanOrEqual(2)
        expect(seen.arrows).toEqual([52, 52]) // the arrows are not squeezed by the text
        expect(seen.overflows).toBe(false)
        expect(seen.align).toBe('center')
        expect(await layout(page)).toMatchObject({ pageScrollsX: false, navFits: true })
        await page.close()
      }, 60_000)

      it('the suggestion is not there for two hides, comes with the third, and goes again when that one is undone', async () => {
        const page = await open('placement=1', language)
        await hide(page)
        await hide(page)
        expect(await nudge(page)).toBeNull()
        await hide(page)
        const text = await page.$eval('.learn-nudge', (e) => e.textContent)
        expect(text).toBe(language === 'en' ? "You've hidden a lot of words. Take the placement test to start with new ones" : 'Скрыли много слов? Пройдите входной тест и начните с незнакомых')
        await page.click('.learn-undo .link-btn')
        await page.waitForFunction(() => !document.querySelector('.learn-nudge'))
        await page.close()
      }, 60_000)

      it.each([['for the first time', 'placement=1', 'first'], ['again once the test has been taken', 'placement=1&rank=200', 'retake']] as const)(
        'the text %s fits two lines at 320px with the undo bar and does not squeeze the card',
        async (_name, query, kind) => {
          const page = await open(query, language)
          for (let i = 0; i < 3; i++) await hide(page)
          const text = await page.$eval('.learn-nudge', (e) => e.textContent)
          if (kind === 'retake') expect(text).toBe(language === 'en' ? 'Still too easy? Retake the placement test' : 'По-прежнему слишком просто? Пройдите входной тест заново')
          const seen = await layout(page)
          expect(seen).toMatchObject({ pageScrollsX: false, pageScrollsY: false, nudgeInside: true, navFits: true })
          expect(seen.nudgeHeight).toBeGreaterThanOrEqual(44) // a full tap target
          expect(seen.nudgeHeight).toBeLessThanOrEqual(46) // two lines at most: shortened, not shrunk
          expect(seen.nudgeFontSize).toBe(13)
          expect(seen.cardHeight).toBeGreaterThanOrEqual(170) // the card is still a card with the undo bar and the suggestion under it
          await page.close()
        },
        60_000,
      )

      it('pressing it opens the placement test, once', async () => {
        const page = await open('placement=1', language)
        for (let i = 0; i < 3; i++) await hide(page)
        await page.click('.learn-nudge')
        expect(await page.evaluate(() => (window as never as { __placement: { opened: number } }).__placement.opened)).toBe(1)
        await page.close()
      }, 60_000)
    })
  }

  it('three hides on cards past the fifth leave no suggestion, five hides anywhere in the batch bring it, and Undo takes it away again', async () => {
    const page = await open('placement=1', 'en')
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => document.querySelector('.learn-progress span')!.textContent!.includes('6 of'))
    for (let i = 0; i < 4; i++) await hide(page)
    expect(await nudge(page)).toBeNull()
    await hide(page)
    expect(await nudge(page)).not.toBeNull()
    await page.click('.learn-undo .link-btn')
    await page.waitForFunction(() => !document.querySelector('.learn-nudge'))
    await page.close()
  }, 60_000)

  it('once the test has been taken the suggestion is the retake one, and pressing it opens the same screen', async () => {
    const page = await open('placement=1&rank=200', 'en')
    for (let i = 0; i < 3; i++) await hide(page)
    expect(await page.$eval('.learn-nudge', (e) => e.textContent)).toBe('Still too easy? Retake the placement test')
    await page.click('.learn-nudge')
    expect(await page.evaluate(() => (window as never as { __placement: { opened: number } }).__placement.opened)).toBe(1)
    await page.close()
  }, 60_000)

  it('there is none where Learn has no way to the placement test', async () => {
    const without = await open('', 'en')
    for (let i = 0; i < 5; i++) await hide(without)
    expect(await nudge(without)).toBeNull()
    await without.close()
  }, 60_000)
})
