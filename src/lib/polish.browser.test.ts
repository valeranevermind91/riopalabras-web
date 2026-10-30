import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * The polish pass in a real browser, at 320px: no line of text ends on a single word where the app wraps it (a title, a hint, a line of advice, a
 * tile's reason, the intro), and the Cloze screen's instruction, focus ring and spent Hint / Reveal row. Needs a Chrome or Chromium; skipped without one
 * (CHROME_PATH). `text-wrap: pretty` and `balance` are Chrome 117+; an older browser ignores them, which is the intended fallback and is not tested here.
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('the polish pass in a browser, at 320px', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5271, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(page: string, query: string, language?: 'ru', width = 320) {
    const tab = await (await browser.createBrowserContext()).newPage()
    await tab.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await tab.setViewport({ width, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    if (language) await tab.evaluateOnNewDocument((code) => localStorage.setItem('riopalabras.language.v1', code), language)
    await tab.goto(`${base}/src/testing/${page}.html?${query}`, { waitUntil: 'networkidle0' })
    return tab
  }

  /** Blocks matching `selector` whose last line is a single word of a text that takes more than one line: "word ← the text it ends". */
  const loneLastWords = (page: Page, selector: string) =>
    page.evaluate((sel) => {
      const found: string[] = []
      for (const block of Array.from(document.querySelectorAll(sel))) {
        const words: { w: string; top: number }[] = []
        for (const node of Array.from(block.childNodes)) {
          if (node.nodeType !== 3) continue
          const re = /\S+/g
          let m: RegExpExecArray | null
          while ((m = re.exec(node.textContent ?? ''))) {
            const range = document.createRange()
            range.setStart(node, m.index)
            range.setEnd(node, m.index + m[0].length)
            const rect = range.getClientRects()[0]
            if (rect) words.push({ w: m[0], top: Math.round(rect.top) })
          }
        }
        const tops = [...new Set(words.map((x) => x.top))]
        if (words.length < 3 || tops.length < 2) continue
        const last = words.filter((x) => x.top === tops[tops.length - 1])
        if (last.length === 1) found.push(`${last[0].w} ← ${words.map((x) => x.w).join(' ')}`)
      }
      return found
    }, selector)

  const SETTINGS_TEXT = '.setting-label, .setting-hint, .settings-label, .setting-note'
  const INTRO_TEXT = '.intro-text, .intro-note, .intro-line, .intro-title'
  const END_TEXT = '.post-batch h2, .post-batch .subtitle, .post-batch-why'
  const HOME_TEXT = '.home-advice, .tile-text'

  for (const language of ['en', 'ru'] as const) {
    const lang = language === 'ru' ? ('ru' as const) : undefined
    const name = language === 'en' ? 'English' : 'Russian'

    it(`${name}: Settings has no line that ends on one word (the goal's "per day", the placement row's hint)`, async () => {
      const page = await open('settingsHarness', `goal=18&lang=${language}`, lang)
      await page.waitForSelector('main')
      await page.click('button[aria-label="Settings"], button[aria-label="Настройки"]')
      await page.waitForSelector('.settings')
      expect(await page.$$eval('.setting-hint', (els) => els.length)).toBeGreaterThan(3) // there is text to check
      expect(await loneLastWords(page, SETTINGS_TEXT)).toEqual([])
      await page.close()
    }, 60_000)

    it(`${name}: the intro's steps have none (the language step, "What is inside")`, async () => {
      const page = await open('settingsHarness', `fresh=1&goal=default&lang=${language}`, lang)
      await page.waitForSelector('.intro-title')
      expect(await loneLastWords(page, INTRO_TEXT)).toEqual([])
      for (const step of [2]) {
        for (let n = 0; n < step; n++) await page.evaluate(() => (document.querySelector('.intro-footer .btn:last-child') as HTMLElement).click())
      }
      await page.waitForSelector('.intro-list')
      expect(await page.$$eval('.intro-list li', (els) => els.length)).toBe(4)
      expect(await loneLastWords(page, INTRO_TEXT)).toEqual([])
      await page.close()
    }, 60_000)

    it(`${name}: the goal step of the intro, with its explanation under the stepper, has none and fits the screen`, async () => {
      const page = await open('settingsHarness', `fresh=1&goal=default&lang=${language}`, lang)
      await page.waitForSelector('.intro-title')
      for (let n = 0; n < 4; n++) await page.evaluate(() => (document.querySelector('.intro-footer .btn:last-child') as HTMLElement).click())
      await page.waitForSelector('[data-step="placement"]')
      await page.evaluate(() => ((document.querySelector('.place-skip .link-btn') ?? document.querySelector('.place-footer .btn-primary')) as HTMLElement).click()) // the test has its own buttons (with no dictionary loaded here it says it is unavailable): either goes on
      await page.waitForSelector('[data-step="goal"]')
      const notes = await page.$$eval('[data-step="goal"] .intro-note', (els) => els.map((e) => e.textContent))
      expect(notes).toHaveLength(1) // the explanation; the sessions note only joins it from 16
      expect(notes[0]).toMatch(language === 'en' ? /^Every word you learn comes back for review/ : /^Каждое выученное слово возвращается на повторение/)
      expect(await loneLastWords(page, INTRO_TEXT)).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.close()
    }, 60_000)

    it(`${name}: the end of Learn for the day has none (the title, the line under it, the why)`, async () => {
      const page = await open('offerHarness', `limit=0&pool=14&lang=${language}`, lang)
      await page.waitForSelector('.post-batch-why')
      expect(await loneLastWords(page, END_TEXT)).toEqual([])
      await page.close()
    }, 60_000)
  }

  it('Russian Home: the advice line and the tiles\' reasons have none', async () => {
    const page = await open('reviewHarness', 'due=0&pool=30', 'ru')
    await page.waitForSelector('.home-advice')
    expect(await loneLastWords(page, HOME_TEXT)).toEqual([])
    await page.close()
  }, 60_000)

  it('English Home, with the day\'s new words used up: the tile says "More tomorrow", on one line, and nothing ends on one word', async () => {
    const page = await open('reviewHarness', 'due=0&pool=30&met=1&limit=10')
    await page.waitForSelector('.home-advice')
    expect(await loneLastWords(page, HOME_TEXT)).toEqual([])
    await page.close()
  }, 60_000)

  describe('Cloze', () => {
    const openCloze = () => open('logHarness', 'screen=cloze&learned=12')

    it('says what to type, under the progress bar', async () => {
      const page = await openCloze()
      await page.waitForSelector('.cz-card')
      expect(await page.$eval('.cz-instruction', (e) => e.textContent)).toBe('Type the missing word, in any form.')
      expect(await page.$eval('.cz-instruction', (e) => (e.previousElementSibling as HTMLElement).getAttribute('role'))).toBe('progressbar')
      await page.close()
    }, 60_000)

    it('in Russian too, and "Ответ" fits its button on one line (it used to wrap as «Показать ответ»)', async () => {
      const page = await open('logHarness', 'screen=cloze&learned=12', 'ru')
      await page.waitForSelector('.cz-card')
      expect(await page.$eval('.cz-instruction', (e) => e.textContent)).toBe('Впишите пропущенное слово — в любой форме.')
      const lines = await page.$$eval('.cz-secondary .btn', (els) => els.map((b) => {
        const range = document.createRange()
        range.selectNodeContents(b)
        return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size
      }))
      expect(lines).toEqual([1, 1])
      await page.close()
    }, 60_000)

    it('the answer field is focused in the practice colour, not the browser\'s blue', async () => {
      const page = await openCloze()
      await page.waitForSelector('.cz-input')
      await page.focus('.cz-input')
      const look = await page.evaluate(() => {
        const input = document.querySelector('.cz-input') as HTMLElement
        const probe = document.createElement('i')
        probe.style.color = 'var(--lav)'
        document.body.append(probe)
        const lav = getComputedStyle(probe).color
        const style = getComputedStyle(input)
        return { focused: document.activeElement === input, outlineColor: style.outlineColor, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, lav }
      })
      expect(look.focused).toBe(true)
      expect(look.outlineStyle).toBe('solid')
      expect(look.outlineWidth).toBe('2px')
      expect(look.outlineColor).toBe(look.lav)
      await page.close()
    }, 60_000)

    it('once the question is answered the Hint / Reveal row is hidden but keeps its place, and cannot be reached', async () => {
      const page = await openCloze()
      await page.waitForSelector('.cz-card')
      const before = await page.$eval('.cz-secondary', (e) => ({ height: e.getBoundingClientRect().height, visibility: getComputedStyle(e).visibility }))
      expect(before.visibility).toBe('visible')
      await page.evaluate(() => (document.querySelectorAll('.cz-secondary .btn')[1] as HTMLElement).click()) // Reveal
      await page.waitForSelector('.cz-secondary.is-spent')
      const after = await page.$eval('.cz-secondary', (e) => ({ height: e.getBoundingClientRect().height, visibility: getComputedStyle(e).visibility }))
      expect(after.visibility).toBe('hidden') // not drawn, not focusable, not read out
      expect(after.height).toBe(before.height) // and the space stays, so nothing below it jumps
      expect(await page.$eval('.cz-dock .btn-primary', (e) => e.textContent)).toBe('Continue')
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.activeElement?.closest('.cz-secondary'))).toBeNull()
      await page.close()
    }, 60_000)
  })
})
