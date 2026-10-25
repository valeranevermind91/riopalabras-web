import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * The offer to turn on the daily reminder, at the end of a finished Learn session (until it is answered, at most three times), in a real browser (src/testing/offerHarness.tsx puts
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

  const OFFER_EN = "Tomorrow's reviews will be waiting. Want a reminder around 20:00? It only comes on days when something is due."
  const OFFER_RU = 'Завтра вас ждет повторение. Напомнить около 20:00? Напоминание приходит только в те дни, когда есть что повторять.'
  const values = async (page: Page) => (await offerPatches(page)).map((p) => p.reminder_offer_shown)
  const answerLine = (page: Page) => page.$eval('.reminder-offer-answer', (e) => e.textContent)
  /** Learns the next batch and finishes it (the end screen it leads to is the next session's). Needs a pool and a goal for more than one batch: limit=50&pool=50. */
  async function nextSession(page: Page) {
    await page.click('.post-batch-actions .btn-primary')
    await finishSession(page)
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
    expect(await page.$eval('#reminder-offer-text', (e) => e.textContent)).toBe(OFFER_EN)
    expect(await page.$$eval('.reminder-offer button', (els) => els.map((e) => e.textContent))).toEqual(['Remind me', 'No thanks'])
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

  it('counts itself as shown the moment it shows (1, not "answered"), before any answer, and puts nothing else about reminders in the settings blob', async () => {
    const page = await open('access=manual')
    await finishSession(page)
    await page.waitForFunction(() => (window as never as { __sent: { settings: Record<string, unknown>[] } }).__sent.settings.some((p) => 'reminder_offer_shown' in p))
    // (the write queue may send it in the same request as the batch's own settings, so only the key is looked at) written once, with nothing pressed
    expect(await values(page)).toEqual([1])
    expect(await log(page)).toMatchObject({ writes: [], updates: [], asked: 0 })
    // answer it; no other key about reminders appears in anything sent, and the answer is the last value
    await page.click('.reminder-offer button:first-child')
    await page.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.asked === 1)
    await answer(page, true)
    await page.waitForFunction(() => !document.querySelector('.reminder-offer'))
    const keys = (await patches(page)).flatMap((p) => Object.keys(p)).filter((k) => /remind/i.test(k))
    expect([...new Set(keys)]).toEqual(['reminder_offer_shown'])
    expect(await values(page)).toEqual([1, true])
    await page.close()
  }, 60_000)

  it('leaving without answering does not spend it: it is made again at the end of the next session, and the next, three times in all, and then no more', async () => {
    const page = await open('limit=50&pool=50')
    await finishSession(page)
    expect(await offer(page)).not.toBeNull()
    await nextSession(page) // "Learn next batch" without a word to the offer
    expect(await offer(page)).not.toBeNull()
    await nextSession(page)
    expect(await offer(page)).not.toBeNull()
    expect(await values(page)).toEqual([1, 2, 3]) // counted at each showing
    await nextSession(page)
    expect(await offer(page)).toBeNull() // the fourth end screen: it has been made three times
    expect(await values(page)).toEqual([1, 2, 3])
    await page.close()
  }, 120_000)

  it('picks the count up from the blob: shown twice before is made once more, shown three times is over, and the old `true` is over', async () => {
    const twice = await open('shows=2')
    await finishSession(twice)
    expect(await offer(twice)).not.toBeNull()
    expect(await values(twice)).toEqual([3])
    await twice.close()
    for (const query of ['shows=3', 'shows=5', 'offered=1']) {
      const page = await open(query)
      await finishSession(page)
      expect(await offer(page), query).toBeNull()
      expect(await offerPatches(page), query).toEqual([])
      await page.close()
    }
  }, 120_000)

  it('an answer ends it for good: after "No thanks" or "Remind me", not at the end of the next session either', async () => {
    for (const choice of ['button:first-child', 'button:last-child']) {
      const page = await open('limit=50&pool=50')
      await finishSession(page)
      await page.click(`.reminder-offer ${choice}`)
      await page.waitForSelector('.reminder-offer-answer')
      await nextSession(page)
      expect(await offer(page), choice).toBeNull()
      expect(await page.$('.reminder-offer-answer'), choice).toBeNull() // the line of the first answer went with its end screen
      expect((await values(page)).at(-1), choice).toBe(true)
      expect(await values(page), choice).toEqual([1, true]) // nothing written for the second screen
      await page.close()
    }
  }, 120_000)

  it('is not made when the reminder is already on, or its state is unknown, or nothing was learned, or there is no reminders control', async () => {
    for (const [query, why] of [
      ['reminder=on', 'already on'],
      ['reminder=on&paused=1', 'on but paused: it is on'],
      ['readfail=1', 'state unknown'],
      ['nolearn=1', 'no control'],
    ] as const) {
      const page = await open(query)
      await finishSession(page)
      expect(await offer(page), why).toBeNull()
      expect(await offerPatches(page), why).toEqual([]) // nothing was shown, so nothing is recorded as shown
      await page.close()
    }
    // an end screen reached with nothing to learn is not a finished session
    const empty = await open('pool=0')
    await empty.waitForSelector('.post-batch')
    expect(await offer(empty)).toBeNull()
    expect(await offerPatches(empty)).toEqual([])
    await empty.close()
  }, 120_000)

  it('"Remind me" asks Telegram first and writes the row, with the time zone, only after yes; the end screen stays usable meanwhile; the answer is on record at once', async () => {
    const page = await open('access=manual')
    await finishSession(page)
    await page.click('.reminder-offer button:first-child')
    await page.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.asked === 1)
    expect(await log(page)).toMatchObject({ writes: [], updates: [] }) // the prompt is open: nothing written
    expect(await values(page)).toEqual([1, true]) // but leaving now would not bring the offer back
    expect(await page.$$eval('.reminder-offer button', (els) => els.map((e) => (e as HTMLButtonElement).disabled))).toEqual([true, true])
    expect(await page.$$eval('.post-batch-actions button', (els) => els.map((e) => (e as HTMLButtonElement).disabled))).toEqual(await page.$$eval('.post-batch-actions button', (els) => els.map(() => false)))
    await answer(page, true)
    await page.waitForSelector('.reminder-offer-answer')
    expect(await offer(page)).toBeNull()
    expect(await answerLine(page)).toBe('Done: a reminder around 20:00 on days when words are due. You can change this in Settings → Notifications.')
    expect((await log(page)).writes).toEqual([{ enabled: true, timezone: 'America/Montevideo' }]) // exactly what the Settings toggle writes
    expect(await page.$('.post-batch h2')).not.toBeNull()
    await page.close()
  }, 60_000)

  it('if Telegram says no, the card gives way to what Settings says about it: nothing written, no error screen, and the offer is over', async () => {
    const page = await open('access=manual')
    await finishSession(page)
    await page.click('.reminder-offer button:first-child')
    await page.waitForFunction(() => (window as never as { __reminders: Log }).__reminders.asked === 1)
    await answer(page, false)
    await page.waitForSelector('.reminder-offer-answer')
    expect(await offer(page)).toBeNull()
    expect(await answerLine(page)).toBe("Telegram did not allow messages. You can allow them from the bot's chat.")
    expect(await log(page)).toMatchObject({ writes: [], updates: [], asked: 1 })
    expect(await page.$('[role="alert"]')).toBeNull()
    expect(await values(page)).toEqual([1, true])
    await page.close()
  }, 60_000)

  it('if the permission was given but the row could not be saved, the line says so', async () => {
    const page = await open('savefail=1')
    await finishSession(page)
    await page.click('.reminder-offer button:first-child')
    await page.waitForSelector('.reminder-offer-answer')
    expect(await offer(page)).toBeNull()
    expect(await answerLine(page)).toBe('Could not save this. Check your connection and try again.')
    expect(await log(page)).toMatchObject({ writes: [], updates: [], asked: 1 })
    expect(await values(page)).toEqual([1, true])
    await page.close()
  }, 60_000)

  it('"No thanks" answers it: Telegram is not asked, the row is not touched, and one line says where the switch is', async () => {
    const page = await open()
    await finishSession(page)
    await page.click('.reminder-offer button:last-child')
    await page.waitForSelector('.reminder-offer-answer')
    expect(await offer(page)).toBeNull()
    expect(await answerLine(page)).toBe('OK. You can turn it on any time in Settings → Notifications.')
    expect(await log(page)).toEqual({ writes: [], updates: [], asked: 0 })
    expect(await values(page)).toEqual([1, true]) // it was shown, and then answered
    expect(await page.$('.reminder-offer-answer button, .reminder-offer-answer a')).toBeNull() // a line, nothing to press
    await page.close()
  }, 60_000)

  for (const lang of ['en', 'ru'] as const) {
    it(`fits at 320px in ${lang === 'en' ? 'English' : 'Russian'}: inside the card, buttons at least 48px and on screen, nothing wider than the screen, and so do the lines that replace it`, async () => {
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
      expect(m.lines).toBeLessThanOrEqual(6)
      expect(m.text).toBe(lang === 'en' ? OFFER_EN : OFFER_RU)
      expect(m.buttons.map((b) => b.text)).toEqual(lang === 'en' ? ['Remind me', 'No thanks'] : ['Напомнить', 'Не нужно'])
      // the line that replaces the card after each answer
      for (const choice of ['button:first-child', 'button:last-child']) {
        const again = await open(`lang=${lang}`, 320)
        await finishSession(again)
        await again.click(`.reminder-offer ${choice}`)
        await again.waitForSelector('.reminder-offer-answer')
        const line = await again.$eval('.reminder-offer-answer', (e) => {
          const r = e.getBoundingClientRect()
          return { left: r.left, right: r.right, text: e.textContent, scroll: document.documentElement.scrollWidth, width: window.innerWidth }
        })
        expect(line.left).toBeGreaterThanOrEqual(0)
        expect(line.right).toBeLessThanOrEqual(line.width)
        expect(line.scroll).toBeLessThanOrEqual(line.width)
        expect(line.text).toContain(lang === 'en' ? 'Settings → Notifications' : 'Настройках → Уведомления')
        await again.close()
      }
      await page.close()
    }, 90_000)
  }
})
