import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { closeBrowser, closeServer, launchBrowser } from '../testing/browser'

/**
 * The real index.html in a real browser: which font files are asked for on a first load, and how many times. English fetches the latin Manrope and never the
 * cyrillic one; Russian (stored, or reported by Telegram when nothing is stored) fetches the cyrillic one early, by the boot script's preload, and once: the
 * preload and the @font-face rule are one request, not two, and Chrome has no "preloaded but not used" to say about it.
 * Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

const LATIN = '/fonts/manrope-latin-v23.woff2'
const CYRILLIC = '/fonts/manrope-cyrillic-v23.woff2'

describe.skipIf(!CHROME)('the font files a first load asks for', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5243, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await launchBrowser(CHROME)
  }, 60_000)

  afterAll(async () => {
    await closeBrowser(browser)
    await closeServer(server)
  })

  /** Opens the app's own page with Telegram's script faked (what it says the user's language is) and nothing else let out of the machine. */
  async function load(options: { stored?: 'en' | 'ru'; telegram?: string }) {
    // with a language from Telegram the page must be inside Telegram (init data present), or the app ignores what the script says
    const initData = options.telegram ? 'query_id=x' : ''
    const page: Page = await (await browser.createBrowserContext()).newPage()
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    const telegram = `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, initDataUnsafe: { user: { id: 1, language_code: ${JSON.stringify(options.telegram ?? 'en')} } }, colorScheme: 'light', themeParams: {}, version: '8.0', platform: 'android', isVersionAtLeast: () => true, ready() {}, expand() {}, close() {}, onEvent() {}, offEvent() {} } }`
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      const host = new URL(request.url()).hostname
      if (host === '127.0.0.1') void request.continue()
      else if (host === 'telegram.org') void request.respond({ status: 200, contentType: 'application/javascript', body: telegram })
      else void request.abort()
    })
    const warnings: string[] = []
    page.on('console', (message) => {
      if (/preload/i.test(message.text())) warnings.push(message.text())
    })
    if (options.stored) await page.evaluateOnNewDocument((language) => localStorage.setItem('riopalabras.language.v1', language), options.stored)
    const cdp = await page.createCDPSession()
    await cdp.send('Network.enable')
    const fonts: string[] = []
    cdp.on('Network.requestWillBeSent', (event) => {
      const path = new URL(event.request.url).pathname
      if (path.startsWith('/fonts/')) fonts.push(path)
    })
    await page.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.fonts.status === 'loaded')
    const text = await page.evaluate(() => document.body.innerText)
    const preloads = await page.$$eval('link[rel="preload"]', (links) => links.map((l) => new URL((l as HTMLLinkElement).href).pathname))
    return { page, fonts, preloads, text, warnings }
  }
  const count = (fonts: string[], path: string) => fonts.filter((f) => f === path).length

  it('English, stored: the latin face once, the cyrillic one never, no cyrillic preload', async () => {
    const { page, fonts, preloads, text } = await load({ stored: 'en' })
    expect(text).toMatch(/Open inside Telegram/)
    expect(count(fonts, LATIN)).toBe(1)
    expect(count(fonts, CYRILLIC)).toBe(0)
    expect(preloads).toEqual([LATIN])
    await page.close()
  }, 60_000)

  it('nothing stored and Telegram says English: the same', async () => {
    const { page, fonts, preloads } = await load({ telegram: 'en' })
    expect(count(fonts, LATIN)).toBe(1)
    expect(count(fonts, CYRILLIC)).toBe(0)
    expect(preloads).toEqual([LATIN])
    await page.close()
  }, 60_000)

  it('Russian, stored: the cyrillic face is preloaded and fetched once, the latin one once, and Chrome has no unused preload to complain of', async () => {
    const { page, fonts, preloads, text, warnings } = await load({ stored: 'ru' })
    expect(text).toMatch(/Откройте приложение в Telegram/)
    expect(preloads.sort()).toEqual([CYRILLIC, LATIN].sort())
    expect(count(fonts, CYRILLIC)).toBe(1)
    expect(count(fonts, LATIN)).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 3500)) // Chrome says "preloaded but not used" a few seconds after load, if it is going to
    expect(warnings).toEqual([])
    await page.close()
  }, 60_000)

  it('Russian, nothing stored but Telegram says so: the app starts in Russian, and the face is preloaded and fetched once', async () => {
    // (the screen this fake leaves the app on, a sign-in failure, is not translated, so the page does not draw Russian text here; the stored case above covers the file being used)
    const { page, fonts, preloads } = await load({ telegram: 'ru' })
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ru')
    expect(preloads.sort()).toEqual([CYRILLIC, LATIN].sort())
    expect(count(fonts, CYRILLIC)).toBe(1)
    expect(count(fonts, LATIN)).toBe(1)
    await page.close()
  }, 60_000)

  it('the choice stored on the device wins over Telegram, as it does in the app: stored English, Telegram Russian, no cyrillic early', async () => {
    const { page, fonts, preloads } = await load({ stored: 'en', telegram: 'ru' })
    expect(preloads).toEqual([LATIN])
    expect(count(fonts, CYRILLIC)).toBe(0)
    await page.close()
  }, 60_000)
})
