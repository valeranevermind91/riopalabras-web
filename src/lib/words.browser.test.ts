import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * The Words list and a word's detail in a real browser, over the real 4,753-word dictionary (src/testing/wordsHarness.tsx
 * swaps list and detail the way App does): windowed rendering, the list keeping its place across a detail round trip,
 * the star and "Bring back" writing through the queue. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('the Words screen in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5199, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open() {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/wordsHarness.html`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => (window as never as { __ready?: boolean }).__ready === true)
    await page.waitForSelector('.word-row')
    return page
  }

  const rows = (page: Page) => page.$$eval('.word-row-head', (els) => els.map((e) => e.textContent ?? ''))
  const fixture = (page: Page) => page.evaluate(() => (window as never as { __fixture: { lapsed: string; hidden: string[]; favourite: string } }).__fixture)
  const sent = (page: Page) => page.evaluate(() => (window as never as { __sent: { favorites: { esWord: string; favorite: boolean }[]; hidden: { esWord: string; hidden: boolean }[] } }).__sent)
  const status = (page: Page) => page.evaluate(() => (window as never as { __queue: { getStatus: () => Record<string, number | boolean> } }).__queue.getStatus())
  const segment = (page: Page, label: string) =>
    page.evaluate((text) => (Array.from(document.querySelectorAll('.segment')).find((b) => b.textContent?.startsWith(text)) as HTMLElement).click(), label)
  const chip = (page: Page, label: string) =>
    page.evaluate((text) => (Array.from(document.querySelectorAll('.chip')).find((b) => b.textContent === text) as HTMLElement).click(), label)
  const scrollTo = async (page: Page, y: number) => {
    await page.$eval('.vlist', (el, top) => void (el.scrollTop = top), y)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  }
  const scrollTop = (page: Page) => page.$eval('.vlist', (el) => el.scrollTop)
  const openRow = async (page: Page, index: number) => {
    const names = await rows(page)
    await page.evaluate((i) => (document.querySelectorAll('.word-row-main')[i] as HTMLElement).click(), index)
    await page.waitForSelector('.word-detail')
    return names[index]
  }
  const back = async (page: Page) => {
    await page.click('.back-link')
    await page.waitForSelector('.words-search')
  }
  const search = async (page: Page, text: string) => {
    await page.$eval('.words-search', (el) => void ((el as HTMLInputElement).value = ''))
    await page.click('.words-search')
    await page.type('.words-search', text)
    await page.waitForSelector('.vlist, .words-empty')
  }

  it('renders a window of the list, not the list: a screenful of rows for 4,753 words, in a scroller as tall as all of them', async () => {
    const page = await open()
    await segment(page, 'All')
    await page.waitForSelector('.vlist-space')
    expect(await page.$eval('.vlist-space', (e) => (e as HTMLElement).offsetHeight)).toBe(4753 * 72)
    const rendered = (await rows(page)).length
    expect(rendered).toBeGreaterThan(8)
    expect(rendered).toBeLessThan(30)

    await scrollTo(page, 72 * 3000)
    const after = await rows(page)
    expect(after.length).toBeLessThan(30)
    expect(after).not.toEqual(await (async () => { await scrollTo(page, 0); return rows(page) })()) // a different part of the list
    await page.close()
  }, 60_000)

  it('opens on the learned words: due first, with the Due badge, and every word of it has progress', async () => {
    const page = await open()
    const labels = await page.$$eval('.segment', (els) => els.map((e) => e.textContent))
    expect(labels).toEqual(['Learned 41', 'All 4753', 'Hidden 2'])
    expect(await page.$$eval('.segment.is-active', (els) => els.map((e) => e.textContent?.split(' ')[0]))).toEqual(['Learned'])
    // the first rows are the due ones
    expect(await page.$$eval('.word-row', (els) => els.slice(0, 5).map((e) => e.querySelector('.word-row-due') !== null))).toEqual([true, true, true, true, true])
    await page.close()
  }, 60_000)

  it('keeps its place across a detail round trip: segment, query, filter and scroll position', async () => {
    const page = await open()
    await segment(page, 'All')
    await scrollTo(page, 72 * 1500)
    const before = { top: await scrollTop(page), names: await rows(page) }
    const opened = await openRow(page, 4)
    expect(await page.$eval('.wc-headword', (e) => e.textContent)).toBe(opened) // the detail is that word's card
    await back(page)

    expect(await page.$$eval('.segment.is-active', (els) => els.map((e) => e.textContent?.split(' ')[0]))).toEqual(['All'])
    expect(Math.abs((await scrollTop(page)) - before.top)).toBeLessThanOrEqual(2)
    expect(await rows(page)).toEqual(before.names)
    await page.close()
  }, 60_000)

  it('…and the query and a filter too', async () => {
    const page = await open()
    await search(page, 'ca')
    await chip(page, 'Nouns')
    await page.waitForSelector('.vlist')
    await scrollTo(page, 72 * 20)
    const before = { top: await scrollTop(page), names: await rows(page) }
    expect(before.names.length).toBeGreaterThan(5)
    await openRow(page, 3)
    await back(page)

    expect(await page.$eval('.words-search', (e) => (e as HTMLInputElement).value)).toBe('ca')
    expect(await page.$$eval('.chip.is-active', (els) => els.map((e) => e.textContent))).toEqual(['Nouns'])
    expect(await page.$$eval('.segment.is-active', (els) => els.length)).toBe(0) // searching: no segment is lit
    expect(Math.abs((await scrollTop(page)) - before.top)).toBeLessThanOrEqual(2)
    expect(await rows(page)).toEqual(before.names)
    await page.close()
  }, 60_000)

  it('the star toggles the favourite without opening the word, and goes through the queue; the latest state wins', async () => {
    const page = await open()
    const first = (await rows(page))[0]
    await page.evaluate(() => (document.querySelector('.word-row-star') as HTMLElement).click())
    await page.waitForSelector('.word-row-star.is-on')
    expect(await page.$('.word-detail')).toBeNull() // still the list
    expect(await page.$eval('.word-row-star.is-on', (e) => e.getAttribute('aria-pressed'))).toBe('true')
    await page.waitForFunction(() => (window as never as { __sent: { favorites: unknown[] } }).__sent.favorites.length > 0)
    expect((await sent(page)).favorites.at(-1)).toMatchObject({ favorite: true })
    expect((await rows(page))[0]).toBe(first)

    await page.evaluate(() => (document.querySelector('.word-row-star.is-on') as HTMLElement).click())
    await page.waitForFunction(() => (window as never as { __sent: { favorites: { favorite: boolean }[] } }).__sent.favorites.at(-1)?.favorite === false)
    expect(await page.$('.word-row-star.is-on')).toBeNull()
    await page.close()
  }, 60_000)

  it('the Favourites chip lists the favourites', async () => {
    const page = await open()
    await segment(page, 'All')
    await chip(page, 'Favourites')
    await page.waitForSelector('.vlist')
    const fx = await fixture(page)
    expect(await page.$$eval('.word-row-star.is-on', (els) => els.length)).toBe(1)
    expect((await rows(page)).length).toBe(1)
    expect(fx.favourite).toBeTruthy()
    await page.close()
  }, 60_000)

  it('Hidden lists the words marked as known with "Bring back"; it goes through the hidden lane and the word leaves the list', async () => {
    const page = await open()
    await segment(page, 'Hidden')
    await page.waitForSelector('.word-row-bring')
    expect(await page.$$eval('.word-row-bring', (els) => els.length)).toBe(2)
    expect(await page.$('.word-row-star')).toBeNull()
    expect(await page.$('.chip:nth-child(1)').then(async (h) => (h ? page.evaluate((e) => e.textContent, h) : null))).toBe('Favourites') // no state chips here
    const [first] = await rows(page)
    await page.evaluate(() => (document.querySelector('.word-row-bring') as HTMLElement).click())
    await page.waitForFunction(() => document.querySelectorAll('.word-row-bring').length === 1)
    expect(await rows(page)).not.toContain(first)
    await page.waitForFunction(() => (window as never as { __sent: { hidden: unknown[] } }).__sent.hidden.length > 0)
    expect((await sent(page)).hidden.at(-1)).toMatchObject({ hidden: false })
    expect((await page.$$eval('.segment', (els) => els.map((e) => e.textContent)))[2]).toBe('Hidden 1')
    await page.close()
  }, 60_000)

  it('a hidden word found by search says so, opens in detail with its kept progress, and "Bring back" there works too', async () => {
    const page = await open()
    const fx = await fixture(page)
    await search(page, fx.hidden[0])
    await page.waitForSelector('.word-row-bring')
    await openRow(page, 0)
    const text = await page.$eval('.state-block', (e) => e.textContent ?? '')
    expect(text).toContain('Hidden')
    expect(text).toContain('Its progress is kept')
    await page.click('.detail-actions .btn-primary')
    await page.waitForFunction(() => document.querySelector('.detail-actions .btn-primary') === null)
    expect(await page.$eval('.state-block', (e) => e.textContent ?? '')).not.toContain('Hidden')
    expect((await sent(page)).hidden.at(-1)).toMatchObject({ hidden: false })
    expect((await status(page)).pendingFavorites).toBe(0)
    await page.close()
  }, 60_000)

  it('the detail of a lapsed word shows that it reads as new and why', async () => {
    const page = await open()
    const fx = await fixture(page)
    await search(page, fx.lapsed)
    await page.waitForSelector('.word-row')
    await openRow(page, 0)
    const text = await page.$eval('.state-block', (e) => e.textContent ?? '')
    expect(text).toContain('New')
    expect(text).toContain('Again')
    expect(text).toContain('Learn pool')
    await page.close()
  }, 60_000)

  it('a search shows the Rioplatense marker on a word matched through its Rioplatense form', async () => {
    const page = await open()
    await search(page, 'aca')
    expect(await page.$$eval('.word-row .pill', (els) => els.map((e) => e.textContent))).toContain('Rioplatense')
    await page.close()
  }, 60_000)

  it('the whole thing is wired into the app: the Home button, Telegram\'s back button, and the list kept while a word is open', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toMatch(/onWords=\{\(\) => setScreen\('words'\)\}/)
    expect(app).toMatch(/savedView=\{wordsView\.get\(\)\}/)
    expect(app).toMatch(/onViewChange=\{wordsView\.set\}/)
    expect(app).toMatch(/setOpen\(\{ key, from: 'words' \}\)/)
    expect(app).toMatch(/setOpen\(\{ key: wordKey\(word\.esWord\), from: 'home' \}\)/)
    expect(app).toMatch(/const backTarget: Screen = screen === 'word' \? \(open\?\.from \?\? 'home'\) : 'home'/)
    expect(app).toMatch(/const onClick = \(\) => void go\(backTarget\)/)
  })
})
