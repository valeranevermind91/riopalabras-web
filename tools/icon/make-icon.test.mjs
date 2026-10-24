import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SIZE, buildFaviconSvg, glyphOutline, readTokens } from './make-icon.mjs'

// The icon and its source: public/favicon.svg is exactly what tools/icon/make-icon.mjs makes from the font and the tokens, it is small, plain and
// in the app's colours, and both pages point at it. (That it draws right in a browser is src/lib/favicon.browser.test.ts.)

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')
const favicon = read('public', 'favicon.svg')

describe('public/favicon.svg', () => {
  it('is exactly what the generator makes from the font and the tokens: the icon and its source cannot drift (run: node tools/icon/make-icon.mjs)', () => {
    expect(favicon).toBe(buildFaviconSvg())
  })

  it('is a square, drawn in the app\'s two colours only, the teal field and the cream letter, both read from src/tokens.css', () => {
    const { teal, page } = readTokens()
    expect(teal).toBe('#0e7c78')
    expect(page).toBe('#f6f4f0')
    expect(favicon).toContain(`viewBox="0 0 ${SIZE} ${SIZE}"`)
    expect([...favicon.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])).toEqual([teal, page])
    expect(favicon).toMatch(/<rect width="512" height="512" fill="#0e7c78"\/>/) // a full-bleed field: no rounded corners (rx), no shadow
    expect(favicon).not.toMatch(/\brx=|\bry=|filter|opacity|gradient|stroke/)
  })

  it('is small and needs nothing else: the letter is an outline, there is no text, no font, no image, no script, no embedded data', () => {
    expect(Buffer.byteLength(favicon)).toBeLessThan(3000)
    expect(favicon).not.toMatch(/<text|font-face|font-family|base64|data:|<image|<script|<style|href=/i)
    expect(favicon.match(/<path /g)).toHaveLength(1)
  })

  it('is neither of the stock icons it replaced: not the Vite bolt (#863bff), and nothing of Flutter\'s blue', () => {
    expect(favicon).not.toMatch(/863bff|ede6ff|47bfff|54c5f8|0175c2|02569b/i)
  })
})

describe('the outline reader', () => {
  const font = fs.readFileSync(path.join(ROOT, 'tools', 'icon', 'fraunces-latin-600-normal.woff2'))

  it('reads the glyphs it is asked for: R has two contours (the letter and the hole in its bowl), I one, O two', () => {
    expect(glyphOutline(font, 'R').contours).toHaveLength(2)
    expect(glyphOutline(font, 'I').contours).toHaveLength(1)
    expect(glyphOutline(font, 'O').contours).toHaveLength(2)
    expect(glyphOutline(font, 'R').unitsPerEm).toBeGreaterThan(0)
  })

  it('an R is taller than wide and has points on its curves', () => {
    const on = glyphOutline(font, 'R').contours.flat().filter((p) => p.on)
    const xs = on.map((p) => p.x), ys = on.map((p) => p.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(Math.max(...xs) - Math.min(...xs))
    expect(glyphOutline(font, 'R').contours.flat().some((p) => !p.on)).toBe(true)
  })

  it('the letter fills the fraction of the square it is meant to, and is centred (so it also fits a circular crop)', () => {
    const numbers = [...favicon.match(/ d="([^"]+)"/)[1].matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]))
    const xs = numbers.filter((_, i) => i % 2 === 0), ys = numbers.filter((_, i) => i % 2 === 1)
    const [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
    expect(h / SIZE).toBeGreaterThan(0.55)
    expect(h / SIZE).toBeLessThan(0.6)
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(SIZE / 2, 0)
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(SIZE / 2, 0)
    expect(Math.hypot(w / 2, h / 2)).toBeLessThan(SIZE / 2) // the farthest corner of the letter's box is inside the inscribed circle
  })
})

describe('where the icon is used', () => {
  it('index.html and privacy.html each point at /favicon.svg, once, as the page icon, and the file is there', () => {
    for (const page of ['index.html', 'privacy.html']) {
      const links = read(page).match(/<link[^>]*rel="icon"[^>]*>/g) ?? []
      expect(links, page).toEqual(['<link rel="icon" type="image/svg+xml" href="/favicon.svg" />'])
    }
    expect(fs.existsSync(path.join(ROOT, 'public', 'favicon.svg'))).toBe(true)
  })

  it('public/ holds only what the app uses: no leftover sprite, no stock logo', () => {
    expect(fs.readdirSync(path.join(ROOT, 'public')).sort()).toEqual(['examples_fallback.json', 'favicon.svg', 'rio_overlay.json', 'words_enriched.json'])
  })

  it('nothing refers to the removed Vite sprite (icons.svg) or to the Vite or React template logos', () => {
    const files = ['index.html', 'privacy.html', 'vite.config.ts', 'vercel.json', 'README.md']
    const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    for (const f of [...files, ...walk('src').filter((f) => !/\.test\.[tj]sx?$|\.test\.mjs$/.test(f))]) {
      expect(read(f), f).not.toMatch(/icons\.svg|vite\.svg|react\.svg/)
    }
  })
})
