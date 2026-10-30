import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { WHATS_NEW } from '../data/whatsNew'

/**
 * The intro in a real browser (src/testing/settingsHarness.tsx: the real Onboarding, Settings, How it works and Home, with Back
 * going where App sends it): a fresh account sees it instead of Home and a returning one does not, the six steps go forward and
 * back, finishing writes onboarding_done once, each step writes what its Settings control writes, and "Run the intro again"
 * opens on the current values and leaves to Settings. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('the intro in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5217, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(query = '') {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/settingsHarness.html?${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('main')
    return page
  }

  const sent = (page: Page) => page.evaluate(() => (window as never as { __sent: { settings: Record<string, unknown>[] } }).__sent.settings)
  const title = (page: Page) => page.$eval('h1', (e) => e.textContent)
  const stepText = (page: Page) => page.$eval('.intro-progress span', (e) => e.textContent)
  const pressBack = (page: Page) => page.evaluate(() => (window as never as { __pressBack: () => string }).__pressBack())
  const clickText = (page: Page, selector: string, text: string) =>
    page.evaluate((sel, t) => (Array.from(document.querySelectorAll(sel)).find((b) => b.textContent?.trim() === t) as HTMLElement).click(), selector, text)
  /** Continue; on the placement test (which has its own buttons) that is Skip: these tests are about the rest of the intro. */
  const next = async (page: Page) => {
    if (await page.$('[data-step="placement"]')) await page.evaluate(() => ((document.querySelector('.place-skip .link-btn') ?? document.querySelector('.place-footer .btn-primary')) as HTMLElement).click()) // Skip (or Continue, where there is no test to take)
    else await clickText(page, '.intro-footer .btn', 'Continue')
  }
  /** Back one step: the placement test has its own Back. */
  const backOne = async (page: Page) => {
    if (await page.$('[data-step="placement"]')) await clickText(page, '.place-footer .btn', 'Back')
    else await clickText(page, '.intro-footer .btn', 'Back')
  }
  const buttons = (page: Page) => page.$$eval('.intro-footer .btn', (els) => els.map((e) => e.textContent))
  /** Continue until the intro shows this step (from wherever it is now). */
  const goTo = async (page: Page, stepNumber: number) => {
    const current = Number((await stepText(page))?.match(/Step (\d+)/)?.[1])
    for (let n = current; n < stepNumber; n++) await next(page)
    await page.waitForFunction((n) => document.querySelector('.intro-progress span')?.textContent === `Step ${n} of 7`, {}, stepNumber)
  }
  const toSettings = async (page: Page) => {
    await page.click('button[aria-label="Settings"]')
    await page.waitForSelector('.settings')
  }
  const aboutRow = (page: Page, label: string) =>
    page.evaluate((text) => (Array.from(document.querySelectorAll('#settings-about ~ .settings-group .setting-nav')).find((b) => b.textContent?.startsWith(text)) as HTMLElement).click(), label)

  describe('who sees it', () => {
    it('a fresh account sees the intro instead of Home', async () => {
      const page = await open('fresh=1&goal=default')
      expect(await page.$('.onboarding')).not.toBeNull()
      expect(await page.$('.home')).toBeNull()
      expect(await stepText(page)).toBe('Step 1 of 7')
      expect(await title(page)).toBe('App language')
      expect(await page.$$eval('.lang-option', (els) => els.map((e) => `${e.textContent}:${e.getAttribute('aria-checked')}`))).toEqual(['English:true', 'Русский:false']) // preselected from Telegram's language (none here: English)
      expect(await sent(page)).toEqual([]) // looking at it writes nothing
      await page.close()
    }, 60_000)

    it('a returning account (onboarding_done is set) goes straight to Home', async () => {
      const page = await open()
      expect(await page.$('.onboarding')).toBeNull()
      expect(await page.$('.home')).not.toBeNull()
      expect(await title(page)).toBe('Riopalabras')
      await page.close()
    }, 60_000)
  })

  describe('the controls stay where they are', () => {
    /** Back and Next/Continue/Done as drawn now, on any step (the placement test draws its own, in its own footer): where each sits on the screen. */
    const controls = (page: Page) =>
      page.evaluate(() => {
        const rect = (e: Element) => {
          const r = e.getBoundingClientRect()
          return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }
        }
        const buttons = Array.from(document.querySelectorAll('.intro-footer .btn, .place-footer .btn')).map((b) => ({ text: b.textContent, ...rect(b) }))
        return { buttons, viewport: window.innerHeight, main: rect(document.querySelector('.onboarding')!) }
      })

    for (const [width, height] of [[390, 800], [320, 568]]) it(`on all seven steps, and on every set of the placement test, the buttons sit at the bottom of the screen: the same height, the same place (${width} x ${height})`, async () => {
      const page = await open('fresh=1&goal=default&dict=1')
      await page.setViewport({ width, height, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
      await page.waitForFunction(() => (window as never as { __dictionary?: boolean }).__dictionary === true)
      const seen: { where: string; bottoms: number[]; heights: number[]; viewport: number; main: { bottom: number } }[] = []
      const record = async (where: string) => {
        const c = await controls(page)
        seen.push({ where, bottoms: c.buttons.map((b) => b.bottom), heights: c.buttons.map((b) => b.height), viewport: c.viewport, main: c.main })
      }
      for (let n = 1; n <= 7; n++) {
        await page.waitForFunction((m) => document.querySelector('.intro-progress span')?.textContent === `Step ${m} of 7`, {}, n)
        if (n === 5) {
          // the placement test: five sets, each with its own Back and Next, then the result
          for (let set = 1; set <= 5; set++) {
            await page.waitForFunction((k) => document.querySelector('.place')?.getAttribute('data-set') === String(k), {}, set)
            await record(`step 5, set ${set}`)
            await page.evaluate(() => (document.querySelector('.place-footer .btn-primary') as HTMLElement).click())
          }
          await page.waitForFunction(() => document.querySelector('.place')?.getAttribute('data-state') === 'result')
          await record('step 5, result')
          await page.evaluate(() => (document.querySelector('.place-footer .btn-primary') as HTMLElement).click())
        } else {
          await record(`step ${n}`)
          if (n < 7) await clickText(page, '.intro-footer .btn', n === 7 ? 'Done' : 'Continue')
        }
      }
      expect(seen.map((s) => s.where)).toEqual(['step 1', 'step 2', 'step 3', 'step 4', 'step 5, set 1', 'step 5, set 2', 'step 5, set 3', 'step 5, set 4', 'step 5, set 5', 'step 5, result', 'step 6', 'step 7'])
      const reference = seen[1] // step 2: the plain case
      for (const s of seen) {
        expect(s.bottoms.length, s.where).toBeGreaterThan(0)
        for (const bottom of s.bottoms) expect(bottom, `${s.where}: the buttons end where the others do`).toBe(reference.bottoms[0])
        for (const height of s.heights) expect(height, `${s.where}: and are as tall`).toBe(reference.heights[0])
        expect(reference.bottoms[0], 'and that is the bottom of the screen: within one padding of its edge').toBeGreaterThan(s.viewport - 40)
      }
      await page.close()
    }, 120_000)

    it('and a short step does not lift them: the intro fills the screen (step 6 is the shortest)', async () => {
      const page = await open('fresh=1&goal=default&dict=1')
      await page.waitForFunction(() => (window as never as { __dictionary?: boolean }).__dictionary === true)
      await goTo(page, 6)
      const c = await controls(page)
      expect(c.main.bottom).toBeGreaterThanOrEqual(c.viewport - 1)
      expect(c.buttons[0].bottom).toBeGreaterThan(c.viewport - 40)
      await page.close()
    }, 90_000)
  })

  describe('the flow', () => {
    it('six steps, forward and back, with the progress following: step titles in order', async () => {
      const page = await open('fresh=1&goal=default')
      const titles: (string | null)[] = []
      const progress: (string | null)[] = []
      for (let n = 1; n <= 7; n++) {
        titles.push(await title(page))
        progress.push(await page.$eval('[role="progressbar"]', (e) => e.getAttribute('aria-valuenow')))
        if (n < 7) await next(page)
      }
      expect(titles).toEqual(['App language', 'Riopalabras', 'What is inside', 'Translations', 'Placement test', 'Daily goal', 'Pronunciation'])
      expect(progress).toEqual(['1', '2', '3', '4', '5', '6', '7'])
      expect(await buttons(page)).toEqual(['Back', 'Done']) // the last step ends in Done

      // and back again, step by step
      for (let n = 7; n > 1; n--) {
        await backOne(page)
        await page.waitForFunction((m) => document.querySelector('.intro-progress span')?.textContent === `Step ${m} of 7`, {}, n - 1)
      }
      expect(await title(page)).toBe('App language')
      await page.close()
    }, 90_000)

    it('Back from the first step does nothing destructive: no button, Telegram\'s back is swallowed, and the language is written only when Continue is tapped', async () => {
      const page = await open('fresh=1&goal=default')
      expect(await buttons(page)).toEqual(['Continue']) // no Back button
      expect(await pressBack(page)).toBe('handled')
      expect(await stepText(page)).toBe('Step 1 of 7')
      expect(await page.$('.onboarding')).not.toBeNull()
      expect(await sent(page)).toEqual([])
      // from step 3, Back steps back, and never past step 1
      await goTo(page, 3)
      expect(await pressBack(page)).toBe('handled')
      expect(await stepText(page)).toBe('Step 2 of 7')
      await pressBack(page)
      await pressBack(page)
      await pressBack(page)
      expect(await stepText(page)).toBe('Step 1 of 7')
      expect(await sent(page)).toEqual([{ ui_language: 'en' }]) // going on from step 1 chose the preselected language; nothing else was written
      await page.close()
    }, 60_000)

    it('Done writes onboarding_done: true once, and shows Home; it is not shown again', async () => {
      const page = await open('fresh=1&goal=default')
      await goTo(page, 7)
      await page.evaluate(() => {
        // two taps in the same tick: the second must find the key already there
        const done = Array.from(document.querySelectorAll('.intro-footer .btn')).find((b) => b.textContent === 'Done') as HTMLElement
        done.click()
        done.click()
      })
      await page.waitForSelector('.home')
      expect(await page.$('.onboarding')).toBeNull()
      const writes = (await sent(page)).filter((p) => 'onboarding_done' in p)
      expect(writes).toEqual([{ onboarding_done: true, daily_new_word_limit: 5, whats_new_seen: WHATS_NEW[0].at }]) // exactly once, with the goal that was on screen (finishing flips the implicit goal, so it is written down) and the news as it stands marked read
      await page.close()
    }, 60_000)

    it('Done writes the goal that was chosen: stepping to 8 and finishing writes 8, not the default', async () => {
      const page = await open('fresh=1&goal=default')
      await goTo(page, 6)
      for (let i = 0; i < 3; i++) await page.click('.stepper-btn[aria-label="Increase the daily goal"]')
      expect(await page.$eval('output.stepper-value', (e) => e.textContent)).toBe('8')
      await goTo(page, 7)
      await clickText(page, '.intro-footer .btn', 'Done')
      await page.waitForSelector('.home')
      expect((await sent(page)).filter((p) => 'onboarding_done' in p)).toEqual([{ onboarding_done: true, daily_new_word_limit: 8, whats_new_seen: WHATS_NEW[0].at }])
      await page.close()
    }, 60_000)

    it('the last step links to "How it works", and Back from there returns to the same step', async () => {
      const page = await open('fresh=1&goal=default')
      await goTo(page, 7)
      expect(await page.$$eval('.intro-es', (els) => els.map((e) => e.textContent))).toEqual(['ll', 'y', 'calle', 'yo', 'vos tenés', 'tú tienes'])
      await clickText(page, '.intro-link', 'How Learn, Review and practice work')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'How it works')
      expect(await page.$$eval('.how-section h2', (els) => els.map((e) => e.textContent))).toEqual(['Learn', 'Review', 'Matching', 'Cloze', 'When a word comes back', 'Reminders'])
      await page.click('.back-link')
      await page.waitForFunction(() => document.querySelector('.intro-progress span')?.textContent === 'Step 7 of 7')
      expect(await title(page)).toBe('Pronunciation')
      // Telegram's back does the same
      await clickText(page, '.intro-link', 'How Learn, Review and practice work')
      await page.waitForSelector('.how-it-works')
      expect(await pressBack(page)).toBe('handled')
      await page.waitForSelector('.onboarding')
      expect(await stepText(page)).toBe('Step 7 of 7')
      expect(await sent(page)).toEqual([{ ui_language: 'en' }])
      await page.close()
    }, 60_000)
  })

  describe('each step writes to the same key its Settings control writes', () => {
    it('translation: the same two keys as the switches, written together', async () => {
      const intro = await open('fresh=1&goal=default')
      await goTo(intro, 4)
      expect(await intro.$$eval('[role="radio"]', (els) => els.map((e) => `${e.textContent}:${e.getAttribute('aria-checked')}`))).toEqual(['Russian:false', 'English:false', 'Both:true']) // both by default
      await clickText(intro, '[role="radio"]', 'Russian')
      await clickText(intro, '[role="radio"]', 'English')
      await clickText(intro, '[role="radio"]', 'Both')
      await clickText(intro, '[role="radio"]', 'Both') // already chosen: nothing is written
      const introWrites = await sent(intro)
      expect(introWrites).toEqual([
        { ui_language: 'en' }, // Continue on step 1 chose the preselected language
        { show_ru_translation: true, show_en_translation: false },
        { show_ru_translation: false, show_en_translation: true },
        { show_ru_translation: true, show_en_translation: true },
      ])
      await intro.close()

      // Settings: turning a switch off writes the same pair of keys
      const settings = await open('goal=default&ru=1&en=1')
      await toSettings(settings)
      await settings.click('#language-en')
      expect(Object.keys((await sent(settings)).at(-1)!).sort()).toEqual(['show_en_translation', 'show_ru_translation'])
      expect((await sent(settings)).at(-1)).toEqual({ show_ru_translation: true, show_en_translation: false }) // the same patch as the intro's "Russian"
      await settings.close()
    }, 90_000)

    it('daily goal: daily_new_word_limit, one step each, from 5 when nothing is stored, like the Settings stepper', async () => {
      const intro = await open('fresh=1&goal=default')
      await goTo(intro, 6)
      expect(await intro.$eval('output.stepper-value', (e) => e.textContent)).toBe('5')
      await intro.click('.stepper-btn[aria-label="Increase the daily goal"]')
      await intro.click('.stepper-btn[aria-label="Increase the daily goal"]')
      await intro.click('.stepper-btn[aria-label="Decrease the daily goal"]')
      expect(await sent(intro)).toEqual([{ ui_language: 'en' }, { daily_new_word_limit: 6 }, { daily_new_word_limit: 7 }, { daily_new_word_limit: 6 }])
      expect(await intro.$eval('output.stepper-value', (e) => e.textContent)).toBe('6')
      await intro.close()

      // an account that finished the intro with no goal stored (all of them, before the intro wrote one) has always had 10 in Settings, and still does
      const legacy = await open('goal=default&ru=1&en=1')
      await toSettings(legacy)
      expect(await legacy.$eval('output.stepper-value', (e) => e.textContent)).toBe('10')
      expect(await sent(legacy)).toEqual([]) // looking at it writes nothing
      await legacy.close()

      const settings = await open('goal=10&ru=1&en=1')
      await toSettings(settings)
      await settings.click('.stepper-btn[aria-label="Increase the daily goal"]')
      expect(await sent(settings)).toEqual([{ daily_new_word_limit: 11 }]) // the same key and the same step
      await settings.close()
    }, 90_000)

    it('the stepper in the intro is the Settings one: the same markup and the same limits', async () => {
      const intro = await open('fresh=1&goal=20')
      await goTo(intro, 6)
      const introMarkup = await intro.$eval('.stepper', (e) => e.outerHTML.replace(/aria-labelledby="[^"]*"/, ''))
      expect(await intro.$eval('.stepper-btn[aria-label="Increase the daily goal"]', (e) => (e as HTMLButtonElement).disabled)).toBe(true) // stops at 20
      await intro.close()
      const settings = await open('goal=20&ru=1&en=1')
      await toSettings(settings)
      const settingsMarkup = await settings.$eval('.stepper', (e) => e.outerHTML.replace(/aria-labelledby="[^"]*"/, ''))
      expect(introMarkup).toBe(settingsMarkup)
      await settings.close()
    }, 90_000)
  })

  describe('Run the intro again', () => {
    it('is a row in About next to "About Riopalabras" and "How it works"', async () => {
      const page = await open('goal=12')
      await toSettings(page)
      expect(await page.$$eval('#settings-about ~ .settings-group .setting-nav .setting-label', (els) => els.map((e) => e.textContent))).toEqual(['About Riopalabras', 'How it works', 'Run the intro again'])
      await page.close()
    }, 60_000)

    it('opens from step 1 on the current values (language and goal as set), and Done returns to Settings, writing nothing', async () => {
      const page = await open('goal=12&ru=1&en=0&lang=en')
      await toSettings(page)
      await aboutRow(page, 'Run the intro again')
      await page.waitForSelector('.onboarding')
      expect(await stepText(page)).toBe('Step 1 of 7')
      expect(await page.$eval('.onboarding', (e) => e.getAttribute('data-mode'))).toBe('replay')

      await goTo(page, 4)
      expect(await page.$$eval('[role="radio"]', (els) => els.map((e) => `${e.textContent}:${e.getAttribute('aria-checked')}`))).toEqual(['Russian:true', 'English:false', 'Both:false']) // as set, not the defaults
      await goTo(page, 6)
      expect(await page.$eval('output.stepper-value', (e) => e.textContent)).toBe('12') // not 10
      await next(page)
      await clickText(page, '.intro-footer .btn', 'Done')
      await page.waitForSelector('.settings') // Settings, not Home
      expect(await title(page)).toBe('Settings')
      expect(await sent(page)).toEqual([]) // nothing was reset, nothing rewritten, onboarding_done is already there
      // and what was set is still set
      expect(await page.$eval('output.stepper-value', (e) => e.textContent)).toBe('12')
      expect(await page.$eval('#language-en', (e) => (e as HTMLInputElement).checked)).toBe(false)
      await page.close()
    }, 90_000)

    it('Back from step 1 leaves to Settings; Telegram\'s back steps back first and leaves from step 1', async () => {
      const page = await open('goal=12&lang=en')
      await toSettings(page)
      await aboutRow(page, 'Run the intro again')
      await page.waitForSelector('.onboarding')
      expect(await buttons(page)).toEqual(['Back', 'Continue'])
      await clickText(page, '.intro-footer .btn', 'Back')
      await page.waitForSelector('.settings')
      expect(await sent(page)).toEqual([])

      await aboutRow(page, 'Run the intro again')
      await page.waitForSelector('.onboarding')
      await goTo(page, 3)
      expect(await pressBack(page)).toBe('handled')
      expect(await stepText(page)).toBe('Step 2 of 7')
      await pressBack(page)
      expect(await stepText(page)).toBe('Step 1 of 7')
      expect(await pressBack(page)).toBe('left') // from step 1 it goes where Back goes: Settings
      await page.waitForSelector('.settings')
      expect(await sent(page)).toEqual([])
      await page.close()
    }, 90_000)

    it('changes made while replaying are written, as in Settings, and a replay still writes no onboarding_done', async () => {
      const page = await open('goal=12&ru=1&en=1&lang=en')
      await toSettings(page)
      await aboutRow(page, 'Run the intro again')
      await page.waitForSelector('.onboarding')
      await goTo(page, 4)
      await clickText(page, '[role="radio"]', 'English')
      await goTo(page, 7)
      await clickText(page, '.intro-footer .btn', 'Done')
      await page.waitForSelector('.settings')
      expect(await sent(page)).toEqual([{ show_ru_translation: false, show_en_translation: true }])
      await page.close()
    }, 90_000)

    it('"How it works" ends in a Back of its own: at the bottom of the page it is on screen, and it leads where the header\'s Back does (Settings; the same step of the intro)', async () => {
      const toBottom = (page: Page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      const endBackVisible = (page: Page) => page.$eval('.how-end .btn', (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight })
      // from Settings
      const settings = await open('goal=12')
      await settings.setViewport({ width: 390, height: 500, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }) // short, so the page scrolls
      await toSettings(settings)
      await aboutRow(settings, 'How it works')
      await settings.waitForSelector('.how-it-works')
      expect(await settings.$eval('.how-end .btn', (e) => e.textContent)).toBe('Back')
      expect(await settings.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true) // the page really is longer than the screen
      await toBottom(settings)
      expect(await endBackVisible(settings)).toBe(true)
      await settings.click('.how-end .btn')
      await settings.waitForSelector('.settings')
      await settings.close()
      // from the intro: back on the same step
      const intro = await open('fresh=1&goal=default')
      await goTo(intro, 7)
      await clickText(intro, '.intro-link', 'How Learn, Review and practice work')
      await intro.waitForSelector('.how-it-works')
      await toBottom(intro)
      await intro.click('.how-end .btn')
      await intro.waitForFunction(() => document.querySelector('.intro-progress span')?.textContent === 'Step 7 of 7')
      await intro.close()
    }, 90_000)

    it("with Telegram's own Back (native=1) the header has no Back, and the end of the page still has one", async () => {
      const page = await open('goal=12&native=1')
      await toSettings(page)
      await aboutRow(page, 'How it works')
      await page.waitForSelector('.how-it-works')
      expect(await page.$('.back-link')).toBeNull()
      await page.click('.how-end .btn')
      await page.waitForSelector('.settings')
      await page.close()
    }, 60_000)

    it('"How it works" in Settings opens its own screen, and Back lands on Settings', async () => {
      const page = await open('goal=12')
      await toSettings(page)
      await aboutRow(page, 'How it works')
      await page.waitForSelector('.how-it-works')
      expect(await title(page)).toBe('How it works')
      await page.click('.back-link')
      await page.waitForSelector('.settings')
      expect(await title(page)).toBe('Settings')
      await page.close()
    }, 60_000)
  })
})
