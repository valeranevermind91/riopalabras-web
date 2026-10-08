import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { strings } from '../strings'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * The Words list and a word's detail in a real browser, over the real 4,753-word dictionary (src/testing/wordsHarness.tsx
 * swaps list and detail the way App does): windowed rendering, the list keeping its place across a detail round trip,
 * the star and "Bring back" writing through the queue. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

describe.skipIf(!CHROME)('the Words screen in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5199, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  async function open(query = '') {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/wordsHarness.html${query}`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => (window as never as { __ready?: boolean }).__ready === true)
    await page.waitForSelector('.word-row')
    return page
  }

  /** The names and expanded state of the nodes in the browser's accessibility tree (what a screen reader is given). */
  const axTree = async (page: Page) => {
    const client = await page.createCDPSession()
    await client.send('Accessibility.enable')
    const { nodes } = (await client.send('Accessibility.getFullAXTree')) as { nodes: { ignored?: boolean; role?: { value: string }; name?: { value: string }; properties?: { name: string; value: { value: unknown } }[] }[] }
    await client.detach()
    return nodes.filter((n) => !n.ignored).map((n) => ({ role: n.role?.value, name: n.name?.value ?? '', expanded: n.properties?.find((p) => p.name === 'expanded')?.value.value }))
  }
  const inTree = async (page: Page, text: string) => (await axTree(page)).some((n) => n.name.includes(text))

  const rows = (page: Page) => page.$$eval('.word-row-head', (els) => els.map((e) => e.textContent ?? ''))
  const fixture = (page: Page) => page.evaluate(() => (window as never as { __fixture: { lapsed: string; hidden: string[]; favourite: string; fresh: string[]; learned: string[] } }).__fixture)
  const sent = (page: Page) => page.evaluate(() => (window as never as { __sent: { favorites: { esWord: string; favorite: boolean }[]; hidden: { esWord: string; hidden: boolean }[]; settings: Record<string, unknown>[] } }).__sent)
  const status = (page: Page) => page.evaluate(() => (window as never as { __queue: { getStatus: () => Record<string, number | boolean> } }).__queue.getStatus())
  const segment = (page: Page, label: string) =>
    page.evaluate((text) => (Array.from(document.querySelectorAll('.segment')).find((b) => b.textContent?.startsWith(text)) as HTMLElement).click(), label)
  const press = (page: Page, selector: string, label: string) =>
    page.evaluate((sel, text) => (Array.from(document.querySelectorAll(sel)).find((b) => b.textContent?.startsWith(text)) as HTMLElement).click(), selector, label)
  const control = (page: Page, label: string) => press(page, '.control-btn', label)
  const controlTexts = (page: Page) => page.$$eval('.control-btn', (els) => els.map((e) => e.textContent ?? ''))
  /** Opens a sheet from its button, taps an option in it, and closes it with a tap outside. */
  const chooseFilter = async (page: Page, button: string, option: string) => {
    await control(page, button)
    await page.waitForSelector('.sheet')
    await press(page, '.sheet .chip', option)
    await closeSheet(page)
  }
  const closeSheet = async (page: Page) => {
    await page.click('.sheet-backdrop', { offset: { x: 20, y: 20 } })
    await page.waitForFunction(() => document.querySelector('.sheet') === null)
  }
  const scrollTo = async (page: Page, y: number) => {
    await page.$eval('.vlist', (el, top) => void (el.scrollTop = top), y)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  }
  const scrollTop = (page: Page) => page.$eval('.vlist', (el) => el.scrollTop)
  const openRow = async (page: Page, index: number) => {
    const names = await rows(page)
    await page.evaluate((i) => (document.querySelectorAll('.word-row-main')[i] as HTMLElement).click(), index)
    await page.waitForSelector('.word-detail')
    return names[index]
  }
  const back = async (page: Page) => {
    await page.click('.back-link')
    await page.waitForSelector('.words-search')
  }
  const search = async (page: Page, text: string) => {
    await page.$eval('.words-search', (el) => void ((el as HTMLInputElement).value = ''))
    await page.click('.words-search')
    await page.type('.words-search', text)
    await page.waitForSelector('.vlist, .words-empty')
  }

  it('renders a window of the list, not the list: a screenful of rows for 4,753 words, in a scroller as tall as all of them', async () => {
    const page = await open()
    await segment(page, 'All')
    await page.waitForSelector('.vlist-space')
    expect(await page.$eval('.vlist-space', (e) => (e as HTMLElement).offsetHeight)).toBe(4753 * 72)
    const rendered = (await rows(page)).length
    expect(rendered).toBeGreaterThan(8)
    expect(rendered).toBeLessThan(30)

    await scrollTo(page, 72 * 3000)
    const after = await rows(page)
    expect(after.length).toBeLessThan(30)
    expect(after).not.toEqual(await (async () => { await scrollTo(page, 0); return rows(page) })()) // a different part of the list
    await page.close()
  }, 60_000)

  it('opens on All, most common first: segments All · Learned · Hidden, and the Filters and Sort buttons', async () => {
    const page = await open()
    expect(await page.$$eval('.segment', (els) => els.map((e) => e.textContent))).toEqual(['All 4753', 'Learned 43', 'Hidden 2'])
    expect(await page.$$eval('.segment.is-active', (els) => els.map((e) => e.textContent?.split(' ')[0]))).toEqual(['All'])
    expect(await controlTexts(page)).toEqual(['Filters', 'Sort: Frequency'])
    expect((await rows(page))[0]).toBe('de')
    expect(await page.$('.chips')).toBeNull() // the mixed chip strip is gone
    await page.close()
  }, 60_000)

  it('Learned lists only words with progress; Due soonest puts the due ones first, with the Due now badge', async () => {
    const page = await open()
    await segment(page, 'Learned')
    await control(page, 'Sort')
    await press(page, '.sheet-row', 'Due soonest')
    await page.waitForFunction(() => document.querySelector('.sheet') === null)
    expect(await controlTexts(page)).toEqual(['Filters', 'Sort: Due soonest'])
    expect(await page.$$eval('.word-row', (els) => els.slice(0, 5).map((e) => e.querySelector('.word-row-due')?.textContent))).toEqual(['Due now', 'Due now', 'Due now', 'Due now', 'Due now'])
    await page.close()
  }, 60_000)

  it('keeps its place across a detail round trip: segment, query, filter and scroll position', async () => {
    const page = await open()
    await segment(page, 'All')
    await scrollTo(page, 72 * 1500)
    const before = { top: await scrollTop(page), names: await rows(page) }
    const opened = await openRow(page, 4)
    expect(await page.$eval('.wc-headword', (e) => e.textContent)).toBe(opened) // the detail is that word's card
    await back(page)

    expect(await page.$$eval('.segment.is-active', (els) => els.map((e) => e.textContent?.split(' ')[0]))).toEqual(['All'])
    expect(Math.abs((await scrollTop(page)) - before.top)).toBeLessThanOrEqual(2)
    expect(await rows(page)).toEqual(before.names)
    await page.close()
  }, 60_000)

  it('…and the query and a filter too', async () => {
    const page = await open()
    await search(page, 'ca')
    await chooseFilter(page, 'Filters', 'Nouns')
    await page.waitForSelector('.vlist')
    await scrollTo(page, 72 * 20)
    const before = { top: await scrollTop(page), names: await rows(page) }
    expect(before.names.length).toBeGreaterThan(5)
    await openRow(page, 3)
    await back(page)

    expect(await page.$eval('.words-search', (e) => (e as HTMLInputElement).value)).toBe('ca')
    expect((await controlTexts(page))[0]).toBe('Filters1') // one filter on: the count is on the button
    expect(await page.$('.sheet')).toBeNull() // and the sheet is closed
    expect(await page.$$eval('.segment.is-active', (els) => els.length)).toBe(0) // searching: no segment is lit
    expect(Math.abs((await scrollTop(page)) - before.top)).toBeLessThanOrEqual(2)
    expect(await rows(page)).toEqual(before.names)
    await page.close()
  }, 60_000)

  it('the star toggles the favourite without opening the word, and goes through the queue; the latest state wins', async () => {
    const page = await open()
    await segment(page, 'Learned')
    const first = (await rows(page))[0]
    await page.evaluate(() => (document.querySelector('.word-row-star') as HTMLElement).click())
    await page.waitForSelector('.word-row-star.is-on')
    expect(await page.$('.word-detail')).toBeNull() // still the list
    expect(await page.$eval('.word-row-star.is-on', (e) => e.getAttribute('aria-pressed'))).toBe('true')
    await page.waitForFunction(() => (window as never as { __sent: { favorites: unknown[] } }).__sent.favorites.length > 0)
    expect((await sent(page)).favorites.at(-1)).toMatchObject({ favorite: true })
    expect((await rows(page))[0]).toBe(first)

    await page.evaluate(() => (document.querySelector('.word-row-star.is-on') as HTMLElement).click())
    await page.waitForFunction(() => (window as never as { __sent: { favorites: { favorite: boolean }[] } }).__sent.favorites.at(-1)?.favorite === false)
    expect(await page.$('.word-row-star.is-on')).toBeNull()
    await page.close()
  }, 60_000)

  it('the Favourites filter lists the favourites', async () => {
    const page = await open()
    await chooseFilter(page, 'Filters', 'Favourites')
    await page.waitForSelector('.vlist')
    const fx = await fixture(page)
    expect(await page.$$eval('.word-row-star.is-on', (els) => els.length)).toBe(1)
    expect((await rows(page)).length).toBe(1)
    expect(fx.favourite).toBeTruthy()
    await page.close()
  }, 60_000)

  it('Hidden lists the words marked as known with "Bring back"; it goes through the hidden lane and the word leaves the list', async () => {
    const page = await open()
    await segment(page, 'Hidden')
    await page.waitForSelector('.word-row-bring')
    expect(await page.$$eval('.word-row-bring', (els) => els.length)).toBe(2)
    expect(await page.$('.word-row-star')).toBeNull()
    await control(page, 'Filters') // the Progress group is left out of the sheet here
    await page.waitForSelector('.sheet')
    expect(await page.$$eval('.sheet h3', (els) => els.map((e) => e.textContent))).toEqual(['Show only', 'Part of speech'])
    await closeSheet(page)
    const [first] = await rows(page)
    await page.evaluate(() => (document.querySelector('.word-row-bring') as HTMLElement).click())
    await page.waitForFunction(() => document.querySelectorAll('.word-row-bring').length === 1)
    expect(await rows(page)).not.toContain(first)
    await page.waitForFunction(() => (window as never as { __sent: { hidden: unknown[] } }).__sent.hidden.length > 0)
    expect((await sent(page)).hidden.at(-1)).toMatchObject({ hidden: false })
    expect((await page.$$eval('.segment', (els) => els.map((e) => e.textContent)))[2]).toBe('Hidden 1')
    await page.close()
  }, 60_000)

  it('a hidden word found by search says so, opens in detail with its kept progress, and "Bring back" there works too', async () => {
    const page = await open()
    const fx = await fixture(page)
    await search(page, fx.hidden[0])
    await page.waitForSelector('.word-row-bring')
    await openRow(page, 0)
    const text = await page.$eval('.state-block', (e) => e.textContent ?? '')
    expect(text).toContain('Hidden')
    expect(text).toContain('Its progress is kept')
    await page.click('.detail-actions .btn-primary')
    await page.waitForFunction(() => document.querySelector('.detail-actions .btn-primary') === null)
    expect(await page.$eval('.state-block', (e) => e.textContent ?? '')).not.toContain('Hidden')
    expect((await sent(page)).hidden.at(-1)).toMatchObject({ hidden: false })
    expect((await status(page)).pendingFavorites).toBe(0)
    await page.close()
  }, 60_000)

  describe('the scheduling details', () => {
    it('are collapsed on every open, and their contents are not in the accessibility tree until expanded', async () => {
      const page = await open()
      await openRow(page, 0)
      expect(await page.$eval('details.sched', (e) => (e as HTMLDetailsElement).open)).toBe(false)
      expect(await page.$eval('details.sched summary', (e) => e.textContent)).toBe('Scheduling details')
      // none of the five rows is shown or exposed to a screen reader while it is closed
      for (const label of ['State', 'Repetitions', 'Interval', 'Next review', 'Ease factor']) expect(await inTree(page, label), label).toBe(false)
      expect(await page.$eval('details.sched dl', (e) => e.checkVisibility())).toBe(false)

      const summary = (await axTree(page)).find((n) => n.name === 'Scheduling details')
      expect(summary?.expanded).toBe(false) // the control says it is collapsed

      await page.click('details.sched summary')
      await page.waitForFunction(() => (document.querySelector('details.sched') as HTMLDetailsElement).open)
      for (const label of ['State', 'Repetitions', 'Interval', 'Next review', 'Ease factor']) expect(await inTree(page, label), label).toBe(true)
      expect((await axTree(page)).find((n) => n.name === 'Scheduling details')?.expanded).toBe(true)
      expect(await page.$eval('details.sched dl', (e) => e.checkVisibility())).toBe(true)
      await page.close()
    }, 60_000)

    it('open and close from the keyboard (Enter and Space on the summary)', async () => {
      const page = await open()
      await openRow(page, 0)
      await page.focus('details.sched summary')
      const isOpen = () => page.$eval('details.sched', (e) => (e as HTMLDetailsElement).open)
      await page.keyboard.press('Enter')
      expect(await isOpen()).toBe(true)
      await page.keyboard.press('Enter')
      expect(await isOpen()).toBe(false)
      await page.keyboard.press('Space')
      expect(await isOpen()).toBe(true)
      await page.close()
    }, 60_000)

    it('are not remembered: closed again on the next open, even for the same word', async () => {
      const page = await open()
      await openRow(page, 0)
      await page.click('details.sched summary')
      await page.waitForFunction(() => (document.querySelector('details.sched') as HTMLDetailsElement).open)
      await back(page)
      await openRow(page, 0)
      expect(await page.$eval('details.sched', (e) => (e as HTMLDetailsElement).open)).toBe(false)
      await page.close()
    }, 60_000)

    it('the explanation for a lapsed, hidden or reference word stays visible, outside the footnote', async () => {
      const page = await open()
      const fx = await fixture(page)
      await search(page, fx.lapsed)
      await page.waitForSelector('.word-row')
      await openRow(page, 0)
      expect(await inTree(page, 'Again')).toBe(true) // the note is in the tree with the disclosure closed
      await page.close()
    }, 60_000)
  })

  it('the detail of a lapsed word shows that it reads as new and why', async () => {
    const page = await open()
    const fx = await fixture(page)
    await search(page, fx.lapsed)
    await page.waitForSelector('.word-row')
    await openRow(page, 0)
    const text = await page.$eval('.state-block', (e) => e.textContent ?? '')
    expect(text).toContain('Not started')
    expect(text).toContain('Again')
    expect(text).toContain('Learn pool')
    await page.close()
  }, 60_000)

  it('in a search the row leads with the form that matched, with the other form beside it and no marker', async () => {
    const page = await open()
    const rowsOf = () => page.$$eval('.word-row', (els) => els.map((e) => [e.querySelector('.word-row-head')?.textContent, e.querySelector('.word-row-alt')?.textContent]))

    await search(page, 'ciga')
    expect(await rowsOf()).toEqual(expect.arrayContaining([['cigarrillo', 'pucho'], ['cigarro', 'pucho']]))
    await search(page, 'pucho')
    expect(await rowsOf()).toEqual(expect.arrayContaining([['pucho', 'cigarrillo'], ['pucho', 'cigarro']]))
    expect(await page.$('.word-row .pill')).toBeNull()
    await page.close()
  }, 60_000)

  it('outside a search the standard word is in the muted line when the headword is not it, so cigarro and cigarrillo can be told apart', async () => {
    const page = await open()
    await segment(page, 'Learned') // the harness has learned both words
    const seen = new Map<string, string | null | undefined>()
    for (let y = 0; y < 72 * 43 && seen.size < 2; y += 400) {
      await scrollTo(page, y)
      for (const [head, alt] of await page.$$eval('.word-row', (els) => els.map((e) => [e.querySelector('.word-row-head')?.textContent, e.querySelector('.word-row-alt')?.textContent]))) {
        if (head === 'pucho' && alt) seen.set(alt, head)
      }
    }
    expect([...seen.keys()].sort()).toEqual(['cigarrillo', 'cigarro']) // both lead with pucho, each says which word it is
    await page.close()
  }, 60_000)

  describe('the sheets', () => {
    it('Filters: groups, applies at once, counts on the button, and Clear all puts everything back', async () => {
      const page = await open()
      await control(page, 'Filters')
      await page.waitForSelector('.sheet')
      expect(await page.$$eval('.sheet h3', (els) => els.map((e) => e.textContent))).toEqual(['Progress', 'Show only', 'Part of speech'])
      expect(await page.$eval('.sheet .link-btn', (e) => (e as HTMLButtonElement).disabled)).toBe(true) // nothing to clear yet

      await press(page, '.sheet .chip', 'Due now')
      await page.waitForFunction(() => document.querySelectorAll('.word-row').length > 0 && Array.from(document.querySelectorAll('.word-row')).every((r) => r.querySelector('.word-row-due')))
      await press(page, '.sheet .chip', 'Verbs')
      expect((await controlTexts(page))[0]).toBe('Filters2')
      expect(await page.$eval('.sheet .link-btn', (e) => (e as HTMLButtonElement).disabled)).toBe(false)

      await page.click('.sheet .link-btn') // Clear all
      await page.waitForFunction(() => document.querySelectorAll('.sheet .chip.is-active').length === 1) // only "Any"
      expect((await controlTexts(page))[0]).toBe('Filters')
      expect((await rows(page))[0]).toBe('de')
      await page.close()
    }, 60_000)

    describe('Random', () => {
      const chooseSort = async (page: Page, label: string) => {
        await control(page, 'Sort')
        await page.waitForSelector('.sheet')
        await press(page, '.sheet-row', label)
        await page.waitForFunction(() => document.querySelector('.sheet') === null)
      }

      it('is the last option in the sort sheet, and is named on the button', async () => {
        const page = await open()
        await control(page, 'Sort')
        await page.waitForSelector('.sheet')
        expect(await page.$$eval('.sheet-row', (els) => els.map((e) => e.textContent))).toEqual(['Frequency', 'A to Z', 'Due soonest', 'Recently learned', 'Random'])
        await press(page, '.sheet-row', 'Random')
        await page.waitForFunction(() => document.querySelector('.sheet') === null)
        expect(await controlTexts(page)).toEqual(['Filters', 'Sort: Random'])
        expect((await rows(page))[0]).not.toBe('de') // not the frequency order
        await page.close()
      }, 60_000)

      it('stays put: scrolling, opening a word and coming back, and a filter on and off do not reorder the list', async () => {
        const page = await open()
        await chooseSort(page, 'Random')
        const order = await rows(page)
        expect(order.length).toBeGreaterThan(8)

        await scrollTo(page, 72 * 400)
        await scrollTo(page, 0)
        expect(await rows(page)).toEqual(order) // scrolling

        await openRow(page, 2)
        await back(page)
        expect(await rows(page)).toEqual(order) // a word opened and closed

        await chooseFilter(page, 'Filters', 'Favourites')
        await page.waitForSelector('.vlist')
        await control(page, 'Filters')
        await page.waitForSelector('.sheet')
        await press(page, '.sheet .link-btn', 'Clear all')
        await closeSheet(page)
        await page.waitForSelector('.vlist')
        expect(await rows(page)).toEqual(order) // a filter on and off again
        await page.close()
      }, 60_000)

      it('choosing Random again, while it is already the order, shuffles again', async () => {
        const page = await open()
        await chooseSort(page, 'Random')
        const first = await rows(page)
        await chooseSort(page, 'Random')
        expect(await controlTexts(page)).toEqual(['Filters', 'Sort: Random'])
        expect(await rows(page)).not.toEqual(first)
        await page.close()
      }, 60_000)

      it('un-starring a word with Favourites on takes only that word out: the others keep their order', async () => {
        const page = await open()
        await segment(page, 'Learned')
        // star five learned words, then look at them in a random order, favourites only
        for (const i of [0, 1, 2, 3, 4]) await page.evaluate((n) => (document.querySelectorAll('.word-row-star')[n] as HTMLElement).click(), i)
        await chooseSort(page, 'Random')
        await chooseFilter(page, 'Filters', 'Favourites')
        await page.waitForFunction(() => document.querySelectorAll('.word-row-star.is-on').length >= 5)
        const before = await rows(page)
        expect(before.length).toBeGreaterThanOrEqual(5)

        await page.evaluate(() => (document.querySelectorAll('.word-row-star.is-on')[1] as HTMLElement).click()) // un-star the second row
        await page.waitForFunction((n) => document.querySelectorAll('.word-row').length === n - 1, {}, before.length)
        expect(await rows(page)).toEqual(before.filter((_, i) => i !== 1))
        await page.close()
      }, 60_000)

      it('is ignored during a search (Best match), and comes back when the search is cleared', async () => {
        const page = await open()
        await chooseSort(page, 'Random')
        const order = await rows(page)
        await search(page, 'casa')
        expect(await controlTexts(page)).toEqual(['Filters', 'Sort: Best match'])
        expect((await rows(page))[0]).toBe('casa')
        await page.focus('.words-search')
        await page.keyboard.press('End')
        for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace') // "casa", one letter at a time
        await page.waitForFunction(() => (document.querySelector('.control-btn:nth-child(2)') as HTMLButtonElement).textContent === 'Sort: Random')
        expect(await rows(page)).toEqual(order) // the same shuffle as before the search
        await page.close()
      }, 60_000)
    })

    it('two changes in the same instant both land (each is built from the latest filters, not the ones the last render saw)', async () => {
      const page = await open()
      await control(page, 'Filters')
      await page.waitForSelector('.sheet')
      await page.evaluate(() => {
        const click = (text: string) => (Array.from(document.querySelectorAll('.sheet .chip')).find((b) => b.textContent === text) as HTMLElement).click()
        click('In progress')
        click('Verbs')
      })
      await page.waitForFunction(() => document.querySelectorAll('.sheet .chip.is-active').length === 2)
      expect((await controlTexts(page))[0]).toBe('Filters2')
      await page.close()
    }, 60_000)

    it('a tap outside closes a sheet, and so does Escape', async () => {
      const page = await open()
      await control(page, 'Filters')
      await page.waitForSelector('.sheet')
      await closeSheet(page)
      await control(page, 'Sort')
      await page.waitForSelector('.sheet')
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => document.querySelector('.sheet') === null)
      await page.close()
    }, 60_000)

    it("Telegram's back button closes an open sheet first, and only then leaves the screen", async () => {
      const page = await open()
      const press_ = () => page.evaluate(() => (window as never as { __pressBack: () => string }).__pressBack())
      expect(await press_()).toBe('left') // nothing open: back leaves
      await control(page, 'Sort')
      await page.waitForSelector('.sheet')
      expect(await press_()).toBe('closed-sheet')
      await page.waitForFunction(() => document.querySelector('.sheet') === null)
      expect(await press_()).toBe('left')
      await page.close()
    }, 60_000)

    it('Sort: A to Z is alphabetical, closes the sheet, and the Sort button is off while a search runs', async () => {
      const page = await open()
      await control(page, 'Sort')
      await press(page, '.sheet-row', 'A to Z')
      await page.waitForFunction(() => document.querySelector('.sheet') === null)
      expect(await controlTexts(page)).toEqual(['Filters', 'Sort: A to Z'])
      const first = await rows(page)
      const collator = new Intl.Collator('es', { sensitivity: 'base' })
      expect([...first].sort((a, b) => collator.compare(a, b))).toEqual(first)

      await search(page, 'casa')
      expect(await controlTexts(page)).toEqual(['Filters', 'Sort: Best match'])
      expect(await page.$eval('.control-btn:nth-child(2)', (e) => (e as HTMLButtonElement).disabled)).toBe(true)
      await page.close()
    }, 60_000)

    it('the sort and the filters are kept across a detail round trip', async () => {
      const page = await open()
      await control(page, 'Sort')
      await press(page, '.sheet-row', 'Recently learned')
      await page.waitForFunction(() => document.querySelector('.sheet') === null)
      await chooseFilter(page, 'Filters', 'Favourites')
      await page.waitForSelector('.vlist')
      await openRow(page, 0)
      await back(page)
      expect(await controlTexts(page)).toEqual(['Filters1', 'Sort: Recently learned'])
      await page.close()
    }, 60_000)
  })

  describe('Queue for Learn', () => {
    const queueButton = (page: Page) => page.$$eval('.detail-actions .btn', (els) => els.map((e) => `${e.textContent?.trim()}|${e.getAttribute('aria-pressed')}`))
    const note = (page: Page) => page.$$eval('.detail-actions .queue-note', (els) => els.map((e) => `${e.textContent}|${e.getAttribute('role')}`))
    const openWord = async (page: Page, esWord: string) => {
      await search(page, esWord)
      await page.waitForSelector('.word-row')
      const at = (await rows(page)).findIndex((r) => r.startsWith(esWord))
      await openRow(page, Math.max(0, at))
    }
    const tapQueue = async (page: Page) => {
      await page.evaluate(() => (Array.from(document.querySelectorAll('.detail-actions .btn')).find((b) => /Queue for Learn|Queued/.test(b.textContent ?? '')) as HTMLElement).click())
    }

    it('queues a word from its detail with a confirmation naming its place, then takes it out again; the blob keeps its other keys', async () => {
      const page = await open()
      const fx = await fixture(page)
      await openWord(page, fx.fresh[0])
      expect(await queueButton(page)).toEqual(['Add to favourites|false', 'Queue for Learn|false'])
      expect(await note(page)).toEqual([])

      await tapQueue(page)
      await page.waitForFunction(() => document.querySelector('.detail-actions .queue-note') !== null)
      expect(await queueButton(page)).toEqual(['Add to favourites|false', 'Queued — remove|true'])
      expect(await note(page)).toEqual(['Queued — 1st in line.|status'])
      await page.waitForFunction(() => (window as never as { __sent: { settings: unknown[] } }).__sent.settings.length > 0)
      expect((await sent(page)).settings.at(-1)).toEqual({ learn_picks: [fx.fresh[0].toLowerCase()] })

      await tapQueue(page)
      await page.waitForFunction(() => document.querySelector('.detail-actions .queue-note') === null)
      expect(await queueButton(page)).toEqual(['Add to favourites|false', 'Queue for Learn|false'])
      await page.waitForFunction(() => (window as never as { __sent: { settings: unknown[] } }).__sent.settings.length > 0)
      expect((await sent(page)).settings.at(-1)).toEqual({ learn_picks: [] })
      await page.close()
    }, 60_000)

    it('names each place as the queue grows (1st, 2nd, 3rd), and the Queued filter lists exactly those words', async () => {
      const page = await open()
      const fx = await fixture(page)
      const queued = fx.fresh.slice(0, 3)
      const places: string[] = []
      for (const esWord of queued) {
        await openWord(page, esWord)
        await tapQueue(page)
        await page.waitForFunction(() => document.querySelector('.detail-actions .queue-note') !== null)
        places.push((await note(page))[0])
        await back(page)
      }
      expect(places).toEqual(['Queued — 1st in line.|status', 'Queued — 2nd in line.|status', 'Queued — 3rd in line.|status'])

      await page.click('.words-search', { count: 3 })
      await page.keyboard.press('Backspace')
      await page.waitForFunction(() => (document.querySelector('.words-search') as HTMLInputElement).value === '')
      await control(page, 'Filters')
      await page.waitForSelector('.sheet')
      expect(await page.$$eval('#sheet-show-only + .sheet-options .chip', (els) => els.map((e) => e.textContent))).toEqual(['Favourites', 'Queued', 'Custom'])
      await press(page, '.sheet .chip', 'Queued')
      await closeSheet(page)
      await page.waitForSelector('.vlist')
      expect(await controlTexts(page)).toEqual(['Filters1', 'Sort: Frequency'])
      expect((await rows(page)).map((r) => r.replace(/\s.*/, '')).sort()).toEqual([...queued].sort())
      await page.close()
    }, 90_000)

    it('has no such action on a word that is in progress or known well, and none on the list row', async () => {
      const page = await open()
      const fx = await fixture(page)
      expect(await page.$$eval('.word-row button', (els) => els.map((e) => e.getAttribute('aria-label') ?? ''))).not.toContain('Queue for Learn')
      await openWord(page, fx.learned[0])
      expect(await queueButton(page)).toEqual(['Add to favourites|false'])
      await page.close()
    }, 60_000)

    it('refuses the 51st word with a message and sends nothing', async () => {
      const page = await open('?picks=50')
      const fx = await fixture(page)
      await openWord(page, fx.fresh[50])
      await tapQueue(page)
      await page.waitForFunction(() => document.querySelector('.detail-actions .queue-note') !== null)
      expect(await note(page)).toEqual(['The queue is full (50 words). Take one out to add another.|status'])
      expect(await queueButton(page)).toEqual(['Add to favourites|false', 'Queue for Learn|false'])
      expect((await sent(page)).settings).toEqual([])
      // taking one out makes room
      await back(page)
      await openWord(page, fx.fresh[0])
      expect(await queueButton(page)).toEqual(['Add to favourites|false', 'Queued — remove|true'])
      await tapQueue(page)
      await back(page)
      await openWord(page, fx.fresh[50])
      await tapQueue(page)
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.detail-actions .queue-note')).some((e) => e.textContent?.startsWith('Queued')))
      expect(await note(page)).toEqual(["Beyond today's batch|null", 'Queued — 50th in line.|status'])
      await page.close()
    }, 90_000)

    it('says "Beyond today\'s batch" on a queued word past what is left today (a goal of 10, the 11th word queued)', async () => {
      const page = await open('?picks=10')
      const fx = await fixture(page)
      await openWord(page, fx.fresh[9])
      expect(await note(page)).toEqual([])
      await back(page)
      await openWord(page, fx.fresh[10])
      await tapQueue(page)
      await page.waitForFunction(() => document.querySelectorAll('.detail-actions .queue-note').length === 2)
      expect(await note(page)).toEqual(["Beyond today's batch|null", 'Queued — 11th in line.|status'])
      await page.close()
    }, 90_000)
  })

  describe('custom words', () => {
    type Sent = { words: { kind: string; row?: Record<string, unknown>; esWord?: string; tombstone?: string }[]; settings: Record<string, unknown>[]; order: string[] }
    const sentAll = (page: Page) => page.evaluate(() => (window as never as { __sent: Sent }).__sent)
    const enrichCalls = (page: Page) => page.evaluate(() => (window as never as { __enrichCalls: unknown[] }).__enrichCalls)
    const stub = (page: Page, result: unknown) => page.evaluate((r) => void ((window as never as { __enrichImpl: unknown }).__enrichImpl = async () => r), result)
    const f = strings.words.form

    const clickText = (page: Page, selector: string, text: string) =>
      page.evaluate((sel, t) => (Array.from(document.querySelectorAll(sel)).find((b) => b.textContent?.trim() === t) as HTMLElement).click(), selector, text)
    const fieldValue = (page: Page, label: string) =>
      page.evaluate((l) => {
        const control = Array.from(document.querySelectorAll('.form-field'))
          .find((x) => x.querySelector('.form-label')?.textContent === l)
          ?.querySelector<HTMLInputElement>('input,textarea,select')
        if (!control) throw new Error(`no field ${l}`)
        return control.value
      }, label)
    const choose = async (page: Page, label: string, value: string) => {
      const handle = await page.evaluateHandle((l) => Array.from(document.querySelectorAll('.form-field')).find((x) => x.querySelector('.form-label')?.textContent === l)?.querySelector('select') as HTMLSelectElement, label)
      await (handle as unknown as { select: (v: string) => Promise<string[]> }).select(value)
    }
    const typeIn = async (page: Page, label: string, text: string) => {
      const handle = await page.evaluateHandle((l) => Array.from(document.querySelectorAll('.form-field')).find((x) => x.querySelector('.form-label')?.textContent === l)?.querySelector('input,textarea') as HTMLElement, label)
      await handle.focus()
      await handle.evaluate((el) => (el as HTMLInputElement).select())
      await page.keyboard.press('Backspace')
      if (text) await handle.type(text)
    }
    /** Cancel on a form that has something in it asks first: this answers "Discard". */
    const cancelAndDiscard = async (page: Page) => {
      await clickText(page, 'button', f.cancel)
      await page.waitForSelector('.sheet')
      await clickText(page, '.sheet .btn', f.discard)
    }
    const notes = (page: Page) => page.$$eval('.form-note', (els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))
    const startAdding = async (page: Page, word: string, pos: string) => {
      await page.click('button[aria-label="Add a word"]')
      await page.waitForSelector('.word-form')
      await typeIn(page, f.spanish, word)
      await clickText(page, '[role="radio"]', pos)
      await clickText(page, 'button', f.continue)
    }
    const addWord = async (page: Page, word = 'Zapallito') => {
      await startAdding(page, word, 'Noun')
      await page.waitForSelector('.form-word')
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.words-search')
    }
    const openByName = async (page: Page, esWord: string) => {
      await search(page, esWord)
      await page.waitForSelector('.word-row')
      await openRow(page, Math.max(0, (await rows(page)).findIndex((r) => r.startsWith(esWord))))
    }

    it('"+" in the header adds a word: type it, pick a part of speech, the translation is filled in, change anything, save; it is written and queued for Learn', async () => {
      const page = await open()
      expect(await page.$$eval('.screen-header-actions .icon-btn', (els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Add a word'])
      await startAdding(page, 'Zapallito', 'Noun')
      await page.waitForSelector('.form-word')
      expect(await enrichCalls(page)).toEqual([{ word: 'Zapallito', pos: 'n' }])
      expect(await fieldValue(page, f.ru)).toBe('кабачок')
      expect(await fieldValue(page, f.en)).toBe('little squash')
      expect(await fieldValue(page, f.example)).toBe('Me gusta el zapallito.')
      expect(await notes(page)).toEqual([f.filled])

      await typeIn(page, f.en, 'baby squash') // every field can be changed before saving
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.words-search')
      expect(await page.$eval('.words-note', (e) => e.textContent)).toBe('Added, and queued for Learn.')

      const sent = await sentAll(page)
      expect(sent.words).toEqual([
        {
          kind: 'save',
          row: { es_word: 'Zapallito', es_rioplatense: null, en_translation: 'baby squash', ru_translation: 'кабачок', example_sentence: 'Me gusta el zapallito.', example_translation_en: 'I like little squash.', example_translation_ru: 'Мне нравится кабачок.', is_rioplatense_variant: false, region: null, register: null, es_standard: null, pos: 'n' },
        },
      ])
      expect(sent.settings.at(-1)).toEqual({ learn_picks: ['zapallito'] })

      await openByName(page, 'Zapallito')
      expect(await page.$eval('.custom-mark', (e) => e.textContent)).toBe('Added by you')
      expect(await page.$$eval('.detail-actions .btn', (els) => els.map((e) => e.textContent?.trim()))).toEqual(['Add to favourites', 'Queued — remove', 'Edit', 'Delete'])
      await page.close()
    }, 90_000)

    it('Back (Telegram\'s or the page\'s) closes the form first, and the list is as it was', async () => {
      const page = await open()
      await page.click('button[aria-label="Add a word"]')
      await page.waitForSelector('.word-form')
      expect(await page.evaluate(() => (window as never as { __pressBack: () => string }).__pressBack())).toBe('closed-sheet')
      await page.waitForSelector('.words-search')
      expect((await sentAll(page)).words).toEqual([])
      await page.close()
    }, 60_000)

    it('a word that is already there is not added: the message says where it matched, "Open" goes to it, and nothing is looked up or written', async () => {
      const page = await open()
      await startAdding(page, 'CASA', 'Noun')
      await page.waitForFunction(() => document.querySelector('.form-note.is-error') !== null)
      expect(await notes(page)).toEqual([`${f.duplicate('CASA', 'casa', 'es_word')} ${f.openExisting('casa')}`])
      expect(await enrichCalls(page)).toEqual([])
      expect((await sentAll(page)).words).toEqual([])
      await clickText(page, 'button', f.openExisting('casa'))
      await page.waitForSelector('.word-detail')
      expect(await page.$eval('.wc-headword', (e) => e.textContent)).toBe('casa')
      expect(await page.$('.custom-mark')).toBeNull() // a dictionary word is not "added by you"
      await page.close()
    }, 60_000)

    it('each way the lookup can fail has its own message, and the form is open to type the fields', async () => {
      const page = await open()
      const failures: [unknown, string][] = [
        [{ kind: 'offline' }, strings.words.enrich.offline],
        [{ kind: 'unauthorized' }, strings.words.enrich.unauthorized],
        [{ kind: 'daily-quota', usage: 100, limit: 100 }, strings.words.enrich.dailyQuota(100, 100)],
        [{ kind: 'rate-limit' }, strings.words.enrich.rateLimit],
        [{ kind: 'busy' }, strings.words.enrich.busy],
        [{ kind: 'timeout' }, strings.words.enrich.timeout],
        [{ kind: 'network' }, strings.words.enrich.network],
        [{ kind: 'no-result' }, strings.words.enrich.noResult],
        [{ kind: 'other', status: 500 }, strings.words.enrich.other(500)],
      ]
      for (const [failure, message] of failures) {
        await stub(page, { ok: false, failure })
        await startAdding(page, 'Zapallito', 'Noun')
        await page.waitForSelector('.form-word')
        expect(await notes(page)).toEqual([message])
        expect(await fieldValue(page, f.ru)).toBe('') // nothing was filled in
        await cancelAndDiscard(page) // the word and the part of speech were typed: leaving asks
        await page.waitForSelector('.words-search')
      }
      expect((await sentAll(page)).words).toEqual([])

      // and the manual form works, with the reason both translations are needed
      await stub(page, { ok: false, failure: { kind: 'offline' } })
      await startAdding(page, 'Zapallito', 'Noun')
      await page.waitForSelector('.form-word')
      await typeIn(page, f.ru, 'кабачок')
      await clickText(page, 'button', f.save)
      expect(await notes(page)).toContain(f.problems.translations)
      expect((await sentAll(page)).words).toEqual([]) // one translation is not enough
      await typeIn(page, f.en, 'squash')
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.words-search')
      expect((await sentAll(page)).words).toMatchObject([{ kind: 'save', row: { es_word: 'Zapallito', ru_translation: 'кабачок', en_translation: 'squash', es_rioplatense: null, is_rioplatense_variant: false } }])
      await page.close()
    }, 120_000)

    it('a lookup that never answers is never a dead end: "Fill it in myself" opens the form', async () => {
      const page = await open()
      await page.evaluate(() => void ((window as never as { __enrichImpl: unknown }).__enrichImpl = () => new Promise(() => {})))
      await startAdding(page, 'Zapallito', 'Noun')
      await page.waitForFunction(() => document.querySelector('.form-note')?.textContent?.includes('Looking up'))
      expect(await page.$eval('.word-form input', (e) => (e as HTMLInputElement).disabled)).toBe(true)
      await clickText(page, 'button', f.fillMyself)
      await page.waitForSelector('.form-word')
      await typeIn(page, f.ru, 'кабачок')
      await typeIn(page, f.en, 'squash')
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.words-search')
      expect((await sentAll(page)).words).toHaveLength(1)
      await page.close()
    }, 60_000)

    it('an untouched form closes without asking; once anything is filled in, Cancel and Back ask "Discard this word?" and nothing is written either way', async () => {
      const page = await open()
      // untouched: no question, from Cancel and from Back
      await page.click('button[aria-label="Add a word"]')
      await clickText(page, 'button', f.cancel)
      await page.waitForSelector('.words-search')
      await page.click('button[aria-label="Add a word"]')
      expect(await page.evaluate(() => (window as never as { __pressBack: () => string }).__pressBack())).toBe('closed-sheet')
      await page.waitForSelector('.words-search')
      expect(await page.$('.sheet')).toBeNull()

      // typed something: Cancel asks; Keep editing keeps the text
      await page.click('button[aria-label="Add a word"]')
      await typeIn(page, f.spanish, 'Zapa')
      await clickText(page, 'button', f.cancel)
      await page.waitForSelector('.sheet')
      expect(await page.$eval('.sheet h2', (e) => e.textContent)).toBe('Discard this word?')
      expect(await page.$$eval('.sheet .btn', (els) => els.map((e) => e.textContent))).toEqual(['Discard', 'Keep editing'])
      await clickText(page, '.sheet .btn', f.keepEditing)
      await page.waitForFunction(() => document.querySelector('.sheet') === null)
      expect(await fieldValue(page, f.spanish)).toBe('Zapa')

      // Back asks too (and Back again closes the question, like any sheet)
      await page.evaluate(() => (window as never as { __pressBack: () => string }).__pressBack())
      await page.waitForSelector('.sheet')
      await page.evaluate(() => (window as never as { __pressBack: () => string }).__pressBack())
      await page.waitForFunction(() => document.querySelector('.sheet') === null)
      expect(await fieldValue(page, f.spanish)).toBe('Zapa')

      // a picked part of speech alone counts as filled in
      await page.reload({ waitUntil: 'networkidle0' })
      await page.waitForFunction(() => (window as never as { __ready?: boolean }).__ready === true)
      await page.waitForSelector('.word-row')
      await page.click('button[aria-label="Add a word"]')
      await clickText(page, '[role="radio"]', 'Verb')
      await clickText(page, 'button', f.cancel)
      await page.waitForSelector('.sheet')
      await clickText(page, '.sheet .btn', f.discard)
      await page.waitForSelector('.words-search')
      expect((await sentAll(page)).words).toEqual([])
      await page.close()
    }, 90_000)

    it('the edit form follows the same rule: untouched closes, changed asks, Keep editing keeps the change', async () => {
      const page = await open()
      await addWord(page)
      await openByName(page, 'Zapallito')
      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
      await clickText(page, 'button', f.cancel) // nothing changed
      await page.waitForSelector('.word-detail')
      expect(await page.$('.sheet')).toBeNull()

      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
      await typeIn(page, f.ru, 'тыква')
      expect(await page.evaluate(() => (window as never as { __pressBack: () => string }).__pressBack())).toBe('closed-sheet')
      await page.waitForSelector('.sheet')
      expect(await page.$eval('.sheet h2', (e) => e.textContent)).toBe('Discard this word?')
      await clickText(page, '.sheet .btn', f.keepEditing)
      expect(await fieldValue(page, f.ru)).toBe('тыква')
      const before = (await sentAll(page)).words.length
      await cancelAndDiscard(page)
      await page.waitForSelector('.word-detail')
      expect((await sentAll(page)).words).toHaveLength(before) // discarded: nothing written
      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
      expect(await fieldValue(page, f.ru)).toBe('кабачок') // the old text is still what the word has
      await page.close()
    }, 90_000)

    it('rules on the word: one word, at most 50 characters, a part of speech, and an "Other" lookup leaves pos out', async () => {
      const page = await open()
      await page.click('button[aria-label="Add a word"]')
      await clickText(page, 'button', f.continue)
      expect(await notes(page)).toEqual([f.problems.empty])
      await typeIn(page, f.spanish, 'dos palabras')
      await clickText(page, 'button', f.continue)
      expect(await notes(page)).toEqual([f.problems.spaces])
      await typeIn(page, f.spanish, 'a'.repeat(51))
      await clickText(page, 'button', f.continue)
      expect(await notes(page)).toEqual([f.problems['too-long']])
      await typeIn(page, f.spanish, 'Zapallito')
      await clickText(page, 'button', f.continue)
      expect(await notes(page)).toEqual([f.problems.pos]) // no default part of speech
      expect(await page.$$eval('[role="radio"]', (els) => els.map((e) => `${e.textContent}:${e.getAttribute('aria-checked')}`))).toEqual(['Verb:false', 'Noun:false', 'Adjective:false', 'Adverb:false', 'Other:false'])
      await clickText(page, '[role="radio"]', 'Other')
      await clickText(page, 'button', f.continue)
      await page.waitForSelector('.form-word')
      expect(await enrichCalls(page)).toEqual([{ word: 'Zapallito', pos: 'custom' }]) // the form passes the code; enrichWord leaves it out of the request
      await page.close()
    }, 60_000)

    it('edits a word from its detail (same key, progress untouched), can re-run the lookup and put back what it had, then deletes it behind a confirm', async () => {
      const page = await open()
      await addWord(page)
      await openByName(page, 'Zapallito')

      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
      expect(await fieldValue(page, f.ru)).toBe('кабачок')
      expect(await page.$eval('.form-word strong', (e) => e.textContent)).toBe('Zapallito') // the word itself cannot be changed
      await typeIn(page, f.ru, 'тыква')
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.word-detail')
      expect(await page.$$eval('.queue-note', (els) => els.map((e) => e.textContent))).toContain('Saved.')
      const afterEdit = await sentAll(page)
      expect(afterEdit.words.at(-1)).toMatchObject({ kind: 'save', row: { es_word: 'Zapallito', ru_translation: 'тыква', pos: 'n' } })

      // re-run enrichment: refills the fields, which can be kept, edited or put back
      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
      await stub(page, { ok: true, value: { enTranslation: 'courgette', ruTranslation: 'цуккини', exampleSentence: 'Un zapallito.', exampleTranslationEn: 'A courgette.', exampleTranslationRu: 'Цуккини.', esRioplatense: 'zapallito', isRioplatenseVariant: true } })
      await clickText(page, 'button', f.rerun)
      await page.waitForFunction(() => document.querySelector('.form-note')?.textContent?.includes('Filled in again'))
      expect(await fieldValue(page, f.ru)).toBe('цуккини')
      await clickText(page, 'button', f.putBack)
      expect(await fieldValue(page, f.ru)).toBe('тыква')
      await clickText(page, 'button', f.cancel) // back to exactly what the word has: nothing to lose, no question
      await page.waitForSelector('.word-detail')
      expect(await page.$('.sheet')).toBeNull()
      expect((await sentAll(page)).words.at(-1)).toEqual(afterEdit.words.at(-1)) // cancelling wrote nothing

      // delete: a confirm that names the word
      await clickText(page, '.detail-actions .btn', 'Delete')
      await page.waitForSelector('.sheet')
      expect(await page.$eval('.confirm-delete h2', (e) => e.textContent)).toBe('Delete “Zapallito”?')
      expect(await page.evaluate(() => (window as never as { __pressBack: () => string }).__pressBack())).toBe('closed-sheet') // Back closes the question
      await page.waitForFunction(() => document.querySelector('.sheet') === null)
      expect((await sentAll(page)).words.at(-1)?.kind).toBe('save') // nothing deleted yet

      await clickText(page, '.detail-actions .btn', 'Delete')
      await page.waitForSelector('.sheet')
      await clickText(page, '.sheet .btn', 'Delete')
      await page.waitForSelector('.words-search') // back on the list
      await page.waitForFunction(() => (window as never as { __sent: { words: { kind: string }[] } }).__sent.words.at(-1)?.kind === 'delete')
      const sent = await sentAll(page)
      expect(sent.words.at(-1)).toEqual({ kind: 'delete', esWord: 'Zapallito', tombstone: 'zapallito' }) // the stored casing and the lowercased key

      // the tombstone went out BEFORE the delete, and was cleared after it
      await page.waitForFunction(() => (window as never as { __sent: { order: string[] } }).__sent.order.at(-1) === 'settings:pending_word_deletes')
      const order = (await sentAll(page)).order
      const del = order.indexOf('words:delete')
      expect(order.slice(0, del).some((o) => o.includes('pending_word_deletes'))).toBe(true)
      expect(order.slice(del + 1)).toEqual(['settings:pending_word_deletes'])
      const patches = (await sentAll(page)).settings
      expect(patches.at(-2)).toMatchObject({ pending_word_deletes: ['zapallito'], learn_picks: [] })
      expect(patches.at(-1)).toEqual({ pending_word_deletes: [] })

      await search(page, 'Zapallito')
      expect(await page.$$eval('.word-row-head', (els) => els.map((e) => e.textContent).filter((t) => t?.startsWith('Zapallito')))).toEqual([])
      await page.close()
    }, 150_000)

    it('a Rioplatense word from the lookup shows the same marks a dictionary word does: the chip, the region, the register, "standard: …" (and its list row stays as it was)', async () => {
      const page = await open()
      await stub(page, { ok: true, value: { enTranslation: 'little squash', ruTranslation: 'кабачок', exampleSentence: '', exampleTranslationEn: '', exampleTranslationRu: '', esRioplatense: null, isRioplatenseVariant: true, region: 'uy', register: 'informal', esStandard: 'calabacín' } })
      await startAdding(page, 'Zapallito', 'Noun')
      await page.waitForSelector('.form-word')
      expect(await fieldValue(page, f.region)).toBe('uy') // the form shows what was filled in
      expect(await fieldValue(page, f.register)).toBe('informal')
      expect(await fieldValue(page, f.standard)).toBe('calabacín')
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.words-search')
      expect((await sentAll(page)).words).toMatchObject([{ kind: 'save', row: { is_rioplatense_variant: true, region: 'uy', register: 'informal', es_standard: 'calabacín' } }])

      await search(page, 'Zapallito')
      await page.waitForSelector('.word-row')
      expect(await page.$eval('.word-row-head', (e) => e.textContent)).toBe('Zapallito') // the row has none of the marks
      expect(await page.$eval('.word-row-line', (e) => e.textContent)).toBe('кабачок · little squash')
      expect(await page.$('.word-row .wc-rio, .word-row .wc-tag, .word-row .wc-register, .word-row-alt')).toBeNull()
      await openRow(page, 0)
      expect(await page.$$eval('.wc-meta .wc-rio', (els) => els.map((e) => e.textContent))).toEqual([strings.rio.en.pill])
      expect(await page.$$eval('.wc-meta .wc-tag', (els) => els.map((e) => e.textContent))).toEqual([strings.rio.en.tag.uy])
      expect(await page.$$eval('.wc-meta .wc-register', (els) => els.map((e) => e.textContent))).toEqual(['informal'])
      expect(await page.$eval('.wc-relation', (e) => e.textContent?.replace(/\s+/g, ' ').trim())).toBe('standard: calabacín')
      await page.close()
    }, 90_000)

    it('the edit form has region and register selects with "Unknown", and a standard field; they round-trip, re-running the lookup refills them, and clearing one writes null', async () => {
      const page = await open()
      await addWord(page)
      await openByName(page, 'Zapallito')
      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
      expect(await page.$$eval('.form-field select', (els) => els.map((e) => Array.from((e as HTMLSelectElement).options).map((o) => o.textContent)))).toEqual([
        ['Unknown', 'Argentina only', 'Uruguay only'],
        ['Unknown', 'Neutral', 'Informal', 'Vulgar', 'Offensive', 'Pejorative'],
      ])
      expect([await fieldValue(page, f.region), await fieldValue(page, f.register), await fieldValue(page, f.standard)]).toEqual(['', '', '']) // all unknown

      await choose(page, f.region, 'ar')
      await choose(page, f.register, 'vulgar')
      await typeIn(page, f.standard, 'calabacín')
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.word-detail')
      expect((await sentAll(page)).words.at(-1)).toMatchObject({ kind: 'save', row: { es_word: 'Zapallito', region: 'ar', register: 'vulgar', es_standard: 'calabacín' } })

      // back in the form they are as saved; re-running the lookup refills them like the other fields
      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
      expect([await fieldValue(page, f.region), await fieldValue(page, f.register), await fieldValue(page, f.standard)]).toEqual(['ar', 'vulgar', 'calabacín'])
      await stub(page, { ok: true, value: { enTranslation: 'squash', ruTranslation: 'кабачок', exampleSentence: '', exampleTranslationEn: '', exampleTranslationRu: '', esRioplatense: null, isRioplatenseVariant: true, region: 'uy', register: 'informal', esStandard: 'zapallo' } })
      await clickText(page, 'button', f.rerun)
      await page.waitForFunction(() => document.querySelector('.form-note')?.textContent?.includes('Filled in again'))
      expect([await fieldValue(page, f.region), await fieldValue(page, f.register), await fieldValue(page, f.standard)]).toEqual(['uy', 'informal', 'zapallo'])
      await clickText(page, 'button', f.putBack)
      expect([await fieldValue(page, f.region), await fieldValue(page, f.register), await fieldValue(page, f.standard)]).toEqual(['ar', 'vulgar', 'calabacín'])

      // clear each back to unknown: null is written
      await choose(page, f.region, '')
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.word-detail')
      expect((await sentAll(page)).words.at(-1)).toMatchObject({ row: { region: null, register: 'vulgar', es_standard: 'calabacín' } })
      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
      await choose(page, f.register, '')
      await typeIn(page, f.standard, '')
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.word-detail')
      expect((await sentAll(page)).words.at(-1)).toMatchObject({ row: { region: null, register: null, es_standard: null } })
      await page.close()
    }, 120_000)

    it('the Filters sheet has "Custom" under "Show only", and it lists only the words added', async () => {
      const page = await open()
      await addWord(page)
      await control(page, 'Filters')
      await page.waitForSelector('.sheet')
      expect(await page.$$eval('#sheet-show-only + .sheet-options .chip', (els) => els.map((e) => e.textContent))).toEqual(['Favourites', 'Queued', 'Custom'])
      await press(page, '.sheet .chip', 'Custom')
      await closeSheet(page)
      await page.waitForSelector('.vlist')
      expect(await controlTexts(page)).toEqual(['Filters1', 'Sort: Frequency'])
      expect((await rows(page)).map((r) => r.replace(/\s.*/, ''))).toEqual(['Zapallito'])
      await page.close()
    }, 90_000)
  })

  it('the whole thing is wired into the app: the Home button, Telegram\'s back button, and the list kept while a word is open', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toMatch(/onWords=\{\(\) => setScreen\('words'\)\}/)
    expect(app).toMatch(/savedView=\{wordsView\.get\(\)\}/)
    expect(app).toMatch(/onViewChange=\{wordsView\.set\}/)
    expect(app).toMatch(/setOpen\(\{ key: wordKey\(esWord\), from: 'words' \}\)/)
    expect(app).toMatch(/setOpen\(\{ key: wordKey\(word\.esWord\), from: 'home' \}\)/)
    expect(app).toMatch(/const backTarget: Screen = backTargetFor\(screen, screen === 'word' \? \(open\?\.from \?\? null\) : null\)/) // a word goes back to where it was opened (src/lib/nav.ts)
    expect(app).toMatch(/const onClick = \(\) => goBack\(\)/)
    expect(app).toMatch(/if \(backInterceptor\.current\?\.\(\)\) return/)
    expect(app).toMatch(/registerBack=\{registerBack\}/)
  })
})
