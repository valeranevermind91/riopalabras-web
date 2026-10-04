import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDictionary } from './dictionary'
import { headword, highlightTarget } from './headword'
import { headwordRegion, relationFor, translationsFor } from './relation'
import { findFormRange, inflectionOf, langFromSettings, parseRioOverlay, pickLocalized } from './rio'
import { strings } from '../strings'
import { makeWord } from '../testing/makeWord'
import type { Word } from './types'

const rawDictionary = JSON.parse(readFileSync('public/words_enriched.json', 'utf8'))
const rawOverlay = JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))
const overlay = parseRioOverlay(rawOverlay)
const words = parseDictionary(rawDictionary, overlay)
const byWord = new Map(words.map((w) => [w.esWord, w]))
const entry = (esWord: string): Word => {
  const w = byWord.get(esWord)
  if (!w) throw new Error(`${esWord} not in dictionary`)
  return w
}
const highlighted = (w: Word) => {
  const r = highlightTarget(w)
  return r.range ? r.sentence.slice(r.range.start, r.range.end) : null
}

describe('the overlay file', () => {
  it('has 76 accepted entries, all in the dictionary, none of type none', () => {
    expect(rawOverlay).toHaveLength(76)
    expect(overlay.size).toBe(76)
    expect(words.filter((w) => w.rio)).toHaveLength(76)
    for (const e of rawOverlay) expect(['replacement', 'meaning_shift', 'regional_only', 'form']).toContain(e.rio_type)
  })

  it('skips malformed entries, non-accepted statuses, none and duplicates', () => {
    const parsed = parseRioOverlay([
      { es_word: 'a', rio_type: 'replacement', rio_form: 'b' },
      { es_word: 'c', rio_type: 'none', rio_form: 'd' },
      { es_word: 'e', rio_type: 'replacement', rio_form: 'f', status: 'pending' },
      { es_word: 'g', rio_type: 'replacement', rio_form: 'h', status: 'rejected' },
      { es_word: 'i', rio_type: 'replacement', rio_form: 'j', status: 'accepted' },
      { es_word: 'k', rio_type: 'replacement' },
      { rio_type: 'replacement', rio_form: 'l' },
      { es_word: 'A', rio_type: 'replacement', rio_form: 'dup' },
      null,
      'x',
    ])
    expect([...parsed.keys()]).toEqual(['a', 'i'])
    expect(parsed.get('a')?.form).toBe('b')
    expect(() => parseRioOverlay({})).toThrow(/array/)
  })

  it('normalizes regions, notes and translations', () => {
    const e = parseRioOverlay([{ es_word: 'x', rio_type: 'replacement', rio_form: 'y', region: 'mx', alt_region: 'ar', notes: { en: 'n', ru: '' }, translation: { en: '', ru: '' } }]).get('x')
    expect(e?.region).toBeNull()
    expect(e?.altRegion).toBe('ar')
    expect(e?.notes).toEqual({ en: 'n', ru: '' })
    expect(e?.translation).toBeNull()
  })
})

describe('the legacy field is only a fallback', () => {
  it('without the overlay (it failed to load) the old es_rioplatense rule applies', () => {
    const legacy = parseDictionary(rawDictionary)
    const periodico = legacy.find((w) => w.esWord === 'periódico')!
    expect(periodico.rio).toBeNull()
    expect(periodico.esRioplatense).toBe('diario')
    expect(headword(periodico)).toEqual({ text: 'diario', form: 'rioplatense', secondary: 'periódico' })
    expect(relationFor(periodico)).toEqual({ type: 'replacement', standardWord: 'periódico' })
  })

  it('with the overlay loaded, the legacy field is dropped for every dictionary word', () => {
    expect(words.filter((w) => w.esRioplatense !== null)).toEqual([])
    expect(entry('tony').rio).toBeNull()
  })

  describe('loadDictionary', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.resetModules()
    })
    const stubFetch = (overlayResponse: () => Response | Promise<Response>) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === '/words_enriched.json') return new Response(JSON.stringify(rawDictionary))
          if (url === '/rio_overlay.json') return overlayResponse()
          throw new Error('unexpected ' + url)
        }),
      )
    }

    it('attaches the overlay when both files load', async () => {
      stubFetch(() => new Response(JSON.stringify(rawOverlay)))
      vi.resetModules()
      const { loadDictionary } = await import('./dictionary')
      const loaded = await loadDictionary()
      const metro = loaded.find((w) => w.esWord === 'metro')!
      expect(metro.rio?.form).toBe('subte')
      expect(metro.esRioplatense).toBeNull()
    })

    it.each([
      ['HTTP 404', () => new Response('nope', { status: 404 })],
      ['not JSON', () => new Response('<html>')],
      ['not an array', () => new Response('{}')],
      ['network error', () => Promise.reject(new TypeError('offline'))],
    ])('falls back to the legacy field when the overlay fails (%s)', async (_label, overlayResponse) => {
      stubFetch(overlayResponse)
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.resetModules()
      const { loadDictionary } = await import('./dictionary')
      const loaded = await loadDictionary()
      const periodico = loaded.find((w) => w.esWord === 'periódico')!
      expect(periodico.rio).toBeNull()
      expect(periodico.esRioplatense).toBe('diario')
      expect(loaded.every((w) => w.rio === null)).toBe(true)
    })
  })
})

