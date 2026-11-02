import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * The client's header and background colour coming back after the Mini App was minimized (src/lib/useTheme.ts, on the settings harness, which runs the real theme hook).
 * The Telegram here is a stand-in that, like a client that drops them while the app is minimized, can be made to forget the colours; the page must put them on again when
 * the app is activated, when the page is visible again, and when Telegram has finished resizing it. Whether a real Android client forgets them cannot be tested here. Needs
 * a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

type Stand = { WebApp: { colorScheme: string }; __colours: { header: string; background: string }; __fire: (name: string, data?: unknown) => void; __forget: () => void }

describe.skipIf(!CHROME)('the client colours on restore, in a browser', () => {
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

  async function open(colorScheme: 'light' | 'dark' = 'light', version = '8.0') {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.evaluateOnNewDocument(
      (scheme, v) => {
        const handlers: Record<string, ((data?: unknown) => void)[]> = {}
        const colours = { header: '', background: '' }
        const stand = {
          __colours: colours,
          // what a client that lost its colours on minimizing looks like: nothing set
          __forget: () => void ((colours.header = ''), (colours.background = '')),
          __fire: (name: string, data?: unknown) => (handlers[name] ?? []).slice().forEach((cb) => cb(data)),
          WebApp: {
            initData: 'query_id=x&hash=y',
            initDataUnsafe: {},
            colorScheme: scheme,
            themeParams: {},
            ready() {},
            expand() {},
            isVersionAtLeast: (want: string) => parseFloat(v) >= parseFloat(want),
            setHeaderColor: (c: string) => void (colours.header = c),
            setBackgroundColor: (c: string) => void (colours.background = c),
            onEvent: (name: string, cb: (data?: unknown) => void) => void (handlers[name] ||= []).push(cb),
            offEvent: (name: string, cb: (data?: unknown) => void) => void (handlers[name] = (handlers[name] ?? []).filter((h) => h !== cb)),
          },
        }
        ;(window as never as { Telegram: unknown }).Telegram = stand
      },
      colorScheme,
      version,
    )
    await page.goto(`${base}/src/testing/settingsHarness.html?goal=12&lang=en`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.screen-header')
    return page
  }
  const colours = (page: Page) => page.evaluate(() => ({ ...(window as never as { Telegram: Stand }).Telegram.__colours }))
  const forget = (page: Page) => page.evaluate(() => (window as never as { Telegram: Stand }).Telegram.__forget())
  const fire = (page: Page, name: string, data?: unknown) => page.evaluate((n, d) => (window as never as { Telegram: Stand }).Telegram.__fire(n, d), name, data)
  const LIGHT = { header: '#f6f4f0', background: '#f6f4f0' }

  it('on start the colours are the page colour of the scheme (what is there to be restored)', async () => {
    const page = await open()
    expect(await colours(page)).toEqual(LIGHT)
    await page.close()
  }, 60_000)

  it('a client that forgot the colours while minimized has them again when Telegram activates the app', async () => {
    const page = await open()
    await fire(page, 'deactivated')
    await forget(page)
    expect(await colours(page)).toEqual({ header: '', background: '' })
    await fire(page, 'activated')
    expect(await colours(page)).toEqual(LIGHT)
    await page.close()
  }, 60_000)

  it('the same when the page becomes visible again (a client older than Bot API 8.0 has no "activated")', async () => {
    const page = await open('light', '7.10')
    await forget(page)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))) // the headless page is visible: this is the "visible again" of a restore
    expect(await colours(page)).toEqual(LIGHT)
    await page.close()
  }, 60_000)

  it('and when Telegram has finished resizing the app, but not while it is still moving', async () => {
    const page = await open()
    await forget(page)
    await fire(page, 'viewportChanged', { isStateStable: false })
    await fire(page, 'viewportChanged', {})
    expect(await colours(page)).toEqual({ header: '', background: '' })
    await fire(page, 'viewportChanged', { isStateStable: true })
    expect(await colours(page)).toEqual(LIGHT)
    await page.close()
  }, 60_000)

  it('with the scheme as it is now: after Telegram switched to night mode, a restore puts on the dark page colour, not the one the app started with', async () => {
    const page = await open('light')
    await page.evaluate(() => void ((window as never as { Telegram: Stand }).Telegram.WebApp.colorScheme = 'dark'))
    await fire(page, 'themeChanged')
    await forget(page)
    await fire(page, 'activated')
    expect(await colours(page)).toEqual({ header: '#0e1618', background: '#0e1618' })
    await page.close()
  }, 60_000)

  it('outside Telegram nothing is sent: no WebApp colours are touched on a restore of an ordinary page', async () => {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.evaluateOnNewDocument(() => {
      ;(window as never as { __calls: number }).__calls = 0
      ;(window as never as { Telegram: unknown }).Telegram = { WebApp: { initData: '', initDataUnsafe: {}, colorScheme: 'light', themeParams: {}, ready() {}, expand() {}, setHeaderColor: () => void (window as never as { __calls: number }).__calls++, setBackgroundColor: () => void (window as never as { __calls: number }).__calls++ } }
    })
    await page.goto(`${base}/src/testing/settingsHarness.html?goal=12&lang=en`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.screen-header')
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(await page.evaluate(() => (window as never as { __calls: number }).__calls)).toBe(0)
    await page.close()
  }, 60_000)
})
