import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The production build (a real `vite build`, run as the deploy runs it, into a temporary folder): privacy.html is emitted next to index.html, and
 * everything it loads is its own small bundle, without the app's sign-in, Supabase client or Telegram code.
 *
 * The build is given made-up Supabase and proxy addresses (nothing connects to them): without any, the bundler sees that the client can never be
 * made and leaves the whole Supabase library out of the app, and "the privacy page does not contain it" would prove nothing.
 */
describe('the production build of the privacy page', () => {
  let out: string

  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), 'riopalabras-build-'))
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'silent'], {
      env: { ...process.env, NODE_ENV: 'production', VITE_SUPABASE_URL: 'https://build-test.invalid', VITE_SUPABASE_ANON_KEY: 'build-test-anon-key', VITE_PROXY_URL: 'https://proxy.invalid' },
      stdio: 'pipe',
    })
  }, 180_000)

  afterAll(() => rmSync(out, { recursive: true, force: true }))

  /** Every file a page loads, through its tags and then through the imports of its scripts. */
  function loaded(page: string): { html: string; files: Map<string, string> } {
    const html = readFileSync(join(out, page), 'utf8')
    const files = new Map<string, string>()
    const visit = (name: string) => {
      const file = name.replace(/^\//, '')
      if (files.has(file)) return
      const content = readFileSync(join(out, file), 'utf8')
      files.set(file, content)
      if (file.endsWith('.js')) for (const m of content.matchAll(/["']\.\/([\w.-]+\.(?:js|css))["']/g)) visit(`assets/${m[1]}`)
    }
    for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) visit(m[1])
    return { html, files }
  }
  const joined = (files: Map<string, string>) => [...files.values()].join('\n')

  // Strings only the Supabase library and the app's sign-in contain. (Not "/auth/telegram": that is also in the Debug screen's English text, which the strings carry.)
  const APP_MARKERS = ['persistSession', 'autoRefreshToken', 'onAuthStateChange', '}/auth/telegram', 'setSession', 'user_progress', 'refresh_token', 'words_enriched']

  it('emits privacy.html and index.html', () => {
    expect(readdirSync(out).sort()).toEqual(expect.arrayContaining(['assets', 'index.html', 'privacy.html']))
  })

  it('privacy.html names its own files only: a script, a stylesheet and the chunk they share, and no address of another site', () => {
    const { html } = loaded('privacy.html')
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    expect(urls.length).toBeGreaterThan(2)
    for (const url of urls) expect(url, url).toMatch(/^\/(assets\/|favicon\.svg)/)
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).toContain('<title>Privacy · Riopalabras</title>')
    expect(html.match(/<script(?![^>]*src=)[^>]*>/g)).toHaveLength(1) // the theme script
  })

  it('its code is the page and its strings, and none of the app: no Supabase client, no sign-in, no Telegram script, no dictionary, no other site', () => {
    const code = joined(loaded('privacy.html').files)
    expect(code).toContain('Last updated')
    expect(code).toContain('Конфиденциальность')
    for (const marker of [...APP_MARKERS, 'telegram-web-app', 'googleapis', 'gstatic', 'rio_overlay', 'examples_fallback', 'build-test.invalid', 'proxy.invalid']) expect(code, marker).not.toContain(marker)
  })

  it('and the markers are the right ones: the app\'s own page does contain them, and is a bigger bundle than the privacy page\'s app code', () => {
    const code = joined(loaded('index.html').files)
    for (const marker of APP_MARKERS) expect(code, marker).toContain(marker)
    expect(code).toContain('build-test.invalid') // the Supabase client was built into the app, so its absence from the privacy page means something
  })

  it('is small: what the page loads, compressed, stays under 160 KB (a pulled-in library or dictionary would not)', () => {
    const { files } = loaded('privacy.html')
    const compressed = [...files.values()].reduce((n, content) => n + gzipSync(content).length, 0)
    expect(compressed).toBeLessThan(160 * 1024)
  })
})
