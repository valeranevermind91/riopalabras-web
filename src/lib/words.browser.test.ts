import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

  async function open() {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/src/testing/wordsHarness.html`, { waitUntil: 'networkidle0' })
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
  const fixture = (page: Page) => page.evaluate(() => (window as never as { __fixture: { lapsed: string; hidden: string[]; favourite: string } }).__fixture)
  const sent = (page: Page) => page.evaluate(() => (window as never as { __sent: { favorites: { esWord: string; favorite: boolean }[]; hidden: { esWord: string; hidden: boolean }[] } }).__sent)
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

  it('the whole thing is wired into the app: the Home button, Telegram\'s back button, and the list kept while a word is open', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toMatch(/onWords=\{\(\) => setScreen\('words'\)\}/)
    expect(app).toMatch(/savedView=\{wordsView\.get\(\)\}/)
    expect(app).toMatch(/onViewChange=\{wordsView\.set\}/)
    expect(app).toMatch(/setOpen\(\{ key, from: 'words' \}\)/)
    expect(app).toMatch(/setOpen\(\{ key: wordKey\(word\.esWord\), from: 'home' \}\)/)
    expect(app).toMatch(/const backTarget: Screen = backTargetFor\(screen, screen === 'word' \? \(open\?\.from \?\? null\) : null\)/) // a word goes back to where it was opened (src/lib/nav.ts)
    expect(app).toMatch(/const onClick = \(\) => goBack\(\)/)
    expect(app).toMatch(/if \(backInterceptor\.current\?\.\(\)\) return/)
    expect(app).toMatch(/registerBack=\{registerBack\}/)
  })
})
