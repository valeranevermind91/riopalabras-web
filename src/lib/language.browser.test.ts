import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type BrowserContext, type Page } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'
import { en } from '../strings'
import { ru } from '../strings.ru'

/**
 * The interface language in a real browser: choosing it in the intro switches the whole intro at once, Settings has its own
 * "App language" group, Home and the Words screen follow, the choice is kept across a reload, and a Russian interface with English-only
 * translations shows Russian chrome around English words. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

/** The English words that may stay in a Russian screen: the names of the app's own screens, and Spanish content. */
const KEEP = new Set(['Learn', 'Review', 'Matching', 'Cloze', 'Words', 'Riopalabras', 'English', 'Telegram', 'palabra', 'nueva', 'Esta', 'del', 'día', 'aprender', 'repasar', 'parejas', 'completar', 'calle', 'vos', 'tenés', 'tú', 'tienes'])
const latin = (texts: readonly string[]) => texts.filter((t) => !/^@\w+$/.test(t) && !/^v?[0-9a-f]{7}\b/.test(t) && !/^dev · /.test(t)).flatMap((t) => (t.match(/\p{Script=Latin}{3,}\d*/gu) ?? []).map((w) => ({ w: w.replace(/\d+$/, ''), t }))).filter(({ w }) => !KEEP.has(w)).map(({ w, t }) => `${w} ← “${t.slice(0, 60)}”`)
const cyrillic = (texts: readonly string[]) => texts.filter((t) => /[А-Яа-яЁё]/.test(t.replace(/Русский/g, '')))

