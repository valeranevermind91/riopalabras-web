import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from '../data/dictionary'
import { relationFor } from '../data/relation'
import { parseRioOverlay, type Lang } from '../data/rio'
import { RelationBlock } from './RelationBlock'

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

  it('renders nothing for a word without an overlay entry', () => {
    expect(html('mona', 'en')).toBe('')
    expect(html('vos', 'en')).toBe('') // regional_only without a note: nothing to say
  })
})
