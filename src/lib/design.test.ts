import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/index.css', 'utf8')
const html = readFileSync('index.html', 'utf8')
const fonts = readFileSync('src/fonts.css', 'utf8')

/** The declarations of the rule that starts with `selector {`. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  if (start === -1) throw new Error(`no ${selector} rule`)
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

describe('fonts', () => {
  it('Fraunces and Manrope are served from the app\'s own domain (public/fonts), in the weights the app uses, with display=swap; the page preloads the main one and asks Google for nothing', () => {
    expect(html).not.toMatch(/googleapis|gstatic|preconnect/)
    expect(html).toContain('<link rel="preload" href="/fonts/manrope-latin-v23.woff2" as="font" type="font/woff2" crossorigin />')
    const faces = [...fonts.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1])
    expect(faces).toHaveLength(4)
    for (const face of faces) expect(face).toContain('font-display: swap')
    const has = (family: string, style: string, weights: string, file: string) =>
      faces.some((f) => f.includes(`font-family: '${family}'`) && f.includes(`font-style: ${style}`) && f.includes(`font-weight: ${weights}`) && f.includes(`url(/fonts/${file})`))
    expect(has('Manrope', 'normal', '400 800', 'manrope-latin-v23.woff2')).toBe(true)
    expect(has('Manrope', 'normal', '400 800', 'manrope-cyrillic-v23.woff2')).toBe(true)
    expect(has('Fraunces', 'normal', '400 700', 'fraunces-latin-v38.woff2')).toBe(true)
    expect(has('Fraunces', 'italic', '400 700', 'fraunces-latin-italic-v38.woff2')).toBe(true)
    for (const file of [...fonts.matchAll(/url\(\/fonts\/([^)]+)\)/g)].map((m) => m[1])) expect(existsSync(`public/fonts/${file}`), file).toBe(true)
    expect(readFileSync('src/main.tsx', 'utf8')).toContain("import './fonts.css'")
  })

  it('the font files are cached for a year, and each is under a name with its version in it, so a new version is a new name', () => {
    const rules = (JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] }).headers
    const rule = rules.find((r) => r.source === '/fonts/(.*)')!
    expect(rule.headers).toEqual([{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }])
    for (const file of readdirSync('public/fonts').filter((f) => f.endsWith('.woff2'))) expect(file, file).toMatch(/-v\d+\.woff2$/)
  })

  it('each family ships with its SIL Open Font License', () => {
    for (const name of ['Manrope', 'Fraunces']) expect(readFileSync(`public/fonts/${name}-OFL.txt`, 'utf8'), name).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })

  it('Manrope is the default face; Fraunces is set only on Spanish words', () => {
    expect(rule('body')).toMatch(/font-family: var\(--font-ui\)/)
    const selectors = [...css.matchAll(/([^{}]+)\{[^}]*font-family: var\(--font-display\)[^}]*\}/g)].map((m) => m[1].trim().replace(/\s+/g, ' '))
    expect(selectors.sort()).toEqual(['.brand', '.cz-input', '.cz-result-word', '.intro-es', '.match-tile.is-es', '.mode-sub', '.place-chip', '.tile-sub', '.wc-headword', '.wotd-word', '.word-row-alt', '.word-row-head'].sort())
  })

  it('Cyrillic is covered by the UI face (Manrope has it), so the Russian UI of the future needs no change', () => {
    expect(fonts).toMatch(/font-family: 'Manrope';[^}]*cyrillic-v23\.woff2\)[^}]*unicode-range: [^;]*U\+0400-045F/)
  })
})

describe('the type scale', () => {
  it.each([
    ['.wc-headword', ['font-size: 42px', 'font-weight: 600']],
    ['.wotd-word', ['font-size: 20px', 'font-weight: 600']],
    ['h1', ['font-size: 23px', 'font-weight: 600']],
    ['.tile-label', ['font-size: 16px', 'font-weight: 700']],
    ['.tile-sub', ['font-size: 12.5px', 'font-style: italic']],
    ['.tile-count', ['font-size: 19px', 'font-weight: 800']],
    ['.mode-label', ['font-size: 15px', 'font-weight: 700']],
    ['.mode-sub', ['font-size: 12.5px', 'font-style: italic']],
    ['.home-progress', ['font-size: 13px', 'font-weight: 600']],
    ['.wotd-label', ['font-size: 11px', 'font-weight: 700']],
    ['.wotd-translation', ['font-size: 14px']],
    ['.wc-sentence', ['font-size: 17px']],
    ['.wc-relation', ['font-size: 13.5px']],
    ['.rate-interval', ['font-size: 10px']],
    ['.cz-input', ['font-size: 20px']],
    ['.cz-sentence', ['font-size: 19px']],
    ['.home-status', ['font-size: 13px', 'font-weight: 600']],
  ])('%s', (selector, expected) => {
    for (const declaration of expected) expect(rule(selector), `${selector} ${declaration}`).toContain(declaration)
  })

  it('body text is 16px with 1.55 line height', () => {
    expect(css).toMatch(/:root \{\s*font: 16px\/1\.55 var\(--font-ui\);/)
  })
})

describe('shapes', () => {
  it.each([
    ['.wotd', 'var(--radius-card)'],
    ['.cz-card', 'var(--radius-card)'],
    ['.word-card', 'var(--radius-card-lg)'],
    ['.tile', 'var(--radius-tile)'],
    ['.mode', 'var(--radius-tile)'],
    ['.home-panel', 'var(--radius-card)'],
    ['.btn', 'var(--radius-button)'],
    ['.rate-btn', 'var(--radius-button)'],
    ['.wc-note', 'var(--radius-small)'],
  ])('%s uses %s', (selector, radius) => {
    expect(rule(selector)).toContain(`border-radius: ${radius}`)
  })

  it('the "Add" button in the Words header is as tall as the round icon buttons (38px), on the surface colour with a 1px border and the button radius, its text 14px bold in the text colour, never wrapping', () => {
    const r = rule('.add-btn')
    for (const d of ['height: 38px', 'border: 1px solid var(--border)', 'border-radius: var(--radius-button)', 'background: var(--surface)', 'color: var(--text)', 'font-size: 14px', 'font-weight: 700', 'white-space: nowrap']) expect(r).toContain(d)
  })

  it('the theme button is a 38px round with a 1px border on the surface colour and a muted icon', () => {
    const r = rule('.icon-btn')
    for (const d of ['width: 38px', 'height: 38px', 'border: 1px solid var(--border)', 'border-radius: 50%', 'background: var(--surface)', 'color: var(--muted)']) expect(r).toContain(d)
  })
})


describe('wrapping and focus (the polish pass)', () => {
  it('paragraphs avoid a lone last word (pretty), and short blocks are balanced: titles, advice, tile reasons, labels, hints and notes', () => {
    expect(rule('body')).toMatch(/text-wrap: pretty/)
    const balanced = css.match(/([^{}]+)\{\s*text-wrap: balance;\s*\}/)![1].split('*/').pop()!.split(',').map((s) => s.trim())
    for (const selector of ['h1', 'h2', 'h3', '.subtitle', '.home-advice', '.tile-text', '.mode', '.setting-label', '.setting-hint', '.words-note', '.post-batch-why', '.intro-note', '.intro-text', '.intro-line', '.wc-translation', '.wc-row-text', '.learn-undo span', '.wc-shift', '.cz-sentence', '.cz-feedback', '.match-hint', '.cz-instruction']) expect(balanced, selector).toContain(selector)
  })

  it('the intro list puts the name above its line, so a long name no longer squeezes the text into a narrow column', () => {
    expect(rule('.intro-list li')).toMatch(/flex-direction: column/)
    expect(rule('.intro-list li')).not.toMatch(/align-items: baseline/)
  })

  it('the Cloze answer wears the practice colour when focused, the search clear is the app\'s own shape, and the spent Hint/Reveal row keeps its place', () => {
    expect(rule('.cz-input:focus-visible')).toMatch(/outline: 2px solid var\(--lav\)/)
    expect(rule('.words-search::-webkit-search-cancel-button')).toMatch(/-webkit-appearance: none/)
    expect(rule('.words-search::-webkit-search-cancel-button')).toMatch(/background-color: var\(--muted\)/)
    expect(rule('.cz-secondary.is-spent')).toMatch(/visibility: hidden/) // hidden, not display: none: Continue stays where Check was
  })

  it('a segment of the word list is a column: the label, and the count on its own line under it, whatever the width', () => {
    expect(rule('.segment')).toMatch(/display: flex/)
    expect(rule('.segment')).toMatch(/flex-direction: column/)
  })

  it('the learning-queue star on a list row is the only control beside the text: a 44 x 44 tap target that never shrinks, grey until it is on and then teal, with a visible focus ring; the queue control is gone', () => {
    const star = rule('.word-row-star')
    expect(star).toMatch(/flex: none/)
    expect(star).toMatch(/width: 44px/)
    expect(star).toMatch(/height: 44px/)
    expect(star).toMatch(/color: var\(--muted-2\)/)
    expect(rule('.word-row-star.is-on')).toMatch(/color: var\(--teal\)/)
    expect(css).toMatch(/\.word-row-star:focus-visible/)
    expect(css).not.toMatch(/word-row-queue|queue-glyph/)
  })

  it('the Cloze instruction is set like the Matching one', () => {
    expect(css).toMatch(/\.match-hint,\s*\.cz-instruction \{/)
  })
})
