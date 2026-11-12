import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { languageFromCode, parseUiLanguage } from './language'

const html = readFileSync('index.html', 'utf8')
const script = /<!-- theme-bootstrap[^>]*-->\s*<script>([\s\S]*?)<\/script>/.exec(html)![1]
const CYRILLIC = '/fonts/manrope-cyrillic-v23.woff2'

type Link = Record<string, string>

/** Runs index.html's boot script in a page that has what it reads, and returns the <link> elements it added and the theme it set. */
function boot(options: { stored?: string | null; storageThrows?: boolean; telegram?: unknown; noHead?: boolean }) {
  const added: Link[] = []
  let theme: string | null = null
  const document = {
    documentElement: { setAttribute: (_name: string, value: string) => (theme = value) },
    createElement: () => ({}) as Link,
    head: options.noHead ? undefined : { appendChild: (link: Link) => added.push({ ...link }) },
  }
  const localStorage = {
    getItem: (key: string) => {
      if (options.storageThrows) throw new Error('blocked')
      return key === 'riopalabras.language.v1' ? (options.stored ?? null) : null
    },
  }
  new Function('localStorage', 'window', 'document', script)(localStorage, { Telegram: options.telegram === undefined ? undefined : { WebApp: options.telegram }, matchMedia: () => ({ matches: false }) }, document)
  return { added, theme }
}
const telegramSaying = (code: unknown) => ({ initData: 'x', colorScheme: 'light', initDataUnsafe: { user: { id: 1, language_code: code } } })

describe('index.html preloads the Russian face for Russian, and only then', () => {
  it('the latin face is preloaded for everyone, in the page itself', () => {
    expect(html).toContain('<link rel="preload" href="/fonts/manrope-latin-v23.woff2" as="font" type="font/woff2" crossorigin />')
    expect(html).not.toContain('<link rel="preload" href="/fonts/manrope-cyrillic') // not in the markup: the boot script decides
  })

  it('adds the cyrillic preload exactly when the app will start in Russian: the stored language, else Telegram\'s, as effectiveLanguage decides', () => {
    for (const stored of [null, 'en', 'ru', 'de', '']) {
      for (const tg of [undefined, null, { initData: '' }, telegramSaying('ru'), telegramSaying('ru-RU'), telegramSaying('RU'), telegramSaying('en'), telegramSaying('uk'), telegramSaying(undefined), telegramSaying(7)] as const) {
        const code = tg && typeof tg === 'object' && 'initDataUnsafe' in tg ? (tg.initDataUnsafe.user.language_code as unknown) : undefined
        const startsIn = parseUiLanguage(stored) ?? languageFromCode(typeof code === 'string' ? code : undefined)
        const { added } = boot({ stored, telegram: tg ?? undefined })
        expect(added.length, `stored ${JSON.stringify(stored)}, Telegram ${JSON.stringify(tg)}`).toBe(startsIn === 'ru' ? 1 : 0)
      }
    }
  })

  it('the link is the one the @font-face rule fetches, in the mode the browser fetches it, so the file is fetched once', () => {
    const [link] = boot({ stored: 'ru' }).added
    expect(link).toMatchObject({ rel: 'preload', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous', href: CYRILLIC })
    const rule = /@font-face \{[^}]*cyrillic-v23\.woff2[^}]*\}/.exec(readFileSync('src/fonts.css', 'utf8'))![0]
    expect(rule).toContain(`url(${CYRILLIC})`)
    expect(existsSync(`public${CYRILLIC}`)).toBe(true)
    expect(html).toContain('<link rel="preload" href="/fonts/manrope-latin-v23.woff2" as="font" type="font/woff2" crossorigin />') // the same attributes, written in markup
  })

  it('blocked storage falls back to Telegram, as the app does; and a page the script cannot add to still gets its theme', () => {
    expect(boot({ storageThrows: true, telegram: telegramSaying('ru') }).added).toHaveLength(1)
    expect(boot({ storageThrows: true }).added).toHaveLength(0)
    expect(boot({ stored: 'ru', noHead: true })).toMatchObject({ added: [], theme: 'light' })
  })
})
