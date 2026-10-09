import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { parseDictionary } from '../data/dictionary'
import { placementPool } from '../data/placement'
import { en } from '../strings'
import { ru } from '../strings.ru'

/**
 * The placement test in a real browser (src/testing/settingsHarness.tsx with the real dictionary): five sets of five words in the intro
 * and on its own from Settings, marking, Skip, Back, the start rank and the hidden words it writes, and the return to Settings.
 * Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

// Where each band starts, worked out from the dictionary the same way the app does: five equal parts of the words the test may show.
const pool = placementPool(parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8'))))
const BAND_STARTS = [0, 1, 2, 3, 4].map((k) => pool[Math.floor((k * pool.length) / 5)].rank!)

describe.skipIf(!CHROME)('the placement test in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5237, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(query: string) {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/settingsHarness.html?dict=1&${query}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => (window as never as { __dictionary?: boolean }).__dictionary === true)
    await page.waitForSelector('main')
    return page
  }

  type Sent = { settings: Record<string, unknown>[]; hidden: string[][] }
  const sent = (page: Page) => page.evaluate(() => (window as never as { __sent: Sent }).__sent)
  const pressBack = (page: Page) => page.evaluate(() => (window as never as { __pressBack: () => string }).__pressBack())
  const clickText = (page: Page, selector: string, text: string) =>
    page.evaluate((sel, t) => (Array.from(document.querySelectorAll(sel)).find((b) => b.textContent?.trim().startsWith(t)) as HTMLElement).click(), selector, text)
  const stepText = (page: Page) => page.$eval('.intro-progress span', (e) => e.textContent)
  const setText = (page: Page) => page.$eval('.place-progress span', (e) => e.textContent)
  const chips = (page: Page) => page.$$eval('.place-chip', (els) => els.map((e) => e.textContent ?? ''))
  const pressed = (page: Page) => page.$$eval('.place-chip', (els) => els.map((e) => e.getAttribute('aria-pressed') === 'true'))
  /** Marks the first n words of the set on screen. */
  const mark = async (page: Page, n: number) => {
    for (let i = 0; i < n; i++) await page.evaluate((k) => (document.querySelectorAll('.place-chip')[k] as HTMLElement).click(), i)
  }
  const forward = (page: Page) => page.evaluate(() => (document.querySelector('.place-footer .btn-primary') as HTMLElement).click())
  /** Goes through the five sets marking `counts[k]` words in set k; the last Continue is "Finish". */
  const takeTest = async (page: Page, counts: number[]) => {
    for (let k = 0; k < 5; k++) {
      await page.waitForFunction((n) => document.querySelector('.place-progress span')?.textContent?.includes(`${n} `), {}, k + 1)
      await mark(page, counts[k])
      await forward(page)
    }
  }
  const toPlacement = async (page: Page) => {
    for (let n = 1; n < 5; n++) await clickText(page, '.intro-footer .btn', 'Continue')
    await page.waitForSelector('[data-step="placement"]')
  }
  const toSettings = async (page: Page) => {
    await page.evaluate(() => (document.querySelector('.screen-header-actions .icon-btn:last-child') as HTMLElement).click())
    await page.waitForSelector('.settings')
  }
  const startRanks = async (page: Page) => (await sent(page)).settings.filter((p) => 'start_rank' in p).map((p) => p.start_rank)

  describe('in the intro', () => {
    it('is the fourth step after the language: five sets of five different words, one set per screen, with its own progress, and Skip on every one', async () => {
      const page = await open('fresh=1&goal=default&lang=en')
      await toPlacement(page)
      expect(await stepText(page)).toBe('Step 5 of 7')
      expect(await page.$eval('h1', (e) => e.textContent)).toBe('Placement test')
      expect(await page.$eval('.intro-footer', (e) => e.textContent).catch(() => null)).toBeNull() // the shell's footer is not drawn: the test has its own buttons
      const all: string[] = []
      for (let k = 1; k <= 5; k++) {
        expect(await setText(page)).toBe(`Set ${k} of 5`)
        expect(await page.$eval('[role="progressbar"][aria-label="Placement test progress"]', (e) => e.getAttribute('aria-valuenow'))).toBe(String(k))
        expect(await page.$eval('.place-question', (e) => e.textContent)).toBe('Which of these do you know?')
        expect(await page.$$eval('.intro-note', (els) => els.map((e) => e.textContent))).toContain('Only mark the words whose meaning you are sure of.')
        expect(await page.$eval('.place-skip .link-btn', (e) => e.textContent)).toBe('Skip')
        expect(await page.$eval('.place-skip .intro-note', (e) => e.textContent)).toBe('It can be taken later from Settings.')
        const words = await chips(page)
        expect(words).toHaveLength(5)
        all.push(...words)
        expect(await page.$$eval('.place-chip', (els) => els.every((e) => getComputedStyle(e).fontFamily.includes('Fraunces')))).toBe(true) // Spanish words in the display face
        expect(await page.$$eval('.place-footer .btn', (els) => els.map((e) => e.textContent))).toEqual(['Back', k === 5 ? 'Finish' : 'Continue'])
        if (k < 5) await forward(page)
      }
      expect(new Set(all).size).toBe(25) // no word twice
      expect(await sent(page)).toMatchObject({ hidden: [] })
      await page.close()
    }, 90_000)

    it('words toggle, nothing says right or wrong, and none marked can continue; no score and no praise anywhere', async () => {
      const page = await open('fresh=1&goal=default&lang=en')
      await toPlacement(page)
      expect(await pressed(page)).toEqual([false, false, false, false, false])
      await mark(page, 2)
      expect(await pressed(page)).toEqual([true, true, false, false, false])
      await page.evaluate(() => (document.querySelectorAll('.place-chip')[0] as HTMLElement).click()) // toggles back off
      expect(await pressed(page)).toEqual([false, true, false, false, false])
      const text = await page.$eval('.place', (e) => (e as HTMLElement).innerText)
      expect(text).not.toMatch(/correct|wrong|score|well done|great|nice|almost|!/i)
      expect(await page.$$eval('.place-chip', (els) => els.map((e) => e.className.includes('is-on')))).toEqual([false, true, false, false, false])

      await page.evaluate(() => (document.querySelectorAll('.place-chip')[1] as HTMLElement).click())
      // none marked, all five sets: allowed, and it writes no start rank and hides nothing
      await takeTest(page, [0, 0, 0, 0, 0])
      await page.waitForFunction(() => document.querySelector('.intro-progress span')?.textContent === 'Step 6 of 7')
      const result = await sent(page)
      expect(result.hidden).toEqual([])
      expect(result.settings.filter((p) => 'start_rank' in p)).toEqual([])
      await page.close()
    }, 90_000)

    it('a wall in the middle stops the start there: the first set with two or fewer marked decides, and one lucky hit in the rare set moves nothing', async () => {
      const page = await open('fresh=1&goal=default&lang=en')
      await toPlacement(page)
      await takeTest(page, [5, 5, 2, 0, 3]) // sets 1 and 2 known, set 3 is the wall, a lucky three in set 5
      await page.waitForFunction(() => document.querySelector('.intro-progress span')?.textContent === 'Step 6 of 7')
      expect(await startRanks(page)).toEqual([BAND_STARTS[2]])
      const { hidden } = await sent(page)
      expect(hidden).toHaveLength(1) // all the marked words left in ONE request, not one each
      expect(hidden[0]).toHaveLength(5 + 5 + 2 + 0 + 3)
      expect(new Set(hidden[0]).size).toBe(15)
      await page.close()
    }, 90_000)

    it('all marked in every set: the last set\'s lowest rank; a beginner (first set two or fewer): no start rank, though what was marked is hidden', async () => {
      const everything = await open('fresh=1&goal=default&lang=en')
      await toPlacement(everything)
      await takeTest(everything, [5, 5, 5, 5, 5])
      await everything.waitForFunction(() => document.querySelector('.intro-progress span')?.textContent === 'Step 6 of 7')
      expect(await startRanks(everything)).toEqual([BAND_STARTS[4]])
      expect((await sent(everything)).hidden[0]).toHaveLength(25)
      await everything.close()

      const beginner = await open('fresh=1&goal=default&lang=en')
      await toPlacement(beginner)
      await takeTest(beginner, [2, 5, 5, 5, 5])
      await beginner.waitForFunction(() => document.querySelector('.intro-progress span')?.textContent === 'Step 6 of 7')
      expect(await startRanks(beginner)).toEqual([])
      expect((await sent(beginner)).hidden[0]).toHaveLength(2 + 5 + 5 + 5 + 5)
      await beginner.close()
    }, 90_000)

    it('Skip leaves with no result and writes nothing, on any set, and goes on to the next step', async () => {
      const page = await open('fresh=1&goal=default&lang=en')
      await toPlacement(page)
      await forward(page)
      await forward(page)
      await mark(page, 4) // marked, then skipped: nothing is kept
      await clickText(page, '.place-skip .link-btn', 'Skip')
      await page.waitForFunction(() => document.querySelector('.intro-progress span')?.textContent === 'Step 6 of 7')
      expect(await page.$eval('h1', (e) => e.textContent)).toBe('Daily goal')
      const result = await sent(page)
      expect(result.hidden).toEqual([])
      expect(result.settings.filter((p) => 'start_rank' in p)).toEqual([])
      await page.close()
    }, 60_000)

    it('Back goes back through the sets keeping what was marked; from the first set it leaves the step backwards; Telegram\'s back does the same', async () => {
      const page = await open('fresh=1&goal=default&lang=en')
      await toPlacement(page)
      const first = await chips(page)
      await mark(page, 3)
      await forward(page)
      expect(await setText(page)).toBe('Set 2 of 5')
      await clickText(page, '.place-footer .btn', 'Back')
      expect(await setText(page)).toBe('Set 1 of 5')
      expect(await chips(page)).toEqual(first) // the same words
      expect(await pressed(page)).toEqual([true, true, true, false, false]) // and the same marks
      await forward(page)
      expect(await pressBack(page)).toBe('handled') // Telegram's back: a set back, not a step back
      expect(await setText(page)).toBe('Set 1 of 5')
      await clickText(page, '.place-footer .btn', 'Back') // from the first set: the step before
      await page.waitForFunction(() => document.querySelector('.intro-progress span')?.textContent === 'Step 4 of 7')
      expect(await sent(page)).toMatchObject({ hidden: [] })
      await page.close()
    }, 60_000)

    it('a second run is a different 25 words', async () => {
      const runs: string[] = []
      for (let i = 0; i < 2; i++) {
        const page = await open('fresh=1&goal=default&lang=en')
        await toPlacement(page)
        const all: string[] = []
        for (let k = 0; k < 5; k++) {
          all.push(...(await chips(page)))
          if (k < 4) await forward(page)
        }
        runs.push(all.join())
        await page.close()
      }
      expect(runs[0]).not.toBe(runs[1])
    }, 90_000)

    it('is in Russian in a Russian interface', async () => {
      const page = await open('fresh=1&goal=default&lang=ru')
      for (let n = 1; n < 5; n++) await clickText(page, '.intro-footer .btn', 'Дальше')
      await page.waitForSelector('[data-step="placement"]')
      expect(await page.$eval('h1', (e) => e.textContent)).toBe(ru.onboarding.placement.title)
      expect(await page.$eval('.place-question', (e) => e.textContent)).toBe(ru.onboarding.placement.question)
      expect(await page.$$eval('.intro-note', (els) => els.map((e) => e.textContent))).toContain(ru.onboarding.placement.hint)
      expect(await page.$eval('.place-skip .link-btn', (e) => e.textContent)).toBe(ru.onboarding.placement.skip)
      expect(await page.$eval('.place-skip .intro-note', (e) => e.textContent)).toBe(ru.onboarding.placement.skipNote)
      expect(await setText(page)).toBe('Набор 1 из 5')
      expect(en.onboarding.placement.set(1, 5)).toBe('Set 1 of 5')
      await page.close()
    }, 60_000)
  })

  describe('on its own, from Settings', () => {
    it('has a "Take the placement test" row in the Learning group, saying where Learn starts', async () => {
      const page = await open('goal=12&lang=en')
      await toSettings(page)
      const rows = await page.$$eval('#settings-learning ~ .settings-group .setting-nav .setting-label', (els) => els.map((e) => e.textContent))
      expect(rows).toEqual(['Take the placement test'])
      expect(await page.$eval('#settings-learning ~ .settings-group .setting-nav .setting-hint', (e) => e.textContent)).toBe('Learn starts with the most common words.')
      await page.close()
    }, 60_000)

    it('runs the same test by itself, without the intro around it, and returns to Settings with what it found', async () => {
      const page = await open('goal=12&lang=en')
      await toSettings(page)
      await clickText(page, '#settings-learning ~ .settings-group .setting-nav', 'Take the placement test')
      await page.waitForSelector('.place')
      expect(await page.$eval('.onboarding', (e) => e.getAttribute('data-mode'))).toBe('standalone')
      expect(await page.$('.intro-progress')).toBeNull() // no intro steps
      expect(await page.$eval('h1', (e) => e.textContent)).toBe('Placement test')
      expect(await setText(page)).toBe('Set 1 of 5')
      expect(await page.$('.place-skip .intro-note')).toBeNull() // "it can be taken later from Settings" is not said where you already are
      await takeTest(page, [5, 4, 5, 1, 0])
      await page.waitForSelector('.settings')
      expect(await page.$eval('h1', (e) => e.textContent)).toBe('Settings')
      expect(await startRanks(page)).toEqual([BAND_STARTS[3]])
      expect((await sent(page)).hidden).toHaveLength(1)
      expect(await page.$eval('#settings-learning ~ .settings-group .setting-nav .setting-hint', (e) => e.textContent)).toBe(`Learn will draw mostly from word ${BAND_STARTS[3]} onwards, but not only.`)
      await page.close()
    }, 90_000)

    it('Skip returns to Settings and writes nothing', async () => {
      const page = await open('goal=12&lang=en')
      await toSettings(page)
      await clickText(page, '#settings-learning ~ .settings-group .setting-nav', 'Take the placement test')
      await page.waitForSelector('.place')
      await mark(page, 3)
      await clickText(page, '.place-skip .link-btn', 'Skip')
      await page.waitForSelector('.settings')
      expect(await sent(page)).toEqual({ settings: [], hidden: [] })
      await page.close()
    }, 60_000)

    it('Back from the first set returns to Settings; Telegram\'s back steps back a set first, then leaves', async () => {
      const page = await open('goal=12&lang=en')
      await toSettings(page)
      await clickText(page, '#settings-learning ~ .settings-group .setting-nav', 'Take the placement test')
      await page.waitForSelector('.place')
      await clickText(page, '.place-footer .btn', 'Back')
      await page.waitForSelector('.settings')

      await clickText(page, '#settings-learning ~ .settings-group .setting-nav', 'Take the placement test')
      await page.waitForSelector('.place')
      await forward(page)
      expect(await pressBack(page)).toBe('handled')
      expect(await setText(page)).toBe('Set 1 of 5')
      expect(await pressBack(page)).toBe('left') // from the first set it goes where Back goes: Settings
      await page.waitForSelector('.settings')
      expect(await sent(page)).toEqual({ settings: [], hidden: [] })
      await page.close()
    }, 60_000)

    it('a retake that finds a beginner clears start_rank (the key is removed), and Settings says Learn starts at the beginning again', async () => {
      const page = await open('goal=12&lang=en&start_rank=2000')
      await toSettings(page)
      expect(await page.$eval('#settings-learning ~ .settings-group .setting-nav .setting-hint', (e) => e.textContent)).toBe('Learn will draw mostly from word 2000 onwards, but not only.')
      await clickText(page, '#settings-learning ~ .settings-group .setting-nav', 'Take the placement test')
      await page.waitForSelector('.place')
      await takeTest(page, [2, 5, 5, 5, 5])
      await page.waitForSelector('.settings')
      expect((await sent(page)).settings).toEqual([{ start_rank: null }]) // the one write: the key goes
      expect(await page.$eval('#settings-learning ~ .settings-group .setting-nav .setting-hint', (e) => e.textContent)).toBe('Learn starts with the most common words.')
      expect((await sent(page)).hidden).toHaveLength(1) // what they marked is hidden all the same
      await page.close()
    }, 90_000)

    it('a first run that finds a beginner writes nothing about start_rank', async () => {
      const page = await open('goal=12&lang=en')
      await toSettings(page)
      await clickText(page, '#settings-learning ~ .settings-group .setting-nav', 'Take the placement test')
      await page.waitForSelector('.place')
      await takeTest(page, [1, 5, 5, 5, 5])
      await page.waitForSelector('.settings')
      expect((await sent(page)).settings).toEqual([])
      await page.close()
    }, 90_000)

    it('taking it again replaces start_rank and hides the newly marked words, and never un-hides anything', async () => {
      const page = await open('goal=12&lang=en')
      await toSettings(page)
      for (const counts of [[5, 5, 2, 0, 0], [5, 5, 5, 5, 2]]) {
        await clickText(page, '#settings-learning ~ .settings-group .setting-nav', 'Take the placement test')
        await page.waitForSelector('.place')
        await takeTest(page, counts)
        await page.waitForSelector('.settings')
      }
      const ranks = (await startRanks(page)) as number[]
      expect(ranks).toHaveLength(2)
      expect(ranks[0]).toBe(BAND_STARTS[2]) // the second value replaces the first. (The parts are cut again from the words still to learn, and the first run hid 12, so the last part starts a little later.)
      expect(ranks[1]).toBeGreaterThanOrEqual(BAND_STARTS[4])
      expect(ranks[1]).toBeLessThanOrEqual(BAND_STARTS[4] + 15)
      const { hidden } = await sent(page)
      expect(hidden).toHaveLength(2) // one request per run
      expect(hidden.flat().some((w) => w.startsWith('-'))).toBe(false)
      expect(hidden[1].length).toBeGreaterThan(0)
      await page.close()
    }, 90_000)
  })
})
