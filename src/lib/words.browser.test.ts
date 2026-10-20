import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NOTICE_MS } from '../screens/Words'
import { strings } from '../strings'
import { ru } from '../strings.ru'
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
  const control = (page: Page, label: string) =>
    page.evaluate((text) => (Array.from(document.querySelectorAll('.control-btn')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').startsWith(text)) as HTMLElement).click(), label)
  /** The two buttons by their accessible name: the Sort button's face is only the value, its aria-label the whole phrase ("Sort: Frequency"). */
  const controlTexts = (page: Page) => page.$$eval('.control-btn', (els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent ?? ''))
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

  it('opens on All, most common first: segments All · Learned · Known, and the Filters and Sort buttons', async () => {
    const page = await open()
    expect(await page.$$eval('.segment', (els) => els.map((e) => e.textContent))).toEqual(['All 4753', 'Learned 43', 'Known 2'])
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

  it('the star ("Learn sooner") toggles without opening the word and goes through the queue; its name is the same pressed or not; the latest state wins', async () => {
    const page = await open('?stars=0')
    const fx = await fixture(page)
    await search(page, fx.fresh[0])
    const label = `Learn ${fx.fresh[0]} sooner`
    const star = async () => page.$eval('.word-row-star', (e) => ({ pressed: e.getAttribute('aria-pressed'), label: e.getAttribute('aria-label'), text: e.textContent?.trim() }))
    expect(await star()).toEqual({ pressed: 'false', label, text: '' })
    await page.evaluate(() => (document.querySelector('.word-row-star') as HTMLElement).click())
    await page.waitForSelector('.word-row-star.is-on')
    expect(await page.$('.word-detail')).toBeNull() // still the list
    expect(await star()).toEqual({ pressed: 'true', label, text: '' }) // pressed, and still the same words
    await page.waitForFunction(() => (window as never as { __sent: { favorites: unknown[] } }).__sent.favorites.length > 0)
    expect((await sent(page)).favorites.at(-1)).toEqual({ esWord: fx.fresh[0], favorite: true })

    await page.evaluate(() => (document.querySelector('.word-row-star.is-on') as HTMLElement).click())
    await page.waitForFunction(() => (window as never as { __sent: { favorites: { favorite: boolean }[] } }).__sent.favorites.at(-1)?.favorite === false)
    expect(await page.$('.word-row-star.is-on')).toBeNull()
    await page.close()
  }, 60_000)

  it('the "Learn sooner" filter lists the starred words that are waiting', async () => {
    const page = await open()
    await chooseFilter(page, 'Filters', 'Learn sooner')
    await page.waitForSelector('.vlist')
    const fx = await fixture(page)
    expect(await page.$$eval('.word-row-star.is-on', (els) => els.length)).toBe(1)
    expect(await rows(page)).toEqual([fx.favourite])
    await page.close()
  }, 60_000)

  it('the search placeholder fits its field at 320px, in English and in Russian (it used to be cut off at "Russi")', async () => {
    for (const query of ['?lang=en', '?lang=ru&ru=0']) {
      const page = await open(query)
      await page.setViewport({ width: 320, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
      const fit = await page.$eval('.words-search', (input) => {
        const style = getComputedStyle(input)
        const context = document.createElement('canvas').getContext('2d')!
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const room = (input as HTMLInputElement).clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        return { placeholder: (input as HTMLInputElement).placeholder, text: Math.ceil(context.measureText((input as HTMLInputElement).placeholder).width), room: Math.floor(room) }
      })
      expect(fit.text, fit.placeholder).toBeLessThanOrEqual(fit.room)
      await page.close()
    }
  }, 60_000)

  it('every segment puts its count on its own line under the label, the same way on all three, in both languages and at 320, 390 and 480px', async () => {
    for (const query of ['?lang=en', '?lang=ru&ru=0']) {
      for (const width of [320, 390, 480]) {
        const page = await open(query)
        await page.setViewport({ width, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
        const segments = await page.$$eval('.segment', (els) =>
          els.map((e) => {
            const count = e.querySelector('.segment-count')!.getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(e.firstChild!) // the label's own text node
            const label = range.getBoundingClientRect()
            const box = e.getBoundingClientRect()
            return { text: e.textContent, labelBottom: label.bottom, countTop: count.top, countOffset: Math.round(count.top - box.top), labelOffset: Math.round(label.top - box.top), height: Math.round(box.height), labelHeight: label.height, font: parseFloat(getComputedStyle(e).fontSize) }
          }),
        )
        const where = `${query} at ${width}px: ${segments.map((s) => s.text).join(' | ')}`
        for (const s of segments) expect(s.countTop, where).toBeGreaterThanOrEqual(s.labelBottom - 1) // under the label, never beside it
        for (const s of segments) expect(s.labelHeight, where).toBeLessThan(s.font * 1.7) // the label itself is one line
        expect(new Set(segments.map((s) => s.countOffset)).size, where).toBe(1) // the counts sit at the same height
        expect(new Set(segments.map((s) => s.labelOffset)).size, where).toBe(1) // and so do the labels
        expect(new Set(segments.map((s) => s.height)).size, where).toBe(1) // and the three are one height
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), where).toBe(true)
        await page.close()
      }
    }
  }, 120_000)

  it('the clear (×) in the search field is drawn in the app\'s muted ink, not the browser\'s blue (read off a screenshot of the field\'s right end)', async () => {
    const page = await open()
    await page.type('.words-search', 'ca')
    const box = await page.$eval('.words-search', (el) => {
      const r = el.getBoundingClientRect()
      const probe = document.createElement('i')
      probe.style.color = 'var(--muted)'
      document.body.append(probe)
      return { x: r.right - 36, y: r.top + 2, width: 30, height: r.height - 4, muted: getComputedStyle(probe).color }
    })
    const shot = (await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height }, encoding: 'base64' })) as string
    // the darkest pixel in that strip is the × (nothing else is drawn there): its colour is the muted ink
    const darkest = await page.evaluate(
      (b64) =>
        new Promise<number[]>((resolve) => {
          const img = new Image()
          img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.width
            canvas.height = img.height
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(img, 0, 0)
            const data = ctx.getImageData(0, 0, img.width, img.height).data
            let best = [255, 255, 255]
            for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < best[0] + best[1] + best[2]) best = [data[i], data[i + 1], data[i + 2]]
            resolve(best)
          }
          img.src = `data:image/png;base64,${b64}`
        }),
      shot,
    )
    const muted = box.muted.match(/\d+/g)!.slice(0, 3).map(Number)
    for (let k = 0; k < 3; k++) expect(Math.abs(darkest[k] - muted[k]), `channel ${k}: ${darkest} vs ${muted}`).toBeLessThanOrEqual(30)
    await page.close()
  }, 60_000)

  it('a list that is empty because of the search offers "Clear search and filters", and pressing it brings the list back (the segment stays)', async () => {
    const page = await open()
    await search(page, 'zzzzqq')
    await page.waitForSelector('.words-empty')
    expect(await page.$eval('.words-empty p', (e) => e.textContent)).toBe('No words match. Try another search, or clear the filters.')
    expect(await page.$$eval('.words-empty .btn', (els) => els.map((e) => e.textContent))).toEqual(['Clear search and filters'])
    await segment(page, 'Learned')
    await page.waitForSelector('.words-empty .btn') // still empty for the same reason: the search is still there
    await page.click('.words-empty .btn')
    await page.waitForSelector('.word-row')
    expect(await page.$eval('.words-search', (e) => (e as HTMLInputElement).value)).toBe('')
    expect(await page.$$eval('.segment.is-active', (els) => els.map((e) => e.textContent?.split(' ')[0]))).toEqual(['Learned']) // the segment is the person's choice and stays
    await page.close()
  }, 60_000)

  it('with a filter on and nothing matching, the same button clears the filter too', async () => {
    const page = await open('?stars=0')
    await control(page, 'Filters')
    await page.waitForSelector('.sheet')
    await press(page, '.sheet .chip', 'Learn sooner') // nothing is starred in this fixture
    await closeSheet(page)
    await page.waitForSelector('.words-empty .btn')
    await page.click('.words-empty .btn')
    await page.waitForSelector('.word-row')
    expect(await controlTexts(page)).toEqual(['Filters', 'Sort: Frequency']) // no "1 filter on" badge any more
    await page.close()
  }, 60_000)

  it('Known lists the words marked as known with "Bring back"; it goes through the hidden lane and the word leaves the list', async () => {
    const page = await open()
    await segment(page, 'Known')
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
    expect((await page.$$eval('.segment', (els) => els.map((e) => e.textContent)))[2]).toBe('Known 1')
    await page.close()
  }, 60_000)

  it('a known word found by search says so, opens in detail with its kept progress, and "Bring back" there works too', async () => {
    const page = await open()
    const fx = await fixture(page)
    await search(page, fx.hidden[0])
    await page.waitForSelector('.word-row-bring')
    await openRow(page, 0)
    const text = await page.$eval('.state-block', (e) => e.textContent ?? '')
    expect(text).toContain('Known')
    expect(text).toContain('Its progress is kept')
    await page.click('.detail-actions .btn-primary')
    await page.waitForFunction(() => document.querySelector('.detail-actions .btn-primary') === null)
    expect(await page.$eval('.state-block', (e) => e.textContent ?? '')).not.toContain('Known')
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

    it('the explanation for a hidden or reference word stays visible, outside the footnote', async () => {
      const page = await open()
      const fx = await fixture(page)
      await search(page, fx.hidden[0])
      await page.waitForSelector('.word-row')
      await openRow(page, 0)
      expect(await inTree(page, 'Marked as known')).toBe(true) // the note is in the tree with the disclosure closed
      await page.close()
    }, 60_000)
  })

  it('the detail of a word rated Again reads as in progress, and says nothing about Learn', async () => {
    const page = await open()
    const fx = await fixture(page)
    await search(page, fx.lapsed)
    await page.waitForSelector('.word-row')
    await openRow(page, 0)
    const text = await page.$eval('.state-block', (e) => e.textContent ?? '')
    expect(text).toContain('In progress')
    expect(text).not.toContain('Not started')
    expect(text).not.toContain('Learn pool')
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

        await chooseFilter(page, 'Filters', 'Learn sooner')
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
        const page = await open('?stars=0')
        await chooseFilter(page, 'Filters', 'Not started')
        // star five words that are not started, then look at them in a random order, starred only
        for (const i of [0, 1, 2, 3, 4]) await page.evaluate((n) => (document.querySelectorAll('.word-row-star')[n] as HTMLElement).click(), i)
        await chooseSort(page, 'Random')
        await chooseFilter(page, 'Filters', 'Learn sooner')
        await page.waitForFunction(() => document.querySelectorAll('.word-row-star.is-on').length === 5)
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
        await page.waitForFunction(() => (document.querySelector('.control-btn:nth-child(2)') as HTMLButtonElement).getAttribute('aria-label') === 'Sort: Random')
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
      await chooseFilter(page, 'Filters', 'Learn sooner')
      await page.waitForSelector('.vlist')
      await openRow(page, 0)
      await back(page)
      expect(await controlTexts(page)).toEqual(['Filters1', 'Sort: Recently learned'])
      await page.close()
    }, 60_000)
  })

  describe('Learn sooner', () => {
    const buttons = (page: Page) => page.$$eval('.detail-actions .btn', (els) => els.map((e) => `${e.textContent?.trim()}|${e.getAttribute('aria-pressed')}`))
    const openWord = async (page: Page, esWord: string) => {
      await search(page, esWord)
      await page.waitForSelector('.word-row')
      const at = (await rows(page)).findIndex((r) => r.startsWith(esWord))
      await openRow(page, Math.max(0, at))
    }
    const tapDetail = (page: Page) => page.evaluate(() => (document.querySelector('.detail-actions .btn[aria-pressed]') as HTMLElement).click())
    const rowButtons = (page: Page, esWord: string) =>
      page.evaluate((word) => {
        const row = Array.from(document.querySelectorAll('.word-row')).find((r) => r.querySelector('.word-row-head')?.textContent === word)
        if (!row) return null
        const star = row.querySelector('.word-row-star')
        return { star: star ? { label: star.getAttribute('aria-label'), text: star.textContent?.trim() ?? '', pressed: star.getAttribute('aria-pressed') } : null, queue: row.querySelector('.word-row-queue') !== null, buttons: row.querySelectorAll('button').length }
      }, esWord)
    const tapRowStar = (page: Page, esWord: string) =>
      page.evaluate((word) => {
        const row = Array.from(document.querySelectorAll('.word-row')).find((r) => r.querySelector('.word-row-head')?.textContent === word)!
        ;(row.querySelector('.word-row-star') as HTMLElement).click()
      }, esWord)

    it('a word that can still be taught has the button on its detail, and it only looks active when pressed: the same words either way; the blob is never touched', async () => {
      const page = await open('?stars=0')
      const fx = await fixture(page)
      await openWord(page, fx.fresh[0])
      expect(await buttons(page)).toEqual(['Learn sooner|false'])
      await tapDetail(page)
      await page.waitForFunction(() => document.querySelector('.detail-actions .btn[aria-pressed="true"]') !== null)
      expect(await buttons(page)).toEqual(['Learn sooner|true']) // pressed; not "Learning sooner", not "Queued"
      expect(await page.$('.detail-actions .btn.is-on')).not.toBeNull()
      await page.waitForFunction(() => (window as never as { __sent: { favorites: unknown[] } }).__sent.favorites.length > 0)
      expect((await sent(page)).favorites.at(-1)).toEqual({ esWord: fx.fresh[0], favorite: true })
      expect((await sent(page)).settings).toEqual([]) // no settings key was written for it: the star lives with the word

      await tapDetail(page)
      await page.waitForFunction(() => (window as never as { __sent: { favorites: { favorite: boolean }[] } }).__sent.favorites.at(-1)?.favorite === false)
      expect(await buttons(page)).toEqual(['Learn sooner|false'])
      expect(await page.$('.detail-actions .queue-note, .detail-actions .detail-note')).toBeNull() // and nothing about a place in line
      await page.close()
    }, 60_000)

    it('the row, the "Learn sooner" filter and the detail agree about which words are starred', async () => {
      const page = await open('?stars=0')
      const fx = await fixture(page)
      const word = fx.fresh[0]
      await search(page, word)
      expect(await rowButtons(page, word)).toEqual({ star: { text: '', pressed: 'false', label: `Learn ${word} sooner` }, queue: false, buttons: 2 }) // the row, and the star: nothing else
      await tapRowStar(page, word)
      await page.waitForSelector('.word-row-star.is-on')
      expect(await page.$('.word-detail')).toBeNull() // the tap acted on the star and did not open the word
      expect(await rowButtons(page, word)).toMatchObject({ star: { pressed: 'true', label: `Learn ${word} sooner` } })

      await page.$eval('.words-search', (el) => void ((el as HTMLInputElement).value = ''))
      await page.click('.words-search')
      await page.keyboard.press('Backspace')
      await chooseFilter(page, 'Filters', 'Learn sooner')
      await page.waitForSelector('.vlist')
      expect(await rows(page)).toEqual([word])
      await openRow(page, 0)
      expect(await buttons(page)).toEqual(['Learn sooner|true'])
      await page.close()
    }, 90_000)

    it('a word in progress or learned has no control, on its row or its detail, only a word Learn can still teach does', async () => {
      const page = await open()
      const fx = await fixture(page)
      await search(page, fx.learned[0])
      await page.waitForSelector('.word-row')
      expect(await rowButtons(page, fx.learned[0])).toEqual({ star: null, queue: false, buttons: 1 })
      await openRow(page, 0)
      expect(await buttons(page)).toEqual([])
      expect(await page.$('.detail-actions .btn[aria-pressed]')).toBeNull()
      await back(page)
      await search(page, fx.fresh[0])
      expect(await rowButtons(page, fx.fresh[0])).toMatchObject({ star: { text: '' } })
      await page.close()
    }, 90_000)

    it('a star that is left on a word that has been learned shows no control and is not listed: only waiting words are', async () => {
      const page = await open('?stars=0')
      const fx = await fixture(page)
      await openWord(page, fx.learned[0])
      expect(await page.$('.detail-actions .btn[aria-pressed]')).toBeNull()
      await page.close()
    }, 60_000)

    it('there is no cap: 60 starred words are all starred, and the filter lists all of them', async () => {
      const page = await open('?stars=60')
      await chooseFilter(page, 'Filters', 'Learn sooner')
      await page.waitForSelector('.vlist')
      expect(await page.$eval('.vlist-space', (e) => (e as HTMLElement).offsetHeight)).toBe(60 * 72)
      await page.close()
    }, 60_000)

    for (const [language, query, label] of [
      ['English', '?lang=en', (w: string) => `Learn ${w} sooner`],
      ['Russian', '?lang=ru', (w: string) => `Учить «${w}» раньше`],
    ] as const) {
      it(`${language}, 320px: one icon-only control on the row, a real tap target, grey until it is on and then teal, and the translation keeps its room`, async () => {
        const page = await open(query)
        await page.setViewport({ width: 320, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
        const fx = await fixture(page)
        const word = fx.fresh.find((w, i) => i > 0 && w.length >= 11) ?? fx.fresh[1] // a long word: the one most likely to be squeezed
        await search(page, word)
        await page.waitForSelector('.word-row')
        const look = () =>
          page.evaluate(() => {
            const row = document.querySelector('.word-row') as HTMLElement
            const box = (e: Element) => {
              const r = e.getBoundingClientRect()
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
            }
            const star = row.querySelector('.word-row-star') as HTMLElement
            return {
              row: box(row),
              star: box(star),
              main: box(row.querySelector('.word-row-main')!),
              head: box(row.querySelector('.word-row-head')!),
              starText: star.textContent?.trim(),
              starShape: Array.from(star.querySelectorAll('svg path')).map((n) => n.getAttribute('d')).join(' | '),
              starColor: getComputedStyle(star).color,
              starFill: getComputedStyle(star.querySelector('svg')!).fill,
              label: star.getAttribute('aria-label'),
              controls: row.querySelectorAll('button').length,
              page: document.documentElement.scrollWidth <= window.innerWidth,
            }
          })
        const idle = await look()
        expect(idle.row.height).toBe(72)
        expect(idle.controls).toBe(2) // the row itself, and the star: no second control
        expect(idle.starText).toBe('') // an icon; the translation needs the room
        expect(idle.label).toBe(label(word)) // and its accessible name says it in full
        expect(idle.starShape).toContain('M12 3.2l2.7 5.6') // a star
        const colours = await page.evaluate(() => {
          const probe = (v: string) => {
            const i = document.createElement('i')
            i.style.color = `var(${v})`
            document.body.append(i)
            return getComputedStyle(i).color
          }
          return { teal: probe('--teal'), grey: probe('--muted-2') }
        })
        expect(idle.starColor).toBe(colours.grey)
        expect(idle.star.height).toBeGreaterThanOrEqual(44)
        expect(idle.star.width).toBeGreaterThanOrEqual(44)
        expect(idle.star.top).toBeGreaterThanOrEqual(idle.row.top)
        expect(idle.star.bottom).toBeLessThanOrEqual(idle.row.bottom)
        expect(idle.star.right).toBeLessThanOrEqual(idle.row.right)
        // the room: 280 less one 44 control, in both languages (the queue control used to take another 40 of it)
        expect(Math.round(idle.main.width)).toBe(236)
        expect(idle.head.width).toBeGreaterThan(60)
        expect(idle.page).toBe(true)

        await tapRowStar(page, word)
        await page.waitForFunction(() => document.querySelector('.word-row-star')?.getAttribute('aria-pressed') === 'true')
        const on = await look()
        expect(on.label).toBe(idle.label) // the same words pressed or not
        expect(on.starColor).toBe(colours.teal)
        expect(on.starFill).not.toBe('none') // filled where the idle star was empty
        expect(idle.starFill).toBe('none')
        expect(on.row.height).toBe(72)
        expect(Math.round(on.main.width)).toBe(236)

        // the detail spells it out in full, on one line, inside the screen
        await openRow(page, 0)
        const button = await page.$eval('.detail-actions .btn[aria-pressed]', (e) => {
          const r = e.getBoundingClientRect()
          return { text: e.textContent?.trim(), left: r.left, right: r.right, height: r.height, clipped: e.scrollWidth > e.clientWidth, pressed: e.getAttribute('aria-pressed'), page: document.documentElement.scrollWidth <= window.innerWidth }
        })
        expect(button.text).toBe(language === 'English' ? 'Learn sooner' : 'Учить раньше')
        expect(button.pressed).toBe('true')
        expect(button.clipped).toBe(false)
        expect(button.left).toBeGreaterThanOrEqual(0)
        expect(button.right).toBeLessThanOrEqual(320)
        expect(button.height).toBeLessThan(60) // one line, not wrapped
        expect(button.page).toBe(true)
        await page.close()
      }, 60_000)
    }
  })

  describe('the Rioplatense marks on a card, at 320px, in both languages: a meaning shift, a local headword and an ordinary word', () => {
    /** Opens the word's detail (its card is the same card Learn draws) at 320px and reads the marks off it. */
    async function marks(query: string, word: string) {
      const page = await open(query)
      await page.setViewport({ width: 320, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
      await search(page, word)
      await page.waitForSelector('.word-row')
      await openRow(page, Math.max(0, (await rows(page)).findIndex((r) => r.startsWith(word))))
      const read = await page.evaluate(() => {
        const card = document.querySelector('.word-card') as HTMLElement
        const lines = (e: Element) => {
          const range = document.createRange()
          range.selectNodeContents(e)
          return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size
        }
        const shift = card.querySelector('.wc-shift')
        const box = card.getBoundingClientRect()
        const rects = Array.from(card.querySelectorAll('.wc-meta > *, .wc-shift, .wc-relation p')).map((e) => e.getBoundingClientRect())
        return {
          headword: card.querySelector('.wc-headword')!.textContent,
          pill: card.querySelector('.wc-rio')?.textContent ?? null,
          tag: card.querySelector('.wc-tag')?.textContent ?? null,
          shift: shift?.textContent ?? null,
          shiftLines: shift ? lines(shift) : 0,
          relationFirst: card.querySelector('.wc-relation p')?.className ?? null,
          standardMeaning: Array.from(card.querySelectorAll('.wc-relation p')).some((p) => /Standard meaning|Обычное значение/.test(p.textContent ?? '')),
          inside: rects.every((r) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5),
          pageWide: document.documentElement.scrollWidth <= window.innerWidth,
        }
      })
      await page.close()
      return read
    }

    for (const [language, query, pill, shift] of [
      ['English', '?lang=en', 'Rioplatense', 'A different meaning in this region'],
      ['Russian', '?lang=ru', 'риоплатское', 'В этом регионе другое значение'],
    ] as const) {
      it(`${language}: "boleto" (a meaning shift) has the pill and says the shift in a line of its own, above the standard meaning, inside the card`, async () => {
        const m = await marks(query, 'boleto')
        expect(m).toMatchObject({ headword: 'boleto', pill, tag: null, shift, relationFirst: 'wc-shift', standardMeaning: true, inside: true, pageWide: true })
        // One line at 320px today (English 223px, Russian 228px of 238). If a wider font or a longer word ever wraps the Russian, it wraps (the meaning comes first,
        // and the line is balanced so the second line is never a single word): two lines at most.
        expect(m.shiftLines).toBeGreaterThanOrEqual(1)
        expect(m.shiftLines).toBeLessThanOrEqual(2)
        if (language === 'English') expect(m.shiftLines).toBe(1)
      }, 60_000)

      it(`${language}: "gurí" (a local headword) keeps its pill and its UY tag, and says no shift`, async () => {
        const m = await marks(query, 'gurí')
        expect(m).toMatchObject({ pill, tag: 'UY', shift: null, inside: true, pageWide: true })
      }, 60_000)

      it(`${language}: "casa" (an ordinary word) shows nothing Rioplatense: no pill, no tag, no shift`, async () => {
        const m = await marks(query, 'casa')
        expect(m).toMatchObject({ headword: 'casa', pill: null, tag: null, shift: null, relationFirst: null, pageWide: true })
      }, 60_000)
    }
  })

  describe('custom words', () => {
    type Sent = { words: { kind: string; row?: Record<string, unknown>; esWord?: string; tombstone?: string }[]; settings: Record<string, unknown>[]; order: string[]; favorites: { esWord: string; favorite: boolean }[] }
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

    it('"+" in the header adds a word: type it, pick a part of speech, the translation is filled in, change anything, save; it is written and set to learn sooner', async () => {
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
      expect(await page.$eval('.words-note', (e) => e.textContent)).toBe('Added, and set to learn sooner.')
      // the note is a confirmation: still there after a few seconds, gone by itself soon after (not left over the list until it is changed)
      await new Promise((r) => setTimeout(r, Math.min(3000, NOTICE_MS - 1500)))
      expect(await page.$('.words-note')).not.toBeNull()
      await page.waitForFunction(() => document.querySelector('.words-note') === null, { timeout: NOTICE_MS + 2000 })

      const sent = await sentAll(page)
      expect(sent.words).toEqual([
        {
          kind: 'save',
          row: { es_word: 'Zapallito', es_rioplatense: null, en_translation: 'baby squash', ru_translation: 'кабачок', example_sentence: 'Me gusta el zapallito.', example_translation_en: 'I like little squash.', example_translation_ru: 'Мне нравится кабачок.', is_rioplatense_variant: false, region: null, register: null, es_standard: null, pos: 'n' },
        },
      ])
      expect(sent.favorites).toEqual([{ esWord: 'Zapallito', favorite: true }]) // the star is written with the word
      expect(sent.settings).toEqual([]) // and nothing goes into the settings blob

      await openByName(page, 'Zapallito')
      expect(await page.$eval('.custom-mark', (e) => e.textContent)).toBe('Added by you')
      expect(await page.$$eval('.detail-actions .btn', (els) => els.map((e) => e.textContent?.trim()))).toEqual(['Learn sooner', 'Edit', 'Delete'])
      await page.close()
    }, 90_000)

    describe('a word the lookup does not recognise', () => {
      const sp = f.spelling
      const fields = (en: string, ru: string, example = '') => ({ enTranslation: en, ruTranslation: ru, exampleSentence: example, exampleTranslationEn: '', exampleTranslationRu: '', esRioplatense: null, isRioplatenseVariant: false, region: null, register: null, esStandard: null })
      /** What the stubbed proxy answers for each word typed (anything else: no result). */
      const answers = (page: Page, table: Record<string, unknown>) =>
        page.evaluate((t) => void ((window as never as { __enrichImpl: unknown }).__enrichImpl = async (i: { word: string }) => (t as Record<string, unknown>)[i.word] ?? { ok: false, failure: { kind: 'no-result' } }), table)
      /** Each note as its sentences (the paragraphs) and its buttons. */
      const spellingNote = (page: Page) => page.$$eval('.form-note', (els) => els.map((e) => ({ text: (e.tagName === 'P' ? [e] : Array.from(e.querySelectorAll('p'))).map((p) => p.textContent?.trim()).join(' '), buttons: Array.from(e.querySelectorAll('button')).map((b) => b.textContent?.trim()) })))
      const waitForWord = (page: Page, word: string) =>
        page.waitForFunction((w) => document.querySelector('.form-word strong')?.textContent === w, {}, word)

      // champeones is answered as the word the proxy believes was meant (campeones), flagged as not recognised
      const misspelt = { ok: true, value: fields('champions', 'чемпионы', 'Los campeones ganaron.'), notRecognised: { suggestion: 'championes' } }
      const corrected = { ok: true, value: fields('championes (Uruguayan sneakers)', 'кеды', 'Se puso los championes.') }

      it('a recognised word shows no question: the form is as it always was', async () => {
        const page = await open()
        await startAdding(page, 'Zapallito', 'Noun')
        await page.waitForSelector('.form-word')
        expect(await notes(page)).toEqual([f.filled])
        expect(await page.$$('.form-note-actions')).toHaveLength(0)
        await page.close()
      }, 90_000)

      it('not recognised, with a likely spelling: asks "Did you mean championes?" above the fields, with both ways on, and says plainly the word was not recognised', async () => {
        const page = await open()
        await answers(page, { champeones: misspelt })
        await startAdding(page, 'champeones', 'Noun')
        await page.waitForSelector('.form-word')
        expect(await spellingNote(page)).toEqual([{ text: `${sp.didYouMean('championes')} ${sp.notRecognised('champeones')}`, buttons: [sp.use('championes'), sp.keep('champeones')] }])
        expect(await page.$eval('.form-word strong', (e) => e.textContent)).toBe('champeones') // the word is still as typed until the user decides
        expect(await fieldValue(page, f.ru)).toBe('чемпионы') // the fields are as they came back
        // above the fields: the note comes before the first field
        expect(await page.evaluate(() => !!(document.querySelector('.form-note-actions')!.compareDocumentPosition(document.querySelector('.form-field')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
        await page.close()
      }, 90_000)

      it('not recognised, with no likely spelling: one line, no actions, and saving still works', async () => {
        const page = await open()
        await answers(page, { qwxz: { ok: true, value: fields('', ''), notRecognised: { suggestion: null } } })
        await startAdding(page, 'qwxz', 'Noun')
        await page.waitForSelector('.form-word')
        expect(await spellingNote(page)).toEqual([{ text: sp.notRecognisedSave('qwxz'), buttons: [] }])
        await typeIn(page, f.ru, 'что-то')
        await typeIn(page, f.en, 'something')
        await clickText(page, 'button', f.save)
        await page.waitForSelector('.words-search')
        expect((await sentAll(page)).words).toEqual([expect.objectContaining({ kind: 'save', row: expect.objectContaining({ es_word: 'qwxz', ru_translation: 'что-то' }) })])
        await page.close()
      }, 90_000)

      it('"Keep champeones": the question goes, the fields stay as they came back, and what was typed is exactly what is saved', async () => {
        const page = await open()
        await answers(page, { champeones: misspelt, championes: corrected })
        await startAdding(page, 'champeones', 'Noun')
        await page.waitForSelector('.form-word')
        await clickText(page, '.form-note-actions button', sp.keep('champeones'))
        expect(await page.$$('.form-note-actions')).toHaveLength(0)
        expect(await notes(page)).toEqual([])
        expect(await fieldValue(page, f.ru)).toBe('чемпионы')
        expect(await enrichCalls(page)).toEqual([{ word: 'champeones', pos: 'n' }]) // nothing was asked again
        await clickText(page, 'button', f.save)
        await page.waitForSelector('.words-search')
        const row = (await sentAll(page)).words[0].row!
        expect(row).toMatchObject({ es_word: 'champeones', en_translation: 'champions', ru_translation: 'чемпионы', example_sentence: 'Los campeones ganaron.' })
        await page.close()
      }, 90_000)

      it('"Use championes": the duplicate check and a fresh lookup run for the corrected word, and nothing from the first answer is kept', async () => {
        const page = await open()
        await answers(page, { champeones: misspelt, championes: corrected })
        await startAdding(page, 'champeones', 'Noun')
        await page.waitForSelector('.form-word')
        await typeIn(page, f.exampleEn, 'something I typed after the first answer') // the first answer's fields, and edits to them, are thrown away too
        await clickText(page, '.form-note-actions button', sp.use('championes'))
        await waitForWord(page, 'championes')
        expect(await enrichCalls(page)).toEqual([
          { word: 'champeones', pos: 'n' },
          { word: 'championes', pos: 'n' }, // the part of speech goes with it
        ])
        expect(await fieldValue(page, f.ru)).toBe('кеды')
        expect(await fieldValue(page, f.en)).toBe('championes (Uruguayan sneakers)')
        expect(await fieldValue(page, f.example)).toBe('Se puso los championes.')
        expect(await fieldValue(page, f.exampleEn)).toBe('') // not the first answer's, and not what was typed over it
        expect(await page.$$('.form-note-actions')).toHaveLength(0)
        expect(await notes(page)).toEqual([f.filled])
        await clickText(page, 'button', f.save)
        await page.waitForSelector('.words-search')
        const row = (await sentAll(page)).words[0].row!
        expect(row).toMatchObject({ es_word: 'championes', ru_translation: 'кеды', example_sentence: 'Se puso los championes.' })
        expect(JSON.stringify(row)).not.toContain('чемпионы')
        await page.close()
      }, 90_000)

      it('"Use": if the second lookup fails, the form is empty for the corrected word: the first answer is not left behind in it', async () => {
        const page = await open()
        await answers(page, { champeones: misspelt }) // championes: no answer
        await startAdding(page, 'champeones', 'Noun')
        await page.waitForSelector('.form-word')
        expect(await fieldValue(page, f.ru)).toBe('чемпионы')
        await clickText(page, '.form-note-actions button', sp.use('championes'))
        await waitForWord(page, 'championes')
        expect(await fieldValue(page, f.ru)).toBe('') // not the translation of campeones
        expect(await fieldValue(page, f.en)).toBe('')
        expect(await fieldValue(page, f.example)).toBe('')
        expect(await notes(page)).toEqual([strings.words.enrich.noResult])
        await page.close()
      }, 90_000)

      it('"Use": the duplicate check comes first: a corrected word that is already there stops as a duplicate does, with no second lookup', async () => {
        const page = await open()
        await answers(page, { kasa: { ok: true, value: fields('house', 'дом'), notRecognised: { suggestion: 'casa' } } })
        await startAdding(page, 'kasa', 'Noun')
        await page.waitForSelector('.form-word')
        await clickText(page, '.form-note-actions button', sp.use('casa'))
        await page.waitForSelector('.form-note.is-error')
        expect(await page.$('.form-word')).toBeNull() // back at the word, not on the details
        expect(await page.$eval('.form-input', (e) => (e as HTMLInputElement).value)).toBe('casa')
        expect((await notes(page))[0]).toContain(f.duplicate('casa', 'casa', 'es_word'))
        expect(await enrichCalls(page)).toEqual([{ word: 'kasa', pos: 'n' }]) // the lookup for casa was never made
        expect((await sentAll(page)).words).toEqual([]) // and nothing was written
        await page.close()
      }, 90_000)

      it('the question is not asked again for a word this form has already looked up, so it cannot go back and forth', async () => {
        const page = await open()
        await answers(page, {
          champeones: misspelt,
          championes: { ok: true, value: fields('x', 'y'), notRecognised: { suggestion: 'champeones' } }, // the second answer points back at the first word
        })
        await startAdding(page, 'champeones', 'Noun')
        await page.waitForSelector('.form-word')
        await clickText(page, '.form-note-actions button', sp.use('championes'))
        await waitForWord(page, 'championes')
        expect(await spellingNote(page)).toEqual([{ text: sp.notRecognisedSave('championes'), buttons: [] }]) // only the line: no suggestion of champeones
        await page.close()
      }, 90_000)

      it('editing the word (or changing it) drops the question', async () => {
        const page = await open()
        await answers(page, { champeones: misspelt })
        await startAdding(page, 'champeones', 'Noun')
        await page.waitForSelector('.form-word')
        await clickText(page, '.form-word .link-btn', f.change)
        await page.waitForSelector('.form-input[lang="es"]')
        expect(await page.$$('.form-note-actions')).toHaveLength(0)
        await page.close()
      }, 90_000)
    })

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
        [{ kind: 'daily-quota', usage: 10, limit: 10 }, strings.words.enrich.dailyQuota(10, 10)],
        [{ kind: 'rate-limit' }, strings.words.enrich.rateLimit],
        [{ kind: 'capacity', resetsAt: Date.now() + 5 * 3_600_000 }, strings.words.enrich.capacity(5)],
        [{ kind: 'unavailable' }, strings.words.enrich.unavailable],
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

    describe('"Try the lookup again" on the details step after a failure', () => {
      /** The lookup answers from a list, one answer to a call, the last one repeating. */
      const answers = (page: Page, list: unknown[]) =>
        page.evaluate((all) => {
          let n = 0
          ;(window as never as { __enrichImpl: unknown }).__enrichImpl = async () => all[Math.min(n++, all.length - 1)]
        }, list)
      const retryButtons = (page: Page) => page.$$eval('.word-form > button.btn-secondary', (els) => els.map((e) => e.textContent?.trim()))
      const GOOD = { ok: true, value: { enTranslation: 'little squash', ruTranslation: 'кабачок', exampleSentence: 'Me gusta el zapallito.', exampleTranslationEn: 'I like little squash.', exampleTranslationRu: 'Мне нравится кабачок.', esRioplatense: null, isRioplatenseVariant: false, region: null, register: null, esStandard: null } }

      it('is offered after a failure that asking again could cure, is never pressed for the person, and one tap asks once more', async () => {
        const page = await open()
        await answers(page, [{ ok: false, failure: { kind: 'timeout' } }, GOOD])
        await startAdding(page, 'Zapallito', 'Noun')
        await page.waitForSelector('.form-word')
        expect(await notes(page)).toEqual([strings.words.enrich.timeout])
        expect(await retryButtons(page)).toEqual([f.retry])
        await new Promise((resolve) => setTimeout(resolve, 1500)) // never automatic
        expect(await enrichCalls(page)).toHaveLength(1)

        await clickText(page, 'button', f.retry)
        await page.waitForFunction(() => document.querySelector('.form-note')?.textContent?.includes('Filled in automatically'))
        expect(await enrichCalls(page)).toHaveLength(2) // one tap, one call
        expect(await enrichCalls(page)).toEqual([{ word: 'Zapallito', pos: 'n' }, { word: 'Zapallito', pos: 'n' }])
        expect(await fieldValue(page, f.ru)).toBe('кабачок')
        expect(await fieldValue(page, f.en)).toBe('little squash')
        expect(await retryButtons(page)).toEqual([]) // it worked: nothing to press
        await page.close()
      }, 90_000)

      it('what the person typed while the lookup was failing or on its way is kept; only the blanks are filled', async () => {
        const page = await open()
        await answers(page, [{ ok: false, failure: { kind: 'network' } }, GOOD])
        await startAdding(page, 'Zapallito', 'Noun')
        await page.waitForSelector('.form-word')
        await typeIn(page, f.ru, 'тыковка') // by hand, before the retry
        await clickText(page, 'button', f.retry)
        await page.waitForFunction(() => document.querySelector('.form-note')?.textContent?.includes('Filled in automatically'))
        expect(await fieldValue(page, f.ru)).toBe('тыковка') // not overwritten by 'кабачок'
        expect(await fieldValue(page, f.en)).toBe('little squash') // the blank was filled
        expect(await fieldValue(page, f.example)).toBe('Me gusta el zapallito.')
        await page.close()
      }, 90_000)

      it('while it is looking the button is gone and the form says so; a second failure brings it back', async () => {
        const page = await open()
        await answers(page, [{ ok: false, failure: { kind: 'busy' } }])
        await startAdding(page, 'Zapallito', 'Noun')
        await page.waitForSelector('.form-word')
        expect(await retryButtons(page)).toEqual([f.retry])
        await page.evaluate(() => void ((window as never as { __enrichImpl: unknown }).__enrichImpl = () => new Promise(() => {}))) // the next one never answers
        await clickText(page, 'button', f.retry)
        await page.waitForFunction(() => document.querySelector('.form-note')?.textContent?.includes('Looking up'))
        expect(await retryButtons(page)).toEqual([]) // no second tap while one is on its way
        expect(await enrichCalls(page)).toHaveLength(2)
        await page.close()

        const again = await open()
        await answers(again, [{ ok: false, failure: { kind: 'busy' } }])
        await startAdding(again, 'Zapallito', 'Noun')
        await again.waitForSelector('.form-word')
        await clickText(again, 'button', f.retry)
        await again.waitForFunction(() => (window as never as { __enrichCalls: unknown[] }).__enrichCalls.length === 2)
        await again.waitForFunction((label) => Array.from(document.querySelectorAll('.word-form > button.btn-secondary')).some((b) => b.textContent?.trim() === label), {}, f.retry)
        expect(await notes(again)).toEqual([strings.words.enrich.busy])
        await again.close()
      }, 90_000)

      it('is not offered when asking again cannot help: the person\'s day used up, the service\'s day used up, the provider out for now', async () => {
        const page = await open()
        for (const failure of [{ kind: 'daily-quota', usage: 10, limit: 10 }, { kind: 'capacity', resetsAt: Date.now() + 3_600_000 }, { kind: 'unavailable' }]) {
          await stub(page, { ok: false, failure })
          await startAdding(page, 'Zapallito', 'Noun')
          await page.waitForSelector('.form-word')
          expect(await retryButtons(page), JSON.stringify(failure)).toEqual([])
          await cancelAndDiscard(page)
          await page.waitForSelector('.words-search')
        }
        await page.close()
      }, 120_000)

      it('is not on a word that is being edited, and not when the first lookup worked', async () => {
        const page = await open()
        await answers(page, [GOOD])
        await startAdding(page, 'Zapallito', 'Noun')
        await page.waitForSelector('.form-word')
        expect(await retryButtons(page)).toEqual([])
        await page.close()
      }, 60_000)

      it('in Russian the button says «Повторить поиск перевода»', async () => {
        const page = await open('?lang=ru')
        await answers(page, [{ ok: false, failure: { kind: 'timeout' } }])
        await page.click('button[aria-label="Добавить слово"]')
        await page.waitForSelector('.word-form')
        await typeIn(page, ru.words.form.spanish, 'Zapallito')
        await clickText(page, '[role="radio"]', ru.words.form.posNames.n)
        await clickText(page, 'button', ru.words.form.continue)
        await page.waitForSelector('.form-word')
        expect(await retryButtons(page)).toEqual(['Повторить поиск перевода'])
        await page.close()
      }, 60_000)
    })

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

    it('edits a word from its detail by hand (same key, progress untouched), then deletes it behind a confirm', async () => {
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
      expect(await page.$$eval('.detail-note', (els) => els.map((e) => e.textContent))).toContain('Saved.')
      const afterEdit = await sentAll(page)
      expect(afterEdit.words.at(-1)).toMatchObject({ kind: 'save', row: { es_word: 'Zapallito', ru_translation: 'тыква', pos: 'n' } })

      // the edit form is for fixing fields by hand: no lookup in it, and an untouched form closes without a question
      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
      expect(await page.$$eval('.word-form button', (els) => els.map((e) => e.textContent?.trim()).filter((t) => /re-run|enrichment|put back|look/i.test(t ?? '')))).toEqual([])
      expect(await page.$$eval('.word-form button:not([role="radio"])', (els) => els.map((e) => e.textContent?.trim()))).toEqual([f.save, f.cancel])
      await clickText(page, 'button', f.cancel)
      await page.waitForSelector('.word-detail')
      expect(await page.$('.sheet')).toBeNull()
      expect((await sentAll(page)).words.at(-1)).toEqual(afterEdit.words.at(-1)) // cancelling wrote nothing
      expect(await enrichCalls(page)).toEqual([{ word: 'Zapallito', pos: 'n' }]) // only the lookup made when the word was added

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
      expect(patches.at(-2)).toMatchObject({ pending_word_deletes: ['zapallito'] })
      expect((await sentAll(page)).favorites.map((f) => f.favorite)).toEqual([true, false]) // starred when added, and the star went with the word
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
      expect(await page.$$eval('.wc-meta .wc-rio', (els) => els.map((e) => e.textContent))).toEqual([strings.rio.pill])
      expect(await page.$$eval('.wc-meta .wc-tag', (els) => els.map((e) => e.textContent))).toEqual([strings.rio.tag.uy])
      expect(await page.$$eval('.wc-meta .wc-register', (els) => els.map((e) => e.textContent))).toEqual(['informal'])
      expect(await page.$eval('.wc-relation', (e) => e.textContent?.replace(/\s+/g, ' ').trim())).toBe('standard: calabacín')
      await page.close()
    }, 90_000)

    it('the edit form has region and register selects with "Both countries or unknown" / "Unknown", and a standard field; they round-trip by hand, and clearing one writes null', async () => {
      const page = await open()
      await addWord(page)
      await openByName(page, 'Zapallito')
      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
      expect(await page.$$eval('.form-field select', (els) => els.map((e) => Array.from((e as HTMLSelectElement).options).map((o) => o.textContent)))).toEqual([
        ['Both countries or unknown', 'Argentina only', 'Uruguay only'],
        ['Unknown', 'Neutral', 'Informal', 'Vulgar', 'Offensive', 'Pejorative'],
      ])
      expect([await fieldValue(page, f.region), await fieldValue(page, f.register), await fieldValue(page, f.standard)]).toEqual(['', '', '']) // all unknown

      await choose(page, f.region, 'ar')
      await choose(page, f.register, 'vulgar')
      await typeIn(page, f.standard, 'calabacín')
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.word-detail')
      expect((await sentAll(page)).words.at(-1)).toMatchObject({ kind: 'save', row: { es_word: 'Zapallito', region: 'ar', register: 'vulgar', es_standard: 'calabacín' } })

      // back in the form they are as saved
      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
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

    it('"This word is Rioplatense" is in the details step of both forms: the lookup sets it, the user can correct it, and unchecking keeps the marks until it is checked again', async () => {
      const page = await open()
      const checkbox = (p: Page) => p.$eval('.form-check input', (e) => (e as HTMLInputElement).checked)
      await stub(page, { ok: true, value: { enTranslation: 'little squash', ruTranslation: 'кабачок', exampleSentence: '', exampleTranslationEn: '', exampleTranslationRu: '', esRioplatense: null, isRioplatenseVariant: true, region: 'uy', register: 'informal', esStandard: 'calabacín' } })
      await startAdding(page, 'Zapallito', 'Noun')
      await page.waitForSelector('.form-word')
      // add form: the checkbox, its label and the one quiet line, filled in by the lookup
      expect(await page.$eval('.form-check', (e) => e.textContent)).toBe(f.rioplatenseCheck)
      expect(await page.$$eval('.form-field .form-hint', (els) => els.map((e) => e.textContent))).toContain(f.rioplatenseHint)
      expect(await checkbox(page)).toBe(true)
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.words-search')

      // edit form: the same checkbox, checked as saved; unchecking changes nothing typed
      await openByName(page, 'Zapallito')
      expect(await page.$$eval('.wc-meta .wc-rio', (els) => els.length)).toBe(1)
      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
      expect(await checkbox(page)).toBe(true)
      await page.click('.form-check input')
      expect(await checkbox(page)).toBe(false)
      expect([await fieldValue(page, f.region), await fieldValue(page, f.register), await fieldValue(page, f.standard)]).toEqual(['uy', 'informal', 'calabacín'])
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.word-detail')
      expect((await sentAll(page)).words.at(-1)).toMatchObject({ row: { is_rioplatense_variant: false, region: 'uy', register: 'informal', es_standard: 'calabacín' } })
      // the marks are hidden on the card
      expect(await page.$$eval('.wc-meta .wc-rio, .wc-meta .wc-tag, .wc-meta .wc-register, .wc-relation', (els) => els.length)).toBe(0)

      // and still there in the form, ready to come back with a tick
      await clickText(page, '.detail-actions .btn', 'Edit')
      await page.waitForSelector('.word-form')
      expect(await checkbox(page)).toBe(false)
      expect([await fieldValue(page, f.region), await fieldValue(page, f.register), await fieldValue(page, f.standard)]).toEqual(['uy', 'informal', 'calabacín'])
      await page.click('.form-check input')
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.word-detail')
      expect((await sentAll(page)).words.at(-1)).toMatchObject({ row: { is_rioplatense_variant: true, region: 'uy', register: 'informal', es_standard: 'calabacín' } })
      expect(await page.$$eval('.wc-meta .wc-rio', (els) => els.length)).toBe(1)
      expect(await page.$$eval('.wc-meta .wc-tag', (els) => els.map((e) => e.textContent))).toEqual([strings.rio.tag.uy])
      expect(await page.$eval('.wc-relation', (e) => e.textContent?.replace(/\s+/g, ' ').trim())).toBe('standard: calabacín')
      await page.close()
    }, 120_000)

    it('a word typed by hand can be marked Rioplatense with the checkbox, and its marks show', async () => {
      const page = await open()
      await stub(page, { ok: false, failure: { kind: 'offline' } })
      await startAdding(page, 'Zapallito', 'Noun')
      await page.waitForSelector('.form-word')
      expect(await page.$eval('.form-check input', (e) => (e as HTMLInputElement).checked)).toBe(false) // nothing looked up: off
      await typeIn(page, f.ru, 'кабачок')
      await typeIn(page, f.en, 'squash')
      await page.click('.form-check input')
      await choose(page, f.region, 'ar')
      await typeIn(page, f.standard, 'calabacín')
      await clickText(page, 'button', f.save)
      await page.waitForSelector('.words-search')
      expect((await sentAll(page)).words).toMatchObject([{ row: { is_rioplatense_variant: true, region: 'ar', register: null, es_standard: 'calabacín' } }])
      await openByName(page, 'Zapallito')
      expect(await page.$$eval('.wc-meta .wc-tag', (els) => els.map((e) => e.textContent))).toEqual([strings.rio.tag.ar])
      await page.close()
    }, 90_000)

    it('the Filters sheet has "Custom" under "Show only", and it lists only the words added', async () => {
      const page = await open()
      await addWord(page)
      await control(page, 'Filters')
      await page.waitForSelector('.sheet')
      expect(await page.$$eval('#sheet-show-only + .sheet-options .chip', (els) => els.map((e) => e.textContent))).toEqual(['Learn sooner', 'Custom'])
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
    expect(app).toMatch(/const backTarget: Screen = backTargetFor\(screen, screen === 'word' \? \(open\?\.from \?\? null\) : null, feedback\.esWord !== null, feedbackFrom\)/) // a word goes back to where it was opened (src/lib/nav.ts)
    expect(app).toMatch(/const onClick = \(\) => goBack\(\)/)
    expect(app).toMatch(/if \(backInterceptor\.current\?\.\(\)\) return/)
    expect(app).toMatch(/registerBack=\{registerBack\}/)
  })
})
