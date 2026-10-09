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
    const page = await open('debug=1')
    await toSettings(page)
    expect(await page.$$eval('.settings-label', (els) => els.map((e) => e.textContent))).toEqual(['Learning', 'Language', 'Appearance', 'Notifications', 'About', 'Debug'])
    expect(await page.$$eval('#settings-debug ~ .settings-group button', (els) => els.length)).toBe(1)
    await page.click('#settings-debug ~ .settings-group .setting-nav')
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Debug')

    await back(page)
    expect(await title(page)).toBe('Settings') // not Home
    await back(page)
    expect(await title(page)).toBe('Riopalabras')
    await page.close()
  }, 60_000)

  it('every row is at least 48px tall, and every control has a name that is tied to it', async () => {
    const page = await open('debug=1')
    await toSettings(page)
    const heights = await page.$$eval('.setting-row', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    expect(heights.length).toBeGreaterThanOrEqual(8)
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(48)
    // the switches: exactly one <label> each, with its text
    expect(await page.$$eval('input.switch', (els) => els.map((e) => (e as HTMLInputElement).labels?.length === 1 ? (e as HTMLInputElement).labels![0].textContent : null))).toEqual(['Russian', 'English'])
    // the stepper: named buttons and a value tied to the "Daily goal" label
    expect(await page.$$eval('.stepper-btn', (els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Decrease the daily goal', 'Increase the daily goal'])
    expect(await page.$eval('output.stepper-value', (e) => document.getElementById(e.getAttribute('aria-labelledby')!)?.textContent)).toBe('Daily goal')
    // the theme control: a radio group named by its label
    expect(await page.$$eval('[role="radiogroup"]', (els) => els.map((e) => document.getElementById(e.getAttribute('aria-labelledby')!)?.textContent))).toEqual(['App language', 'Theme'])
    // the reminders row has nothing to focus
    expect(await page.$$eval('.setting-row.is-disabled button, .setting-row.is-disabled input, .setting-row.is-disabled a, .setting-row.is-disabled [tabindex]', (els) => els.length)).toBe(0)
    await page.close()
  }, 60_000)

  it('the stepper stops at 20 and at 0, writes daily_new_word_limit each step, and the note shows from 16 up', async () => {
    const page = await open('goal=18')
    await toSettings(page)
    expect(await goal(page)).toBe(18)
    expect(await page.$('.setting-note')).not.toBeNull() // 18 ≥ 16

    await page.click('button[aria-label="Increase the daily goal"]')
    await page.click('button[aria-label="Increase the daily goal"]')
    expect(await goal(page)).toBe(20)
    expect(await page.$eval('button[aria-label="Increase the daily goal"]', (e) => (e as HTMLButtonElement).disabled)).toBe(true)
    await page.waitForFunction(() => (window as never as { __sent: { settings: unknown[] } }).__sent.settings.length >= 2)
    expect((await sent(page)).map((p) => p.daily_new_word_limit)).toEqual([19, 20])

    for (let i = 0; i < 5; i++) await page.click('button[aria-label="Decrease the daily goal"]') // down to 15
    expect(await goal(page)).toBe(15)
    expect(await page.$('.setting-note')).toBeNull() // at 15 the note is gone
    await page.click('button[aria-label="Increase the daily goal"]')
    expect(await page.$('.setting-note')).not.toBeNull() // and back at 16
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
    const state = () => page.$$eval('input.switch', (els) => els.map((e) => ({ checked: (e as HTMLInputElement).checked, disabled: (e as HTMLInputElement).disabled })))
    expect(await state()).toEqual([{ checked: true, disabled: true }, { checked: false, disabled: false }])

    await page.click('label[for="language-ru"]') // a tap on the disabled one
    expect(await state()).toEqual([{ checked: true, disabled: true }, { checked: false, disabled: false }])
    expect(await sent(page)).toEqual([])

    await page.click('label[for="language-en"]') // English on: both on, nothing disabled
    await page.waitForFunction(() => document.querySelectorAll('input.switch:checked').length === 2)
    expect(await state()).toEqual([{ checked: true, disabled: false }, { checked: true, disabled: false }])
    await page.click('label[for="language-ru"]') // Russian off: English is now the last one
    await page.waitForFunction(() => document.querySelectorAll('input.switch:checked').length === 1)
    expect(await state()).toEqual([{ checked: false, disabled: false }, { checked: true, disabled: true }])
    expect((await sent(page)).at(-1)).toEqual({ show_ru_translation: false, show_en_translation: true })
    await page.close()
  }, 60_000)
})
