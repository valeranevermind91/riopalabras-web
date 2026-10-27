import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type HTTPRequest, type Page } from 'puppeteer-core'
import { build, createServer, preview, type PreviewServer, type ViteDevServer } from 'vite'
import { ANON_KEY, createFakeServer, initDataFor } from '../testing/fakeServer'

/**
 * The REAL app, from index.html and main.tsx, in a real browser: Telegram (a stub of its script), the proxy, Supabase's auth and its tables are the fake server
 * (src/testing/fakeServer.ts) answering through request interception, so nothing leaves the machine. Every other test puts one screen on a page and hands it its props;
 * this is the only one that shows what App itself hands them. It exists because a control that depends on a prop from App ("Report a problem" on Learn's card needs the
 * sender) can be fully tested as a component and still be missing in the product when the wiring is wrong. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

const SUPABASE = 'fake-supabase.test'
const PROXY = 'fake-proxy.test'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
const TELEGRAM_ID = 7

/** What telegram.org/js/telegram-web-app.js would define: a Mini App opened by user 7 on Android. */
const telegramScript = () => `
  window.Telegram = { WebApp: { initData: ${JSON.stringify(initDataFor(TELEGRAM_ID))}, initDataUnsafe: { user: { id: ${TELEGRAM_ID}, first_name: 'T' } }, platform: 'android', colorScheme: 'light', themeParams: {}, version: '8.0',
    isVersionAtLeast: () => true, ready() {}, expand() {}, close() {}, onEvent() {}, offEvent() {}, enableClosingConfirmation() {}, disableClosingConfirmation() {},
    BackButton: { show() {}, hide() {}, onClick() {}, offClick() {}, isVisible: false }, HapticFeedback: { impactOccurred() {}, selectionChanged() {}, notificationOccurred() {} } } }`

