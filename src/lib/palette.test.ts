import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrast } from './contrast'

const tokens = readFileSync('src/tokens.css', 'utf8')

/** The custom properties declared in the block that starts with `selector {`. */
function block(selector: string): string {
  const start = tokens.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`no ${selector} block in tokens.css`)
  return tokens.slice(tokens.indexOf('{', start) + 1, tokens.indexOf('}', start))
}

function declared(selector: string): Record<string, string> {
  return Object.fromEntries([...block(selector).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

const lightRaw = declared(':root[data-theme=\'light\']')
const darkRaw = declared(':root[data-theme=\'dark\']')

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** Every token as a solid #rrggbb: an rgba() token (the dark highlight) is composited over the surface it sits on. */
function solid(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw)) {
    const m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(value)
    if (m) {
      const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
      const base = rgb(raw['--surface'])
      out[name] = toHex([r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)])
    } else {
      out[name] = value
    }
  }
  return out
}

const light = solid(lightRaw)
const dark = solid(darkRaw)
const themes = { light, dark } as const

// [foreground, background, minimum ratio, what it is]
const TEXT = 4.5
const PAIRS: [string, string, number, string][] = [
  // body text
  ['--text', '--page', TEXT, 'body text on the page'],
  ['--text', '--surface', TEXT, 'text on cards'],
  ['--text', '--surface-2', TEXT, 'text in the note box'],
  ['--text-2', '--surface', TEXT, 'sentences and secondary text on cards'],
  ['--text-2', '--page', TEXT, 'secondary text on the page'],
  ['--muted', '--page', TEXT, 'status row, hints and captions on the page'],
  ['--muted', '--surface', TEXT, 'translations, the standard-word line, register labels on cards'],
  ['--muted', '--surface-2', TEXT, 'muted text in the note box and on disabled tiles'],
  // teal: the learning path
  ['--teal-ink', '--teal', TEXT, 'Learn tile, Easy rating, primary buttons, progress labels'],
  ['--teal', '--page', TEXT, 'teal links on the page'],
  ['--teal', '--surface', TEXT, 'the "See the card" link and teal links on cards'],
  ['--teal-on-soft', '--teal-soft', TEXT, 'Review tile label, Good rating, rioplatense pill'],
  ['--teal-on-soft-2', '--teal-soft', TEXT, 'Review tile Spanish word, pill text'],
  // lavender: practice
  ['--lav-ink', '--lav', TEXT, 'Continue and Check buttons in Cloze'],
  ['--lav', '--surface', TEXT, 'lavender text on cards (Cloze hint)'],
  ['--lav-on-soft', '--lav-soft', TEXT, 'Matching and Cloze tile labels'],
  ['--lav-on-soft-2', '--lav-soft', TEXT, 'Matching and Cloze tile Spanish words, the word-of-the-day pill'],
  // amber: the target word (and the Hard rating)
  ['--hl-text', '--hl-bg', TEXT, 'the highlighted word in a sentence, the Hard rating'],
  // feedback
  ['--ok', '--surface', TEXT, 'correct text on cards'],
  ['--ok', '--ok-bg', TEXT, 'correct text in the feedback block'],
  ['--ok-text', '--ok-bg', TEXT, 'feedback text on the correct block'],
  ['--text', '--ok-bg', TEXT, 'text on a matched tile'],
  ['--bad', '--surface', TEXT, 'wrong / error text on cards'],
  ['--bad', '--page', TEXT, 'wrong / error text on the page'],
  ['--bad', '--bad-bg', TEXT, 'wrong text in the feedback block, the Again rating, the unsaved banner'],
  ['--text', '--bad-bg', TEXT, 'text on the unsaved banner and on a wrong tile'],
  // non-text parts that identify a control: 3:1
  ['--lav', '--surface', 3, 'the Cloze answer input border and the outlined buttons'],
  ['--lav', '--lav-soft', 3, 'the selected-tile border on a lavender tile'],
  ['--teal', '--teal-soft', 3, 'teal icons on the Review tile'],
  ['--teal', '--surface', 3, 'the progress bar fill and active streak dots'],
  ['--bad', '--bad-bg', 3, 'the wrong-tile border'],
  ['--muted', '--surface', 3, 'the theme button icon'],
  ['--muted-2', '--surface', 3, 'decorative marks on cards (muted-2 is never text and never on the page)'],
]

