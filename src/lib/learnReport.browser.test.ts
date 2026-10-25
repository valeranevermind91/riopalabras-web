import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * "Report a problem with this word" on the Learn card, in a real browser (src/testing/logHarness.tsx: the real Learn screen, with a sender that records every
 * report when the query has report=1). The form is drawn over the card, which stays mounted: sending or leaving returns to the same card in the same batch.
 * Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((path) => path && existsSync(path))

interface Report {
  kind: string
  esWord: string | null
  screen: string
  message: string
}

describe.skipIf(!CHROME)('Report a problem, from the Learn card', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5251, strictPort: false } })
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
    await page.emulateTimezone('America/Montevideo')
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/logHarness.html?screen=learn&fresh=12&${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.learn-progress')
    return page
  }
  const position = (page: Page) => page.$eval('.learn-progress span', (e) => e.textContent ?? '')
  const headwordOnCard = (page: Page) => page.$eval('.wc-headword', (e) => e.textContent ?? '')
  const reports = (page: Page) => page.evaluate(() => (window as never as { __reports: Report[] }).__reports) as Promise<Report[]>
  const cardNumber = async (page: Page) => Number((await position(page)).match(/\d+/)![0])
  /** Moves `times` cards on from wherever the batch is, and waits for the card to be there. */
  const next = async (page: Page, times: number) => {
    const target = (await cardNumber(page)) + times
    for (let i = 0; i < times; i++) await page.keyboard.press('ArrowRight')
    await page.waitForFunction((n) => document.querySelector('.learn-progress span')?.textContent?.startsWith(`Word ${n} of`), {}, target)
  }
  const formOpen = (page: Page) => page.waitForSelector('main.feedback')
  const cardShowing = (page: Page) => page.waitForSelector('main.fill:not([hidden]) .learn-progress')

  it('the card has the control, quiet and under "Hide this word"; without a sender there is none', async () => {
    const page = await open('report=1')
    expect(await page.$eval('.learn-report .known-btn', (e) => e.textContent)).toBe('Report a problem with this word')
    expect(await page.$eval('.learn-known .known-btn', (e) => e.textContent)).toBe('Hide this word')
    const under = await page.evaluate(() => Boolean(document.querySelector('.learn-known')!.compareDocumentPosition(document.querySelector('.learn-report')!) & Node.DOCUMENT_POSITION_FOLLOWING))
    expect(under).toBe(true)
    await page.close()

    const signedOut = await open('')
    expect(await signedOut.$('.learn-report')).toBeNull()
    await signedOut.close()
  })

  it('it opens the form for the word on the card; sending returns to the same card with a line that says it went, for that card only', async () => {
    const page = await open('report=1')
    await next(page, 2)
    const word = await headwordOnCard(page)
    expect(await position(page)).toMatch(/^Word 3 of/)
    await page.click('.learn-report .known-btn')
    await formOpen(page)
    expect(await page.$eval('.form-word strong', (e) => e.textContent)).toBe(word)
    expect(await page.$eval('main.fill', (e) => (e as HTMLElement).hidden)).toBe(true) // the card is still there, under the form
    await page.type('textarea', 'The translation is wrong.')
    await page.click('.form-actions .btn-primary')
    await cardShowing(page)
    expect(await position(page)).toMatch(/^Word 3 of/) // the same card, the same batch
    expect(await headwordOnCard(page)).toBe(word)
    expect(await page.$eval('.learn-report .detail-note', (e) => e.textContent)).toBe('Sent. Thank you.')
    const sent = await reports(page)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ kind: 'word', esWord: word, screen: 'learn', message: 'The translation is wrong.' })
    await next(page, 1) // another card: no line
    expect(await page.$('.learn-report .detail-note')).toBeNull()
    await page.keyboard.press('ArrowLeft')
    await page.waitForFunction(() => document.querySelector('.learn-progress span')?.textContent?.startsWith('Word 3 of'))
    expect(await page.$eval('.learn-report .detail-note', (e) => e.textContent)).toBe('Sent. Thank you.')
    await page.close()
  })

  it('Cancel leaves with nothing sent, on the same card', async () => {
    const page = await open('report=1')
    await next(page, 1)
    const word = await headwordOnCard(page)
    await page.click('.learn-report .known-btn')
    await formOpen(page)
    await page.click('.form-actions .btn-secondary')
    await cardShowing(page)
    expect(await position(page)).toMatch(/^Word 2 of/)
    expect(await headwordOnCard(page)).toBe(word)
    expect(await reports(page)).toEqual([])
    expect(await page.$('.learn-report .detail-note')).toBeNull()
    await page.close()
  })

  it('with the form open, the arrow keys belong to its text box, not to the cards behind it', async () => {
    const page = await open('report=1')
    await next(page, 1)
    await page.click('.learn-report .known-btn')
    await formOpen(page)
    await page.focus('textarea')
    await page.type('textarea', 'abc')
    // not a round trip: three Rights and one Left, so that if the cards behind did move, they would end somewhere else (card 4, not card 2)
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    await page.click('.form-actions .btn-secondary') // Cancel with something typed asks first
    await page.click('.confirm-delete .btn-danger')
    await cardShowing(page)
    expect(await position(page)).toMatch(/^Word 2 of/) // never moved
    await page.close()
  })

  it("Telegram's own Back closes the form (and asks first when something is typed), and the card is where it was", async () => {
    const page = await open('report=1&native=1')
    await next(page, 1)
    const back = () => page.evaluate(() => (window as never as { __nativeBack: () => void }).__nativeBack())
    await page.click('.learn-report .known-btn')
    await formOpen(page)
    await back()
    await cardShowing(page)
    expect(await position(page)).toMatch(/^Word 2 of/)
    await page.click('.learn-report .known-btn')
    await formOpen(page)
    await page.type('textarea', 'half a thought')
    await back()
    await page.waitForSelector('.confirm-delete')
    await back() // Back again takes the question away, and the text is still there
    await page.waitForFunction(() => !document.querySelector('.confirm-delete'))
    expect(await page.$eval('textarea', (e) => (e as HTMLTextAreaElement).value)).toBe('half a thought')
    await page.close()
  })
})