describe('inflectionOf / findFormRange', () => {
  it.each([
    ['apuro', 'apurar', 'v', true],
    ['apurás', 'apurar', 'v', true],
    ['estacioná', 'estacionar', 'v', true],
    ['apurate', 'apurar', 'v', true],
    ['levantalo', 'levantar', 'v', true], // voseo imperative + lo
    ['levantarlo', 'levantar', 'v', true],
    ['elegís', 'elegir', 'v', true],
    ['apurar', 'apurar', 'v', true],
    ['auto', 'auto', 'n', true],
    ['autos', 'auto', 'n', true],
    ['pelos', 'pelo', 'n', true],
    ['pela', 'pelo', 'n', true],
    ['sillones', 'sillón', 'n', true],
    ['peces', 'pez', 'n', true],
    ['Capaz', 'capaz', 'adv', true],
    ['sus', 'su', 'pron', true],
    ['automóvil', 'auto', 'n', false],
    ['pelota', 'pelo', 'n', false],
    ['papá', 'papa', 'n', false],
    ['suyo', 'su', 'pron', false],
    ['colar', 'cola', 'n', false],
    ['tiraje', 'tirar', 'v', false],
  ])('%s vs %s (%s) → %s', (token, form, pos, expected) => {
    expect(inflectionOf(token, form, pos)).toBe(expected)
  })

  it('finds multi-word forms as consecutive words, not across punctuation', () => {
    const s = 'Pasame el control remoto, por favor.'
    const r = findFormRange(s, 'control remoto', 'n')
    expect(r && s.slice(r.start, r.end)).toBe('control remoto')
    expect(findFormRange('El control, remoto o no.', 'control remoto', 'n')).toBeNull()
    const plural = findFormRange('Los controles remotos no andan.', 'control remoto', 'n')
    expect(plural).not.toBeNull()
  })

  it('matches a short form only as a whole word', () => {
    expect(findFormRange('Este es su problema.', 'su', 'pron')).toEqual({ start: 8, end: 10 })
    expect(findFormRange('Suspiró y se fue.', 'su', 'pron')).toBeNull()
  })
})

