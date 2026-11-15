import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { closeBrowser, closeServer, launchBrowser } from '../testing/browser'

/**
 * A noun's article before the headword in a real browser, at 320px (src/testing/genderHarness.tsx: the real WordCard and ReviewCard over the real dictionary): the longest el/la
 * and plural headwords still fit the card, nothing scrolls sideways, the article is lighter and smaller than the word and on its line, and the Review card has it on both faces.
 * Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

// The longest headwords with el/la, the longest with an article of one gender, one with a plural article, the shortest and a stressed-a word.
const LONGEST = ['vicepresidente', 'representante', 'especialista', 'protagonista', 'participante', 'corresponsal', 'responsabilidad', 'infraestructura', 'enhorabuena', 'agua', 'casa', 'gracias', 'gafas']

describe.skipIf(!CHROME)('a noun\'s article on the cards, at 320px', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5281, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await launchBrowser(CHROME)
  }, 60_000)

  afterAll(async () => {
    await closeBrowser(browser)
    await closeServer(server)
  })

  async function open(words: string[], width = 320): Promise<Page> {
    const tab = await (await browser.createBrowserContext()).newPage()
    await tab.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await tab.setViewport({ width, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await tab.goto(`${base}/src/testing/genderHarness.html?words=${words.join(',')}`, { waitUntil: 'networkidle0' })
    await tab.waitForSelector('body[data-ready="1"]')
    await tab.evaluate(() => document.fonts.ready)
    return tab
  }

  it('Learn / word page card: the article is before the word, lighter and smaller, and the title fits at 320px', async () => {
    const page = await open(LONGEST)
    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('section[data-key]')).map((section) => {
        const h = section.querySelector('.case-learn .wc-headword') as HTMLElement
        const a = h.querySelector('.wc-article') as HTMLElement | null
        const hr = h.getBoundingClientRect()
        const ar = a?.getBoundingClientRect()
        return {
          key: (section as HTMLElement).dataset.key!,
          text: h.textContent,
          article: a?.textContent ?? null,
          right: Math.round(hr.right),
          overflow: h.scrollWidth > h.clientWidth + 1,
          articleFirst: a ? h.firstElementChild === a : null,
          articleSize: a ? parseFloat(getComputedStyle(a).fontSize) : null,
          wordSize: parseFloat(getComputedStyle(h).fontSize),
          articleWeight: a ? getComputedStyle(a).fontWeight : null,
          wordWeight: getComputedStyle(h).fontWeight,
          articleColor: a ? getComputedStyle(a).color : null,
          wordColor: getComputedStyle(h).color,
          articleLeft: ar ? Math.round(ar.left) : null,
          headLeft: Math.round(hr.left),
        }
      }),
    )
    expect(rows.length).toBe(LONGEST.length)
    for (const r of rows) {
      expect(r.article, r.key).not.toBeNull()
      expect(r.text, r.key).toMatch(/^(el\/la|el|la|los|las) \S/)
      expect(r.articleFirst, r.key).toBe(true)
      expect(r.articleLeft, `${r.key}: the article starts the title`).toBe(r.headLeft)
      expect(r.right, `${r.key}: the title stays inside the screen`).toBeLessThanOrEqual(320)
      expect(r.overflow, `${r.key}: the title does not scroll sideways`).toBe(false)
      expect(r.articleSize!, r.key).toBeLessThan(r.wordSize)
      expect(Number(r.articleWeight), r.key).toBeLessThan(Number(r.wordWeight))
      expect(r.articleColor, r.key).not.toBe(r.wordColor)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320) // no sideways scroll for the page
    await page.close()
  }, 60_000)

  it('the Review card shows it on the front and on the back, and the front is as wide as the screen allows', async () => {
    const page = await open(LONGEST)
    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('section[data-key]')).map((section) => {
        const front = section.querySelector('.flip-front .wc-headword') as HTMLElement
        const back = section.querySelector('.flip-back .wc-headword') as HTMLElement
        return { key: (section as HTMLElement).dataset.key!, front: front.textContent, back: back.textContent, frontRight: Math.round(front.getBoundingClientRect().right), frontOver: front.scrollWidth > front.clientWidth + 1 }
      }),
    )
    for (const r of rows) {
      expect(r.front, r.key).toMatch(/^(el\/la|el|la|los|las) \S/)
      expect(r.back, r.key).toBe(r.front)
      expect(r.frontRight, r.key).toBeLessThanOrEqual(320)
      expect(r.frontOver, r.key).toBe(false)
    }
    await page.close()
  }, 60_000)

  it('the article is read with the word, and the bare title is unchanged: a word without it has no span and the same text as the headword', async () => {
    const page = await open(['casa'])
    const [withArticle, bare] = await page.evaluate(() => [document.querySelector('.case-learn .wc-headword')!.textContent, document.querySelector('.case-bare .wc-headword')!.textContent])
    expect(withArticle).toBe('la casa')
    expect(bare).toBe('casa')
    expect(await page.$('.case-bare .wc-article')).toBeNull()
    await page.close()
  }, 60_000)

  it('at the narrowest phones (320px) the longest el/la title takes at most three lines', async () => {
    const page = await open(['vicepresidente', 'representante'])
    const lines = await page.evaluate(() => Array.from(document.querySelectorAll('.case-learn .wc-headword')).map((h) => Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight))))
    for (const n of lines) expect(n).toBeLessThanOrEqual(3)
    await page.close()
  }, 60_000)
})
