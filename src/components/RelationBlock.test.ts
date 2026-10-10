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
import { flagsFor } from '../testing/translationFlags'

const words = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')), parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))))
const html = (esWord: string, lang: Lang) => renderToStaticMarkup(createElement(RelationBlock, { relation: relationFor(words.find((w) => w.esWord === esWord)!), settings: flagsFor(lang) }))

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
    // no entry has an alternative form without its country any more (the overlay build refuses one), but the block still copes with one
    const untagged = renderToStaticMarkup(createElement(RelationBlock, { relation: { type: 'meaning_shift', altForm: 'otra', altRegion: null }, settings: flagsFor('en') }))
    expect(untagged).toContain('otra')
    expect(untagged).not.toContain('>AR<')
    expect(untagged).not.toContain('>UY<')
  })

  it('foco has no "also" line: lámpara was one person\'s word, not a regional variant', () => {
    const foco = html('foco', 'en')
    expect(foco).not.toContain('lámpara')
    expect(foco).not.toContain('also')
    expect(foco).toContain('>focus<') // what is left is the standard meaning
  })

  it('shows the standard word as the secondary note when the form leads: the label is English chrome, the note text follows the translation setting', () => {
    const coger = html('coger', 'en')
    expect(coger).toContain('coger')
    expect(coger).toContain('Note')
    expect(coger).toContain('vulgar')
    const ru = html('coger', 'ru')
    expect(ru).toContain('Note') // chrome: English whatever the translation language
    expect(ru).not.toContain('Заметка')
    expect(ru).toMatch(/[А-Яа-яЁё]/) // the note itself is word content: Russian
    expect(coger).not.toMatch(/[А-Яа-яЁё]/)
  })

  it('tú shows the standard word as the secondary note and a note naming the Peninsular form', () => {
    const en = html('tú', 'en')
    expect(en).toContain('tú')
    expect(en).toContain('Peninsular')
    expect(html('tú', 'ru')).toContain('испанская') // the note text follows the translation setting
  })

  it('labels the secondary word "standard" in every case and in both languages (chrome), with std_usage as a soft hint after it', () => {
    const line = (word: string, lang: 'en' | 'ru') => html(word, lang).match(/<p>standard: .*?<\/p>/)?.[0]
    const rows: [string, string][] = [
      // word, the line (identical in English and Russian: it is UI chrome)
      ['ordenador', 'standard: <span>ordenador</span><span class="wc-hint"> · rarely used here</span>'], // not_used
      ['autobús', 'standard: <span>autobús</span>'], // downgraded to less_common by hand: no hint
      ['metro', 'standard: <span>metro</span>'], // another everyday sense (the unit of length)
      ['chico', 'standard: <span>chico</span><span class="wc-hint"> · also common</span>'], // equally_used
      ['fila', 'standard: <span>fila</span><span class="wc-hint"> · also common</span>'],
      ['pastel', 'standard: <span>pastel</span>'], // overridden to less_common by hand: no hint
      ['coger', 'standard: <span>coger</span>'], // likewise
      ['aquí', 'standard: <span>aquí</span>'], // less_common: no hint
    ]
    for (const [word, expected] of rows) {
      expect(line(word, 'en'), `${word} en`).toBe(`<p>${expected}</p>`)
      expect(line(word, 'ru'), `${word} ru`).toBe(`<p>${expected}</p>`)
    }
    for (const w of words.filter((x) => x.rio)) expect(html(w.esWord, 'ru'), w.esWord).not.toMatch(/стандарт|тоже в ходу|здесь почти не говорят|Заметка|Обычное значение|также:/)
  })

  it('the hint depends on std_usage alone: equally_used and not_used say something, less_common and unknown say nothing', () => {
    const hint = (stdUsage: string | null, lang: 'en' | 'ru') =>
      renderToStaticMarkup(createElement(RelationBlock, { relation: { type: 'replacement', standardWord: 'x', standardUsage: stdUsage as 'not_used' | null }, settings: flagsFor(lang) })).includes('wc-hint')
    expect([hint('equally_used', 'en'), hint('not_used', 'en'), hint('less_common', 'en'), hint(null, 'en')]).toEqual([true, true, false, false])
    expect([hint('equally_used', 'ru'), hint('not_used', 'ru'), hint('less_common', 'ru'), hint(null, 'ru')]).toEqual([true, true, false, false])
    const text = (lang: 'en' | 'ru') => renderToStaticMarkup(createElement(RelationBlock, { relation: { type: 'replacement', standardWord: 'x', standardUsage: 'not_used' }, settings: flagsFor(lang) }))
    expect(text('ru')).toBe(text('en')) // the hint is chrome: the same English words in both languages
  })

  it('no card shows a geography claim such as "in Spain" / "в Испании", for any overlay word in either language', () => {
    for (const w of words.filter((x) => x.rio)) {
      for (const lang of ['en', 'ru'] as const) {
        const card = renderToStaticMarkup(createElement(WordCard, { word: w, settings: flagsFor(lang) }))
        expect(card, `${w.esWord} ${lang}`).not.toMatch(/in spain|в испании|\bspain\b|испани/i)
      }
    }
    expect(JSON.stringify(strings.rio)).not.toMatch(/spain|испани/i)
    expect(JSON.stringify(strings.wordContent)).not.toMatch(/spain|испани/i)
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
