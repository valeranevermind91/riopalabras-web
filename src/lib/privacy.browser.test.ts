import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * The privacy page (privacy.html, at /privacy) in a real browser, as someone who has never opened the Mini App sees it: no Telegram, no account, no
 * sign-in. Every request the page makes is recorded. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('the privacy page in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5219, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  interface Options {
    /** navigator.languages */
    languages?: string[]
    /** What this device last used in the app (localStorage riopalabras.language.v1). */
    stored?: 'en' | 'ru'
    scheme?: 'light' | 'dark'
    width?: number
  }

  /** The page in its own browser context (no test sees another's storage), with every request and every error recorded. */
  async function open(path: string, { languages = ['en-US'], stored, scheme = 'light', width = 390 }: Options = {}) {
    const page = await (await browser.createBrowserContext()).newPage()
    const requests: string[] = []
    const errors: string[] = []
    page.on('request', (r) => {
      if (!r.url().startsWith('data:')) requests.push(r.url())
    })
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await page.setViewport({ width, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.evaluateOnNewDocument(
      (langs, remembered) => {
        Object.defineProperty(navigator, 'languages', { get: () => langs })
        Object.defineProperty(navigator, 'language', { get: () => langs[0] })
        if (remembered) localStorage.setItem('riopalabras.language.v1', remembered)
      },
      languages,
      stored ?? null,
    )
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.privacy')
    return { page, requests, errors }
  }

  const title = (page: Page) => page.$eval('h1', (e) => e.textContent)
  const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)
  const remembered = (page: Page) => page.evaluate(() => localStorage.getItem('riopalabras.language.v1'))

  it('loads at /privacy with no Telegram, no sign-in and no Supabase call, and nothing from any other site', async () => {
    const { page, requests, errors } = await open('/privacy')
    const origin = new URL(base).origin
    expect(requests.filter((u) => !u.startsWith(origin))).toEqual([]) // not one request leaves the page's own site (so none to Telegram, Google, Supabase or the proxy)
    // and of its own site's files, none of the app: the dev server hands out source files by path, so the app's sign-in and Supabase would show here
    expect(requests.map((u) => new URL(u).pathname).filter((path) => /supabase|\/lib\/(auth|supabase)|\/data\/|\/enrich|\/auth\/|words_enriched|rio_overlay|examples_fallback|\/App\.tsx|\/main\.tsx/i.test(path))).toEqual([])
    expect(await page.evaluate(() => (window as never as { Telegram?: unknown }).Telegram)).toBeUndefined()
    expect(await page.$$eval('script[src]', (els) => els.map((e) => new URL((e as HTMLScriptElement).src).origin))).toEqual(Array(await page.$$eval('script[src]', (els) => els.length)).fill(origin))
    expect(errors).toEqual([])
    await page.close()
  }, 60_000)

  it('renders from the address alone, however it is written: /privacy, /privacy/, with or without a query', async () => {
    for (const path of ['/privacy', '/privacy/', '/privacy?lang=en', '/privacy/?lang=en', '/privacy.html']) {
      const { page } = await open(path)
      expect(await title(page), path).toBe('Privacy')
      expect(await page.$$eval('h2', (els) => els.length), path).toBe(4)
      await page.close()
    }
  }, 60_000)

  describe('the language, with no Telegram to ask', () => {
    it('follows the browser: English for an English one, Russian for a Russian one', async () => {
      const en = await open('/privacy', { languages: ['en-US'] })
      expect([await title(en.page), await htmlLang(en.page), await en.page.title()]).toEqual(['Privacy', 'en', 'Privacy · Riopalabras'])
      await en.page.close()
      const ru = await open('/privacy', { languages: ['ru-RU', 'en'] })
      expect([await title(ru.page), await htmlLang(ru.page), await ru.page.title()]).toEqual(['Конфиденциальность', 'ru', 'Конфиденциальность · Riopalabras'])
      await ru.page.close()
      const es = await open('/privacy', { languages: ['es-UY'] }) // neither: English
      expect(await title(es.page)).toBe('Privacy')
      await es.page.close()
    }, 60_000)

    it('the address asks for one (the app puts ?lang= on its link), and that wins over the browser and over the device', async () => {
      const a = await open('/privacy?lang=ru', { languages: ['en-US'], stored: 'en' })
      expect(await title(a.page)).toBe('Конфиденциальность')
      await a.page.close()
      const b = await open('/privacy?lang=en', { languages: ['ru-RU'], stored: 'ru' })
      expect(await title(b.page)).toBe('Privacy')
      await b.page.close()
    }, 60_000)

    it('with no ?lang=, what this device last used in the app wins over the browser', async () => {
      const { page } = await open('/privacy', { languages: ['en-US'], stored: 'ru' })
      expect(await title(page)).toBe('Конфиденциальность')
      await page.close()
    }, 60_000)

    it('the switch changes the language, puts it in the address, and remembers nothing on the device', async () => {
      const { page } = await open('/privacy', { languages: ['en-US'] })
      await page.click('button[lang="ru"]')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Конфиденциальность')
      expect(new URL(page.url()).searchParams.get('lang')).toBe('ru')
      expect(await htmlLang(page)).toBe('ru')
      expect(await page.title()).toBe('Конфиденциальность · Riopalabras')
      expect(await remembered(page)).toBeNull() // the app's own start is left alone
      expect(await page.$eval('button[lang="ru"]', (e) => e.getAttribute('aria-checked'))).toBe('true')
      await page.reload({ waitUntil: 'networkidle0' })
      expect(await title(page)).toBe('Конфиденциальность') // the address carries it
      await page.click('button[lang="en"]')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Privacy')
      expect(new URL(page.url()).searchParams.get('lang')).toBe('en')
      await page.close()
    }, 60_000)
  })

  it('is the page and nothing of the Mini App around it: no header with a back button, no navigation, no controls but the language switch', async () => {
    const { page } = await open('/privacy')
    expect(await page.$('.screen-header, .back-link, nav, [role="tablist"], .tile')).toBeNull()
    expect(await page.$$eval('button', (els) => els.map((e) => e.getAttribute('lang')))).toEqual(['en', 'ru'])
    await page.close()
  }, 60_000)

  it('follows the OS theme: light or dark', async () => {
    const light = await open('/privacy', { scheme: 'light' })
    const dark = await open('/privacy', { scheme: 'dark' })
    expect(await light.page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light')
    expect(await dark.page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
    const colour = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(await colour(light.page)).not.toBe(await colour(dark.page))
    await light.page.close()
    await dark.page.close()
  }, 60_000)

  describe('on a phone', () => {
    for (const width of [320, 390]) {
      for (const [name, languages] of [['English', ['en-US']], ['Russian', ['ru-RU']]] as const) {
        it(`${name} at ${width}px: nothing is wider than the screen, the text is a readable size, and the account address wraps instead of running off`, async () => {
          const { page } = await open('/privacy', { languages: [...languages], width })
          const layout = await page.evaluate(() => ({
            page: document.documentElement.scrollWidth - window.innerWidth,
            wide: Array.from(document.querySelectorAll('main *')).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5).map((e) => e.className || e.tagName),
            body: parseFloat(getComputedStyle(document.querySelector('.privacy-intro')!).fontSize),
            item: parseFloat(getComputedStyle(document.querySelector('.privacy-section p')!).fontSize),
            lineHeight: parseFloat(getComputedStyle(document.querySelector('.privacy-section p')!).lineHeight) / parseFloat(getComputedStyle(document.querySelector('.privacy-section p')!).fontSize),
            code: document.querySelector('.privacy-code')!.getBoundingClientRect().right,
          }))
          expect(layout.page).toBe(0)
          expect(layout.wide).toEqual([])
          expect(layout.body).toBeGreaterThanOrEqual(16)
          expect(layout.item).toBeGreaterThanOrEqual(16)
          expect(layout.lineHeight).toBeGreaterThanOrEqual(1.5)
          expect(layout.code).toBeLessThanOrEqual(width)
          // the address wraps only after an @ or a . (where the page lets it), never in the middle of a word
          const wrap = await page.evaluate(() => {
            const walker = document.createTreeWalker(document.querySelector('.privacy-code')!, NodeFilter.SHOW_TEXT)
            const chars: { ch: string; top: number }[] = []
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const text = node as Text
              for (let i = 0; i < text.length; i++) {
                const range = document.createRange()
                range.setStart(text, i)
                range.setEnd(text, i + 1)
                const rect = range.getClientRects()[0]
                if (rect) chars.push({ ch: text.data[i], top: Math.round(rect.top) })
              }
            }
            return { lines: new Set(chars.map((c) => c.top)).size, brokenAfter: chars.filter((c, i) => i < chars.length - 1 && chars[i + 1].top > c.top && c.ch !== '@' && c.ch !== '.').map((c) => c.ch) }
          })
          expect(wrap.brokenAfter).toEqual([])
          if (width === 320) expect(wrap.lines).toBeGreaterThanOrEqual(2) // at 320px it really has to wrap, so the check above means something
          await page.close()
        }, 60_000)
      }
    }
  })

  it('its one link is to the author, opens in a new tab with no opener, and is the only link', async () => {
    const { page } = await open('/privacy')
    expect(await page.$$eval('a', (els) => els.map((e) => [e.getAttribute('href'), e.getAttribute('target'), e.getAttribute('rel')]))).toEqual([['https://t.me/valeranevermind', '_blank', 'noopener noreferrer']])
    await page.close()
  }, 60_000)
})
