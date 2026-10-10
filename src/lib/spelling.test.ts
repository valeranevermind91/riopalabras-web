import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { SpellingNote } from '../components/SpellingNote'
import { setLanguage } from './language'

// The question the add form asks when the lookup did not recognise the typed word.

const render = (suggestion: string | null) => renderToStaticMarkup(createElement(SpellingNote, { typed: 'champeones', suggestion, onUse: () => {}, onKeep: () => {} }))
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])
const sentences = (html: string) => [...html.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''))

afterEach(() => setLanguage('en'))

describe('with a likely spelling', () => {
  it('asks "Did you mean championes?", says plainly the word was not recognised, and offers both ways on', () => {
    const html = render('championes')
    expect(sentences(html)).toEqual(['Did you mean championes?', '“champeones” was not recognised as a Spanish word.'])
    expect(buttons(html)).toEqual(['Use championes', 'Keep champeones'])
    expect(html).toContain('role="status"') // a polite announcement, not an alert: nothing here is an error
    expect(html).not.toContain('is-error')
  })

  it('says it in Russian too, in the same register as the rest of the form', () => {
    setLanguage('ru')
    const html = render('championes')
    expect(sentences(html)).toEqual(['Вы имели в виду championes?', 'Слово «champeones» не распознано как испанское.'])
    expect(buttons(html)).toEqual(['Исправить на championes', 'Оставить champeones'])
  })
})

describe('with no likely spelling', () => {
  it('is one line saying the word was not recognised, that saving is still possible, and no actions', () => {
    const html = render(null)
    expect(sentences(html)).toEqual(['“champeones” was not recognised as a Spanish word. You can still save it.'])
    expect(buttons(html)).toEqual([])
  })

  it('in Russian', () => {
    setLanguage('ru')
    const html = render(null)
    expect(sentences(html)).toEqual(['Слово «champeones» не распознано как испанское. Его всё равно можно сохранить.'])
    expect(buttons(html)).toEqual([])
  })
})