describe.skipIf(!CHROME)('the interface language in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5231, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  const context = async () => {
    const ctx = await browser.createBrowserContext()
    return ctx
  }
  async function open(ctx: BrowserContext, harness: string, query = '', telegramLanguage?: string) {
    const page = await ctx.newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    if (telegramLanguage) {
      // A Telegram that reports a language (initData makes the app treat it as the real WebApp).
      await page.evaluateOnNewDocument((code) => {
        ;(window as never as { Telegram: unknown }).Telegram = { WebApp: { initData: 'x', initDataUnsafe: { user: { id: 1, first_name: 'A', language_code: code } }, colorScheme: 'light', themeParams: {}, ready() {}, expand() {} } }
      }, telegramLanguage)
    }
    await page.goto(`${base}/src/testing/${harness}.html?${query}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('main')
    return page
  }
  const settingsPage = (ctx: BrowserContext, query = '', telegramLanguage?: string) => open(ctx, 'settingsHarness', query, telegramLanguage)

  /** Everything a person reads on the page: its text, and the labels that are not text. */
  const everything = (page: Page, root = 'body') =>
    page.evaluate((selector) => {
      const out: string[] = []
      for (const el of document.querySelectorAll(selector)) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.trim()) out.push(n.textContent.trim())
        for (const a of [el, ...el.querySelectorAll('*')]) for (const attr of ['aria-label', 'placeholder', 'title']) if (a.getAttribute(attr)) out.push(a.getAttribute(attr)!)
      }
      return out
    }, root)
  const sent = (page: Page) => page.evaluate(() => (window as never as { __sent: { settings: Record<string, unknown>[] } }).__sent.settings)
  const htmlLang = (page: Page) => page.evaluate(() => document.documentElement.lang)
  const title = (page: Page) => page.$eval('h1', (e) => e.textContent)
  const clickText = (page: Page, selector: string, text: string) =>
    page.evaluate((sel, t) => (Array.from(document.querySelectorAll(sel)).find((b) => b.textContent?.trim().startsWith(t)) as HTMLElement).click(), selector, text)
  /** The intro's Continue, or Skip on the placement test (it has its own buttons). */
  const proceed = async (page: Page, label: string) => {
    if (await page.$('[data-step="placement"]')) await page.evaluate(() => ((document.querySelector('.place-skip .link-btn') ?? document.querySelector('.place-footer .btn-primary')) as HTMLElement).click()) // Skip (or Continue, where there is no test to take)
    else await clickText(page, '.intro-footer .btn', label)
  }
  const footer = (page: Page) => page.$$eval('.intro-footer .btn', (els) => els.map((e) => e.textContent))
  const stepText = (page: Page) => page.$eval('.intro-progress span', (e) => e.textContent)

  describe('the intro', () => {
    it('is in the language Telegram reports, preselected, and writes nothing until a language is chosen', async () => {
      const ctx = await context()
      const russian = await settingsPage(ctx, 'fresh=1&goal=default', 'ru')
      expect(await title(russian)).toBe(ru.onboarding.language.title)
      expect(await russian.$$eval('.lang-option', (els) => els.map((e) => `${e.textContent}:${e.getAttribute('aria-checked')}`))).toEqual(['English:false', 'Русский:true'])
      expect(await htmlLang(russian)).toBe('ru')
      expect(await sent(russian)).toEqual([])
      await russian.close()
      await ctx.close()

      for (const code of ['en', 'es', 'uk']) {
        const other = await context()
        const page = await settingsPage(other, 'fresh=1&goal=default', code)
        expect(await title(page), code).toBe(en.onboarding.language.title)
        expect(await page.$$eval('.lang-option', (els) => els.map((e) => e.getAttribute('aria-checked')))).toEqual(['true', 'false'])
        await other.close()
      }
    }, 90_000)

    it('tapping Continue without touching either option writes ui_language, and the value is the one that was preselected', async () => {
      for (const [telegram, expected] of [['ru', 'ru'], ['en', 'en'], ['es', 'en'], [undefined, 'en']] as const) {
        const ctx = await context()
        const page = await settingsPage(ctx, 'fresh=1&goal=default', telegram)
        expect(await page.$$eval('.lang-option[aria-checked="true"]', (els) => els.map((e) => e.getAttribute('lang'))), String(telegram)).toEqual([expected]) // what is preselected
        expect(await sent(page)).toEqual([]) // nothing yet
        await clickText(page, '.intro-footer .btn', expected === 'ru' ? 'Дальше' : 'Continue')
        await page.waitForSelector('[data-step="about"]')
        expect(await sent(page), String(telegram)).toEqual([{ ui_language: expected }])
        await ctx.close()
      }
    }, 90_000)

    it('that write is the one tapping the option makes, and it happens once', async () => {
      const ctx = await context()
      const tapped = await settingsPage(ctx, 'fresh=1&goal=default', 'ru')
      await clickText(tapped, '.lang-option', 'Русский') // the preselected one, tapped: it becomes a choice
      const viaOption = await sent(tapped)
      await tapped.close()

      const other = await context()
      const page = await settingsPage(other, 'fresh=1&goal=default', 'ru')
      await page.evaluate(() => {
        // two taps in the same tick: the second must find the language already written
        const go = Array.from(document.querySelectorAll('.intro-footer .btn')).find((b) => b.textContent === 'Дальше') as HTMLElement
        go.click()
        go.click()
      })
      await page.waitForSelector('[data-step="about"]')
      expect(await sent(page)).toEqual(viaOption)
      expect(await sent(page)).toEqual([{ ui_language: 'ru' }])
      // later steps do not write it again
      await clickText(page, '.intro-footer .btn', 'Дальше')
      await clickText(page, '.intro-footer .btn', 'Назад')
      await clickText(page, '.intro-footer .btn', 'Назад')
      await clickText(page, '.intro-footer .btn', 'Дальше')
      expect(await sent(page)).toEqual([{ ui_language: 'ru' }])
      await ctx.close()
      await other.close()
    }, 90_000)

    it('a language already chosen is not written again by Continue (a replay, or a second device)', async () => {
      const ctx = await context()
      const page = await settingsPage(ctx, 'fresh=1&goal=default&lang=ru', 'en') // the account chose Russian; this Telegram says English
      expect(await title(page)).toBe('Язык приложения')
      await clickText(page, '.intro-footer .btn', 'Дальше')
      await page.waitForSelector('[data-step="about"]')
      expect(await sent(page)).toEqual([])
      await ctx.close()
    }, 60_000)

    it('choosing Russian switches the whole intro at once, and every step after it is in Russian', async () => {
      const ctx = await context()
      const page = await settingsPage(ctx, 'fresh=1&goal=default')
      expect(await title(page)).toBe('App language')
      expect(await footer(page)).toEqual(['Continue'])

      await clickText(page, '.lang-option', 'Русский')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Язык приложения')
      expect(await stepText(page)).toBe('Шаг 1 из 7')
      expect(await footer(page)).toEqual(['Дальше'])
      expect(await htmlLang(page)).toBe('ru')
      expect(await sent(page)).toEqual([{ ui_language: 'ru' }])
      expect(latin(await everything(page))).toEqual([])

      const titles: (string | null)[] = []
      for (let n = 1; n <= 7; n++) {
        titles.push(await title(page))
        expect(latin(await everything(page)), `step ${n}`).toEqual([])
        expect(await page.$eval('[role="progressbar"]', (e) => e.getAttribute('aria-label'))).toBe('Ход введения')
        if (n < 7) await proceed(page, 'Дальше')
      }
      expect(titles).toEqual(['Язык приложения', 'Riopalabras', 'Что внутри', 'Переводы', 'Входной тест', 'Дневная цель', 'Произношение'])
      expect(await footer(page)).toEqual(['Назад', 'Готово'])
      await page.close()
      await ctx.close()
    }, 90_000)

    it('"What is inside" says what to expect, in both languages, with the screen names in Latin', async () => {
      const ctx = await context()
      const page = await settingsPage(ctx, 'fresh=1&goal=default')
      const inside = async () => {
        await page.waitForSelector('.intro-list')
        return page.$$eval('.intro-list li', (els) => els.map((e) => [e.querySelector('.intro-name')?.textContent, e.querySelector('.intro-line')?.textContent]))
      }
      await clickText(page, '.intro-footer .btn', 'Continue')
      await clickText(page, '.intro-footer .btn', 'Continue')
      expect(await inside()).toEqual([
        ['Learn', 'new words, each shown in a real sentence rather than a bare list.'],
        ['Review', 'self-check cards: you say whether you remembered, and the app decides when the word comes back.'],
        ['Matching and Cloze', 'two other ways to go over what you know: pair words with their translations, or fill the missing word into a sentence.'],
        ['Words', 'the whole dictionary, with search, filters, favourites, and words you add yourself.'],
      ])
      await clickText(page, '.intro-footer .btn', 'Back')
      await clickText(page, '.intro-footer .btn', 'Back')
      await clickText(page, '.lang-option', 'Русский')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Язык приложения')
      await clickText(page, '.intro-footer .btn', 'Дальше')
      await clickText(page, '.intro-footer .btn', 'Дальше')
      expect(await inside()).toEqual([
        ['Learn', 'новые слова, каждое сразу в живом предложении, а не списком.'],
        ['Review', 'карточки для самопроверки: вы отмечаете, вспомнили или нет, а приложение решает, когда показать слово снова.'],
        ['Matching и Cloze', 'два других способа повторить: собрать пары слово — перевод или вставить пропущенное слово в предложение.'],
        ['Words', 'весь словарь: поиск, фильтры, избранное и слова, которые вы добавили сами.'],
      ])
      await ctx.close()
    }, 90_000)

    it('choosing English again switches back at once, and Done lands on a Home in the chosen language', async () => {
      const ctx = await context()
      const page = await settingsPage(ctx, 'fresh=1&goal=default', 'ru')
      await clickText(page, '.lang-option', 'English')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'App language')
      expect(cyrillic(await everything(page)).filter((t) => t !== 'Русский')).toEqual([])
      expect(await sent(page)).toEqual([{ ui_language: 'en' }]) // an explicit choice, even against Telegram's language

      await clickText(page, '.lang-option', 'Русский')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Язык приложения')
      for (let n = 1; n < 7; n++) await proceed(page, 'Дальше')
      await clickText(page, '.intro-footer .btn', 'Готово')
      await page.waitForSelector('.home')
      expect(await everything(page)).toContain(ru.common.signInPrompt) // this harness's Home has no Telegram to sign in with
      expect(latin(await everything(page))).toEqual([])
      await ctx.close()
    }, 90_000)
  })

  describe('Settings', () => {
    const toSettings = async (page: Page) => {
      await page.waitForSelector('button[aria-label]')
      await page.evaluate(() => (document.querySelector('.screen-header-actions .icon-btn:last-child') as HTMLElement).click())
      await page.waitForSelector('.settings')
    }

    it('has an "App language" row in its own group, above Appearance, apart from the translation switches', async () => {
      const ctx = await context()
      const page = await settingsPage(ctx, 'goal=12')
      await toSettings(page)
      expect(await page.$$eval('.settings-label', (els) => els.map((e) => e.textContent))).toEqual(['Learning', 'Language', 'Appearance', 'Notifications', 'About'])
      const groups = await page.$$eval('.settings-section', (els) => els.map((e) => [e.querySelector('h2')?.textContent, e.querySelectorAll('.settings-group').length, e.querySelector('#ui-language-label')?.textContent ?? null, e.querySelector('#translation-label')?.textContent ?? null]))
      expect(groups).toEqual([
        ['Learning', 1, null, 'Translations'], // the translation switches keep their own label
        ['Language', 1, 'App language', null], // the interface language is a different group
        ['Appearance', 1, null, null],
        ['Notifications', 1, null, null],
        ['About', 1, null, null],
      ])
      expect(await page.$$eval('[aria-labelledby="ui-language-label"] [role="radio"]', (els) => els.map((e) => `${e.textContent}:${e.getAttribute('aria-checked')}`))).toEqual(['English:true', 'Русский:false'])
      await page.close()
      await ctx.close()
    }, 60_000)

    it('with a stored Russian it is all Russian, and choosing English switches it all at once and saves the choice', async () => {
      const ctx = await context()
      const page = await settingsPage(ctx, 'goal=12&lang=ru&debug=1')
      expect(await htmlLang(page)).toBe('ru')
      await toSettings(page)
      expect(await page.$$eval('.settings-label', (els) => els.map((e) => e.textContent))).toEqual(['Обучение', 'Язык', 'Оформление', 'Уведомления', 'О приложении', 'Debug'])
      const groups = await page.$$eval('.settings-section', (els) => els.map((e) => [e.querySelector('#ui-language-label')?.textContent ?? null, e.querySelector('#translation-label')?.textContent ?? null]).filter(([a, b]) => a || b))
      expect(groups).toEqual([[null, 'Переводы'], ['Язык приложения', null]])
      expect(latin(await everything(page, '.settings')).filter((x) => !/^Debug/.test(x))).toEqual([])
      expect(await page.$$eval('[aria-labelledby="ui-language-label"] [role="radio"]', (els) => els.map((e) => e.getAttribute('aria-checked')))).toEqual(['false', 'true'])

      await clickText(page, '[aria-labelledby="ui-language-label"] [role="radio"]', 'English')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Settings')
      expect(await page.$$eval('.settings-label', (els) => els.map((e) => e.textContent))).toEqual(['Learning', 'Language', 'Appearance', 'Notifications', 'About', 'Debug'])
      expect(cyrillic(await everything(page, '.settings'))).toEqual([]) // the language's own name is the one Russian word, and cyrillic() leaves it out
      expect(await sent(page)).toEqual([{ ui_language: 'en' }])
      expect(await htmlLang(page)).toBe('en')
      await ctx.close()
    }, 90_000)

    it('Debug stays English in a Russian interface', async () => {
      const ctx = await context()
      const page = await settingsPage(ctx, 'goal=12&lang=ru&debug=1')
      await toSettings(page)
      await page.evaluate(() => (document.querySelector('#settings-debug ~ .settings-group .setting-nav') as HTMLElement).click())
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Debug')
      expect(cyrillic(await everything(page))).toEqual([])
      await ctx.close()
    }, 60_000)
  })

  describe('Home', () => {
    it('is in Russian with a stored Russian, and English without: no English chrome in the one, no Russian in the other', async () => {
      const ctx = await context()
      const russian = await settingsPage(ctx, 'goal=12&lang=ru&ready=1')
      await russian.waitForSelector('.tile')
      const texts = await everything(russian, '.home')
      expect(latin(texts)).toEqual([])
      expect(texts).toContain('0 дней подряд')
      expect(await russian.$$eval('.tile-label', (els) => els.map((e) => e.textContent))).toEqual(['Learn', 'Review', 'Matching', 'Cloze'])
      expect(await russian.$$eval('.screen-header-actions .icon-btn', (els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Words', 'Настройки'])
      await russian.close()

      const english = await settingsPage(ctx, 'goal=12&ready=1')
      await english.waitForSelector('.tile')
      const enTexts = await everything(english, '.home')
      expect(cyrillic(enTexts).filter((t) => !/слово|новое/.test(t))).toEqual([])
      expect(enTexts).toContain('0-day streak')
      expect(await english.$$eval('.screen-header-actions .icon-btn', (els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Words', 'Settings'])
      await ctx.close()
    }, 90_000)
  })

  describe('the choice is kept', () => {
    it('across a reload: the language this device used last shows before the settings have loaded, and the stored one confirms it', async () => {
      const ctx = await context()
      const first = await settingsPage(ctx, 'fresh=1&goal=default')
      await clickText(first, '.lang-option', 'Русский')
      await first.waitForFunction(() => document.querySelector('h1')?.textContent === 'Язык приложения')
      expect(await first.evaluate(() => localStorage.getItem('riopalabras.language.v1'))).toBe('ru')
      await first.close()

      // a new launch: the settings arrive late (a slow load). Before they do, the page is already in Russian.
      const again = await settingsPage(ctx, 'late=1&lang=ru&goal=default')
      expect(await everything(again)).toContain(ru.common.signInPrompt)
      expect(await htmlLang(again)).toBe('ru')
      await again.evaluate(() => (window as never as { __loadSettings: () => void }).__loadSettings())
      await again.waitForSelector('.home')
      expect(await htmlLang(again)).toBe('ru') // the stored setting says Russian too
      expect(await everything(again)).toContain(ru.common.signInPrompt)
      await again.close()

      // a device that never chose has nothing to show early: English, then Russian once the stored setting arrives
      const other = await context()
      const fresh = await settingsPage(other, 'late=1&lang=ru&goal=default')
      expect(await everything(fresh)).toContain(en.common.signInPrompt)
      await fresh.evaluate(() => (window as never as { __loadSettings: () => void }).__loadSettings())
      await fresh.waitForFunction(() => document.documentElement.lang === 'ru')
      expect(await everything(fresh)).toContain(ru.common.signInPrompt)
      await other.close()
      await ctx.close()
    }, 90_000)

    it('the stored setting wins over what the device last used, and with none stored Telegram decides', async () => {
      const ctx = await context()
      const first = await settingsPage(ctx, 'lang=ru&goal=default')
      expect(await htmlLang(first)).toBe('ru')
      await first.close()
      const next = await settingsPage(ctx, 'lang=en&goal=default') // this account chose English
      expect(await htmlLang(next)).toBe('en')
      await next.close()
      const none = await settingsPage(ctx, 'goal=default', 'ru') // no stored language: Telegram says Russian
      expect(await htmlLang(none)).toBe('ru')
      await ctx.close()
    }, 90_000)
  })

  describe('the Words screen', () => {
    // chrome only: the rows and the card are the dictionary's own content
    const CHROME_SELECTORS = ['.screen-header', '.words-search', '.segmented', '.words-controls', '.words-empty', '.words-note', '.sheet', '.detail-actions', '.state-block']

    it('a Russian interface with English-only translations: Russian chrome, sheets and detail around English words', async () => {
      const ctx = await context()
      const page = await open(ctx, 'wordsHarness', 'lang=ru&ru=0')
      await page.waitForFunction(() => (window as never as { __ready?: boolean }).__ready === true)
      await page.waitForSelector('.word-row')

      expect(await page.$eval('h1', (e) => e.textContent)).toBe('Words')
      expect(await page.$eval('.words-search', (e) => e.getAttribute('placeholder'))).toBe(ru.words.searchPlaceholder)
      expect(await page.$$eval('.segment', (els) => els.map((e) => e.textContent?.replace(/\d+$/, '').trim()))).toEqual(['Все', 'Выученные', 'Скрытые'])
      expect(await page.$$eval('.control-btn', (els) => els.map((e) => e.textContent))).toEqual(['Фильтры', 'Сортировка: По частоте'])
      expect(await page.$eval('button[aria-label="Добавить слово"]', (e) => e.getAttribute('aria-label'))).toBe(ru.words.addWord)
      expect(latin(await everything(page, CHROME_SELECTORS.join(',')))).toEqual([])

      // the rows show English glosses only (the translation flags), not Russian ones
      const lines = await page.$$eval('.word-row-line', (els) => els.slice(0, 6).map((e) => e.textContent ?? ''))
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) expect(line).not.toMatch(/[А-Яа-яЁё]/)

      // the sheets
      await clickText(page, '.control-btn', 'Фильтры')
      await page.waitForSelector('.sheet')
      expect(await page.$$eval('.sheet h3', (els) => els.map((e) => e.textContent))).toEqual(['Прогресс', 'Показывать только', 'Часть речи'])
      expect(await page.$$eval('.sheet .chip', (els) => els.map((e) => e.textContent))).toEqual(['Любой', 'Не начато', 'В процессе', 'Знаю хорошо', 'Пора повторить', 'Избранное', 'В очереди', 'Мои слова', 'Глаголы', 'Существительные', 'Прилагательные', 'Наречия'])
      expect(latin(await everything(page, '.sheet'))).toEqual([])
      await page.click('.sheet-backdrop', { offset: { x: 20, y: 20 } })
      await page.waitForFunction(() => document.querySelector('.sheet') === null)
      await clickText(page, '.control-btn', 'Сортировка')
      await page.waitForSelector('.sheet')
      expect(await page.$$eval('.sheet-row', (els) => els.map((e) => e.textContent))).toEqual(['По частоте', 'По алфавиту', 'Ближайшие повторы', 'Недавно выученные', 'В случайном порядке'])
      await page.click('.sheet-backdrop', { offset: { x: 20, y: 20 } })
      await page.waitForFunction(() => document.querySelector('.sheet') === null)

      // a word's detail: chrome in Russian, the English translation only
      await page.evaluate(() => (document.querySelectorAll('.word-row-main')[4] as HTMLElement).click())
      await page.waitForSelector('.word-detail')
      expect(await page.$eval('h1', (e) => e.textContent)).toBe('Слово')
      expect(latin(await everything(page, CHROME_SELECTORS.join(',')))).toEqual([])
      expect(await page.$$eval('.wc-row-label', (els) => els.map((e) => e.textContent))).toEqual(['EN:']) // the translation row is content: it follows the flags
      expect(await page.$$eval('.detail-actions .btn', (els) => els.map((e) => e.textContent?.trim()))).toContain('В избранное')
      await ctx.close()
    }, 120_000)

    it('the same screen in English, with Russian-only translations, has no Russian chrome', async () => {
      const ctx = await context()
      const page = await open(ctx, 'wordsHarness', 'lang=en')
      await page.waitForFunction(() => (window as never as { __ready?: boolean }).__ready === true)
      await page.waitForSelector('.word-row')
      expect(cyrillic(await everything(page, CHROME_SELECTORS.join(',')))).toEqual([])
      await ctx.close()
    }, 60_000)
  })
})