describe('headword with the overlay', () => {
  it.each([
    ['aquí', 'acá'],
    ['periódico', 'diario'],
    ['metro', 'subte'],
    ['vosotros', 'ustedes'],
    ['vuestro', 'su'],
    ['coger', 'agarrar'],
  ])('%s → %s leads, with the standard word as the secondary note', (esWord, form) => {
    const w = entry(esWord)
    expect(headword(w)).toEqual({ text: form, form: 'rioplatense', secondary: esWord })
    expect(relationFor(w)).toMatchObject({ type: 'replacement', standardWord: esWord })
    expect(relationFor(w)).not.toHaveProperty('rioForm')
  })

  it('cigarrillo → pucho: the sentence has no pucho, so the headword stays and pucho is a note', () => {
    const w = entry('cigarrillo')
    expect(w.exampleSentence).not.toMatch(/pucho/i)
    expect(headword(w)).toEqual({ text: 'cigarrillo', form: 'standard', secondary: null })
    expect(relationFor(w)).toEqual({ type: 'replacement', rioForm: 'pucho', region: null })
    expect(headwordRegion(w)).toBeNull()
    expect(highlighted(w)).toBe('cigarrillo')
  })

  it('metro → subte carries the AR tag; aquí → acá carries none', () => {
    expect(headwordRegion(entry('metro'))).toBe('ar')
    expect(headwordRegion(entry('aquí'))).toBeNull()
    expect(entry('metro').rio?.region).toBe('ar')
  })

  it('foco is a meaning_shift: headword stays, alt_form is shown, the region tag is UY', () => {
    const w = entry('foco')
    expect(headword(w)).toEqual({ text: 'foco', form: 'standard', secondary: null })
    expect(relationFor(w)).toMatchObject({ type: 'meaning_shift', altForm: 'lámpara', altRegion: null, stdMeaning: { en: 'focus, spotlight' } })
    expect(headwordRegion(w)).toBe('uy')
  })

  it('vos is regional_only: the headword stays and there is no replacement block', () => {
    const w = entry('vos')
    expect(headword(w).form).toBe('standard')
    expect(relationFor(w)).toEqual({ type: 'regional_only' })
    expect(translationsFor(w)).toEqual({ en: w.enTranslation, ru: w.ruTranslation })
  })

  it('mona was rejected: it is a plain dictionary entry', () => {
    const w = entry('mona')
    expect(w.rio).toBeNull()
    expect(headword(w)).toEqual({ text: 'mona', form: 'standard', secondary: null })
    expect(relationFor(w)).toBeNull()
    expect(translationsFor(w)).toEqual({ en: w.enTranslation, ru: w.ruTranslation })
    for (const rejected of ['polla', 'picado', 'puto', 'hermoso', 'bello', 'rostro', 'empleo', 'vacación', 'norteamericano', 'tony']) {
      expect(entry(rejected).rio).toBeNull()
    }
  })

  it('a replacement leads only if the sentence shows the form, case-insensitively and inflected', () => {
    const base = entry('periódico')
    const withSentence = (exampleSentence: string) => ({ ...base, exampleSentence })
    expect(headword(withSentence('Compré el **Diario** hoy.')).text).toBe('diario') // ** stripped, case-insensitive
    expect(headword(withSentence('Compré los diarios hoy.')).form).toBe('rioplatense') // plural
    expect(headword(withSentence('Compré el periódico hoy.')).form).toBe('standard')
    expect(headword(withSentence('Un diariamente leído libro.')).form).toBe('standard') // not a whole word
    expect(headword(withSentence('')).form).toBe('standard')
  })

  it('other types never switch the headword, even when the sentence contains the form', () => {
    const w = { ...entry('guapo'), exampleSentence: 'Es muy guapo.' }
    expect(headword(w)).toEqual({ text: 'guapo', form: 'standard', secondary: null })
  })

  it('is independent of word_form_in_example (the overlay decides, not the old extraction)', () => {
    const w = { ...entry('periódico'), wordFormInExample: null }
    expect(headword(w).form).toBe('rioplatense')
  })
})

describe('notes, alternatives and translations', () => {
  it('shows the note on a replacement too (coger / agarrar carries a warning) and the translation override of the headword', () => {
    const w = entry('coger')
    const rel = relationFor(w)
    expect(pickLocalized(rel?.note ?? null, 'en')).toMatch(/vulgar/)
    expect(translationsFor(w)).toEqual({ en: 'to grab, to catch', ru: 'брать, хватать' })
  })

  it('does not apply a replacement\'s override when the headword stayed the standard word', () => {
    const w = { ...entry('coger'), exampleSentence: 'No coger nada del suelo.' }
    expect(headword(w).form).toBe('standard')
    expect(translationsFor(w)).toEqual({ en: w.enTranslation, ru: w.ruTranslation })
  })

  it('applies the override of a meaning_shift (guapo = brave, tough) and keeps the standard meaning as a note', () => {
    const w = entry('guapo')
    expect(translationsFor(w)).toEqual({ en: 'brave, tough', ru: 'смелый, крутой' })
    expect(relationFor(w)).toMatchObject({ type: 'meaning_shift', stdMeaning: { en: 'handsome, good-looking' } })
  })

  it('shows both forms on autobús: ómnibus (UY) as a note and colectivo (AR) as the alternative', () => {
    const w = entry('autobús')
    expect(headword(w).form).toBe('standard')
    expect(relationFor(w)).toMatchObject({ type: 'replacement', rioForm: 'ómnibus', region: 'uy', altForm: 'colectivo', altRegion: 'ar' })
  })

  it('picks the note by language and falls back to the other one', () => {
    const l = { en: 'English', ru: 'Русский' }
    expect(pickLocalized(l, 'ru')).toBe('Русский')
    expect(pickLocalized(l, 'en')).toBe('English')
    expect(pickLocalized({ en: 'English', ru: '' }, 'ru')).toBe('English')
    expect(pickLocalized(null, 'en')).toBeNull()
    expect(langFromSettings({ showRuTranslation: true })).toBe('ru')
    expect(langFromSettings({ showRuTranslation: false })).toBe('en')
  })

  it('has every label in both languages', () => {
    expect(Object.keys(strings.rio.en).sort()).toEqual(Object.keys(strings.rio.ru).sort())
    expect(Object.keys(strings.rio.en.tag)).toEqual(['uy', 'ar'])
    expect(Object.keys(strings.rio.ru.tagTitle)).toEqual(['uy', 'ar'])
  })
})

