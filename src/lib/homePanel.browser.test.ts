import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { setLanguage } from './language'
import { strings } from '../strings'

/**
 * The Practice tile and its panel on Home, in a real browser (src/testing/settingsHarness.tsx, `ready=1`; `endofday=N` for the end of the day; window.__taps records which Home
 * handler a button calls). The panel (Matching and Cloze) covers the dock under the tiles: the same footprint, so opening it moves nothing and the page does not grow; the tile
 * says whether it is open; a second tap on the tile, a tap anywhere else and Escape close it. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('the Practice panel on Home, in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5273, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(query = 'goal=10', size: { width: number; height: number } = { width: 380, height: 700 }) {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setViewport({ ...size, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/settingsHarness.html?ready=1&${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.home-actions')
    return page
  }
  const expanded = (page: Page) => page.$eval('[data-tile="practice"]', (e) => e.getAttribute('aria-expanded'))
  const panelShown = (page: Page) => page.$eval('.home-panel', (e) => !(e as HTMLElement).hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0)
  const taps = (page: Page) => page.evaluate(() => (window as never as { __taps: string[] }).__taps)
  /** Where everything is: the layout that opening the panel must not change. */
  const layout = (page: Page) =>
    page.evaluate(() => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect()
        return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]
      }
      return {
        page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight, window.innerWidth, window.innerHeight],
        tiles: [...document.querySelectorAll('.tile')].map(box),
        actions: box(document.querySelector('.home-actions')!),
        dock: box(document.querySelector('.home-dock')!),
        above: [...document.querySelectorAll('.home-status, .home-advice, .home-spacer, .wotd')].map(box),
      }
    })

  it('closed to begin with; a tap on Practice opens the panel over the dock, and a second tap closes it', async () => {
    const page = await open()
    expect(await expanded(page)).toBe('false')
    expect(await panelShown(page)).toBe(false)
    await page.click('[data-tile="practice"]')
    expect(await expanded(page)).toBe('true')
    expect(await panelShown(page)).toBe(true)
    await page.click('[data-tile="practice"]')
    expect(await expanded(page)).toBe('false')
    expect(await panelShown(page)).toBe(false)
    await page.close()
  }, 60_000)

  it('while the panel is open the Practice tile is drawn open (is-open, a ring), in step with aria-expanded, whether it is lavender or the filled advised one; nothing else is', async () => {
    for (const query of ['goal=10', 'endofday=8&goal=10']) {
      const page = await open(query)
      const look = () =>
        page.evaluate(() => {
          const tile = document.querySelector<HTMLElement>('[data-tile="practice"]')!
          return { open: tile.classList.contains('is-open'), expanded: tile.getAttribute('aria-expanded'), ring: getComputedStyle(tile).boxShadow, others: [...document.querySelectorAll('.tile:not([data-tile="practice"]), .mode')].filter((e) => e.classList.contains('is-open')).length }
        })
      const closed = await look()
      expect(closed, query).toMatchObject({ open: false, expanded: 'false', ring: 'none', others: 0 })
      await page.click('[data-tile="practice"]')
      const opened = await look()
      expect(opened, query).toMatchObject({ open: true, expanded: 'true', others: 0 })
      expect(opened.ring, query).not.toBe('none')
      expect(opened.ring, query).toContain('inset')
      await page.click('[data-tile="practice"]')
      expect(await look(), query).toMatchObject({ open: false, expanded: 'false', ring: 'none' })
      await page.keyboard.press('Escape') // already closed: nothing happens
      await page.close()
    }
  }, 60_000)

  it('the progress line is at the top of the dock, 11px under the tiles, and the dock is still 88px', async () => {
    const page = await open('goal=10')
    const seen = await page.evaluate(() => {
      const tiles = document.querySelector('.home-tiles')!.getBoundingClientRect()
      const dock = document.querySelector('.home-dock')!.getBoundingClientRect()
      const line = document.querySelector('.home-progress')!.getBoundingClientRect()
      return { gapToLine: Math.round(line.top - tiles.bottom), lineInTopHalf: line.bottom < dock.top + dock.height / 2, dock: Math.round(dock.height) }
    })
    expect(seen).toEqual({ gapToLine: 11, lineInTopHalf: true, dock: 88 })
    await page.close()
  }, 60_000)

  it('the labels of the three tiles are level (top-aligned text), with different reasons under them', async () => {
    const page = await open('endofday=8&goal=10&lang=ru') // Learn and Review are disabled with two-line reasons, Practice is not
    const tops = await page.$$eval('.tile-label', (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
    expect(new Set(tops).size).toBe(1)
    await page.close()
  }, 60_000)

  it('is not opened by itself, not even at the end of the day when Practice is the filled tile', async () => {
    const page = await open('endofday=8&goal=10')
    expect(await page.$eval('[data-tile="practice"]', (e) => e.classList.contains('is-primary'))).toBe(true)
    expect(await expanded(page)).toBe('false')
    expect(await panelShown(page)).toBe(false)
    await page.close()
  }, 60_000)

  it('closes on a tap anywhere outside the panel and the tile, and on Escape (the focus goes back to the tile); a tap inside the panel, on a free slot, leaves it open', async () => {
    const page = await open()
    await page.click('[data-tile="practice"]')
    const free = await page.$eval('.home-panel', (e) => {
      const r = e.getBoundingClientRect()
      return { x: r.right - 24, y: r.top + r.height / 2 } // the third slot: nothing there yet
    })
    await page.mouse.click(free.x, free.y)
    expect(await panelShown(page)).toBe(true)
    await page.click('.screen-header')
    expect(await panelShown(page)).toBe(false)
    expect(await expanded(page)).toBe('false')

    await page.click('[data-tile="practice"]')
    expect(await panelShown(page)).toBe(true)
    await page.focus('[data-tile="matching"]') // the focus is in the panel, as a keyboard user's is after Tab
    await page.keyboard.press('Escape')
    expect(await panelShown(page)).toBe(false)
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-tile'))).toBe('practice')
    await page.close()
  }, 60_000)

  it('a tap on another tile while it is open closes it and still does what the tile does (it is not swallowed)', async () => {
    const page = await open()
    await page.click('[data-tile="practice"]')
    await page.click('[data-tile="review"]')
    expect(await panelShown(page)).toBe(false)
    expect(await taps(page)).toEqual(['review'])
    await page.close()
  }, 60_000)

  it('Matching and Cloze open the exercises as they did from the tiles, and the panel is a labelled group', async () => {
    const page = await open()
    expect(await page.$eval('.home-panel', (e) => [e.getAttribute('role'), e.getAttribute('aria-label')])).toEqual(['group', 'Practice exercises'])
    expect(await page.$eval('[data-tile="practice"]', (e) => e.getAttribute('aria-controls'))).toBe(await page.$eval('.home-panel', (e) => e.id))
    await page.click('[data-tile="practice"]')
    await page.click('[data-tile="matching"]')
    await page.click('[data-tile="cloze"]')
    expect(await taps(page)).toEqual(['matching', 'cloze'])
    await page.close()
  }, 60_000)

  it('the panel is exactly where the dock is, and opening it moves nothing: not a tile, not the word card, not the height of the page', async () => {
    for (const query of ['goal=10', 'endofday=8&goal=10&lang=ru']) {
      const page = await open(query)
      const before = await layout(page)
      await page.click('[data-tile="practice"]')
      const after = await layout(page)
      expect(after, query).toEqual(before)
      const rect = (selector: string) => page.$eval(selector, (e) => Object.values(e.getBoundingClientRect().toJSON()).map((n) => Math.round((n as number) * 10) / 10))
      expect(await rect('.home-panel')).toEqual(await rect('.home-dock'))
      await page.close()
    }
  }, 60_000)

  // Together the tiles and the dock take no more height than the 2x2 grid did (two rows of 96 and a gap of 14), and Home does not scroll in a compact Mini App window.
  describe.each([
    [380, 700],
    [320, 640],
  ])('at %ipx by %ipx', (width, height) => {
    it.each(['en', 'ru'])('%s: the block is 206px at most, closed and open, and the page does not scroll', async (lang) => {
      for (const query of [`lang=${lang}&goal=5`, `lang=${lang}&endofday=12&goal=12`, `lang=${lang}&endofday=8&goal=10`]) {
        const page = await open(query, { width, height })
        for (const isOpen of [false, true]) {
          if (isOpen) await page.click('[data-tile="practice"]')
          const seen = await layout(page)
          expect(seen.actions[3], `${query} ${isOpen}`).toBeLessThanOrEqual(206)
          expect(seen.page[1], `${query} ${isOpen}: vertical scroll`).toBeLessThanOrEqual(seen.page[3])
          expect(seen.page[0], `${query} ${isOpen}: horizontal scroll`).toBeLessThanOrEqual(seen.page[2])
        }
        await page.close()
      }
    }, 120_000)

    // The reasons a tile can give in place of its Spanish word, set into each tile in turn: the longest take three lines at these widths, and the block must still be 206px.
    it.each(['en', 'ru'])('%s: every reason a tile can give fits the tile, and the block stays 206px', async (lang) => {
      setLanguage(lang as 'en' | 'ru')
      const reasons = [strings.home.learnPoolEmpty, strings.home.learnGoalOff, strings.home.learnCapReached, strings.home.reviewNothingDue, strings.practice.needWords]
      setLanguage('en')
      const page = await open(`lang=${lang}&endofday=12&goal=12`, { width, height })
      for (const reason of reasons) {
        const seen = await page.evaluate((text) => {
          const tiles = [...document.querySelectorAll<HTMLButtonElement>('.tile')]
          for (const tile of tiles) {
            tile.disabled = true // a reason is only ever shown on a disabled tile, in its plain type
            tile.querySelector('.tile-sub')!.textContent = text
          }
          return { tiles: tiles.map((t) => [t.getBoundingClientRect().height, t.scrollHeight > t.clientHeight + 1, t.scrollWidth > t.clientWidth + 1]), block: document.querySelector('.home-actions')!.getBoundingClientRect().height }
        }, reason)
        for (const [h, tall, wide] of seen.tiles) expect([reason, h, tall, wide]).toEqual([reason, 104, false, false])
        expect(seen.block, reason).toBe(206)
      }
      await page.close()
    }, 120_000)

    // The panel has three slots and two are filled. The third will hold «Вспомни слово» (Russian) / «Recall» (English): it must fit as it stands, wrapping between words, never inside one.
    it.each([
      ['ru', 'Вспомни слово'],
      ['en', 'Recall'],
    ])('%s: a third button labelled «%s» fits its slot and the panel, wrapping only between words', async (lang, label) => {
      const page = await open(`lang=${lang}&goal=5`, { width, height })
      await page.click('[data-tile="practice"]')
      const seen = await page.evaluate((text) => {
        const panel = document.querySelector('.home-panel')!
        const third = document.createElement('button')
        third.type = 'button'
        third.className = 'mode'
        third.innerHTML = `<span class="mode-label">${text}</span><span class="mode-sub">recordar</span>`
        panel.appendChild(third)
        const buttons = [...panel.querySelectorAll<HTMLElement>('.mode')]
        const range = document.createRange()
        range.selectNodeContents(third.querySelector('.mode-label')!)
        const words = text.split(' ')
        const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
        const p = panel.getBoundingClientRect()
        return {
          widths: buttons.map((b) => Math.round(b.getBoundingClientRect().width)),
          lines,
          words: words.length,
          overflows: third.scrollWidth > third.clientWidth || third.scrollHeight > third.clientHeight,
          insidePanel: buttons.every((b) => b.getBoundingClientRect().bottom <= p.bottom && b.getBoundingClientRect().right <= p.right),
          oneRow: new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size === 1,
        }
      }, label)
      expect(new Set(seen.widths).size).toBe(1) // three equal slots
      expect(seen.oneRow).toBe(true)
      expect(seen.overflows).toBe(false)
      expect(seen.insidePanel).toBe(true)
      expect(seen.lines).toBeLessThanOrEqual(seen.words) // at most a line for each word: a word is never split
      await page.close()
    }, 60_000)
  })
})
