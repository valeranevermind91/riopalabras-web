import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * A Learn card is counted when it is reached, in a real browser (src/testing/logHarness.tsx: the real Learn screen, every write the queue sends recorded in window.__sent, the
 * words and settings as the screen has them in window.__state). Reading seven of ten cards and leaving leaves seven words learned, written to the queue as they were reached,
 * not at the end; hiding a word that was counted takes it back out; "Finish batch" after the last card sends nothing more. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((path) => path && existsSync(path))

interface Sent {
  progress: { esWord: string; repetitions: number }[]
  settings: Record<string, unknown>[]
  hidden: { esWord: string }[]
  seen: number[]
}
interface State {
  words: Record<string, { repetitions: number }>
  settings: string
}

describe.skipIf(!CHROME)('Learn counts a card when it is reached, in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5276, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open() {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateTimezone('America/Montevideo')
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/logHarness.html?screen=learn&learned=0&fresh=40`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.learn-progress')
    return page
  }
  const sent = (page: Page) => page.evaluate(() => (window as never as { __sent: Sent }).__sent) as Promise<Sent>
  const state = (page: Page) => page.evaluate(() => (window as never as { __state: () => State }).__state()) as Promise<State>
  const learned = async (page: Page) => Object.values((await state(page)).words).filter((w) => w.repetitions > 0).length
  const counter = async (page: Page) => (JSON.parse((await state(page)).settings) as { newWordsLearnedTodayCount?: number }).newWordsLearnedTodayCount ?? 0
  const cardNumber = async (page: Page) => Number(((await page.$eval('.learn-progress span', (e) => e.textContent)) ?? '').match(/\d+/)![0])
  const goTo = async (page: Page, target: number) => {
    while ((await cardNumber(page)) < target) {
      const from = await cardNumber(page)
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction((n) => document.querySelector('.learn-progress span')?.textContent?.startsWith(`Word ${n} of`), {}, from + 1)
    }
  }

  it('opening the screen counts the first card; reading to card 7 has seven words learned, written as they were reached, with the counter at 7', async () => {
    const page = await open()
    expect(await learned(page)).toBe(1)
    expect((await sent(page)).seen).toEqual([1])
    await goTo(page, 7)
    await page.waitForFunction(() => (window as never as { __sent: Sent }).__sent.progress.length >= 7)
    expect(await learned(page)).toBe(7)
    expect(await counter(page)).toBe(7)
    const s = await sent(page)
    expect(s.progress.filter((u) => u.repetitions === 1)).toHaveLength(7)
    expect(new Set(s.progress.map((u) => u.esWord)).size).toBe(7)
    expect(s.seen.at(-1)).toBe(7)
    await page.close()
  }, 60_000)

  it('going back and forward again counts nothing twice', async () => {
    const page = await open()
    await goTo(page, 4)
    await page.click('button[aria-label="Previous"]')
    await page.waitForFunction(() => document.querySelector('.learn-progress span')?.textContent?.startsWith('Word 3 of'))
    await goTo(page, 4)
    expect(await learned(page)).toBe(4)
    expect(await counter(page)).toBe(4)
    expect((await sent(page)).progress).toHaveLength(4)
    await page.close()
  }, 60_000)

  it('hiding a word that was counted takes it back out and the word that takes its place is counted: still one word learned per card, none of them the hidden one', async () => {
    const page = await open()
    await goTo(page, 3)
    const hiddenWord = await page.$eval('.wc-headword', (e) => e.textContent ?? '')
    await page.click('.learn-known .known-btn')
    await page.waitForFunction(() => (window as never as { __sent: Sent }).__sent.hidden.length === 1)
    expect(await counter(page)).toBe(3)
    expect(await learned(page)).toBe(3)
    expect((await sent(page)).hidden[0].esWord.toLowerCase()).toBe(hiddenWord.toLowerCase())
    expect((await state(page)).words[hiddenWord.toLowerCase()]?.repetitions ?? 0).toBe(0)
    await page.close()
  }, 60_000)

  it('"Finish batch" after the last card sends nothing more, and the day is 10 of 10', async () => {
    const page = await open()
    await goTo(page, 10)
    await page.waitForFunction(() => (window as never as { __sent: Sent }).__sent.progress.length >= 10)
    const before = (await sent(page)).progress.length
    await page.click('.learn-finish .btn-primary')
    await page.waitForSelector('.post-batch')
    expect((await sent(page)).progress).toHaveLength(before)
    expect(await counter(page)).toBe(10)
    await page.close()
  }, 60_000)
})
