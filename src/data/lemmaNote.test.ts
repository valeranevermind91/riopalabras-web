import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from './dictionary'
import { lemmaOfForm } from './lemmaNote'
import { clozeTarget } from './practice'
import { parseFallbackExamples, parseRioOverlay } from './rio'
import { en } from '../strings'
import { ru } from '../strings.ru'
import { makeWord } from '../testing/makeWord'

// The note Cloze adds under a wrong or given-up answer: "vas — from ir". It must never say a word comes from another when it does not (auto does not come from coche).

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const overlay = parseRioOverlay(read('public/rio_overlay.json'))
const fallback = parseFallbackExamples(read('public/examples_fallback.json'))
const dictionary = parseDictionary(read('public/words_enriched.json'), overlay, fallback)
const legacy = parseDictionary(read('public/words_enriched.json'), null, fallback) // the overlay failed to load: the dictionary's own free-text field is all there is
const find = (words: typeof dictionary, esWord: string) => words.find((w) => w.esWord === esWord)!
const noteFor = (words: typeof dictionary, esWord: string) => {
  const word = find(words, esWord)
  const target = clozeTarget(word)
  return target ? lemmaOfForm(word, target.target) : undefined
}

describe('a form of the dictionary word says which word', () => {
  it('irregular verb forms that look nothing like the infinitive: vas / ir, sos / ser, ves / ver', () => {
    expect(noteFor(dictionary, 'ir')).toBe('ir')
    expect(noteFor(dictionary, 'ser')).toBe('ser')
    expect(noteFor(dictionary, 'ver')).toBe('ver')
  })

  it('regular forms: a conjugated verb with a clitic, a plural, a feminine, an apocopated adjective', () => {
    expect(lemmaOfForm(makeWord('dejar', { pos: 'v' }), 'Dejame')).toBe('dejar')
    expect(lemmaOfForm(makeWord('animal', { pos: 'n' }), 'animales')).toBe('animal')
    expect(lemmaOfForm(makeWord('blanco', { pos: 'adj' }), 'blanca')).toBe('blanco')
    expect(lemmaOfForm(makeWord('tercero', { pos: 'adj' }), 'tercer')).toBe('tercero')
  })

  it('the note names the dictionary word as stored, not the form it was given', () => {
    expect(lemmaOfForm(makeWord('ir', { pos: 'v' }), 'vas')).toBe('ir')
  })
})

describe('the words of the note', () => {
  it('«vas — от ir» in Russian and "vas — from ir" in English: the form, a dash, the word, and no grammar', () => {
    expect(ru.practice.lemmaNote('vas', 'ir')).toBe('vas — от ir')
    expect(en.practice.lemmaNote('vas', 'ir')).toBe('vas — from ir')
    for (const text of [ru.practice.lemmaNote('vas', 'ir'), en.practice.lemmaNote('vas', 'ir')]) expect(text).not.toMatch(/л\.|ед\.|мн\.|время|person|singular|plural|tense|present/i)
  })
})

describe('nothing is said when it would not be true', () => {
  it('the form is the word itself, up to case and accents: Dónde / donde, Vos / vos', () => {
    expect(lemmaOfForm(makeWord('donde', { pos: 'pron' }), 'Dónde')).toBeNull()
    expect(lemmaOfForm(makeWord('casa', { pos: 'n' }), 'Casa')).toBeNull()
  })

  it('the example shows the Rioplatense replacement, not a form of the word: auto / coche, gurí / chico, pibe / chaval', () => {
    for (const [esWord, form] of [['coche', 'auto'], ['chico', 'gurí'], ['chaval', 'pibe'], ['agarrar', 'agarrar']] as const) {
      if (form === esWord) continue
      expect(lemmaOfForm(find(dictionary, esWord), form), `${form} / ${esWord}`).toBeNull()
    }
  })

  it('a replacement that is also inflected is left out: enojes is not "from enfadar"', () => {
    expect(noteFor(dictionary, 'enfadar')).toBeNull()
  })

  it('a replacement the overlay does not know but that shares no stem with the word: cheto / tony', () => {
    expect(noteFor(dictionary, 'tony')).toBeNull()
    expect(lemmaOfForm(makeWord('xyz', { pos: 'n' }), 'abcdef')).toBeNull()
  })

  it('a verb form that is a replacement is left out too (tirar for halar)', () => {
    expect(noteFor(dictionary, 'halar')).toBeNull()
  })

  it('a word the user added, a letter\'s name, an interjection, and a form with a space', () => {
    expect(lemmaOfForm(makeWord('casa', { pos: 'n', isCustom: true }), 'casas')).toBeNull()
    expect(lemmaOfForm(makeWord('r', { pos: 'letter' }), 'erre')).toBeNull()
    expect(lemmaOfForm(makeWord('ox', { pos: 'interj' }), "'ox'")).toBeNull()
    expect(lemmaOfForm(makeWord('comer', { pos: 'v' }), 'comer algo')).toBeNull()
  })

  it('a plural that the dictionary lists as a replacement is still a plural: vacaciones / vacación (the overlay failed to load, the legacy field names it)', () => {
    expect(noteFor(legacy, 'vacación')).toBe('vacación')
    expect(noteFor(dictionary, 'vacación')).toBe('vacación')
  })

  it('the legacy field is read when the overlay is not there: auto / coche is still left out', () => {
    expect(noteFor(legacy, 'coche')).toBeNull()
    expect(noteFor(legacy, 'chico')).toBeNull()
  })
})

describe('over the whole dictionary', () => {
  const cases = (words: typeof dictionary) =>
    words.flatMap((word) => {
      const target = clozeTarget(word)
      return target ? [{ word, form: target.target, lemma: lemmaOfForm(word, target.target) }] : []
    })

  it('about a tenth of the questions have a note, and every one names the word it is on', () => {
    const all = cases(dictionary)
    const shown = all.filter((c) => c.lemma)
    expect(all.length).toBeGreaterThan(4000)
    expect(shown.length).toBeGreaterThan(400)
    expect(shown.length).toBeLessThan(550)
    for (const c of shown) expect(c.lemma).toBe(c.word.esWord.trim())
  })

  it('no note is on a form that is the replacement the overlay records for its word', () => {
    for (const { word, form, lemma } of cases(dictionary)) {
      if (!lemma || word.rio?.type !== 'replacement') continue
      const replacements = [word.rio.form, word.rio.altForm].filter((x): x is string => !!x).map((x) => x.toLowerCase())
      expect(replacements, `${form} / ${word.esWord}`).not.toContain(form.toLowerCase())
    }
  })

  it('a note is rarely longer than one line at 320px (about 33 characters in English): the slot then grows by a line', () => {
    const shown = cases(dictionary).filter((c) => c.lemma)
    const long = shown.filter((c) => `${c.form} — from ${c.lemma}`.length > 33)
    expect(long.length / shown.length).toBeLessThan(0.05)
    expect(Math.max(...shown.map((c) => `${c.form} — from ${c.lemma}`.length))).toBeLessThanOrEqual(40) // and never more than two lines
  })
})
