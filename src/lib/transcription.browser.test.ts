import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { closeBrowser, closeServer, launchBrowser } from '../testing/browser'

/**
 * The Cyrillic transcription after the headword in a real browser, at 320 and 360px (src/testing/genderHarness.tsx, with ?lang=ru&tr=1: the real WordCard and ReviewCard over the
 * real dictionary): small and muted, in the interface face, on the headword's line when it fits and wrapping beneath it when it does not, the stressed vowel set apart, nothing
 * scrolling sideways, on Learn's card and on both faces of the Review card. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

// The longest headwords in the dictionary (the transcription is as long again), a noun with an article, short words, and a phrase.
const WORDS = ['desafortunadamente', 'fundamentalmente', 'responsabilidad', 'infraestructura', 'establecimiento', 'estacionamiento', 'estadounidense', 'llevar', 'yo', 'calle', 'cerveza', 'extranjero', 'casa', 'de veras']

describe.skipIf(!CHROME)('the Cyrillic transcription on the cards', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5283, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await launchBrowser(CHROME)
  }, 60_000)

  afterAll(async () => {
    await closeBrowser(browser)
    await closeServer(server)
  })

  async function open(query: string, width: number): Promise<Page> {
    const tab = await (await browser.createBrowserContext()).newPage()
    await tab.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await tab.setViewport({ width, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await tab.goto(`${base}/src/testing/genderHarness.html?${query}`, { waitUntil: 'networkidle0' })
    await tab.waitForSelector('body[data-ready="1"]')
    await tab.evaluate(() => document.fonts.ready)
    return tab
  }

  for (const width of [320, 360]) {
    it(`at ${width}px: it follows the headword, is small, muted and in Manrope, the stress is set apart, and nothing scrolls sideways`, async () => {
      const page = await open(`lang=ru&tr=1&words=${WORDS.join(',')}`, width)
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('section[data-key]')).map((section) => {
          const h = section.querySelector('.case-learn .wc-headword') as HTMLElement
          const tr = h.querySelector('.wc-tr') as HTMLElement | null
          const stress = tr?.querySelector('.tr-stress') as HTMLElement | null
          const hr = h.getBoundingClientRect()
          const rects = tr ? Array.from(tr.getClientRects()) : []
          const first = rects[0]
          return {
            key: (section as HTMLElement).dataset.key!,
            text: tr?.textContent ?? null,
            hasStress: Boolean(stress),
            hidden: tr?.getAttribute('aria-hidden') ?? null,
            right: Math.max(0, ...rects.map((r) => Math.round(r.right))),
            hRight: Math.round(hr.right),
            overflow: h.scrollWidth > h.clientWidth + 1,
            trSize: tr ? parseFloat(getComputedStyle(tr).fontSize) : null,
            headSize: parseFloat(getComputedStyle(h).fontSize),
            trFont: tr ? getComputedStyle(tr).fontFamily : null,
            trColor: tr ? getComputedStyle(tr).color : null,
            headColor: getComputedStyle(h).color,
            stressWeight: stress ? Number(getComputedStyle(stress).fontWeight) : null,
            trWeight: tr ? Number(getComputedStyle(tr).fontWeight) : null,
            stressColor: stress ? getComputedStyle(stress).color : null,
            // the first line of the transcription starts at or below the headword's first line, and no more than a line and a half down
            lineHeight: parseFloat(getComputedStyle(h).lineHeight) || hr.height,
            firstTop: first ? first.top - hr.top : null,
            // inline boxes give one rect per fragment of one line, so lines are counted by distinct tops
            multi: new Set(rects.map((r) => Math.round(r.top))).size > 1,
          }
        }),
      )
      expect(rows).toHaveLength(WORDS.length)
      for (const r of rows) {
        expect(r.text, r.key).toMatch(/^\[(?:[а-яА-Я -]|\u0301)+\]$/)
        expect(r.hidden, r.key).toBe('true')
        expect(r.right, `${r.key}: the transcription stays inside the card`).toBeLessThanOrEqual(r.hRight)
        expect(r.overflow, `${r.key}: the title does not scroll sideways`).toBe(false)
        expect(r.trSize!, r.key).toBeLessThan(r.headSize)
        expect(r.trSize!, r.key).toBeLessThanOrEqual(16)
        expect(r.trFont!, r.key).toMatch(/Manrope/)
        expect(r.trColor, r.key).not.toBe(r.headColor)
        if (r.hasStress) {
          expect(r.stressWeight!, r.key).toBeGreaterThan(r.trWeight!)
          expect(r.stressColor, r.key).not.toBe(r.trColor)
        }
      }
      // one syllable: no stressed vowel
      expect(rows.find((r) => r.key === 'yo')!.hasStress).toBe(false)
      expect(rows.find((r) => r.key === 'llevar')!.hasStress).toBe(true)
      // a short word keeps the transcription on its own line; a long one lets it wrap rather than leave the card
      expect(rows.find((r) => r.key === 'llevar')!.multi).toBe(false)
      expect(rows.find((r) => r.key === 'llevar')!.firstTop!).toBeLessThan(rows.find((r) => r.key === 'llevar')!.lineHeight)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width) // no sideways scroll for the page
      await page.close()
    }, 60_000)

    it(`at ${width}px: the Review card has it on the front and on the back, inside the card`, async () => {
      const page = await open(`lang=ru&tr=1&words=${WORDS.join(',')}`, width)
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('section[data-key]')).map((section) => {
          const side = (selector: string) => {
            const h = section.querySelector(`${selector} .wc-headword`) as HTMLElement
            const tr = h.querySelector('.wc-tr') as HTMLElement | null
            return { has: Boolean(tr), right: tr ? Math.max(...Array.from(tr.getClientRects()).map((r) => Math.round(r.right))) : 0, hRight: Math.round(h.getBoundingClientRect().right), overflow: h.scrollWidth > h.clientWidth + 1 }
          }
          return { key: (section as HTMLElement).dataset.key!, front: side('.flip-front'), back: side('.flip-back') }
        }),
      )
      for (const r of rows) {
        for (const face of ['front', 'back'] as const) {
          expect(r[face].has, `${r.key} ${face}`).toBe(true)
          expect(r[face].overflow, `${r.key} ${face}`).toBe(false)
          expect(r[face].right, `${r.key} ${face}`).toBeLessThanOrEqual(r[face].hRight)
        }
      }
      await page.close()
    }, 60_000)
  }

  it('without the switch, or in English, the cards have none', async () => {
    const english = await open(`tr=1&words=llevar,yo`, 360)
    expect(await english.$$eval('.wc-tr', (els) => els.length)).toBe(0)
    await english.close()
    const off = await open(`lang=ru&words=llevar,yo`, 360)
    expect(await off.$$eval('.wc-tr', (els) => els.length)).toBe(0)
    await off.close()
  }, 60_000)
})
