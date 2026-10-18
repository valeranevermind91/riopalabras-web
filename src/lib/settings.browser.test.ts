import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * Home, Settings and Debug in a real browser (src/testing/settingsHarness.tsx puts the real screens, the real theme hook and
 * App's real Back rule on a page): the gear opens Settings, a theme chosen there holds after Back, Debug is reached only
 * from Settings and Back from it lands on Settings, and the controls behave. Needs a Chrome or Chromium; skipped without
 * one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('Settings in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5209, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(query = '') {
    // Its own browser context, so no test sees another's localStorage; and a light OS, so "System" is light everywhere.
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/settingsHarness.html?${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.screen-header')
    return page
  }

  const title = (page: Page) => page.$eval('h1', (e) => e.textContent)
  const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  const pageColour = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const sent = (page: Page) => page.evaluate(() => (window as never as { __sent: { settings: Record<string, unknown>[] } }).__sent.settings)
  const toSettings = async (page: Page) => {
    await page.click('button[aria-label="Settings"]')
    await page.waitForSelector('.settings')
  }
  const back = async (page: Page) => {
    await page.click('.back-link')
    await page.waitForSelector('.screen-header')
  }
  const goal = (page: Page) => page.$eval('output.stepper-value', (e) => Number(e.textContent))
  const press = (page: Page, selector: string, label: string) =>
    page.evaluate((sel, text) => (Array.from(document.querySelectorAll(sel)).find((b) => b.textContent?.startsWith(text)) as HTMLElement).click(), selector, label)

  it('Home has the app name, then Words and the gear; the theme toggle is not there', async () => {
    const page = await open()
    expect(await page.$$eval('.screen-header-actions .icon-btn', (els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Words', 'Settings'])
    expect(await page.$('[data-theme-choice]')).toBeNull()
    expect(await page.$('.debug-link')).toBeNull()
    await page.close()
  }, 60_000)

  it('Home → Settings → change the theme → Back → the new theme is still applied', async () => {
    const page = await open()
    const before = { theme: await theme(page), colour: await pageColour(page) }
    expect(before.theme).toBe('light')

    await toSettings(page)
    expect(await title(page)).toBe('Settings')
    expect(await page.$$eval('[aria-labelledby="theme-label"] [role="radio"]', (els) => els.map((e) => `${e.textContent}:${e.getAttribute('aria-checked')}`))).toEqual(['System:true', 'Light:false', 'Dark:false'])

    await press(page, '[aria-labelledby="theme-label"] [role="radio"]', 'Dark')
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark')
    expect(await page.$$eval('[aria-labelledby="theme-label"] [role="radio"]', (els) => els.map((e) => e.getAttribute('aria-checked')))).toEqual(['false', 'false', 'true'])
    const dark = await pageColour(page)
    expect(dark).not.toBe(before.colour) // the screen really changed

    await back(page)
    expect(await title(page)).toBe('Riopalabras')
    expect(await theme(page)).toBe('dark')
    expect(await pageColour(page)).toBe(dark)

    await toSettings(page) // and Settings still shows it
    expect(await page.$eval('[aria-labelledby="theme-label"] [role="radio"][aria-checked="true"]', (e) => e.textContent)).toBe('Dark')
    await page.close()
  }, 60_000)

  it('the choice is saved: sent through the settings lane as theme_preference, and kept in localStorage', async () => {
    const page = await open()
    await toSettings(page)
    await press(page, '[aria-labelledby="theme-label"] [role="radio"]', 'Dark')
    await page.waitForFunction(() => (window as never as { __sent: { settings: unknown[] } }).__sent.settings.length > 0)
    expect((await sent(page)).at(-1)).toEqual({ theme_preference: 'dark' })
    expect(await page.evaluate(() => localStorage.getItem('riopalabras.theme.v1'))).toBe('dark')

    await page.reload({ waitUntil: 'networkidle0' }) // a new launch, before any settings are loaded
    await page.waitForSelector('.screen-header')
    expect(await theme(page)).toBe('dark')
    await page.close()
  }, 60_000)

  it('Debug is absent from the DOM for someone who is not allowed', async () => {
    const page = await open()
    await toSettings(page)
    expect(await page.$('#settings-debug')).toBeNull()
    expect(await page.$('#settings-debug ~ .settings-group .setting-nav')).toBeNull()
    expect(await page.evaluate(() => document.body.innerHTML.includes('Debug'))).toBe(false)
    await page.close()
  }, 60_000)

  it('Home → Settings → Debug → Back lands on Settings (and Back again on Home)', async () => {
    const page = await open('unlocked=1')
    await toSettings(page)
    expect(await page.$$eval('.settings-label', (els) => els.map((e) => e.textContent))).toEqual(['Learning', 'Language', 'Appearance', 'Notifications', 'About', 'Debug'])
    expect(await page.$$eval('#settings-debug ~ .settings-group button', (els) => els.map((e) => e.textContent))).toEqual(['Debug›', 'Lock Debug']) // the way in, and the way out
    await page.click('#settings-debug ~ .settings-group .setting-nav')
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Debug')

    await back(page)
    expect(await title(page)).toBe('Settings') // not Home
    await back(page)
    expect(await title(page)).toBe('Riopalabras')
    await page.close()
  }, 60_000)

  it('every row is at least 48px tall, and every control has a name that is tied to it', async () => {
    const page = await open('unlocked=1')
    await toSettings(page)
    const heights = await page.$$eval('.setting-row', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    expect(heights.length).toBeGreaterThanOrEqual(8)
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(48)
    // the switches: exactly one <label> each, with its text
    expect(await page.$$eval('input.switch', (els) => els.map((e) => (e as HTMLInputElement).labels?.length === 1 ? (e as HTMLInputElement).labels![0].textContent : null))).toEqual(['Russian', 'English', 'Daily reminder'])
    // the stepper: named buttons and a value tied to the "Daily goal" label
    expect(await page.$$eval('.stepper-btn', (els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Decrease the daily goal', 'Increase the daily goal'])
    expect(await page.$eval('output.stepper-value', (e) => document.getElementById(e.getAttribute('aria-labelledby')!)?.textContent)).toBe('Daily goal')
    // the theme control: a radio group named by its label
    expect(await page.$$eval('[role="radiogroup"]', (els) => els.map((e) => document.getElementById(e.getAttribute('aria-labelledby')!)?.textContent))).toEqual(['App language', 'Theme'])
    // the reminder switch: its hint is tied to it
    expect(await page.$eval('#daily-reminder', (e) => document.getElementById(e.getAttribute('aria-describedby')!)?.textContent)).toBe('Comes at 20:00, and only when something is waiting.')
    await page.close()
  }, 60_000)

  describe('the daily reminder', () => {
    type Log = { writes: Record<string, unknown>[]; updates: Record<string, unknown>[]; asked: number }
    const log = (page: Page) => page.evaluate(() => (window as never as { __reminders: Log }).__reminders)
    const toggle = (page: Page) => page.$eval('#daily-reminder', (e) => ({ checked: (e as HTMLInputElement).checked, disabled: (e as HTMLInputElement).disabled }))
    const note = (page: Page) => page.$eval('#daily-reminder-note', (e) => e.textContent).catch(() => null)
    const answer = (page: Page, granted: boolean) => page.evaluate((g) => (window as never as { __answerAccess: (g: boolean) => void }).__answerAccess(g), granted)
    const settled = (page: Page) => page.waitForFunction(() => !(document.getElementById('daily-reminder') as HTMLInputElement | null)?.disabled)

    it('turns on only after Telegram agrees: nothing is written while the prompt is open, then the row gets enabled and the device zone', async () => {
      const page = await open('access=manual')
      await toSettings(page)
      await settled(page)
      expect(await toggle(page)).toEqual({ checked: false, disabled: false })

      await page.click('#daily-reminder')
      await page.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.asked === 1)
      expect(await log(page)).toMatchObject({ writes: [], updates: [], asked: 1 }) // asked, not yet written
      expect(await toggle(page)).toEqual({ checked: true, disabled: true }) // shows what was asked for, and cannot be pressed again meanwhile

      await answer(page, true)
      await settled(page)
      expect(await toggle(page)).toEqual({ checked: true, disabled: false })
      expect((await log(page)).writes).toEqual([{ enabled: true, timezone: 'America/Montevideo' }])
      expect(await note(page)).toBeNull()
      expect(await sent(page)).toEqual([]) // and nothing about it went into the settings blob
      await page.close()
    }, 60_000)

    it('stays off when Telegram says no: nothing is written, and one line says where to allow it', async () => {
      const page = await open('access=manual')
      await toSettings(page)
      await settled(page)
      await page.click('#daily-reminder')
      await page.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.asked === 1)
      await answer(page, false)
      await settled(page)
      expect(await toggle(page)).toEqual({ checked: false, disabled: false })
      expect(await log(page)).toMatchObject({ writes: [], updates: [] })
      expect(await note(page)).toBe("Telegram did not allow messages. You can allow them from the bot's chat.")
      expect(await sent(page)).toEqual([])

      // pressing it again asks again, and a yes this time turns it on and takes the line away
      await page.click('#daily-reminder')
      await page.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.asked === 2)
      expect(await note(page)).toBeNull()
      await answer(page, true)
      await settled(page)
      expect(await toggle(page)).toEqual({ checked: true, disabled: false })
      expect((await log(page)).writes).toHaveLength(1)
      await page.close()
    }, 60_000)

    it('stays off, with its own line, when permission was given but the row could not be saved', async () => {
      const page = await open('savefail=1')
      await toSettings(page)
      await settled(page)
      await page.click('#daily-reminder')
      await page.waitForFunction(() => document.getElementById('daily-reminder-note'))
      expect(await toggle(page)).toEqual({ checked: false, disabled: false })
      expect(await note(page)).toBe('Could not save this. Check your connection and try again.')
      expect((await log(page)).writes).toEqual([])
      await page.close()
    }, 60_000)

    it('turning it off changes the row and does not ask Telegram', async () => {
      const page = await open('reminder=on')
      await toSettings(page)
      await settled(page)
      expect(await toggle(page)).toEqual({ checked: true, disabled: false })
      await page.click('#daily-reminder')
      await page.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.updates.length === 1)
      await settled(page)
      expect(await toggle(page)).toEqual({ checked: false, disabled: false })
      expect(await log(page)).toMatchObject({ writes: [], updates: [{ enabled: false }], asked: 0 })
      await page.close()
    }, 60_000)

    it('is disabled, not off, when the row cannot be read', async () => {
      const page = await open('readfail=1')
      await toSettings(page)
      await page.waitForFunction(() => document.getElementById('daily-reminder'))
      expect(await toggle(page)).toEqual({ checked: false, disabled: true })
      await page.close()
    }, 60_000)

    it('writes the time zone at app open only when it differs from the row, and never makes a row', async () => {
      // the row says Madrid, the device says Montevideo: written once, without visiting Settings
      const changed = await open('reminder=on&rtz=Europe/Madrid')
      await changed.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.updates.length > 0)
      expect(await log(changed)).toMatchObject({ writes: [], updates: [{ timezone: 'America/Montevideo' }] })
      await changed.close()

      const same = await open('reminder=off&rtz=America/Montevideo')
      await same.evaluate(() => new Promise((r) => setTimeout(r, 300)))
      expect(await log(same)).toMatchObject({ writes: [], updates: [] })
      await same.close()

      const traveller = await open('reminder=off&rtz=America/Montevideo&tz=Asia/Tokyo') // off or on, a changed zone is kept current
      await traveller.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.updates.length > 0)
      expect(await log(traveller)).toMatchObject({ writes: [], updates: [{ timezone: 'Asia/Tokyo' }] })
      await traveller.close()

      const none = await open('reminder=none&tz=Asia/Tokyo') // never turned on: opening the app creates nothing
      await none.evaluate(() => new Promise((r) => setTimeout(r, 300)))
      expect(await log(none)).toMatchObject({ writes: [], updates: [] })
      await none.close()
    }, 60_000)

    describe('says why nothing arrives', () => {
      const PAUSED = 'Paused — nothing was studied after several reminders. Turn it off and on to resume.'
      const UNREACHABLE = "Open the bot's chat and press Start, then switch this off and on again. Pressing Start alone is not enough."

      it('shows the line under a switch that is on, and keeps the switch on', async () => {
        for (const [query, text] of [['reminder=on&paused=1', PAUSED], ['reminder=on&unreachable=1', UNREACHABLE], ['reminder=on&paused=1&unreachable=1', UNREACHABLE]] as const) {
          const page = await open(query)
          await toSettings(page)
          await settled(page)
          expect(await toggle(page), query).toEqual({ checked: true, disabled: false })
          expect(await note(page), query).toBe(text)
          await page.close()
        }
      }, 60_000)

      it('shows nothing when all is well, and nothing when the reminder is off (the flags mean nothing then)', async () => {
        for (const query of ['reminder=on', 'reminder=off&paused=1&unreachable=1', 'reminder=none']) {
          const page = await open(query)
          await toSettings(page)
          await settled(page)
          expect(await note(page), query).toBeNull()
          await page.close()
        }
      }, 60_000)

      it('turning it off and on again clears the line (the database clears the flags when it is switched on)', async () => {
        const page = await open('reminder=on&paused=1')
        await toSettings(page)
        await settled(page)
        expect(await note(page)).toBe(PAUSED)
        await page.click('#daily-reminder') // off: the line goes, it means nothing now
        await page.waitForFunction(() => !document.getElementById('daily-reminder-note') && !(document.getElementById('daily-reminder') as HTMLInputElement).checked)
        await settled(page)
        await page.click('#daily-reminder') // on again: Telegram is asked, the row is written, and the line does not come back
        await page.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.writes.length === 1)
        await settled(page)
        expect(await toggle(page)).toEqual({ checked: true, disabled: false })
        expect(await note(page)).toBeNull()
        await page.close()
      }, 60_000)

      it('gives way to what just happened: a failed save replaces the line, and the line is back once that is gone', async () => {
        // paused, switched on, and turning it off cannot be saved: the switch stays on, and the line says so (not that it is paused)
        const page = await open('reminder=on&paused=1&savefail=1')
        await toSettings(page)
        await settled(page)
        expect(await note(page)).toBe(PAUSED)
        await page.click('#daily-reminder')
        await page.waitForFunction(() => document.getElementById('daily-reminder-note')?.textContent?.startsWith('Could not save'))
        expect(await toggle(page)).toEqual({ checked: true, disabled: false })
        expect(await note(page)).toBe('Could not save this. Check your connection and try again.')
        await page.close()
      }, 60_000)

      for (const lang of ['en', 'ru'] as const) {
        for (const flag of ['paused', 'unreachable'] as const) {
          it(`fits at 320px in ${lang === 'en' ? 'English' : 'Russian'} (${flag}): no horizontal scroll, the line inside the card, the switch on screen`, async () => {
            const page = await open(`lang=${lang}&reminder=on&${flag}=1`)
            await page.setViewport({ width: 320, height: 700, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
            await page.click('.screen-header-actions .icon-btn:last-child')
            await page.waitForSelector('.settings')
            await page.waitForFunction(() => document.getElementById('daily-reminder-note'))
            const m = await page.evaluate(() => {
              const noteBox = document.getElementById('daily-reminder-note')!.getBoundingClientRect()
              const card = document.getElementById('daily-reminder')!.closest('.settings-group')!.getBoundingClientRect()
              const sw = document.getElementById('daily-reminder')!.getBoundingClientRect()
              const lineHeight = parseFloat(getComputedStyle(document.getElementById('daily-reminder-note')!).lineHeight)
              return { noteLeft: noteBox.left, noteRight: noteBox.right, cardLeft: card.left, cardRight: card.right, swRight: sw.right, width: window.innerWidth, scroll: document.documentElement.scrollWidth, lines: Math.round((noteBox.height - 12) / lineHeight) }
            })
            expect(m.scroll).toBeLessThanOrEqual(m.width)
            expect(m.noteLeft).toBeGreaterThanOrEqual(m.cardLeft)
            expect(m.noteRight).toBeLessThanOrEqual(m.cardRight)
            expect(m.swRight).toBeLessThanOrEqual(m.width - 12)
            expect(m.lines).toBeLessThanOrEqual(4) // quiet: a few short lines, never a block
            await page.close()
          }, 60_000)
        }
      }
    })

    for (const lang of ['en', 'ru'] as const) {
      it(`fits at 320px in ${lang === 'en' ? 'English' : 'Russian'}, with the declined line: the switch fully on screen, nothing wider than the screen, the row at least 48px`, async () => {
        const page = await open(`lang=${lang}&access=no`)
        await page.setViewport({ width: 320, height: 700, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
        await page.click('.screen-header-actions .icon-btn:last-child') // the gear (its name is in the page's language)
        await page.waitForSelector('.settings')
        await settled(page)
        await page.click('#daily-reminder')
        await page.waitForFunction(() => document.getElementById('daily-reminder-note'))
        const m = await page.evaluate(() => {
          const sw = document.getElementById('daily-reminder')!.getBoundingClientRect()
          const row = document.getElementById('daily-reminder')!.closest('.setting-row')!.getBoundingClientRect()
          const text = document.getElementById('daily-reminder-hint')!.getBoundingClientRect()
          const noteBox = document.getElementById('daily-reminder-note')!.getBoundingClientRect()
          return { swRight: sw.right, swLeft: sw.left, row: row.height, textRight: text.right, noteRight: noteBox.right, scroll: document.documentElement.scrollWidth, width: window.innerWidth, label: document.querySelector('label[for="daily-reminder"]')!.textContent, hint: document.getElementById('daily-reminder-hint')!.textContent }
        })
        expect(m.scroll).toBeLessThanOrEqual(m.width)
        expect(m.swRight).toBeLessThanOrEqual(m.width - 12)
        expect(m.textRight).toBeLessThanOrEqual(m.swLeft) // the text never runs under the switch
        expect(m.noteRight).toBeLessThanOrEqual(m.width)
        expect(m.row).toBeGreaterThanOrEqual(48)
        expect(m.label).toBe(lang === 'en' ? 'Daily reminder' : 'Ежедневное напоминание')
        expect(m.hint).toBe(lang === 'en' ? 'Comes at 20:00, and only when something is waiting.' : 'Приходит в 20:00 и только если есть что повторять.')
        await page.close()
      }, 60_000)
    }
  })

  // the sessions note is one of the goal's notes (the other, saying what a goal means, is always there): it is the one about batches of 10
  const sessionsNote = (p: Page) => p.evaluateHandle(() => Array.from(document.querySelectorAll('.setting-note')).find((e) => e.textContent?.includes('batches of 10')) ?? null).then((h) => h.asElement())
  it('the stepper stops at 20 and at 0, writes daily_new_word_limit each step, and the note shows from 16 up', async () => {
    const page = await open('goal=18')
    await toSettings(page)
    expect(await goal(page)).toBe(18)
    expect(await sessionsNote(page)).not.toBeNull() // 18 ≥ 16

    await page.click('button[aria-label="Increase the daily goal"]')
    await page.click('button[aria-label="Increase the daily goal"]')
    expect(await goal(page)).toBe(20)
    expect(await page.$eval('button[aria-label="Increase the daily goal"]', (e) => (e as HTMLButtonElement).disabled)).toBe(true)
    await page.waitForFunction(() => (window as never as { __sent: { settings: unknown[] } }).__sent.settings.length >= 2)
    expect((await sent(page)).map((p) => p.daily_new_word_limit)).toEqual([19, 20])

    for (let i = 0; i < 5; i++) await page.click('button[aria-label="Decrease the daily goal"]') // down to 15
    expect(await goal(page)).toBe(15)
    expect(await sessionsNote(page)).toBeNull() // at 15 the note is gone
    await page.click('button[aria-label="Increase the daily goal"]')
    expect(await sessionsNote(page)).not.toBeNull() // and back at 16
    await page.close()

    const low = await open('goal=1')
    await toSettings(low)
    await low.click('button[aria-label="Decrease the daily goal"]')
    expect(await goal(low)).toBe(0)
    expect(await low.$eval('button[aria-label="Decrease the daily goal"]', (e) => (e as HTMLButtonElement).disabled)).toBe(true)
    await low.waitForFunction(() => (window as never as { __sent: { settings: unknown[] } }).__sent.settings.length >= 1)
    expect((await sent(low)).at(-1)).toEqual({ daily_new_word_limit: 0 })
    await low.close()
  }, 60_000)

  it('the last translation switch cannot be turned off: it is disabled, and a tap does nothing', async () => {
    const page = await open('ru=1&en=0')
    await toSettings(page)
    const state = () => page.$$eval('input.switch[id^="language-"]', (els) => els.map((e) => ({ checked: (e as HTMLInputElement).checked, disabled: (e as HTMLInputElement).disabled })))
    expect(await state()).toEqual([{ checked: true, disabled: true }, { checked: false, disabled: false }])

    await page.click('label[for="language-ru"]') // a tap on the disabled one
    expect(await state()).toEqual([{ checked: true, disabled: true }, { checked: false, disabled: false }])
    expect(await sent(page)).toEqual([])

    await page.click('label[for="language-en"]') // English on: both on, nothing disabled
    await page.waitForFunction(() => document.querySelectorAll('input.switch[id^="language-"]:checked').length === 2)
    expect(await state()).toEqual([{ checked: true, disabled: false }, { checked: true, disabled: false }])
    await page.click('label[for="language-ru"]') // Russian off: English is now the last one
    await page.waitForFunction(() => document.querySelectorAll('input.switch[id^="language-"]:checked').length === 1)
    expect(await state()).toEqual([{ checked: false, disabled: false }, { checked: true, disabled: true }])
    expect((await sent(page)).at(-1)).toEqual({ show_ru_translation: false, show_en_translation: true })
    await page.close()
  }, 60_000)

  it("Home's Review count does not hold a word rated Again until its time, and counts it by itself when it comes due", async () => {
    const page = await open('ready=1&relearn=3')
    await page.waitForSelector('[data-tile="review"] .tile-count')
    const count = () => page.$eval('[data-tile="review"] .tile-count', (e) => Number(e.textContent))
    expect(await count()).toBe(8) // the eight due words; the one rated Again a moment ago is not due yet, so Review would not hand it out
    await page.waitForFunction(() => Number(document.querySelector('[data-tile="review"] .tile-count')?.textContent) === 9, { timeout: 10_000 }) // no tap, no navigation: the count is taken again when it comes due
    expect(await count()).toBe(9)
    await page.close()
  }, 60_000)

  describe('the Debug section behind seven taps on the version row', () => {
    const versionRow = '.setting-version'
    const tapVersion = async (page: Page, times: number) => {
      for (let i = 0; i < times; i++) await page.click(versionRow)
    }
    const debugSection = (page: Page) => page.$('#settings-debug')
    const pageText = (page: Page) => page.evaluate(() => document.body.innerText)

    it('six quick taps do nothing; the seventh unlocks Debug and writes debug_unlocked once', async () => {
      const page = await open('goal=12&lang=en')
      await toSettings(page)
      expect(await debugSection(page)).toBeNull()
      const before = await pageText(page)
      await tapVersion(page, 6)
      expect(await debugSection(page)).toBeNull()
      expect(await pageText(page)).toBe(before) // nothing on screen changed
      expect(await sent(page)).toEqual([])
      await tapVersion(page, 1)
      await page.waitForSelector('#settings-debug')
      expect(await page.$$eval('#settings-debug ~ .settings-group .setting-label', (els) => els.map((e) => e.textContent))).toEqual(['Debug', 'Lock Debug'])
      expect(await sent(page)).toEqual([{ debug_unlocked: true }])
      await tapVersion(page, 7) // more taps on an unlocked account write nothing more
      expect(await sent(page)).toEqual([{ debug_unlocked: true }])
      await page.close()
    }, 60_000)

    it('slow taps never unlock it: a pause longer than a second and a half starts the count again', async () => {
      const page = await open('goal=12&lang=en')
      await toSettings(page)
      await tapVersion(page, 6)
      await new Promise((r) => setTimeout(r, 1700))
      await tapVersion(page, 1) // the seventh in all, but the first since the pause
      expect(await debugSection(page)).toBeNull()
      await tapVersion(page, 5)
      expect(await debugSection(page)).toBeNull()
      await tapVersion(page, 1) // seven since the pause
      await page.waitForSelector('#settings-debug')
      await page.close()
    }, 60_000)

    it('only taps on the version row count: twenty on the text beneath it do nothing, and six on the row with one elsewhere between are still six', async () => {
      const page = await open('goal=12&lang=en')
      await toSettings(page)
      for (let i = 0; i < 20; i++) await page.click('.settings-about')
      expect(await debugSection(page)).toBeNull()
      await tapVersion(page, 3)
      await page.click('.settings-about')
      await tapVersion(page, 3)
      expect(await debugSection(page)).toBeNull()
      await page.close()
    }, 60_000)

    it('an account that unlocked it sees Debug at once, opens it, and locks it again: the section goes and the key leaves the blob', async () => {
      const page = await open('goal=12&lang=en&unlocked=1')
      await toSettings(page)
      await page.waitForSelector('#settings-debug')
      await press(page, '#settings-debug ~ .settings-group .setting-nav', 'Lock Debug')
      await page.waitForFunction(() => document.querySelector('#settings-debug') === null)
      expect(await sent(page)).toEqual([{ debug_unlocked: null }])
      expect(await pageText(page)).not.toContain('Debug')
      await tapVersion(page, 7) // and it can be found again the same way
      await page.waitForSelector('#settings-debug')
      expect(await sent(page)).toEqual([{ debug_unlocked: null }, { debug_unlocked: true }])
      await page.close()
    }, 60_000)

    it('Debug opens from the unlocked section and Back lands on Settings', async () => {
      const page = await open('goal=12&lang=en&unlocked=1')
      await toSettings(page)
      await press(page, '#settings-debug ~ .settings-group .setting-nav', 'Debug')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Debug')
      await back(page)
      await page.waitForSelector('.settings')
      await page.close()
    }, 60_000)

    it('nothing about the version row says it can be tapped: not focusable, no role, no pointer, no highlight, the same on a touch device', async () => {
      const page = await open('goal=12&lang=en')
      await toSettings(page)
      const look = await page.$eval(versionRow, (e) => {
        const style = getComputedStyle(e)
        return { tag: e.tagName, tabIndex: (e as HTMLElement).tabIndex, role: e.getAttribute('role'), aria: e.getAttributeNames().filter((n) => n.startsWith('aria-') || n === 'title'), cursor: style.cursor, tapHighlight: style.getPropertyValue('-webkit-tap-highlight-color'), select: style.userSelect }
      })
      expect(look).toEqual({ tag: 'DIV', tabIndex: -1, role: null, aria: [], cursor: 'auto', tapHighlight: 'rgba(0, 0, 0, 0)', select: 'none' })
      const plain = await page.$eval('.setting-row:not(.setting-nav):not(.setting-version):not(.setting-link)', (e) => getComputedStyle(e).cursor)
      expect(plain).toBe('auto')
      await page.close()
    }, 60_000)

    it('in Russian the lock row says «Заблокировать Debug»', async () => {
      const page = await open('goal=12&lang=ru&unlocked=1')
      await page.click('button[aria-label="Настройки"]')
      await page.waitForSelector('#settings-debug')
      expect(await page.$$eval('#settings-debug ~ .settings-group .setting-label', (els) => els.map((e) => e.textContent))).toEqual(['Debug', 'Заблокировать Debug'])
      await page.close()
    }, 60_000)
  })

  describe('a screen opens at the top of the page, and the one Back leads to gets its place back', () => {
    async function openShort(query: string) {
      const page = await open(query)
      await page.setViewport({ width: 390, height: 500, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }) // short, so Settings and "How it works" both scroll
      return page
    }
    const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))
    const scrollToEnd = (page: Page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const settle = (page: Page) => new Promise((r) => setTimeout(r, 150)).then(() => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(true)))))

    it('"How it works", opened from the bottom of Settings, opens at its top (it used to open where Settings had been scrolled to)', async () => {
      const page = await openShort('goal=12&lang=en')
      await toSettings(page)
      await scrollToEnd(page)
      await settle(page)
      expect(await scrollY(page)).toBeGreaterThan(100) // Settings really is scrolled
      await press(page, '.setting-nav', 'How it works')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'How it works')
      await settle(page)
      expect(await scrollY(page)).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(520) // and it is a page that can scroll, so the test means something
      await page.close()
    }, 60_000)

    it('Back from it puts Settings where it was left', async () => {
      const page = await openShort('goal=12&lang=en')
      await toSettings(page)
      // part-way down, not the end: at the end a clamped scroll would look like a restored one
      await page.evaluate(() => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - window.innerHeight) / 2)))
      await settle(page)
      const left = await scrollY(page)
      expect(left).toBeGreaterThan(50)
      expect(left).toBeLessThan(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight - 50))
      await press(page, '.setting-nav', 'How it works')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'How it works')
      await scrollToEnd(page) // read to the bottom of it
      await settle(page)
      await page.evaluate(() => (window as never as { __pressBack: () => string }).__pressBack()) // Back as App does it, without scrolling to its button
      await page.waitForSelector('.settings')
      await settle(page)
      expect(await scrollY(page)).toBe(left)
      await page.close()
    }, 60_000)

    it('the same for Debug (a tall page opened from Settings), the intro and the placement test', async () => {
      const page = await openShort('goal=12&lang=en&unlocked=1&ready=1')
      await toSettings(page)
      for (const [row, heading] of [['Debug', 'Debug'], ['Run the intro again', null], ['Take the placement test', 'Placement test']] as const) {
        await scrollToEnd(page)
        await settle(page)
        await press(page, '.setting-nav', row)
        await page.waitForFunction((h) => (h ? document.querySelector('h1')?.textContent === h : document.querySelector('.intro-progress') !== null), {}, heading)
        await settle(page)
        expect(await scrollY(page), row).toBe(0)
        await page.evaluate(() => (window as never as { __pressBack: () => string }).__pressBack())
        await page.waitForSelector('.settings')
      }
      await page.close()
    }, 90_000)
  })
})
