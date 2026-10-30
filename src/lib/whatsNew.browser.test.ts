import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * "What's new" in a real browser (src/testing/settingsHarness.tsx, ready=1 so that Home has its data and the dot is decided, with news=1 for two entries dated today and yesterday and seen=old|all for how much of them
 * the account has opened): the dot on the gear, the row leading Settings while there is something unread, the screen's "New" labels, the one write that opening it
 * makes, and where the row settles afterwards. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)("What's new in a browser", () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5211, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(query = '', width = 390) {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setViewport({ width, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/settingsHarness.html?ready=1&${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.screen-header')
    return page
  }

  const sent = (page: Page) => page.evaluate(() => (window as never as { __sent: { settings: Record<string, unknown>[] } }).__sent.settings)
  const gear = (page: Page) => page.$eval('.screen-header-actions .icon-btn:last-child', (e) => ({ label: e.getAttribute('aria-label'), dot: e.querySelector('.news-dot') !== null }))
  const toSettings = async (page: Page) => {
    await page.click('.screen-header-actions .icon-btn:last-child')
    await page.waitForSelector('.settings')
  }
  const toNews = async (page: Page) => {
    await page.evaluate(() => (Array.from(document.querySelectorAll('.setting-nav')).find((b) => /What.s new|Что нового/.test(b.textContent ?? '')) as HTMLElement).click())
    await page.waitForSelector('.whats-new')
  }
  const back = async (page: Page) => {
    await page.click('.back-link')
    await page.waitForSelector('.screen-header')
  }
  const rows = (page: Page) => page.$$eval('.setting-nav .setting-label', (els) => els.map((e) => e.textContent))
  const entries = (page: Page) =>
    page.$$eval('.whats-new .settings-section', (els) =>
      els.map((e) => ({ title: e.querySelector('.news-title')?.textContent, at: e.querySelector('time')?.getAttribute('datetime'), isNew: e.querySelector('.news-pill') !== null })),
    )
  const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

  it('with no entries there is no dot, no row and no write', async () => {
    const page = await open()
    expect(await gear(page)).toEqual({ label: 'Settings', dot: false })
    await toSettings(page)
    expect(await rows(page)).not.toContain("What's new")
    expect(await page.$('.news-dot')).toBeNull()
    expect(await sent(page)).toEqual([])
    await page.close()
  }, 60_000)

  it('unread: the gear carries a dot inside its own box and says there is something new; Settings leads with the row, dot and all, above Learning', async () => {
    const page = await open('news=1')
    expect(await gear(page)).toEqual({ label: 'Settings, something new', dot: true })
    const inside = await page.evaluate(() => {
      const btn = document.querySelector('.screen-header-actions .icon-btn:last-child')!.getBoundingClientRect()
      const dot = document.querySelector('.news-dot-corner')!.getBoundingClientRect()
      return { w: dot.width, h: dot.height, in: dot.left >= btn.left && dot.right <= btn.right && dot.top >= btn.top && dot.bottom <= btn.bottom }
    })
    expect(inside).toEqual({ w: 8, h: 8, in: true })

    await toSettings(page)
    expect((await rows(page))[0]).toBe("What's new")
    const order = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.setting-nav')).find((b) => /What.s new/.test(b.textContent ?? ''))!
      return { top: row.getBoundingClientRect().top, learning: document.getElementById('settings-learning')!.getBoundingClientRect().top, label: row.getAttribute('aria-label'), dot: row.querySelector('.news-dot') !== null }
    })
    expect(order.top).toBeLessThan(order.learning)
    expect(order.top).toBeLessThan(400) // in view without scrolling
    expect(order).toMatchObject({ label: "What's new, unread", dot: true })
    await page.close()
  }, 60_000)

  it('opening Settings does not clear the dot; opening the What\'s new screen does, with one write of the newest entry\'s moment', async () => {
    const page = await open('news=1')
    await toSettings(page)
    expect(await sent(page)).toEqual([])
    await back(page)
    expect((await gear(page)).dot).toBe(true) // still there: Settings was only passed through

    await toSettings(page)
    await toNews(page)
    expect(await page.$eval('h1', (e) => e.textContent)).toBe("What's new")
    const list = await entries(page)
    expect(list.map((e) => e.title)).toEqual(['A newer thing you can do now', 'An older change'])
    expect(list.map((e) => e.isNew)).toEqual([true, true]) // both were unread when it opened, and stay labelled while it is open
    await page.waitForFunction(() => (window as never as { __sent: { settings: unknown[] } }).__sent.settings.length > 0)
    expect(await sent(page)).toEqual([{ whats_new_seen: list[0].at }])
    expect(await entries(page)).toEqual(list) // the write did not strip the labels from under the reader
    await page.close()
  }, 60_000)

  it('afterwards: Back lands on Settings with the row in About, after "How it works", dot-free; Home\'s gear is plain; opening it again labels nothing and writes nothing', async () => {
    const page = await open('news=1')
    await toSettings(page)
    await toNews(page)
    await page.waitForFunction(() => (window as never as { __sent: { settings: unknown[] } }).__sent.settings.length > 0)
    await back(page)
    await page.waitForSelector('.settings')
    const labels = await rows(page)
    expect(labels[0]).not.toBe("What's new")
    expect(labels.slice(-4)).toEqual(expect.arrayContaining(["What's new"]))
    expect(labels.indexOf("What's new")).toBeGreaterThan(labels.indexOf('How it works'))
    expect(await page.$('.news-dot')).toBeNull()
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('.setting-nav')).some((b) => /unread/.test(b.getAttribute('aria-label') ?? '')))).toBe(false)

    await back(page)
    expect(await gear(page)).toEqual({ label: 'Settings', dot: false })

    await toSettings(page)
    await toNews(page)
    expect((await entries(page)).map((e) => e.isNew)).toEqual([false, false])
    expect(await sent(page)).toHaveLength(1)
    await page.close()
  }, 60_000)

  it('part-read: only the entries after the watermark are labelled "New", and the write moves the watermark to the newest', async () => {
    const page = await open('news=1&seen=old')
    expect((await gear(page)).dot).toBe(true)
    await toSettings(page)
    await toNews(page)
    const list = await entries(page)
    expect(list.map((e) => e.isNew)).toEqual([true, false])
    await page.waitForFunction(() => (window as never as { __sent: { settings: unknown[] } }).__sent.settings.length > 0)
    expect(await sent(page)).toEqual([{ whats_new_seen: list[0].at }])
    await page.close()
  }, 60_000)

  it('all read: no dot anywhere, the row sits in About, and opening the screen writes nothing', async () => {
    const page = await open('news=1&seen=all')
    expect(await gear(page)).toEqual({ label: 'Settings', dot: false })
    await toSettings(page)
    expect(await page.$('.news-dot')).toBeNull()
    await toNews(page)
    expect((await entries(page)).map((e) => e.isNew)).toEqual([false, false])
    expect(await sent(page)).toEqual([])
    await page.close()
  }, 60_000)

  it('in Russian: «Настройки, есть новое», the row «Что нового», the entries in Russian with «Новое»', async () => {
    const page = await open('news=1&lang=ru')
    expect(await gear(page)).toEqual({ label: 'Настройки, есть новое', dot: true })
    await toSettings(page)
    expect((await rows(page))[0]).toBe('Что нового')
    await toNews(page)
    expect(await page.$eval('h1', (e) => e.textContent)).toBe('Что нового')
    expect((await entries(page)).map((e) => e.title)).toEqual(['Новая возможность', 'Старое изменение'])
    expect(await page.$$eval('.news-pill', (els) => els.map((e) => e.textContent))).toEqual(['Новое', 'Новое'])
    await page.close()
  }, 60_000)

  it('at 320px nothing overflows sideways on Home, Settings or the screen, and the long text wraps', async () => {
    const page = await open('news=1', 320)
    expect(await noOverflow(page)).toBe(true)
    await toSettings(page)
    expect(await noOverflow(page)).toBe(true)
    await toNews(page)
    expect(await noOverflow(page)).toBe(true)
    const text = await page.$eval('.news-text', (e) => ({ right: e.getBoundingClientRect().right, height: e.getBoundingClientRect().height, line: parseFloat(getComputedStyle(e).lineHeight) }))
    expect(text.right).toBeLessThanOrEqual(320)
    expect(text.height).toBeGreaterThan(text.line * 2) // it wrapped
    await page.close()
  }, 60_000)
})
