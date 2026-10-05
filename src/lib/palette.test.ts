import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrast } from './contrast'
import { PALETTE_BG } from './theme'

const css = readFileSync('src/index.css', 'utf8')

/** The custom properties declared in the block that starts with `selector {`. */
function palette(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no ${selector} block in index.css`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]))
}

const light = palette(":root[data-theme='light']")
const dark = palette(":root[data-theme='dark']")
const themes = { light, dark } as const

// [foreground, background, minimum ratio, what it is]
const PAIRS: [string, string, number, string][] = [
  ['--tg-text-color', '--tg-bg-color', 4.5, 'body text on the page'],
  ['--tg-text-color', '--tg-secondary-bg-color', 4.5, 'text on cards'],
  ['--tg-hint-color', '--tg-bg-color', 4.5, 'hint text on the page (region / register labels, stat labels)'],
  ['--tg-hint-color', '--tg-secondary-bg-color', 4.5, 'hint text on cards (region / register labels, disabled tile reasons)'],
  ['--tg-link-color', '--tg-bg-color', 4.5, 'links and the back link'],
  ['--tg-link-color', '--tg-secondary-bg-color', 4.5, 'links on cards (the Cloze hint)'],
  ['--tg-button-text-color', '--tg-button-color', 4.5, 'primary buttons and the Learn tile'],
  ['--ok', '--tg-bg-color', 4.5, 'Cloze "correct" text on the page'],
  ['--ok', '--tg-secondary-bg-color', 4.5, 'Cloze "correct" text on the card'],
  ['--bad', '--tg-bg-color', 4.5, 'errors and Cloze "wrong" text on the page'],
  ['--bad', '--tg-secondary-bg-color', 4.5, 'Cloze "wrong" text on the card'],
  ['--warn', '--tg-bg-color', 4.5, 'warnings'],
  ['--tg-text-color', '--ok-bg', 4.5, 'text on a matched tile'],
  ['--ok', '--ok-bg', 4.5, 'coloured text on the matched tile'],
  ['--tg-text-color', '--bad-bg', 4.5, 'text on the unsaved banner and on a wrong tile'],
  ['--bad', '--bad-bg', 4.5, 'coloured text on the banner'],
  ['--mark-fg', '--mark-bg', 4.5, 'the highlighted word in a sentence'],
  ['--tg-text-color', '--select-bg', 4.5, 'text on a selected tile'],
  ['--tg-text-color', '--notice-bg', 4.5, 'text in the notices'],
  ['--tg-hint-color', '--notice-bg', 4.5, 'hint text in the notices'],
  ['--rate-text', '--rate-again', 4.5, 'rating button: Again'],
  ['--rate-text', '--rate-hard', 4.5, 'rating button: Hard'],
  ['--rate-text', '--rate-good', 4.5, 'rating button: Good'],
  ['--rate-text', '--rate-easy', 4.5, 'rating button: Easy'],
  ['--badge-mock-fg', '--badge-mock-bg', 4.5, 'the mock-data badge'],
  ['--badge-live-fg', '--badge-live-bg', 4.5, 'the live-data badge'],
  // non-text: borders and highlights that carry meaning need 3:1 against what they sit on
  ['--tg-button-color', '--tg-secondary-bg-color', 3, 'the selected-tile border on a card'],
  ['--bad', '--tg-secondary-bg-color', 3, 'the wrong-tile border on a card'],
]

describe('both palettes are complete', () => {
  it('declare the same custom properties, all as solid #rrggbb colours', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort())
    for (const name of ['--tg-bg-color', '--tg-text-color', '--tg-hint-color', '--tg-link-color', '--tg-button-color', '--tg-button-text-color', '--tg-secondary-bg-color', '--ok', '--bad', '--mark-bg', '--notice-bg', '--rate-again']) {
      expect(light[name], name).toBeDefined()
    }
  })

  it('the light palette is designed, not the dark one inverted: the semantic colours differ in kind (dark text on light tints; light text on dark tints)', () => {
    const lum = (hex: string) => contrast(hex, '#000000')
    expect(lum(light['--tg-bg-color'])).toBeGreaterThan(lum(light['--tg-text-color']))
    expect(lum(dark['--tg-bg-color'])).toBeLessThan(lum(dark['--tg-text-color']))
    expect(lum(light['--ok-bg'])).toBeGreaterThan(lum(light['--ok']))
    expect(lum(dark['--ok-bg'])).toBeLessThan(lum(dark['--ok']))
    expect(light['--ok']).not.toBe(dark['--ok'])
    expect(light['--mark-bg']).not.toBe(dark['--mark-bg'])
  })

  it("the page colour Telegram's header is set to equals --tg-bg-color in each palette", () => {
    expect(PALETTE_BG.light).toBe(light['--tg-bg-color'])
    expect(PALETTE_BG.dark).toBe(dark['--tg-bg-color'])
  })
})

describe.each(Object.entries(themes))('%s palette contrast', (_name, p) => {
  it.each(PAIRS)('%s on %s is at least %s:1 (%s)', (fg, bg, min) => {
    expect(contrast(p[fg], p[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min)
  })
})

describe("the semantic colours stay readable on Telegram's own page colours", () => {
  // Inside Telegram the page and card colours are the client's. These are common ones; the semantic
  // text colours (ok / bad / warn) are chosen per scheme, so they must hold on every page of that scheme.
  const telegramLight = ['#ffffff', '#f0f0f0', '#f1f1f1', '#efeff4', '#f4f4f5']
  const telegramDark = ['#212121', '#181818', '#282e33', '#17212b', '#232e3c', '#0f0f0f', '#1c1c1d', '#2c2c2e']
  it.each([
    ['light', light, telegramLight],
    ['dark', dark, telegramDark],
  ] as const)('%s', (_n, p, backgrounds) => {
    for (const bg of backgrounds) {
      for (const fg of ['--ok', '--bad', '--warn']) expect(contrast(p[fg], bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('the stylesheet uses the palette, not stray colours', () => {
  it('has no hard-coded hex colours outside the two palette blocks (and the unchanged rating/badge text)', () => {
    const withoutPalettes = css.replace(/:root,\s*:root\[data-theme='light'\] \{[^}]*\}/, '').replace(/:root\[data-theme='dark'\] \{[^}]*\}/, '')
    const stray = [...withoutPalettes.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
    expect(stray).toEqual([])
  })
})
