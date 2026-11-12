import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'fonts', 'fonts.css'), 'utf8')
const root = join(here, '..', '..')

/**
 * The browser tests measure layouts (what fits in 320px, how many lines a hint takes) in the app's real faces, from files in the repo, never from Google Fonts
 * and never from whatever system face the machine falls back to: a fallback face made the Words placeholder test pass while the real Manrope cut the same
 * placeholder off, and a macOS update then moved the numbers under a green test.
 */
describe('the fonts the browser tests load', () => {
  it('every font file fonts.css names is in the folder, and every family index.html asks Google Fonts for is covered', () => {
    const files = [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map((m) => m[1])
    expect(files.length).toBeGreaterThanOrEqual(4)
    for (const file of files) expect(existsSync(join(here, 'fonts', file)), file).toBe(true)
    const asked = [...readFileSync(join(root, 'index.html'), 'utf8').matchAll(/family=([A-Za-z]+)/g)].map((m) => m[1]).sort()
    const served = [...new Set([...css.matchAll(/font-family: '([^']+)'/g)].map((m) => m[1]))].sort()
    expect(served).toEqual(asked)
  })

  it('every harness page loads them, and preloads each file, so a test never starts before the faces are there', () => {
    const pages = readdirSync(here).filter((f) => f.endsWith('.html'))
    expect(pages.length).toBeGreaterThanOrEqual(8)
    for (const page of pages) {
      const html = readFileSync(join(here, page), 'utf8')
      expect(html, page).toContain('<link rel="stylesheet" href="/src/testing/fonts/fonts.css" />')
      for (const file of [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map((m) => m[1])) expect(html, `${page} preloads ${file}`).toContain(`href="/src/testing/fonts/${file}" as="font"`)
    }
  })

  it('the production page still loads them from Google Fonts, which the privacy page names (this folder is for the tests only)', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8')
    expect(html).toContain('https://fonts.googleapis.com/css2?family=Fraunces')
    expect(html).not.toContain('src/testing')
  })
})
