import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer, { type Browser } from 'puppeteer-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * The favicon in a real browser, for both pages that carry it (the Mini App's index.html, and /privacy): the page's own <link rel="icon"> resolves to
 * an SVG that the server really serves, and drawn at the sizes of a browser tab (16 and 32 px) it is the teal square with the cream letter in it,
 * full to the corners. Needs a Chrome or Chromium; skipped without one (CHROME_PATH).
 */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p))

const TEAL = [0x0e, 0x7c, 0x78]

describe.skipIf(!CHROME)('the favicon in a browser', () => {
  let server: ViteDevServer
  let browser: Browser
  let base: string

  beforeAll(async () => {
    server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5243, strictPort: false } })
    await server.listen()
    base = server.resolvedUrls!.local[0].replace(/\/$/, '')
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  for (const [name, route] of [['the Mini App (index.html)', '/'], ['the privacy page', '/privacy']] as const) {
    it(`${name}: the page icon resolves to an SVG the server serves, and drawn at 16 and 32 px it is a teal square with the cream letter`, async () => {
      const page = await (await browser.createBrowserContext()).newPage()
      await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
      const result = await page.evaluate(async () => {
        const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null
        if (!link) return { error: 'no <link rel="icon">' }
        const response = await fetch(link.href)
        const type = response.headers.get('content-type')
        const blobUrl = URL.createObjectURL(new Blob([await response.text()], { type: 'image/svg+xml' }))
        const img = new Image()
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = blobUrl })
        const sample = (px: number) => {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = px
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0, px, px)
          const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data)
          const all = ctx.getImageData(0, 0, px, px).data
          let light = 0
          let red = 0
          for (let i = 0; i < all.length; i += 4) {
            if (all[i] > 100) light++ // visibly lighter than the teal field (its red is 14, the letter's 246)
            red += all[i]
          }
          return { corners: [at(0, 0), at(px - 1, 0), at(0, px - 1), at(px - 1, px - 1)], light: light / (px * px), meanRed: red / (px * px) }
        }
        return { href: new URL(link.href).pathname, status: response.status, type, s16: sample(16), s32: sample(32) }
      })
      expect(result).toMatchObject({ href: '/favicon.svg', status: 200 })
      expect((result as { type: string }).type).toContain('image/svg+xml')
      for (const key of ['s16', 's32'] as const) {
        const s = (result as unknown as Record<string, { corners: number[][]; light: number; meanRed: number }>)[key]
        for (const corner of s.corners) expect(corner, `${name} ${key}`).toEqual([...TEAL, 255]) // opaque, edge to edge: nothing rounded, nothing missing
        // the letter is there and at tab size it is the same amount of ink at 16 and 32 px (at 16 its thin strokes are soft, not gone)
        expect(s.light, `${name} ${key}: the letter is there`).toBeGreaterThan(0.14)
        expect(s.light, `${name} ${key}: and does not flood the square`).toBeLessThan(0.35)
        expect(s.meanRed, `${name} ${key}: ink`).toBeGreaterThan(40)
        expect(s.meanRed, `${name} ${key}: ink`).toBeLessThan(62)
      }
      await page.close()
    }, 60_000)
  }
})
