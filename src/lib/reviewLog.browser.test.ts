import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * The review log in a real browser (src/testing/logHarness.tsx: ONE of the real Review, Learn, Matching or Cloze screens over the real write queue and the
 * real log; the queue's sender records what it is given). Each mode writes the right rows, with the session ids its sittings should have, and a log that
 * cannot be sent changes nothing the user sees. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

interface Row {
  id: string
  esWord: string
  reviewedAt: string
  rating: number
  mode: string
  stateBefore: string
  elapsedDays: number | null
  scheduledDays: number
  intervalAfter: number
  easeAfter: number
  repetitionsAfter: number
  sessionId: string | null
  durationMs: number | null
}

describe.skipIf(!CHROME)('the review log in the four modes', () => {
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

  async function open(query: string) {
    const page = await (await browser.createBrowserContext()).newPage()
    await page.emulateTimezone('America/Montevideo')
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/logHarness.html?${query}`, { waitUntil: 'networkidle0' })
    return page
  }
  const log = (page: Page) => page.evaluate(() => (window as never as { __log: unknown[] }).__log) as Promise<Row[]>
  const progress = (page: Page) => page.evaluate(() => (window as never as { __progress: { esWord: string }[] }).__progress)
  const logAttempts = (page: Page) => page.evaluate(() => (window as never as { __sent: { logAttempts: number } }).__sent.logAttempts)
  const waitForRows = (page: Page, n: number) => page.waitForFunction((count) => (window as never as { __log: unknown[] }).__log.length >= count, { timeout: 10_000 }, n)
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  // ---- Review ----
  const counter = (page: Page) => page.$eval('.review-count', (e) => e.textContent ?? '')
  const headword = (page: Page) => page.$eval('.flip-front .wc-headword', (e) => e.textContent ?? '')
  async function rate(page: Page, tone: 'again' | 'hard' | 'good' | 'easy') {
    const before = await counter(page)
    await page.click('.flip')
    await page.waitForSelector(`.rating:not(.is-hidden) .rate-${tone}`)
    await page.click(`.rate-${tone}`)
    await page.waitForFunction((b) => !document.querySelector('.review-count') || document.querySelector('.review-count')!.textContent !== b, { timeout: 10_000 }, before)
  }

  describe('Review', () => {
    it('one row per rating, with the rating, the word, mode review and its state before; a lapsed word comes back as relearning, and its second rating is a row too', async () => {
      const page = await open('screen=review&learned=8')
      await page.waitForSelector('.flip')
      const shown: string[] = []
      const tones = ['good', 'again', 'easy', 'hard'] as const
      for (const tone of tones) {
        shown.push(await headword(page))
        await rate(page, tone)
      }
      await waitForRows(page, 4)
      let rows = await log(page)
      expect(rows.map((r) => [r.esWord, r.rating, r.mode, r.stateBefore])).toEqual(shown.map((w, i) => [w, [3, 1, 4, 2][i], 'review', 'review']))
      for (const r of rows) {
        expect(r.id).toMatch(UUID)
        expect(r.elapsedDays).toBeGreaterThan(0.9) // the words were last reviewed about a day and a half ago
        expect(r.durationMs).toBeGreaterThanOrEqual(0)
      }
      expect(rows[1]).toMatchObject({ scheduledDays: 0, intervalAfter: 0, repetitionsAfter: 1 }) // the Again: its ten-minute step
      expect(rows[0].scheduledDays).toBe(rows[0].intervalAfter) // the others: the interval they were given

      // the lapsed word comes back at the end of the session: its rating is another row, from the state the Again left
      while (await page.$('.review-count')) {
        const word = await headword(page)
        if (word === shown[1] && (await log(page)).length < 12) {
          await rate(page, 'good')
          break
        }
        await rate(page, 'good')
      }
      await page.waitForFunction((w) => (window as never as { __log: Row[] }).__log.some((r) => r.esWord === w && r.stateBefore === 'relearning'), {}, shown[1])
      rows = await log(page)
      const back = rows.find((r) => r.esWord === shown[1] && r.stateBefore === 'relearning')!
      expect(back).toMatchObject({ mode: 'review', rating: 3 })
      expect(back.elapsedDays).toBeLessThan(0.5) // minutes since the Again, not days
      expect(rows.filter((r) => r.esWord === shown[1])).toHaveLength(2) // one row per rating: the Again and this
      await page.close()
    }, 120_000)

    it('every row of a session has the same session id, and "Continue" starts another', async () => {
      const page = await open('screen=review&learned=24')
      await page.waitForSelector('.flip')
      for (let i = 0; i < 20; i++) await rate(page, 'good')
      await page.waitForSelector('.post-batch')
      await waitForRows(page, 20)
      const first = await log(page)
      expect(new Set(first.map((r) => r.sessionId)).size).toBe(1)
      expect(first[0].sessionId).toMatch(UUID)
      expect(new Set(first.map((r) => r.id)).size).toBe(20)

      await page.evaluate(() => (Array.from(document.querySelectorAll('.post-batch button')).find((b) => b.textContent?.trim() === 'Continue') as HTMLElement).click())
      await page.waitForSelector('.flip')
      await rate(page, 'good')
      await waitForRows(page, 21)
      const all = await log(page)
      expect(all[20].sessionId).not.toBe(first[0].sessionId)
      expect(all[20].sessionId).toMatch(UUID)
      await page.close()
    }, 180_000)

    it('the time on the card is measured from the card appearing to the rating', async () => {
      const page = await open('screen=review&learned=4')
      await page.waitForSelector('.flip')
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 600)))
      await rate(page, 'good')
      await rate(page, 'good') // the second card is rated at once: its clock started when IT appeared, not when the screen did
      await waitForRows(page, 2)
      const [row, second] = await log(page)
      expect(row.durationMs).toBeGreaterThanOrEqual(600)
      expect(row.durationMs).toBeLessThan(5000)
      expect(second.durationMs).toBeLessThan(500)
      await page.close()
    }, 60_000)
  })

  // ---- Learn ----
  describe('Learn', () => {
    const progressText = (page: Page) => page.$eval('.learn-progress span', (e) => e.textContent ?? '')
    async function finishBatch(page: Page) {
      await page.waitForSelector('.learn-progress')
      const total = Number((await progressText(page)).match(/\d+/g)![1])
      for (let i = 1; i < total; i++) {
        await page.keyboard.press('ArrowRight')
        await page.waitForFunction((n) => Number(document.querySelector('.learn-progress span')!.textContent!.match(/\d+/)![0]) === n, {}, i + 1)
      }
      await page.click('.learn-finish .btn-primary')
      await page.waitForSelector('.post-batch')
      return total
    }

    it('a row per word introduced, mode learn, "new" before and due tomorrow, all of one session; the next batch is another session', async () => {
      const page = await open('screen=learn&fresh=12')
      const total = await finishBatch(page)
      expect(total).toBe(10)
      await waitForRows(page, 10)
      const rows = await log(page)
      expect(rows).toHaveLength(10)
      for (const r of rows) expect(r).toMatchObject({ mode: 'learn', rating: 3, stateBefore: 'new', elapsedDays: 0, scheduledDays: 1, intervalAfter: 0, easeAfter: 2.5, repetitionsAfter: 1, durationMs: null })
      expect(new Set(rows.map((r) => r.sessionId)).size).toBe(1)
      expect(new Set(rows.map((r) => r.esWord)).size).toBe(10)
      expect((await progress(page)).length).toBe(10) // and the words' progress was written too: the log is next to it, not instead

      await page.evaluate(() => (document.querySelector('.post-batch-actions .btn-primary') as HTMLElement).click()) // the next batch: the two left
      const second = await finishBatch(page)
      await waitForRows(page, 10 + second)
      const all = await log(page)
      expect(new Set(all.slice(10).map((r) => r.sessionId)).size).toBe(1)
      expect(all[10].sessionId).not.toBe(all[0].sessionId)
      await page.close()
    }, 120_000)

    it('a word marked "already known" is not a rating: nothing is logged for it', async () => {
      const page = await open('screen=learn&fresh=12')
      await page.waitForSelector('.known-btn')
      const first = await page.$eval('.learn-progress span', (e) => e.textContent)
      expect(first).toMatch(/1/)
      await page.click('.known-btn')
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
      expect(await log(page)).toEqual([])
      await page.close()
    }, 60_000)
  })

  // ---- Matching ----
  describe('Matching', () => {
    const glossOf = (word: string) => {
      const i = Number(word.replace('vieja', '')) - 1
      return `старое${'абвгдежзиклмнопр'[i % 16]}${i + 1}`
    }
    const tile = (page: Page, column: 'left' | 'right', text: string) =>
      page.evaluate(
        (col, t) => {
          const tiles = Array.from(document.querySelectorAll('.match-col')[col === 'left' ? 0 : 1].querySelectorAll('button'))
          ;(tiles.find((b) => b.textContent === t) as HTMLElement).click()
        },
        column,
        text,
      )
    const leftWords = (page: Page) => page.$$eval('.match-col:first-child button', (els) => els.map((e) => e.textContent ?? ''))
    const rightGlosses = (page: Page) => page.$$eval('.match-col:nth-child(2) button', (els) => els.map((e) => e.textContent ?? ''))
    const wrongGone = (page: Page) => page.waitForFunction(() => !document.querySelector('.match-tile.is-wrong'), { timeout: 5000 })

    it('a row per matched pair, rating 3 at the first try and 1 for the two words of a wrong pair; one session per group', async () => {
      const page = await open('screen=matching&learned=12')
      await page.waitForSelector('.match-grid')
      const left = await leftWords(page)
      const glosses = await rightGlosses(page)
      expect(left).toHaveLength(5)
      // a wrong pair: the first word with the gloss of the second
      await tile(page, 'left', left[0])
      await tile(page, 'right', glosses.find((g) => g === glossOf(left[1]))!)
      await page.waitForSelector('.match-tile.is-wrong')
      await wrongGone(page)
      expect(await log(page)).toEqual([]) // a wrong tap is not an answer to log
      for (const word of left) {
        await tile(page, 'left', word)
        await tile(page, 'right', glossOf(word))
      }
      await waitForRows(page, 5)
      const rows = await log(page)
      expect(rows).toHaveLength(5)
      expect(Object.fromEntries(rows.map((r) => [r.esWord, r.rating]))).toEqual({ [left[0]]: 1, [left[1]]: 1, [left[2]]: 3, [left[3]]: 3, [left[4]]: 3 })
      for (const r of rows) expect(r).toMatchObject({ mode: 'matching', stateBefore: 'review', scheduledDays: 0, intervalAfter: 3, easeAfter: 2.5, repetitionsAfter: 2, durationMs: null })
      expect(new Set(rows.map((r) => r.sessionId)).size).toBe(1)
      expect(rows[0].sessionId).toMatch(UUID)

      await page.waitForSelector('.post-batch')
      await page.evaluate(() => (document.querySelector('.post-batch-actions .btn-primary') as HTMLElement).click()) // the next group
      await page.waitForSelector('.match-grid')
      const next = await leftWords(page)
      await tile(page, 'left', next[0])
      await tile(page, 'right', glossOf(next[0]))
      await waitForRows(page, 6)
      const all = await log(page)
      expect(all[5].sessionId).not.toBe(all[0].sessionId)
      expect(all[5].rating).toBe(3) // misses do not carry over to the next group
      await page.close()
    }, 120_000)
  })

  // ---- Cloze ----
  describe('Cloze', () => {
    const asked = (page: Page) => page.$eval('.cz-cue', (e) => e.textContent ?? '').then((text) => `vieja${String(Number(text.match(/old(\d+)/)![1])).padStart(2, '0')}`)
    async function answer(page: Page, how: 'right' | 'wrong' | 'giveUp') {
      await page.waitForSelector('.cz-input:not([disabled])')
      const word = await asked(page)
      if (how === 'giveUp') await page.click('.cz-secondary .btn:nth-child(2)')
      else {
        await page.type('.cz-input', how === 'right' ? word : 'zzzzz')
        await page.click('.cz-dock .btn-primary')
      }
      await page.waitForSelector('.cz-dock .btn-primary:not([type="submit"])')
      await page.click('.cz-dock .btn-primary')
      return word
    }

    it('a row per answered question, right (3) or wrong (1), with the time it took; giving up is not an answer; one session for the Cloze session', async () => {
      const page = await open('screen=cloze&learned=12')
      await page.waitForSelector('.cz-card')
      const first = await answer(page, 'right')
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)))
      const second = await answer(page, 'wrong')
      await answer(page, 'giveUp')
      const fourth = await answer(page, 'right')
      await waitForRows(page, 3)
      const rows = await log(page)
      expect(rows.map((r) => [r.esWord, r.rating, r.mode])).toEqual([[first, 3, 'cloze'], [second, 1, 'cloze'], [fourth, 3, 'cloze']])
      for (const r of rows) {
        expect(r).toMatchObject({ stateBefore: 'review', scheduledDays: 0, intervalAfter: 3, easeAfter: 2.5, repetitionsAfter: 2 })
        expect(r.durationMs).toBeGreaterThan(0)
      }
      expect(new Set(rows.map((r) => r.sessionId)).size).toBe(1)
      expect(rows[0].sessionId).toMatch(UUID)
      await page.close()
    }, 120_000)
  })

  // ---- the log failing ----
  describe('a log that cannot be sent', () => {
    it('changes nothing the user sees: the cards advance, the ratings are saved, and nothing says anything is wrong', async () => {
      const page = await open('screen=review&learned=6&logfail=1')
      await page.waitForSelector('.flip')
      const shown: string[] = []
      for (const tone of ['good', 'again', 'good'] as const) {
        shown.push(await headword(page))
        const before = Date.now()
        await rate(page, tone)
        expect(Date.now() - before).toBeLessThan(3000) // the next card is up at once
      }
      await page.waitForFunction(() => (window as never as { __sent: { logAttempts: number } }).__sent.logAttempts >= 1)
      expect(await log(page)).toEqual([]) // nothing arrived...
      expect((await progress(page)).map((u) => u.esWord)).toEqual(expect.arrayContaining(shown)) // ...and every rating did
      const text = await page.$eval('body', (e) => (e as HTMLElement).innerText)
      expect(text).not.toMatch(/saved|retry|error|wrong|failed/i) // no banner, no notice
      expect(await page.$('.unsaved-notice, [role="alert"]')).toBeNull()
      expect(await logAttempts(page)).toBeGreaterThanOrEqual(1)
      await page.close()
    }, 120_000)
  })
})