// Hairlines (card borders, dividers) are decoration, not the way a control is found, so they are
// exempt from 3:1; they only have to be visible at all.
const HAIRLINES: [string, string][] = [
  ['--border', '--page'],
  ['--border', '--surface'],
  ['--border-soft', '--surface'],
  ['--teal-soft-border', '--teal-soft'],
  ['--lav-soft-border', '--lav-soft'],
  ['--ok-border', '--ok-bg'],
  ['--bad-border', '--bad-bg'],
]

describe('both palettes are complete', () => {
  it('declare the same custom properties', () => {
    expect(Object.keys(lightRaw).sort()).toEqual(Object.keys(darkRaw).sort())
  })

  it('declare the whole token set of the design', () => {
    const required = [
      '--page', '--surface', '--surface-2', '--border', '--border-soft',
      '--text', '--text-2', '--muted', '--muted-2',
      '--teal', '--teal-ink', '--teal-soft', '--teal-soft-border', '--teal-on-soft', '--teal-on-soft-2',
      '--lav', '--lav-ink', '--lav-soft', '--lav-soft-border', '--lav-on-soft', '--lav-on-soft-2',
      '--hl-bg', '--hl-text',
      '--ok', '--ok-bg', '--ok-border', '--ok-text',
      '--bad', '--bad-bg', '--bad-border',
    ]
    for (const name of required) {
      expect(lightRaw[name], `light ${name}`).toBeDefined()
      expect(darkRaw[name], `dark ${name}`).toBeDefined()
    }
  })

  it('uses the design values (spot checks)', () => {
    expect(lightRaw['--page']).toBe('#f6f4f0')
    expect(lightRaw['--teal']).toBe('#0e7c78')
    expect(lightRaw['--lav']).toBe('#6150a8')
    expect(lightRaw['--hl-bg']).toBe('#fbebc2')
    expect(darkRaw['--page']).toBe('#0e1618')
    expect(darkRaw['--teal']).toBe('#2fa39b')
    expect(darkRaw['--hl-bg']).toBe('rgba(240, 206, 126, 0.17)')
  })

  it('warm neutrals: never pure white or pure black as a page or text colour', () => {
    for (const p of [light, dark]) {
      for (const name of ['--page', '--surface-2', '--text', '--text-2']) expect(['#ffffff', '#000000']).not.toContain(p[name])
    }
    expect(light['--page']).not.toBe('#ffffff') // the white is reserved for cards
  })

  it('shape and spacing tokens are set', () => {
    for (const [name, value] of Object.entries({ '--radius-card': '22px', '--radius-tile': '20px', '--radius-button': '16px', '--radius-small': '14px', '--radius-pill': '6px', '--page-pad': '20px', '--block-gap': '16px' })) {
      expect(tokens).toContain(`${name}: ${value};`)
    }
  })
})

describe.each(Object.entries(themes))('%s palette contrast', (_name, p) => {
  it.each(PAIRS)('%s on %s is at least %s:1 (%s)', (fg, bg, min) => {
    expect(contrast(p[fg], p[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min)
  })

  it.each(HAIRLINES)('hairline %s is visible against %s', (line, bg) => {
    expect(contrast(p[line], p[bg]), `${line} on ${bg}`).toBeGreaterThanOrEqual(1.05)
  })
})

describe('no colour is written down outside tokens.css', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sourceFiles(path)
      return /\.(css|ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'tokens.css' ? [path] : []
    })
  }
  const files = sourceFiles('src')

  it('no hex colour in any stylesheet, component or module', () => {
    const offenders = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => `${f}: ${m[0]}`))
    expect(offenders).toEqual([])
  })

  it('no rgb()/rgba()/hsl() colour literal outside tokens.css either', () => {
    const offenders = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\b(?:rgba?|hsla?)\(/g)].map((m) => `${f}: ${m[0]}`))
    expect(offenders).toEqual([])
  })

  it('nothing reads Telegram\'s colours any more (no --tg-* variables)', () => {
    const offenders = files.filter((f) => /--tg-/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('index.css pulls the tokens in, so there is one source for them', () => {
    expect(readFileSync('src/index.css', 'utf8')).toMatch(/@import\s+['"]\.\/tokens\.css['"]/)
  })
})
