import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import type { FeedbackReport } from '../data/feedback'

/**
 * The message form in a real browser (src/testing/feedbackHarness.tsx puts the real screen on a page with a send function that records what it is
 * given and answers as the test says): what is refused, what is sent and with what, a failure that keeps the words, a retry that keeps the id,
 * the 2000-character limit and its count, and sending that never holds the screen. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('the message form in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5233, strictPort: false } })
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
    await page.goto(`${base}/src/testing/feedbackHarness.html?${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.feedback textarea')
    return page
  }

  const reports = (page: Page) => page.evaluate(() => (window as never as { __reports: FeedbackReport[] }).__reports)
  const mode = (page: Page, value: 'ok' | 'fail' | 'hang') => page.evaluate((m) => void ((window as never as { __mode: string }).__mode = m), value)
  const typed = (page: Page) => page.$eval('textarea', (e) => (e as HTMLTextAreaElement).value)
  const write = async (page: Page, text: string) => {
    await page.click('textarea')
    await page.keyboard.sendCharacter(text)
  }
  const tap = (page: Page, text: string) =>
    page.evaluate((label) => (Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLElement).click(), text)
  const alerts = (page: Page) => page.$$eval('[role="alert"]', (els) => els.map((e) => e.textContent))
  const result = (page: Page) => page.$eval('#result', (e) => e.textContent)
  const pressBack = (page: Page) => page.evaluate(() => (window as never as { __pressBack: () => string }).__pressBack())

  it('an empty message is refused, and so is one of only spaces and line breaks: nothing is sent', async () => {
    const page = await open()
    await tap(page, 'Send')
    expect(await alerts(page)).toEqual(['Write something first.'])
    await write(page, '   \n  ')
    expect(await alerts(page)).toEqual([]) // typing clears the complaint
    await tap(page, 'Send')
    expect(await alerts(page)).toEqual(['Write something first.'])
    expect(await reports(page)).toEqual([])
    expect(await page.$('#result')).toBeNull() // and the form is still there
    await page.close()
  }, 60_000)

  it('a general message goes trimmed, with no word, and with the context filled in; then the form closes', async () => {
    const page = await open()
    await write(page, '  The reminders come twice.  \n')
    await tap(page, 'Send')
    await page.waitForSelector('#result')
    expect(await result(page)).toBe('sent')
    const [report, ...rest] = await reports(page)
    expect(rest).toEqual([])
    expect(report).toMatchObject({ kind: 'general', esWord: null, message: 'The reminders come twice.', uiLanguage: 'en', screen: 'settings', platform: 'android' })
    expect(report.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(report.appVersion).toMatch(/\S/)
    await page.close()
  }, 60_000)

  it('a word report shows the word on the form and carries it, with the screen it came from', async () => {
    const page = await open('kind=word')
    expect(await page.$eval('.form-word', (e) => e.textContent)).toBe('The wordchévere')
    await write(page, 'The Russian translation is wrong')
    await tap(page, 'Send')
    await page.waitForSelector('#result')
    expect((await reports(page))[0]).toMatchObject({ kind: 'word', esWord: 'chévere', screen: 'word', message: 'The Russian translation is wrong', platform: 'android' })
    await page.close()
  }, 60_000)

  it('says in one line, before sending, exactly what goes along with the text: the same values the report then carries', async () => {
    const page = await open('kind=word')
    const sentWith = await page.$eval('#feedback-sends', (e) => e.textContent!)
    await write(page, 'x')
    await tap(page, 'Send')
    await page.waitForSelector('#result')
    const r = (await reports(page))[0]
    expect(sentWith).toBe(`Sent with your message: the word “chévere”, your account, app version ${r.appVersion}, interface language English, screen Word, Telegram platform ${r.platform}.`)
    await page.close()
  }, 60_000)

  it('a failed send keeps every word, says so, and leaves the form as it was; the retry carries the same id', async () => {
    const page = await open()
    await mode(page, 'fail')
    await write(page, 'A long note I do not want to lose')
    await tap(page, 'Send')
    await page.waitForFunction(() => document.querySelector('[role="alert"]') !== null)
    expect(await alerts(page)).toEqual(['Could not send it. Your message is still here: try again in a moment.'])
    expect(await typed(page)).toBe('A long note I do not want to lose')
    expect(await page.$('#result')).toBeNull()
    expect(await page.$eval('button[type="submit"]', (e) => ({ text: e.textContent, disabled: (e as HTMLButtonElement).disabled }))).toEqual({ text: 'Send', disabled: false })

    await mode(page, 'ok')
    await tap(page, 'Send')
    await page.waitForSelector('#result')
    const all = await reports(page)
    expect(all).toHaveLength(2)
    expect(all[1].id).toBe(all[0].id) // the same report twice, so the table can ignore the second
    expect(all[1].message).toBe(all[0].message)
    await page.close()
  }, 60_000)

  it('after a failure, changed words are a new report with a new id; the same words again are the same one', async () => {
    const page = await open()
    await mode(page, 'fail')
    await write(page, 'first')
    await tap(page, 'Send')
    await page.waitForFunction(() => document.querySelector('[role="alert"]') !== null)
    await write(page, ' and more')
    expect(await alerts(page)).toEqual([]) // editing clears the complaint
    await tap(page, 'Send')
    await page.waitForFunction(() => (window as never as { __reports: unknown[] }).__reports.length === 2)
    const [a, b] = await reports(page)
    expect(b.id).not.toBe(a.id)
    expect(b.message).toBe('first and more')
    await page.close()
  }, 60_000)

  it('holds 2000 characters and not one more, and shows the count from 1800 on', async () => {
    const page = await open()
    await write(page, 'a'.repeat(1799))
    expect(await page.$('.form-count')).toBeNull() // plenty of room: no count
    await write(page, 'a')
    expect(await page.$eval('.form-count', (e) => e.textContent)).toBe('1800 / 2000')
    await write(page, 'b'.repeat(500)) // more than fits
    expect((await typed(page)).length).toBe(2000)
    expect(await page.$eval('.form-count', (e) => ({ text: e.textContent, full: e.classList.contains('is-full') }))).toEqual({ text: '2000 / 2000', full: true })
    await tap(page, 'Send')
    await page.waitForSelector('#result')
    expect((await reports(page))[0].message).toHaveLength(2000)
    await page.close()
  }, 60_000)

  it('sending never holds the screen: the button says it is sending, the words stay readable, and Back and Cancel still work', async () => {
    const page = await open()
    await mode(page, 'hang')
    await write(page, 'slow network')
    await tap(page, 'Send')
    await page.waitForFunction(() => document.querySelector('button[type="submit"]')?.textContent === 'Sending…')
    expect(await page.$eval('button[type="submit"]', (e) => (e as HTMLButtonElement).disabled)).toBe(true)
    expect(await page.$eval('textarea', (e) => (e as HTMLTextAreaElement).readOnly)).toBe(true)
    expect(await typed(page)).toBe('slow network')
    await page.$eval('form', (f) => (f as HTMLFormElement).requestSubmit()) // a second submit does not send a second time
    expect(await reports(page)).toHaveLength(1)
    await tap(page, 'Cancel')
    await page.waitForSelector('#result')
    expect(await result(page)).toBe('closed')
    await page.close()
  }, 60_000)

  it('Back with words typed asks first and keeps them if asked to; with nothing typed it just leaves', async () => {
    const page = await open()
    expect(await pressBack(page)).toBe('handled')
    await page.waitForSelector('#result')
    expect(await result(page)).toBe('closed')
    await page.close()

    const typedPage = await open()
    await write(typedPage, 'half a thought')
    expect(await pressBack(typedPage)).toBe('handled')
    await typedPage.waitForSelector('.sheet')
    expect(await typedPage.$eval('.sheet h2', (e) => e.textContent)).toBe('Discard your message?')
    await tap(typedPage, 'Keep writing')
    await typedPage.waitForFunction(() => document.querySelector('.sheet') === null)
    expect(await typed(typedPage)).toBe('half a thought')
    await tap(typedPage, 'Cancel')
    await typedPage.waitForSelector('.sheet')
    await tap(typedPage, 'Discard')
    await typedPage.waitForSelector('#result')
    expect(await reports(typedPage)).toEqual([])
    await typedPage.close()
  }, 60_000)

  for (const [language, query, send, cancel, line] of [
    ['English', 'lang=en&kind=word', 'Send', 'Cancel', 'Sent with your message: the word “chévere”, your account, app version dev, interface language English, screen Word, Telegram platform android.'],
    ['Russian', 'lang=ru&kind=word', 'Отправить', 'Отмена', 'Вместе с текстом отправится: слово «chévere», ваш аккаунт, версия приложения dev, язык интерфейса — русский, экран — «Слово», платформа Telegram — android.'],
  ] as const) {
    it(`${language}, 320px: the form fits the screen, the line says what is sent, the buttons are real tap targets, and the count fits beside a full field`, async () => {
      const page = await open(query, 320)
      await write(page, 'я'.repeat(1900))
      const look = await page.evaluate(() => {
        const box = (e: Element) => {
          const r = e.getBoundingClientRect()
          return { left: r.left, right: r.right, height: r.height }
        }
        const area = document.querySelector('textarea')!
        return {
          pageFits: document.documentElement.scrollWidth <= window.innerWidth,
          area: box(area),
          buttons: Array.from(document.querySelectorAll('.form-actions .btn')).map((b) => ({ text: b.textContent, ...box(b) })),
          line: document.querySelector('#feedback-sends')!.textContent,
          count: document.querySelector('.form-count') ? box(document.querySelector('.form-count')!) : null,
          size: parseFloat(getComputedStyle(area).fontSize),
        }
      })
      expect(look.pageFits).toBe(true)
      expect(look.area.left).toBeGreaterThanOrEqual(0)
      expect(look.area.right).toBeLessThanOrEqual(320)
      expect(look.size).toBeGreaterThanOrEqual(16) // no zoom-on-focus
      expect(look.buttons.map((b) => b.text)).toEqual([send, cancel])
      for (const b of look.buttons) expect(b.height).toBeGreaterThanOrEqual(44)
      expect(look.line).toMatch(new RegExp(`^${line.replace('dev', '(?:dev|[0-9a-f]{7,})')}$`)) // the build's own version is whatever this checkout is
      expect(look.count!.right).toBeLessThanOrEqual(320)
      await page.close()
    }, 60_000)
  }
})
