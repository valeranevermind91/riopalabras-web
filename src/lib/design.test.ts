import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/index.css', 'utf8')
const html = readFileSync('index.html', 'utf8')

/** The declarations of the rule that starts with `selector {`. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  if (start === -1) throw new Error(`no ${selector} rule`)
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

describe('fonts', () => {
  it('Fraunces and Manrope are loaded from Google Fonts with preconnect and display=swap', () => {
    expect(html).toContain('<link rel="preconnect" href="https://fonts.googleapis.com" />')
    expect(html).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />')
    expect(html).toContain('family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700')
    expect(html).toContain('family=Manrope:wght@400..800')
    expect(html).toContain('display=swap')
  })

  it('Manrope is the default face; Fraunces is set only on Spanish words', () => {
    expect(rule('body')).toMatch(/font-family: var\(--font-ui\)/)
    const selectors = [...css.matchAll(/([^{}]+)\{[^}]*font-family: var\(--font-display\)[^}]*\}/g)].map((m) => m[1].trim().replace(/\s+/g, ' '))
    expect(selectors.sort()).toEqual(['.brand', '.cz-input', '.cz-result-word', '.intro-es', '.match-tile.is-es', '.place-chip', '.tile-sub', '.wc-headword', '.wotd-word', '.word-row-alt', '.word-row-head'].sort())
  })

  it('Cyrillic is covered by the UI face (Manrope has it), so the Russian UI of the future needs no change', () => {
    expect(html).toContain('Manrope')
  })
})

describe('the type scale', () => {
  it.each([
    ['.wc-headword', ['font-size: 42px', 'font-weight: 600']],
    ['.wotd-word', ['font-size: 34px', 'font-weight: 600']],
    ['h1', ['font-size: 23px', 'font-weight: 600']],
    ['.tile-label', ['font-size: 16px', 'font-weight: 700']],
    ['.tile-sub', ['font-size: 12.5px', 'font-style: italic']],
    ['.tile-count', ['font-size: 19px', 'font-weight: 800']],
    ['.pill', ['font-size: 10px', 'font-weight: 700', 'letter-spacing: 0.9px', 'text-transform: uppercase']],
    ['.wotd-sentence', ['font-size: 16px', 'line-height: 1.55']],
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
    ['.btn', 'var(--radius-button)'],
    ['.rate-btn', 'var(--radius-button)'],
    ['.wc-note', 'var(--radius-small)'],
    ['.pill', 'var(--radius-pill)'],
  ])('%s uses %s', (selector, radius) => {
    expect(rule(selector)).toContain(`border-radius: ${radius}`)
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
    for (const selector of ['h1', 'h2', 'h3', '.subtitle', '.home-advice', '.tile-text', '.setting-label', '.setting-hint', '.words-note', '.post-batch-why', '.intro-note', '.intro-text', '.intro-line', '.wc-translation', '.wc-row-text', '.learn-undo span', '.wc-shift', '.cz-sentence', '.cz-feedback', '.match-hint', '.cz-instruction']) expect(balanced, selector).toContain(selector)
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

  it('the queue control on a list row is an icon in a 40 x 44 tap target that never shrinks, in the Learn colour, with a visible focus ring; the save star beside it rests grey', () => {
    const queue = rule('.word-row-queue')
    expect(queue).toMatch(/flex: none/)
    expect(queue).toMatch(/width: 40px/)
    expect(queue).toMatch(/height: 44px/)
    expect(queue).toMatch(/color: var\(--teal\)/)
    expect(queue).not.toMatch(/padding: [1-9]/) // no padding to widen it
    expect(rule('.word-row-queue .queue-glyph-mark')).toMatch(/stroke: var\(--teal-ink\)/) // the tick on the filled disc
    expect(css).toMatch(/\.word-row-queue:focus-visible/)
    expect(rule('.word-row-star')).toMatch(/color: var\(--muted-2\)/) // the star, as it was: grey until it is saved
    expect(rule('.word-row-star.is-on')).toMatch(/color: var\(--teal\)/)
  })

  it('the Cloze instruction is set like the Matching one', () => {
    expect(css).toMatch(/\.match-hint,\s*\.cz-instruction \{/)
  })
})
