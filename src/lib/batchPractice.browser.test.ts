import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * Practising the words of a Learn batch with Matching, from Learn's end screen, in a real browser (src/testing/logHarness.tsx: the real Learn screen over the
 * real write queue and the real review log; the queue's sender records every write it is given). Above all: a full practice round writes no scheduling field,
 * no progress row, no settings patch and no streak. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

interface Row {
  esWord: string
  rating: number
  mode: string
  stateBefore: string
  scheduledDays: number | null
  intervalAfter: number
  easeAfter: number
  repetitionsAfter: number
  sessionId: string | null
}
interface State {
  words: Record<string, { nextReview: string | null; interval: number; repetitions: number; easeFactor: number }>
  settings: string
}
interface Written {
  progress: number
  settings: number
  hidden: number
  favorites: number
  active: number
}

describe.skipIf(!CHROME)('practising a Learn batch with Matching', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5241, strictPort: false } })
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
    await page.goto(`${base}/src/testing/logHarness.html?screen=learn&${query}`, { waitUntil: 'networkidle0' })
    return page
  }
  const log = (page: Page) => page.evaluate(() => (window as never as { __log: unknown[] }).__log) as Promise<Row[]>
  const state = (page: Page) => page.evaluate(() => (window as never as { __state: () => unknown }).__state()) as Promise<State>
  const written = (page: Page) =>
    page.evaluate(() => {
      const s = (window as never as { __sent: { progress: unknown[]; settings: unknown[]; hidden: unknown[]; favorites: unknown[]; active: number } }).__sent
      return { progress: s.progress.length, settings: s.settings.length, hidden: s.hidden.length, favorites: s.favorites.length, active: s.active }
    }) as Promise<Written>
  const waitForRows = (page: Page, n: number) => page.waitForFunction((count) => (window as never as { __log: unknown[] }).__log.length >= count, { timeout: 10_000 }, n)
  /** The queue is quiet: nothing more is sent (the sender is told at once, so a short wait is a long time). */
  const settle = (page: Page) => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)))

  async function finishBatch(page: Page) {
    await page.waitForSelector('.learn-progress')
    const total = Number((await page.$eval('.learn-progress span', (e) => e.textContent ?? '')).match(/\d+/g)![1])
    for (let i = 1; i < total; i++) {
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction((n) => Number(document.querySelector('.learn-progress span')!.textContent!.match(/\d+/)![0]) === n, {}, i + 1)
    }
    await page.click('.learn-finish .btn-primary')
    await page.waitForSelector('.post-batch')
    return total
  }
  /** The end screen of Learn is the one showing (not hidden under the practice). */
  const onEndScreen = (page: Page) => page.waitForSelector('main:not([hidden]) .post-batch .practice-offer', { timeout: 5000 })
  const startPractice = async (page: Page) => {
    await onEndScreen(page)
    await page.click('main:not([hidden]) .practice-offer button')
    await page.waitForSelector('.match-grid')
  }

  // The gloss of nuevaNN is "новоеN" (see the harness).
  const glossOf = (word: string) => `новое${Number(word.replace('nueva', ''))}`
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
  /** Plays the round on screen. `wrongFirst`: one wrong pair before the right ones (the first word with the gloss of the second). */
  async function playRound(page: Page, wrongFirst = false) {
    await page.waitForSelector('.match-grid')
    const left = await leftWords(page)
    expect(left).toHaveLength(5)
    if (wrongFirst) {
      await tile(page, 'left', left[0])
      await tile(page, 'right', glossOf(left[1]))
      await page.waitForSelector('.match-tile.is-wrong')
      await page.waitForFunction(() => !document.querySelector('.match-tile.is-wrong'), { timeout: 5000 })
    }
    for (const word of left) {
      await tile(page, 'left', word)
      await tile(page, 'right', glossOf(word))
    }
    await page.waitForSelector('.practice .post-batch')
    return left
  }
  const buttonText = (page: Page) => page.$eval('.practice .post-batch-actions button', (e) => e.textContent ?? '')
  const heading = (page: Page) => page.$eval('.practice .post-batch h2', (e) => e.textContent ?? '')

  it('the end screen offers the practice above the buttons: the line, a quiet button (the primary one is still "Learn next batch"), and the note', async () => {
    const page = await open('fresh=12')
    await finishBatch(page)
    await onEndScreen(page)
    const offer = await page.$eval('.practice-offer', (e) => ({ paragraphs: Array.from(e.querySelectorAll('p')).map((p) => p.textContent), button: e.querySelector('button')!.textContent, buttonClass: e.querySelector('button')!.className }))
    expect(offer.paragraphs).toEqual(['These words come back for review tomorrow.', "Matching on the words from this batch. It doesn't affect the schedule."])
    expect(offer.button).toBe('Practise these words now')
    expect(offer.buttonClass).toContain('btn-secondary')
    // above the buttons, and the buttons are as they were: exactly one primary, "Learn next batch"
    const above = await page.evaluate(() => {
      const card = document.querySelector('.practice-offer')!
      const actions = document.querySelector('.post-batch-actions')!
      return Boolean(card.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(above).toBe(true)
    expect(await page.$$eval('.post-batch-actions .btn-primary', (els) => els.map((e) => e.textContent))).toEqual(['Learn next batch'])
    await page.close()
  }, 60_000)

  it('is not offered when Matching could not run on the batch: four words give no offer, five do', async () => {
    const four = await open('fresh=4')
    await finishBatch(four)
    expect(await four.$('.practice-offer')).toBeNull()
    expect(await four.$$eval('.post-batch-actions button', (els) => els.length)).toBeGreaterThan(0) // the end screen is as it was
    await four.close()
    const five = await open('fresh=5')
    await finishBatch(five)
    await onEndScreen(five)
    await five.close()
  }, 60_000)

  it('is not offered on an end screen reached with nothing to learn (no batch was finished here)', async () => {
    const page = await open('fresh=0')
    await page.waitForSelector('.post-batch')
    expect(await page.$('.practice-offer')).toBeNull()
    await page.close()
  }, 60_000)

  it('skipping costs nothing: with the offer on screen, and after leaving it unused, nothing was written but the batch', async () => {
    const page = await open('fresh=12')
    await finishBatch(page)
    await onEndScreen(page)
    await waitForRows(page, 10)
    await settle(page)
    const before = await written(page)
    await page.click('main:not([hidden]) .post-batch-actions .btn-primary') // Learn next batch, as before
    await page.waitForSelector('.learn-progress')
    await settle(page)
    const rows = await log(page)
    expect(rows.every((r) => r.mode === 'learn')).toBe(true)
    // The next batch opens on its first card and that card is counted (a card is learned when it is reached): one word, one settings step, the day marked active again.
    // Nothing else was written, and nothing at all for the practice offer that was skipped.
    const after = await written(page)
    expect(after).toEqual({ ...before, progress: before.progress + 1, settings: before.settings + 1, active: before.active + 1 })
    await page.close()
  }, 60_000)

  describe('a full practice round of a batch of ten', () => {
    it('writes no scheduling field: not one word\'s next review, interval, repetitions or ease, no progress row, no settings patch, no hidden or favourite write, no streak', async () => {
      const page = await open('fresh=12')
      await finishBatch(page)
      await waitForRows(page, 10)
      await settle(page)
      const stateBefore = await state(page)
      const writtenBefore = await written(page)
      expect(writtenBefore.progress).toBe(10) // the batch itself was written: that is the baseline
      expect(writtenBefore.settings).toBeGreaterThan(0)
      expect(writtenBefore.active).toBeGreaterThan(0) // the day was marked active as the cards were reached

      await startPractice(page)
      const first = await playRound(page, true) // a wrong pair in it
      expect(await heading(page)).toBe('Session complete')
      expect(await buttonText(page)).toBe('Next words')
      await page.click('.practice .post-batch-actions button')
      const second = await playRound(page)
      expect(await heading(page)).toBe('Session complete')
      expect(await buttonText(page)).toBe('Done')
      expect(new Set([...first, ...second]).size).toBe(10) // every word of the batch, once each
      await waitForRows(page, 20)
      await settle(page)

      // nothing about the schedule moved: every word, the settings, and what the queue was given
      expect(await state(page)).toEqual(stateBefore)
      expect(await written(page)).toEqual(writtenBefore)
      await page.close()
    }, 120_000)

    it('counts no card toward the streak, even on a day the practice would have carried over the line: five cards from the batch, five pairs matched, the day stays at five', async () => {
      const page = await open('fresh=5') // a batch of five: the day stands at five cards of the ten that count
      await finishBatch(page)
      await waitForRows(page, 5)
      await settle(page)
      const stateBefore = await state(page)
      const writtenBefore = await written(page)
      expect(JSON.parse(stateBefore.settings).cardsDoneTodayCount).toBe(5)
      await startPractice(page)
      await playRound(page)
      await page.click('.practice .post-batch-actions button') // Done
      await onEndScreen(page)
      await settle(page)
      expect(await state(page)).toEqual(stateBefore) // a counted card would have made it ten, and written the streak
      expect(await written(page)).toEqual(writtenBefore)
      await page.close()
    }, 120_000)

    it('logs one row per matched pair with the mode "practice", all of one session apart from the batch\'s own, and changes nothing in the word it logs', async () => {
      const page = await open('fresh=12')
      await finishBatch(page)
      await waitForRows(page, 10)
      const learnRows = await log(page)
      await startPractice(page)
      const first = await playRound(page, true)
      await page.click('.practice .post-batch-actions button')
      await playRound(page)
      await waitForRows(page, 20)
      const all = await log(page)
      expect(all).toHaveLength(20)
      const practice = all.slice(10)
      expect(practice.every((r) => r.mode === 'practice')).toBe(true)
      expect(new Set(practice.map((r) => r.esWord))).toEqual(new Set(learnRows.map((r) => r.esWord))) // the batch's words, and no other
      expect(new Set(practice.map((r) => r.sessionId)).size).toBe(1) // the two rounds are one sitting
      expect(practice[0].sessionId).not.toBeNull()
      expect(practice[0].sessionId).not.toBe(learnRows[0].sessionId) // and not the batch's
      // the word is logged as the schedule has it: learned, due tomorrow, nothing changed; the rating is the stand-in (1 for the pair that needed another try)
      for (const r of practice) expect(r).toMatchObject({ stateBefore: 'learning', scheduledDays: null, intervalAfter: 0, easeAfter: 2.5, repetitionsAfter: 1 })
      expect(practice.filter((r) => r.rating === 1).map((r) => r.esWord).sort()).toEqual([first[0], first[1]].sort()) // the two words of the wrong pair
      expect(practice.filter((r) => r.rating === 3)).toHaveLength(8)
      await page.close()
    }, 120_000)

    it('after the last round "Done" returns to the end screen as it was: its title, its buttons, the offer again', async () => {
      const page = await open('fresh=12')
      await finishBatch(page)
      const title = await page.$eval('main:not([hidden]) .post-batch h2', (e) => e.textContent)
      expect(title).toBe('10 of 20 new words today')
      const actions = await page.$$eval('main:not([hidden]) .post-batch-actions button', (els) => els.map((e) => e.textContent))
      expect(actions[0]).toBe('Learn next batch')
      await startPractice(page)
      await playRound(page)
      await page.click('.practice .post-batch-actions button')
      await playRound(page)
      await page.click('.practice .post-batch-actions button') // Done
      await onEndScreen(page)
      expect(await page.$('.match-grid')).toBeNull()
      expect(await page.$eval('main:not([hidden]) .post-batch h2', (e) => e.textContent)).toBe(title)
      expect(await page.$$eval('main:not([hidden]) .post-batch-actions button', (els) => els.map((e) => e.textContent))).toEqual(actions)
      // and the next batch still starts from it
      await page.click('main:not([hidden]) .post-batch-actions .btn-primary')
      await page.waitForSelector('.learn-progress')
      await page.close()
    }, 120_000)
  })

  it('a batch of seven is two rounds: the seven words, and three repeats from the same batch; "Next words" after the first, "Done" after the second', async () => {
    const page = await open('fresh=7')
    await finishBatch(page)
    await waitForRows(page, 7)
    const learnRows = await log(page)
    await startPractice(page)
    await playRound(page)
    expect(await buttonText(page)).toBe('Next words')
    await page.click('.practice .post-batch-actions button')
    await playRound(page)
    expect(await buttonText(page)).toBe('Done')
    await waitForRows(page, 17)
    const practice = (await log(page)).slice(7)
    expect(practice).toHaveLength(10)
    const words = practice.map((r) => r.esWord)
    expect(new Set(words)).toEqual(new Set(learnRows.map((r) => r.esWord))) // every word, and none from outside
    expect(words.length - new Set(words).size).toBe(3)
    await page.close()
  }, 120_000)

  describe('Back, in the middle of the practice', () => {
    for (const native of [false, true]) {
      it(`${native ? "Telegram's BackButton" : 'the Back arrow'} returns to the end screen; nothing about the schedule moved, and the offer starts a new sitting`, async () => {
        const page = await open(`fresh=12&native=${native ? 1 : 0}`)
        await finishBatch(page)
        await waitForRows(page, 10)
        await settle(page)
        const stateBefore = await state(page)
        const writtenBefore = await written(page)

        await startPractice(page)
        const left = await leftWords(page)
        await tile(page, 'left', left[0])
        await tile(page, 'right', glossOf(left[0])) // one pair done, then Back
        await waitForRows(page, 11)
        expect(await rightGlosses(page)).toHaveLength(5)
        if (native) {
          expect(await page.$('.practice .back-link')).toBeNull() // the app draws no arrow of its own
          await page.evaluate(() => (window as never as { __nativeBack: () => void }).__nativeBack())
        } else {
          await page.click('main.practice .back-link')
        }
        await onEndScreen(page)
        expect(await page.$('.match-grid')).toBeNull()
        await settle(page)
        expect(await state(page)).toEqual(stateBefore)
        expect(await written(page)).toEqual(writtenBefore)
        const firstSitting = (await log(page))[10]
        expect(firstSitting).toMatchObject({ mode: 'practice', esWord: left[0] })

        await startPractice(page) // again: fresh rounds, a sitting of its own
        const again = await playRound(page)
        await waitForRows(page, 12)
        const rows = await log(page)
        expect(rows[11].sessionId).not.toBe(firstSitting.sessionId)
        expect(again).toHaveLength(5)
        await page.close()
      }, 120_000)
    }
  })
})