describe('highlight with the overlay', () => {
  it.each([
    ['aquí', 'acá'],
    ['periódico', 'diario'],
    ['vosotros', 'Ustedes'],
    ['vuestro', 'su'],
    ['metro', 'subte'],
    ['cigarrillo', 'cigarrillo'],
    ['foco', 'lamparita'],
  ])('%s highlights %s', (esWord, expected) => {
    expect(highlighted(entry(esWord))).toBe(expected)
  })

  it('highlights a 2-letter form whole-word (su) and not inside sus/suyo', () => {
    const w = { ...entry('vuestro'), wordFormInExample: 'su', exampleSentence: 'Sus amigos dijeron que este es su problema.' }
    const r = highlightTarget(w)
    expect(r.range && r.sentence.slice(r.range.start, r.range.end)).toBe('su')
    expect(r.range?.start).toBe(r.sentence.indexOf(' su ') + 1)
  })

  it('falls back to the headword, then the other form, and never straight to es_word on a Rioplatense headword', () => {
    const base = entry('periódico')
    const w = { ...base, wordFormInExample: 'gaceta', exampleSentence: 'El periódico llegó, y el diario también.' }
    expect(headword(w).form).toBe('rioplatense')
    expect(highlighted(w)).toBe('diario') // not "periódico", although it comes first in the sentence
  })

  it('finds an inflected Rioplatense headword even when the stored word form is unusable', () => {
    const w = { ...entry('aparcar'), wordFormInExample: null, exampleSentence: 'Siempre estaciono en la esquina.' }
    expect(headword(w).text).toBe('estacionar')
    expect(highlighted(w)).toBe('estaciono')
  })

  it('on a note-only replacement, the alternative is a fallback when the Rioplatense form is absent', () => {
    const w = { ...entry('autobús'), wordFormInExample: null, exampleSentence: 'Tomé el colectivo para ir al centro.' }
    expect(headword(w).form).toBe('standard')
    expect(highlighted(w)).toBe('colectivo')
  })

  it('autobús leads with ómnibus when the sentence shows it, and highlights it', () => {
    const w = { ...entry('autobús'), wordFormInExample: null, exampleSentence: 'Tomé el ómnibus y después el colectivo.' }
    expect(headword(w)).toEqual({ text: 'ómnibus', form: 'rioplatense', secondary: 'autobús' })
    expect(highlighted(w)).toBe('ómnibus')
  })

  // One pass over all 4753 words (a few seconds on a loaded machine), hence the explicit timeout.
  it('finds a highlight for every dictionary word, and no ** markers remain', () => {
    const results = words.map((w) => ({ word: w.esWord, result: highlightTarget(w) }))
    expect(results.filter((r) => r.result.range === null).map((r) => r.word)).toEqual([])
    expect(results.filter((r) => r.result.sentence.includes('*')).map((r) => r.word)).toEqual([])
  }, 30_000)
})

describe('what the overlay does to the dictionary', () => {
  it('55 words lead with a Rioplatense headword, 21 show a note only, 4677 are untouched', () => {
    const withOverlay = words.filter((w) => w.rio)
    const led = withOverlay.filter((w) => headword(w).form === 'rioplatense')
    const noteOnly = withOverlay.filter((w) => headword(w).form === 'standard' && relationFor(w))
    expect(led).toHaveLength(55)
    expect(noteOnly).toHaveLength(21)
    expect(withOverlay.filter((w) => headword(w).form === 'standard' && !relationFor(w))).toHaveLength(0)
    expect(words.filter((w) => !w.rio)).toHaveLength(words.length - 76)
    for (const w of words.filter((x) => !x.rio)) {
      expect(headword(w)).toEqual({ text: w.esWord, form: 'standard', secondary: null })
      expect(relationFor(w)).toBeNull()
    }
  })

  it('every overlay replacement that leads really shows its form in the sentence', { timeout: 30_000 }, () => {
    for (const w of words.filter((x) => x.rio && headword(x).form === 'rioplatense')) {
      expect(findFormRange(highlightTarget(w).sentence, w.rio!.form, w.pos), w.esWord).not.toBeNull()
    }
  })

  it('makeWord defaults keep custom and synthetic words overlay-free', () => {
    expect(makeWord('casa').rio).toBeNull()
  })
})
