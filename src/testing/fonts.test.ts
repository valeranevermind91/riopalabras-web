import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const files = [...readFileSync(join(root, 'src', 'fonts.css'), 'utf8').matchAll(/url\(\/fonts\/([^)]+)\)/g)].map((m) => m[1])

/**
 * The browser tests measure layouts (what fits in 320px, how many lines a hint takes) in the app's real faces, the very files and @font-face rules production
 * uses (src/fonts.css, public/fonts), never in whatever system face the machine falls back to: a fallback face made the Words placeholder test pass while
 * the real Manrope cut the same placeholder off, and a macOS update then moved the numbers under a green test.
 */
describe('the fonts the browser tests load', () => {
  it('every harness page loads the app\'s font rules and preloads each file, so a test never starts before the faces are there', () => {
    expect(files.length).toBe(4)
    for (const file of files) expect(existsSync(join(root, 'public', 'fonts', file)), file).toBe(true)
    const pages = readdirSync(here).filter((f) => f.endsWith('.html'))
    expect(pages.length).toBeGreaterThanOrEqual(8)
    for (const page of pages) {
      const html = readFileSync(join(here, page), 'utf8')
      expect(html, page).toContain('<link rel="stylesheet" href="/src/fonts.css" />')
      for (const file of files) expect(html, `${page} preloads ${file}`).toContain(`href="/fonts/${file}" as="font"`)
    }
  })

  it('the harness pages load nothing from another site, fonts included', () => {
    for (const page of readdirSync(here).filter((f) => f.endsWith('.html'))) expect(readFileSync(join(here, page), 'utf8'), page).not.toMatch(/https?:\/\//)
  })
})
