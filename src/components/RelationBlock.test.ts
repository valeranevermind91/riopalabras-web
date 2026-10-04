import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from '../data/dictionary'
import { relationFor } from '../data/relation'
import { parseRioOverlay, type Lang } from '../data/rio'
import { strings } from '../strings'
import { RelationBlock } from './RelationBlock'
import { WordCard } from './WordCard'

const words = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')), parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))))
const html = (esWord: string, lang: Lang) => renderToStaticMarkup(createElement(RelationBlock, { relation: relationFor(words.find((w) => w.esWord === esWord)!), lang }))

describe('RelationBlock', () => {
  it('shows only the first gloss of the standard meaning (foco: "focus", not "focus, spotlight")', () => {
    const en = html('foco', 'en')
    expect(en).toContain('Standard meaning')
    expect(en).toContain('>focus<')
    expect(en).not.toContain('spotlight')
    expect(html('foco', 'ru')).toContain('>фокус<')
    expect(html('foco', 'ru')).not.toContain('прожектор')
    expect(html('guapo', 'en')).toContain('>handsome<')
  })

  it('shows "also: alt_form" with its region tag when the region is known, and without a tag when it is not', () => {
    const autobus = html('autobús', 'en')
    expect(autobus).toContain('also')
    expect(autobus).toContain('colectivo')
    expect(autobus).toContain('>AR<')
    const foco = html('foco', 'en')
    expect(foco).toContain('lámpara')
    expect(foco).not.toContain('>AR<')
    expect(foco).not.toContain('>UY<')
  })

  it('shows the standard word as the secondary note when the form leads, and the note in the user\'s language', () => {
    const coger = html('coger', 'en')
    expect(coger).toContain('coger')
    expect(coger).toContain('Note')
    expect(coger).toContain('vulgar')
    expect(html('coger', 'ru')).toContain('Заметка')
  })

  it('tú shows the standard word as the secondary note and a note naming the Peninsular form', () => {
    const en = html('tú', 'en')
    expect(en).toContain('tú')
    expect(en).toContain('Peninsular')
    expect(html('tú', 'ru')).toContain('испанская')
  })

  it('labels the secondary word "standard" / "стандарт" in every case, with std_usage as a soft hint after it', () => {
    const line = (word: string, lang: 'en' | 'ru') => html(word, lang).match(/<p>(?:standard|стандарт): .*?<\/p>/)?.[0]
    const rows: [string, string, string][] = [
      // word, English line, Russian line
      ['ordenador', 'standard: <span>ordenador</span><span class="wc-hint"> · rarely used here</span>', 'стандарт: <span>ordenador</span><span class="wc-hint"> · здесь почти не говорят</span>'], // not_used
      ['autobús', 'standard: <span>autobús</span>', 'стандарт: <span>autobús</span>'], // downgraded to less_common by hand: no hint
      ['metro', 'standard: <span>metro</span>', 'стандарт: <span>metro</span>'], // another everyday sense (the unit of length)
      ['chico', 'standard: <span>chico</span><span class="wc-hint"> · also common</span>', 'стандарт: <span>chico</span><span class="wc-hint"> · тоже в ходу</span>'], // equally_used
      ['fila', 'standard: <span>fila</span><span class="wc-hint"> · also common</span>', 'стандарт: <span>fila</span><span class="wc-hint"> · тоже в ходу</span>'],
      ['pastel', 'standard: <span>pastel</span>', 'стандарт: <span>pastel</span>'], // overridden to less_common by hand: no hint
      ['coger', 'standard: <span>coger</span>', 'стандарт: <span>coger</span>'], // likewise
      ['aquí', 'standard: <span>aquí</span>', 'стандарт: <span>aquí</span>'], // less_common: no hint
    ]
    for (const [word, en, ru] of rows) {
      expect(line(word, 'en'), `${word} en`).toBe(`<p>${en}</p>`)
      expect(line(word, 'ru'), `${word} ru`).toBe(`<p>${ru}</p>`)
    }
  })

  it('the hint depends on std_usage alone: equally_used and not_used say something, less_common and unknown say nothing', () => {
    const hint = (stdUsage: string | null, lang: 'en' | 'ru') =>
      renderToStaticMarkup(createElement(RelationBlock, { relation: { type: 'replacement', standardWord: 'x', standardUsage: stdUsage as 'not_used' | null }, lang })).includes('wc-hint')
    expect([hint('equally_used', 'en'), hint('not_used', 'en'), hint('less_common', 'en'), hint(null, 'en')]).toEqual([true, true, false, false])
    expect([hint('equally_used', 'ru'), hint('not_used', 'ru'), hint('less_common', 'ru'), hint(null, 'ru')]).toEqual([true, true, false, false])
  })

  it('no card shows a geography claim such as "in Spain" / "в Испании", for any overlay word in either language', () => {
    for (const w of words.filter((x) => x.rio)) {
      for (const lang of ['en', 'ru'] as const) {
        const card = renderToStaticMarkup(createElement(WordCard, { word: w, lang }))
        expect(card, `${w.esWord} ${lang}`).not.toMatch(/in spain|в испании|\bspain\b|испани/i)
      }
    }
    expect(JSON.stringify(strings.rio)).not.toMatch(/spain|испани/i)
  })

  it('never shows the Spanish label "estándar" for any overlay word, in either language', () => {
    for (const w of words.filter((x) => x.rio)) {
      for (const lang of ['en', 'ru'] as const) expect(html(w.esWord, lang).toLowerCase(), `${w.esWord} ${lang}`).not.toContain('estándar')
    }
  })

  it('renders nothing for a word without an overlay entry', () => {
    expect(html('mona', 'en')).toBe('')
    expect(html('vos', 'en')).toBe('') // regional_only without a note: nothing to say
  })
})
