import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * Cloze under a wrong or given-up answer says which dictionary word the form comes from ("vieja03s — from vieja03"), in the slot the hint used, so nothing moves;
 * after a correct answer, and for a form that is the word itself, the slot stays empty. The real Cloze screen (src/testing/logHarness.tsx), inflected=1 making the
 * examples show the plural. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((path) => path && existsSync(path))

describe.skipIf(!CHROME)('Cloze: the note under the answer', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5263, strictPort: false } })
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
    await page.setViewport({ width: 320, height: 700, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/logHarness.html?screen=cloze&learned=12&${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.cz-dock')
    return page
  }
  const press = (page: Page, text: string) => page.evaluate((t) => (Array.from(document.querySelectorAll('.cz-dock .btn')).find((b) => b.textContent === t) as HTMLElement).click(), text)
  /** Where the slot, the feedback and the button under them are, and what the slot says. */
  const look = (page: Page) =>
    page.evaluate(() => {
      const slot = document.querySelector('.cz-hint') as HTMLElement
      const r = (e: Element) => e.getBoundingClientRect()
      return {
        text: slot.textContent,
        className: slot.className,
        slotTop: Math.round(r(slot).top),
        slotHeight: Math.round(r(slot).height),
        slotRight: Math.round(r(slot).right),
        feedbackTop: Math.round(r(document.querySelector('.cz-feedback')!).top),
        buttonTop: Math.round(r(document.querySelector('.cz-dock > .btn-primary')!).top),
        page: document.documentElement.scrollWidth <= window.innerWidth,
      }
    })
  /** The number of the word asked (the cue is its English "oldN"), and so the form the sentence holds. */
  const form = (page: Page) => page.$eval('.cz-cue', (e) => `vieja${String(/old(\d+)/.exec(e.textContent ?? '')![1]).padStart(2, '0')}s`)

  it('Reveal: "vieja03s — from vieja03" in the slot the hint used, and nothing else moves', async () => {
    const page = await open('inflected=1')
    const before = await look(page)
    expect(before.text).toBe('')
    const expected = await form(page)
    await press(page, 'Reveal')
    await page.waitForFunction(() => document.querySelector('.cz-feedback')?.textContent !== '')
    const after = await look(page)
    expect(after.text).toBe(`${expected} — from ${expected.slice(0, -1)}`)
    expect(after.className).toContain('cz-lemma')
    expect(after.slotTop).toBe(before.slotTop) // the same slot
    expect(after.slotHeight).toBe(before.slotHeight) // one line: the layout under it did not move
    expect(after.buttonTop).toBe(before.buttonTop) // Continue is where Check was
    expect(after.slotRight).toBeLessThanOrEqual(320)
    expect(after.page).toBe(true)
    await page.close()
  }, 60_000)

  it('a wrong answer says it too; a correct one does not', async () => {
    const page = await open('inflected=1')
    const expected = await form(page)
    await page.type('.cz-input', 'nada')
    await press(page, 'Check')
    await page.waitForFunction(() => /Not quite/.test(document.querySelector('.cz-feedback')?.textContent ?? ''))
    expect((await look(page)).text).toBe(`${expected} — from ${expected.slice(0, -1)}`)
    await page.close()

    const right = await open('inflected=1')
    const form2 = await form(right)
    await right.type('.cz-input', form2)
    await press(right, 'Check')
    await right.waitForFunction(() => /Correct/.test(document.querySelector('.cz-feedback')?.textContent ?? ''))
    const correct = await look(right)
    expect(correct.text).toBe('')
    expect(correct.className).not.toContain('cz-lemma')
    await right.close()
  }, 60_000)

  it('typing the headword (accepted, not the form in the sentence) is correct and gets no note', async () => {
    const page = await open('inflected=1')
    const expected = await form(page)
    await page.type('.cz-input', expected.slice(0, -1))
    await press(page, 'Check')
    await page.waitForFunction(() => /Correct/.test(document.querySelector('.cz-feedback')?.textContent ?? ''))
    expect((await look(page)).text).toBe('')
    await page.close()
  }, 60_000)

  it('a form that is the word itself has no note, even given up', async () => {
    const page = await open('')
    await press(page, 'Reveal')
    await page.waitForFunction(() => document.querySelector('.cz-feedback')?.textContent !== '')
    expect((await look(page)).text).toBe('')
    await page.close()
  }, 60_000)

  it('the hint still works before the answer, and is gone after it', async () => {
    const page = await open('inflected=1')
    await press(page, 'Hint')
    expect((await look(page)).text).not.toBe('')
    await press(page, 'Reveal')
    await page.waitForFunction(() => document.querySelector('.cz-feedback')?.textContent !== '')
    expect((await look(page)).text).toMatch(/ — from /)
    await page.close()
  }, 60_000)
})
