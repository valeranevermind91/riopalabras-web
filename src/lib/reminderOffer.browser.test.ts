import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * The offer to turn on the daily reminder, at the end of the first finished Learn session, in a real browser (src/testing/offerHarness.tsx puts
 * the real Learn screen, the real write queue and the real useReminders hook on a page, over a fake reminder row and a fake Telegram prompt).
 * Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

type Log = { writes: Record<string, unknown>[]; updates: Record<string, unknown>[]; asked: number }

describe.skipIf(!CHROME)('the reminder offer after a Learn session', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5214, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(query = '', width = 390) {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.setViewport({ width, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/offerHarness.html?${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.screen-header')
    return page
  }

  const log = (page: Page) => page.evaluate(() => (window as never as { __reminders: Log }).__reminders)
  const patches = (page: Page) => page.evaluate(() => (window as never as { __sent: { settings: Record<string, unknown>[] } }).__sent.settings)
  const answer = (page: Page, granted: boolean) => page.evaluate((g) => (window as never as { __answerAccess: (g: boolean) => void }).__answerAccess(g), granted)
  const offer = (page: Page) => page.$('.reminder-offer')
  const offerPatches = async (page: Page) => (await patches(page)).filter((p) => 'reminder_offer_shown' in p)
  const wordPosition = (page: Page) => page.$eval('.learn-progress span', (e) => Number(e.textContent!.match(/\d+/)![0]))
  const wordCount = (page: Page) => page.$eval('.learn-progress span', (e) => Number(e.textContent!.match(/\d+/g)![1]))

  /** Reads the whole batch card by card and presses "Finish batch": the session is finished once the end screen is there. */
  async function finishSession(page: Page) {
    await page.waitForSelector('.learn-progress')
    const total = await wordCount(page)
    for (let i = 1; i < total; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction((n) => Number(document.querySelector('.learn-progress span')!.textContent!.match(/\d+/)![0]) === n, {}, i + 1)
    }
    await page.click('.learn-finish .btn-primary')
    await page.waitForSelector('.post-batch')
  }

  it('is made on the end screen once the session is finished, and not before, not mid-session, not on the last card', async () => {
    const page = await open()
    await page.waitForSelector('.learn-progress')
    expect(await offer(page)).toBeNull()
    const total = await wordCount(page)
    for (let i = 1; i < total; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction((n) => Number(document.querySelector('.learn-progress span')!.textContent!.match(/\d+/)![0]) === n, {}, i + 1)
      expect(await offer(page)).toBeNull()
    }
    expect(await wordPosition(page)).toBe(total) // the last card, with "Finish batch" on it
    expect(await offer(page)).toBeNull()
    expect(await offerPatches(page)).toEqual([])

    await page.click('.learn-finish .btn-primary')
    await page.waitForSelector('.post-batch')
    expect(await offer(page)).not.toBeNull() // in the same frame as the end screen: nothing waited for
    expect(await page.$eval('#reminder-offer-text', (e) => e.textContent)).toBe('The words you just learned will come back for review tomorrow. Should we remind you?')
    expect(await page.$$eval('.reminder-offer button', (els) => els.map((e) => e.textContent))).toEqual(['Remind me', 'Not now'])
    await page.close()
  }, 60_000)

  it('does not push the end screen: its buttons are where they are without the offer, and the offer is below them', async () => {
    const withOffer = await open()
    await finishSession(withOffer)
    const without = await open('offered=1')
    await finishSession(without)
    const tops = (page: Page) => page.$$eval('.post-batch h2, .post-batch-actions button', (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
    expect(await tops(withOffer)).toEqual(await tops(without))
    const geometry = await withOffer.evaluate(() => ({
      lastButtonBottom: Math.max(...Array.from(document.querySelectorAll('.post-batch-actions button')).map((b) => b.getBoundingClientRect().bottom)),
      offerTop: document.querySelector('.reminder-offer')!.getBoundingClientRect().top,
    }))
    expect(geometry.offerTop).toBeGreaterThan(geometry.lastButtonBottom)
    await withOffer.close()
    await without.close()
  }, 60_000)

  it('records that it was shown the moment it shows, before any answer, and puts nothing else about reminders in the settings blob', async () => {
    const page = await open('access=manual')
    await finishSession(page)
    await page.waitForFunction(() => (window as never as { __sent: { settings: Record<string, unknown>[] } }).__sent.settings.some((p) => 'reminder_offer_shown' in p))
    // (the write queue may send it in the same request as the batch's own settings, so only the key is looked at) written once, with nothing
    // pressed: leaving now would not bring it back
    expect((await offerPatches(page)).map((p) => p.reminder_offer_shown)).toEqual([true])
    expect(await log(page)).toMatchObject({ writes: [], updates: [], asked: 0 })
    // answer it; no other key about reminders appears in anything sent
    await page.click('.reminder-offer button:first-child')
    await page.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.asked === 1)
    await answer(page, true)
    await page.waitForFunction(() => !document.querySelector('.reminder-offer'))
    const keys = (await patches(page)).flatMap((p) => Object.keys(p)).filter((k) => /remind/i.test(k))
    expect(keys).toEqual(['reminder_offer_shown'])
    await page.close()
  }, 60_000)

  it('is made once: not again at the end of the next session', async () => {
    const page = await open()
    await finishSession(page)
    expect(await offer(page)).not.toBeNull()
    await page.click('.reminder-offer button:last-child') // not now
    await page.waitForFunction(() => !document.querySelector('.reminder-offer'))
    await page.click('.post-batch-actions .btn-primary') // learn the next batch (the two words that are left)
    await finishSession(page)
    expect(await offer(page)).toBeNull()
    expect(await offerPatches(page)).toHaveLength(1) // and the flag was not written again
    await page.close()
  }, 60_000)

  it('is not made when the reminder is already on, or was offered before, or its state is unknown, or nothing was learned, or there is no reminders control', async () => {
    for (const [query, why] of [
      ['reminder=on', 'already on'],
      ['reminder=on&paused=1', 'on but paused: it is on'],
      ['offered=1', 'offered before'],
      ['readfail=1', 'state unknown'],
      ['nolearn=1', 'no control'],
    ] as const) {
      const page = await open(query)
      await finishSession(page)
      expect(await offer(page), why).toBeNull()
      expect(await offerPatches(page), why).toEqual([]) // nothing was shown, so nothing is recorded as shown (and for "offered before", nothing again)
      await page.close()
    }
    // an end screen reached with nothing to learn is not a finished session
    const empty = await open('pool=0')
    await empty.waitForSelector('.post-batch')
    expect(await offer(empty)).toBeNull()
    expect(await offerPatches(empty)).toEqual([])
    await empty.close()
  }, 120_000)

  it('"Remind me" asks Telegram first and writes the row, with the time zone, only after yes; the end screen stays usable meanwhile', async () => {
    const page = await open('access=manual')
    await finishSession(page)
    await page.click('.reminder-offer button:first-child')
    await page.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.asked === 1)
    expect(await log(page)).toMatchObject({ writes: [], updates: [] }) // the prompt is open: nothing written
    expect(await page.$$eval('.reminder-offer button', (els) => els.map((e) => (e as HTMLButtonElement).disabled))).toEqual([true, true])
    expect(await page.$$eval('.post-batch-actions button', (els) => els.map((e) => (e as HTMLButtonElement).disabled))).toEqual(await page.$$eval('.post-batch-actions button', (els) => els.map(() => false)))
    await answer(page, true)
    await page.waitForFunction(() => !document.querySelector('.reminder-offer'))
    expect((await log(page)).writes).toEqual([{ enabled: true, timezone: 'America/Montevideo' }]) // exactly what the Settings toggle writes
    expect(await page.$('.post-batch h2')).not.toBeNull()
    await page.close()
  }, 60_000)

  it('if Telegram says no, the offer just closes: nothing written, no error screen, the end screen as it was', async () => {
    const page = await open('access=manual')
    await finishSession(page)
    const before = await page.$eval('.post-batch', (e) => e.textContent!.replace(/\s+/g, ' ').replace(/The words you just learned.*?Not now/, '').trim())
    await page.click('.reminder-offer button:first-child')
    await page.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.asked === 1)
    await answer(page, false)
    await page.waitForFunction(() => !document.querySelector('.reminder-offer'))
    expect(await log(page)).toMatchObject({ writes: [], updates: [], asked: 1 })
    const after = await page.$eval('.post-batch', (e) => e.textContent!.replace(/\s+/g, ' ').trim())
    expect(after).toBe(before) // nothing was added: no message, no notice
    expect(await page.$('[role="alert"]')).toBeNull()
    expect(await page.$eval('body', (e) => e.textContent)).not.toMatch(/did not allow|Could not save/)
    await page.close()
  }, 60_000)

  it('if the permission was given but the row could not be saved, it closes the same way', async () => {
    const page = await open('savefail=1')
    await finishSession(page)
    await page.click('.reminder-offer button:first-child')
    await page.waitForFunction(() => !document.querySelector('.reminder-offer'))
    expect(await log(page)).toMatchObject({ writes: [], updates: [], asked: 1 })
    expect(await page.$eval('body', (e) => e.textContent)).not.toMatch(/did not allow|Could not save/)
    await page.close()
  }, 60_000)

  it('"Not now" closes it and changes nothing: Telegram is not asked, the row is not touched', async () => {
    const page = await open()
    await finishSession(page)
    await page.click('.reminder-offer button:last-child')
    await page.waitForFunction(() => !document.querySelector('.reminder-offer'))
    expect(await log(page)).toEqual({ writes: [], updates: [], asked: 0 })
    expect((await offerPatches(page)).map((p) => p.reminder_offer_shown)).toEqual([true]) // it was shown, and that stays recorded
    await page.close()
  }, 60_000)

  for (const lang of ['en', 'ru'] as const) {
    it(`fits at 320px in ${lang === 'en' ? 'English' : 'Russian'}: inside the card, buttons at least 48px and on screen, nothing wider than the screen`, async () => {
      const page = await open(`lang=${lang}`, 320)
      await finishSession(page)
      await page.waitForSelector('.reminder-offer')
      const m = await page.evaluate(() => {
        const card = document.querySelector('.reminder-offer')!.getBoundingClientRect()
        const text = document.getElementById('reminder-offer-text')!
        const buttons = Array.from(document.querySelectorAll('.reminder-offer button')).map((b) => ({ r: b.getBoundingClientRect(), text: b.textContent }))
        return {
          card: { left: card.left, right: card.right },
          buttons: buttons.map((b) => ({ left: b.r.left, right: b.r.right, height: b.r.height, text: b.text })),
          lines: Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)),
          scroll: document.documentElement.scrollWidth,
          width: window.innerWidth,
          text: text.textContent,
        }
      })
      expect(m.scroll).toBeLessThanOrEqual(m.width)
      for (const b of m.buttons) {
        expect(b.height).toBeGreaterThanOrEqual(48)
        expect(b.left).toBeGreaterThanOrEqual(m.card.left)
        expect(b.right).toBeLessThanOrEqual(m.card.right)
      }
      expect(m.lines).toBeLessThanOrEqual(5)
      expect(m.text).toBe(lang === 'en' ? 'The words you just learned will come back for review tomorrow. Should we remind you?' : 'Слова, которые вы только что выучили, вернутся на повторение завтра. Напомнить вам?')
      expect(m.buttons.map((b) => b.text)).toEqual(lang === 'en' ? ['Remind me', 'Not now'] : ['Напомнить', 'Не сейчас'])
      await page.close()
    }, 60_000)
  }
})
