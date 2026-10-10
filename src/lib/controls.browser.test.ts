import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { en } from '../strings'
import { ru } from '../strings.ru'

/**
 * The Filters and Sort buttons on the Words screen at the narrowest width the app supports (320px), in both languages: the text of neither
 * button overflows its box, whatever the sort is, including "Best match" (a search on) and "Лучшее совпадение". A value that is too long for the
 * button is cut with an ellipsis, never wrapped and never spilling out. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

const WIDTH = 320
const SORT_KEYS = ['frequency', 'az', 'due', 'recent', 'random'] as const

describe.skipIf(!CHROME)('the Filters and Sort buttons at 320px', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5243, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(lang: 'en' | 'ru') {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setViewport({ width: WIDTH, height: 700, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/wordsHarness.html?lang=${lang}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => (window as never as { __ready?: boolean }).__ready === true)
    await page.waitForSelector('.word-row')
    return page
  }

  type Fit = { face: string; label: string; name: string | null; buttonBox: [number, number]; labelBox: [number, number]; buttonOverflows: boolean; labelInside: boolean; oneLine: boolean; ellipsised: boolean; pageOverflows: boolean }
  /** What each of the two buttons looks like right now: its face text, name, and whether anything of it is outside its box. */
  const fits = (page: Page): Promise<Fit[]> =>
    page.$$eval('.words-controls .control-btn', (buttons) =>
      buttons.map((b) => {
        const label = b.querySelector('.control-label') as HTMLElement
        const box = b.getBoundingClientRect()
        const text = label.getBoundingClientRect()
        const style = getComputedStyle(b)
        const inner = [box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft), box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight)]
        const lineHeight = parseFloat(getComputedStyle(label).lineHeight) || parseFloat(getComputedStyle(label).fontSize) * 1.3
        return {
          face: (b.textContent ?? '').trim(),
          label: (label.textContent ?? '').trim(),
          name: b.getAttribute('aria-label'),
          buttonBox: [Math.round(box.left), Math.round(box.right)] as [number, number],
          labelBox: [Math.round(text.left), Math.round(text.right)] as [number, number],
          buttonOverflows: b.scrollWidth > b.clientWidth,
          labelInside: text.left >= inner[0] - 0.5 && text.right <= inner[1] + 0.5,
          oneLine: text.height <= lineHeight * 1.5, // wrapping would make it taller
          ellipsised: label.scrollWidth > label.clientWidth, // cut: allowed, the ellipsis shows
          pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
        }
      }),
    )

  const expectFits = (all: Fit[], context: string) => {
    for (const fit of all) {
      expect(fit.buttonOverflows, `${context}: "${fit.face}" overflows its button`).toBe(false)
      expect(fit.labelInside, `${context}: "${fit.label}" is outside its button (${JSON.stringify(fit.labelBox)} in ${JSON.stringify(fit.buttonBox)})`).toBe(true)
      expect(fit.oneLine, `${context}: "${fit.label}" wraps`).toBe(true)
      expect(fit.pageOverflows, `${context}: the page scrolls sideways`).toBe(false)
    }
  }

  const openSort = async (page: Page) => {
    await page.evaluate(() => (document.querySelector('.words-controls .control-btn:nth-child(2)') as HTMLElement).click())
    await page.waitForSelector('.sheet')
  }
  const chooseSort = async (page: Page, index: number) => {
    await openSort(page)
    await page.evaluate((i) => (document.querySelectorAll('.sheet-row')[i] as HTMLElement).click(), index)
    await page.waitForFunction(() => document.querySelector('.sheet') === null)
  }

  for (const [lang, t] of [['en', en.words], ['ru', ru.words]] as const) {
    describe(lang === 'en' ? 'in English' : 'in Russian', () => {
      it('every sort value fits: the face is the icon and the value alone, the whole phrase is the name', async () => {
        const page = await open(lang)
        for (const [i, key] of SORT_KEYS.entries()) {
          if (i > 0) await chooseSort(page, i)
          const [filters, sort] = await fits(page)
          expectFits([filters, sort], `${lang} ${key}`)
          expect(sort.face).toBe(t.sorts[key]) // no "Sort:" on the face
          expect(sort.label).toBe(t.sorts[key])
          expect(sort.name).toBe(t.sortButton(t.sorts[key])) // a screen reader still hears "Sort: ..."
          expect(await page.$('.words-controls .control-btn:nth-child(2) svg[aria-hidden="true"]')).not.toBeNull() // the icon, hidden from the tree
        }
        await page.close()
      }, 90_000)

      it(`the search's "${t.bestMatch}" fits too`, async () => {
        const page = await open(lang)
        await page.type('.words-search', 'casa')
        await page.waitForFunction(() => (document.querySelector('.words-controls .control-btn:nth-child(2)') as HTMLButtonElement).disabled)
        const [filters, sort] = await fits(page)
        expectFits([filters, sort], `${lang} best match`)
        expect(sort.face).toBe(t.bestMatch)
        expect(sort.name).toBe(t.sortButton(t.bestMatch))
        await page.close()
      }, 90_000)

      it('Filters fits, with nothing on and with every filter on (the count beside the word)', async () => {
        const page = await open(lang)
        const [none] = await fits(page)
        expectFits([none], `${lang} no filters`)
        expect(none.face).toBe(t.filtersButton)

        await page.evaluate(() => (document.querySelector('.words-controls .control-btn') as HTMLElement).click())
        await page.waitForSelector('.sheet')
        // Due now, Favourites, Queued, Custom and a part of speech: five filters at once
        await page.evaluate(() => {
          const chips = Array.from(document.querySelectorAll('.sheet .chip')) as HTMLElement[]
          for (const i of [4, 5, 6, 7, 8]) chips[i].click()
        })
        await page.waitForFunction(() => document.querySelector('.words-controls .control-count')?.textContent === '5')
        await page.evaluate(() => (document.querySelector('.sheet-backdrop') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })))
        await page.waitForFunction(() => document.querySelector('.sheet') === null)
        const [many] = await fits(page)
        expectFits([many], `${lang} five filters`)
        expect(many.face).toBe(`${t.filtersButton}5`)
        await page.close()
      }, 90_000)
    })
  }

  it('a value that is too long for the button is cut with an ellipsis, not wrapped and not spilling out', async () => {
    const page = await open('ru')
    await chooseSort(page, 2) // "Ближайшие повторы": the longest that is not "Лучшее совпадение"
    const [, sort] = await fits(page)
    expect(sort.ellipsised).toBe(true) // it does not all fit in 320px next to the icon: cut
    expectFits([sort], 'ru due')
    expect(await page.$eval('.words-controls .control-btn:nth-child(2) .control-label', (e) => getComputedStyle(e).textOverflow)).toBe('ellipsis')
    expect(await page.$eval('.words-controls .control-btn:nth-child(2) .control-label', (e) => getComputedStyle(e).whiteSpace)).toBe('nowrap')
    await page.close()
  }, 90_000)

  it('the buttons are not cut at a wider width: the whole value shows', async () => {
    const page = await open('en')
    await page.setViewport({ width: 390, height: 700, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    const [filters, sort] = await fits(page)
    expect(sort.ellipsised).toBe(false)
    expect(filters.ellipsised).toBe(false)
    await page.close()
  }, 90_000)
})