/** The same checks twice: on the dev server (the source, in StrictMode) and on a production build, which is what ships (minified, and with the Supabase client in it only because the build was given its address). */
for (const mode of ['dev server', 'production build'] as const)
describe.skipIf(!CHROME)(`the real app (${mode}): what App hands its screens`, () => {
  let server: ViteDevServer | PreviewServer
  let browser: Browser
  let base: string
  const saved: Record<string, string | undefined> = {}
  const env = { VITE_SUPABASE_URL: `https://${SUPABASE}`, VITE_SUPABASE_ANON_KEY: ANON_KEY, VITE_PROXY_URL: `https://${PROXY}` }

  beforeAll(async () => {
    // Vite takes VITE_* variables from the process before the .env files, so the app is built against the fake addresses; the interception below answers (or aborts) anything else.
    for (const [key, value] of Object.entries(env)) {
      saved[key] = process.env[key]
      process.env[key] = value
    }
    if (mode === 'dev server') {
      const dev = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5274, strictPort: false } })
      await dev.listen()
      server = dev
    } else {
      // Built here, with the fake addresses, into a folder that git ignores. A build made without them has no Supabase client in it at all (the bundler drops the dead branch),
      // which is why `npm run build` on a machine without the variables cannot tell whether the real wiring works.
      const outDir = 'node_modules/.cache/app-wiring-dist'
      await build({ configFile: 'vite.config.ts', logLevel: 'error', build: { outDir, emptyOutDir: true } })
      server = await preview({ configFile: 'vite.config.ts', logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 5275, strictPort: false } })
    }
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await (server as { close: () => Promise<void> } | undefined)?.close()
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  /** Opens the app signed in as the Telegram user, with a settled account (the intro done, the reminder offer made) so Home is the first screen. */
  async function open(options: { seed?: (fake: ReturnType<typeof createFakeServer>) => void } = {}) {
    const fake = createFakeServer()
    fake.users.set(TELEGRAM_ID, 'user-1')
    fake.tables.set('user_settings', [{ user_id: 'user-1', settings: { onboarding_done: true, ui_language: 'en', daily_new_word_limit: 10, reminder_offer_shown: true } }])
    options.seed?.(fake)
    const page = await (await browser.createBrowserContext()).newPage()
    const outside: string[] = []
    await page.setRequestInterception(true)
    page.on('request', (req: HTTPRequest) => {
      void (async () => {
        const url = new URL(req.url())
        if (url.hostname === '127.0.0.1') return void (await req.continue())
        if (url.hostname === 'telegram.org') return void (await req.respond({ status: 200, contentType: 'application/javascript', body: telegramScript() }))
        if (url.hostname.startsWith('fonts.')) return void (await req.respond({ status: 200, contentType: 'text/css', body: '' }))
        if (url.hostname !== SUPABASE && url.hostname !== PROXY) {
          outside.push(url.hostname) // nothing real may be reached
          return void (await req.abort())
        }
        if (req.method() === 'OPTIONS') return void (await req.respond({ status: 204, headers: CORS }))
        const body = req.postData()
        const answer = await fake.fetch(new Request(req.url(), { method: req.method(), headers: req.headers(), ...(body ? { body } : {}) }))
        const headers: Record<string, string> = { ...CORS }
        answer.headers.forEach((value, key) => (headers[key] = value))
        await req.respond({ status: answer.status, headers, body: await answer.text() })
      })()
    })
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await page.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.home .home-grid', { timeout: 30_000 })
    return { page, fake, outside }
  }

  const press = async (page: Page, selector: string) => {
    await page.waitForSelector(selector)
    await page.click(selector)
  }

  it('signs in as the Telegram user and reaches Home through the fake server alone', async () => {
    const { page, fake, outside } = await open()
    expect(outside).toEqual([]) // nothing but the fakes and the dev server was asked
    expect(fake.log.some((l) => l.url === '/auth/v1/user' && l.status === 200)).toBe(true)
    expect(fake.log.some((l) => l.url === '/rest/v1/user_settings' && l.method === 'GET' && l.role === 'authenticated')).toBe(true)
    await page.close()
  }, 90_000)
  /** Types into the open report form and sends it; waits for the form to go. */
  async function sendFromForm(page: Page, message: string, fake?: ReturnType<typeof createFakeServer>) {
    await page.waitForSelector('textarea.form-input')
    await page.type('textarea.form-input', message)
    await press(page, 'button[type="submit"]')
    await page.waitForFunction(() => !document.querySelector('textarea.form-input'), { timeout: 8000 }).catch(async (e) => {
      throw new Error(`the form stayed: ${await page.evaluate(() => document.querySelector('form')?.textContent)} :: ${JSON.stringify(fake?.log.slice(-2))} :: ${e}`)
    })
  }
  const reports = (fake: ReturnType<typeof createFakeServer>) => fake.rows('feedback')

  it('Learn\'s card has "Report a problem with this word" under "Hide this word", and a report from it reaches the server as a word report from Learn', async () => {
    const { page, fake } = await open()
    await press(page, '[data-tile="learn"]')
    await page.waitForSelector('.learn-known')
    expect(await page.$eval('.learn-known .known-btn', (e) => e.textContent)).toBe('Hide this word')
    // the control the product must show: the sender App was given is the reason it is there at all
    expect(await page.$eval('.learn-report .known-btn', (e) => e.textContent)).toBe('Report a problem with this word')
    expect(await page.evaluate(() => document.querySelector('.learn-known')!.nextElementSibling?.className)).toBe('learn-report') // and it sits right under it
    await press(page, '.learn-report .known-btn')
    await sendFromForm(page, 'The translation of this word is wrong.', fake)
    await page.waitForSelector('.learn-report .detail-note') // the line that says it went
    await page.waitForFunction(() => document.querySelectorAll('.learn-report').length === 1)
    expect(reports(fake)).toHaveLength(1)
    expect(reports(fake)[0]).toMatchObject({ user_id: 'user-1', kind: 'word', screen: 'learn', message: 'The translation of this word is wrong.', platform: 'android', ui_language: 'en' })
    expect(typeof reports(fake)[0].es_word).toBe('string')
    await page.close()
  }, 90_000)

  it('the word detail screen has "Report a problem with this word" too, and a report from it reaches the server as a word report from the detail screen', async () => {
    const { page, fake } = await open()
    await press(page, '.wotd .link-btn') // the word of the day's "See the card"
    await page.waitForSelector('.link-btn')
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.link-btn')).some((b) => b.textContent === 'Report a problem with this word'))
    await page.evaluate(() => (Array.from(document.querySelectorAll('.link-btn')).find((b) => b.textContent === 'Report a problem with this word') as HTMLElement).click())
    await sendFromForm(page, 'The example is odd.')
    expect(reports(fake)).toHaveLength(1)
    expect(reports(fake)[0]).toMatchObject({ user_id: 'user-1', kind: 'word', screen: 'word', message: 'The example is odd.' })
    await page.close()
  }, 90_000)
})
