import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDictionary } from './dictionary'
import { effectiveExample, headword, headwordDecision, highlightTarget } from './headword'
import { headwordRegion, relationFor, translationsFor } from './relation'
import { findFormRange, firstGloss, inflectionOf, parseFallbackExamples, parseRioOverlay, type RioInfo } from './rio'
import { pickLocalizedAll, type TranslationFlags } from './translations'
import { en, strings } from '../strings'
import { ru } from '../strings.ru'
import { makeWord } from '../testing/makeWord'
import type { Word } from './types'
import { EN_ONLY, RU_ONLY } from '../testing/translationFlags'

const rawDictionary = JSON.parse(readFileSync('public/words_enriched.json', 'utf8'))
const rawOverlay = JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))
const rawFallback = JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))
const overlay = parseRioOverlay(rawOverlay)
const fallback = parseFallbackExamples(rawFallback)
const words = parseDictionary(rawDictionary, overlay, fallback)
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

// The first paragraph of the block (the cards show every enabled language; these tests care about the text and the fallback).
const pickLocalized = (value: Parameters<typeof pickLocalizedAll>[0], flags: TranslationFlags) => pickLocalizedAll(value, flags)[0] ?? null

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
    const stubFetch = (
      overlayResponse: () => Response | Promise<Response>,
      fallbackResponse: () => Response | Promise<Response> = () => new Response(JSON.stringify(rawFallback)),
    ) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === '/words_enriched.json') return new Response(JSON.stringify(rawDictionary))
          if (url === '/rio_overlay.json') return overlayResponse()
          if (url === '/examples_fallback.json') return fallbackResponse()
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

    it('attaches the fallback examples when the file loads, and keeps the old dictionary example when it does not', async () => {
      stubFetch(() => new Response(JSON.stringify(rawOverlay)))
      vi.resetModules()
      const ok = await (await import('./dictionary')).loadDictionary()
      const nino = ok.find((w) => w.esWord === 'niño')!
      expect(nino.fallbackExample?.es).toMatch(/niño/)
      expect(effectiveExample(nino).source).toBe('fallback')

      for (const [label, response] of [
        ['HTTP 404', () => new Response('nope', { status: 404 })],
        ['not JSON', () => new Response('<html>')],
        ['not an array', () => new Response('{}')],
        ['network error', () => Promise.reject(new TypeError('offline'))],
      ] as const) {
        stubFetch(() => new Response(JSON.stringify(rawOverlay)), response)
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.resetModules()
        const failed = await (await import('./dictionary')).loadDictionary()
        const same = failed.find((w) => w.esWord === 'niño')!
        expect(same.fallbackExample, label).toBeNull()
        expect(effectiveExample(same).source, label).toBe('dictionary')
        expect(same.exampleSentence, label).toMatch(/pibe/) // exactly today's behaviour
        expect(same.rio, label).toBeNull() // niño is not in the overlay either way
        expect(failed.find((w) => w.esWord === 'autobús')?.rio?.form, label).toBe('ómnibus') // the overlay is independent of the fallback file
      }
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
    // verb stem changes and spelling changes (pass 3)
    ['siento', 'sentir', 'v', true],
    ['sintió', 'sentir', 'v', true],
    ['muera', 'morir', 'v', true],
    ['murió', 'morir', 'v', true],
    ['pido', 'pedir', 'v', true],
    ['juego', 'jugar', 'v', true],
    ['jugué', 'jugar', 'v', true],
    ['llegué', 'llegar', 'v', true],
    ['empiezo', 'empezar', 'v', true],
    ['empecé', 'empezar', 'v', true],
    ['tengo', 'tener', 'v', true],
    ['tienes', 'tener', 'v', true],
    ['supongo', 'suponer', 'v', true],
    ['conozco', 'conocer', 'v', true],
    ['salgo', 'salir', 'v', true],
    ['sigo', 'seguir', 'v', true],
    ['cojo', 'coger', 'v', true],
    ['elijo', 'elegir', 'v', true],
    ['construyo', 'construir', 'v', true],
    ['sentido', 'sentir', 'v', true], // the participle is a form of sentir too
    ['sentada', 'sentir', 'v', false], // sentar, not sentir
    ['fiarle', 'fiar', 'v', true], // infinitive + clitic
    ['levantarlo', 'levantar', 'v', true],
    ['darmelo', 'dar', 'v', true],
    ['algún', 'alguno', 'det', true], // apocope
    ['tercer', 'tercero', 'adj', true],
    ['buen', 'bueno', 'adj', true],
    ['mal', 'malo', 'adj', true],
    ['francesa', 'francés', 'adj', true], // feminine of a consonant-ending adjective
    ['encantadora', 'encantador', 'adj', true],
    ['musulmanas', 'musulmán', 'adj', true],
    ['sos', 'ser', 'v', false], // irregular beyond patterns: stays unmatched
  ])('%s vs %s (%s) → %s', (token, form, pos, expected) => {
    expect(inflectionOf(token, form, pos)).toBe(expected)
  })

  it('loose accents (opt-in) accept a different accent, strict mode does not', () => {
    expect(inflectionOf('dónde', 'donde', 'pron')).toBe(false)
    expect(inflectionOf('dónde', 'donde', 'pron', true, true)).toBe(true)
    expect(inflectionOf('Quién', 'quien', 'pron', true, true)).toBe(true)
    expect(inflectionOf('papá', 'papa', 'n')).toBe(false) // overlay forms stay strict: papá is not papa
    expect(findFormRange('¿Dónde vivís?', 'donde', 'pron', true)).toEqual({ start: 1, end: 6 })
    expect(findFormRange('¿Dónde vivís?', 'donde', 'pron')).toBeNull()
    // accent-less verb endings still match in loose mode (Recibí / recibir, Vení / venir)
    expect(inflectionOf('Recibí', 'recibir', 'v', true, true)).toBe(true)
    expect(inflectionOf('Recibí', 'recibir', 'v')).toBe(true)
    expect(inflectionOf('Vení', 'venir', 'v', true, true)).toBe(true)
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

  it('cigarrillo → pucho: the dictionary example has no pucho, so the overlay example is shown and pucho leads', () => {
    const w = entry('cigarrillo')
    expect(w.exampleSentence).not.toMatch(/pucho/i)
    expect(effectiveExample(w).source).toBe('overlay')
    expect(effectiveExample(w).sentence).toMatch(/pucho/)
    expect(headword(w)).toEqual({ text: 'pucho', form: 'rioplatense', secondary: 'cigarrillo' })
    expect(relationFor(w)).toMatchObject({ type: 'replacement', standardWord: 'cigarrillo' })
    expect(headwordRegion(w)).toBeNull() // both countries
    expect(highlighted(w)).toBe('pucho')
  })

  it('metro → subte carries the AR tag; aquí → acá carries none', () => {
    expect(headwordRegion(entry('metro'))).toBe('ar')
    expect(headwordRegion(entry('aquí'))).toBeNull()
    expect(entry('metro').rio?.region).toBe('ar')
  })

  it('foco is a meaning_shift: headword stays, there is no alternative form, the region tag is UY', () => {
    const w = entry('foco')
    expect(headword(w)).toEqual({ text: 'foco', form: 'standard', secondary: null })
    expect(relationFor(w)).toMatchObject({ type: 'meaning_shift', stdMeaning: { en: 'focus, spotlight' } })
    expect(relationFor(w)).not.toHaveProperty('altForm')
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
    expect(pickLocalized(rel?.note ?? null, EN_ONLY)).toMatch(/vulgar/)
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

  it('autobús leads with ómnibus (UY tag) from its overlay example, with colectivo (AR) as "also"', () => {
    const w = entry('autobús')
    expect(effectiveExample(w).source).toBe('overlay')
    expect(headword(w)).toEqual({ text: 'ómnibus', form: 'rioplatense', secondary: 'autobús' })
    expect(relationFor(w)).toMatchObject({ type: 'replacement', standardWord: 'autobús', altForm: 'colectivo', altRegion: 'ar' })
    expect(headwordRegion(w)).toBe('uy')
    expect(highlighted(w)).toBe('ómnibus')
  })

  it('picks the note by language and falls back to the other one', () => {
    const l = { en: 'English', ru: 'Русский' }
    expect(pickLocalized(l, RU_ONLY)).toBe('Русский')
    expect(pickLocalized(l, EN_ONLY)).toBe('English')
    expect(pickLocalized({ en: 'English', ru: '' }, RU_ONLY)).toBe('English')
    expect(pickLocalized(null, EN_ONLY)).toBeNull()
  })

  it('has every label in both languages', () => {
    expect(Object.keys(en.rio).sort()).toEqual(Object.keys(ru.rio).sort())
    expect(Object.keys(en.rio.tag)).toEqual(['uy', 'ar'])
    expect(Object.keys(ru.rio.tagTitle)).toEqual(['uy', 'ar'])
  })
})

describe('highlight with the overlay', () => {
  it.each([
    ['aquí', 'acá'],
    ['periódico', 'diario'],
    ['vosotros', 'Ustedes'],
    ['vuestro', 'su'],
    ['metro', 'subte'],
    ['cigarrillo', 'pucho'],
    ['autobús', 'ómnibus'],
    ['foco', 'foco'],
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

  it('on a note-only replacement (no overlay example, form absent) the alternative is a fallback', () => {
    const base = entry('autobús')
    const w = { ...base, rio: { ...base.rio!, example: null }, wordFormInExample: null, exampleSentence: 'Tomé el colectivo para ir al centro.' }
    expect(headword(w).form).toBe('standard')
    expect(highlighted(w)).toBe('colectivo')
  })

  it('autobús leads with ómnibus when the dictionary example shows it, and highlights it', () => {
    const base = entry('autobús')
    const w = { ...base, rio: { ...base.rio!, example: null }, wordFormInExample: null, exampleSentence: 'Tomé el ómnibus y después el colectivo.' }
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

describe('overlay examples (pass 2)', () => {
  const withExample = words.filter((w) => w.rio?.example)

  it('21 words carry an example in the client file: the 6 pass-2 replacements, tú and contigo, and the 13 confirmed meaning_shift / regional_only entries', () => {
    expect(withExample.map((w) => w.esWord).sort()).toEqual(
      ['asilo', 'autobús', 'boleto', 'chance', 'chico', 'cigarrillo', 'colgado', 'contigo', 'feria', 'foco', 'guapo', 'guay', 'marcador', 'mina', 'portero', 'propaganda', 'saco', 'suprema', 'torta', 'tú', 'vos'].sort(),
    )
    expect(withExample.filter((w) => w.rio!.type === 'replacement')).toHaveLength(8)
    expect(withExample.filter((w) => w.rio!.type !== 'replacement')).toHaveLength(13)
    expect(words.filter((w) => w.rio?.type === ('form' as string))).toEqual([]) // tú and contigo are replacements now
  })

  it('every overlay example is valid: it contains its form once, the form is a substring, and a replacement never uses the standard word', () => {
    for (const w of withExample) {
      const ex = w.rio!.example!
      expect(ex.wordForm && ex.es.includes(ex.wordForm), w.esWord).toBeTruthy()
      expect(findFormRange(ex.es, w.rio!.form, w.pos), w.esWord).not.toBeNull()
      if (w.rio!.type === 'replacement') {
        expect(new RegExp(`(^|[^\\p{L}])${w.esWord}(?![\\p{L}])`, 'iu').test(ex.es), `${w.esWord} appears in its own replacement example`).toBe(false)
      }
      expect(ex.en.length).toBeGreaterThan(0)
      expect(ex.ru.length).toBeGreaterThan(0)
    }
  })

  it.each([
    ['foco', 'foco', 'foco', 'standard'],
    ['guapo', 'guapo', 'guapo', 'standard'],
    ['mina', 'mina', 'mina', 'standard'],
    ['saco', 'saco', 'saco', 'standard'],
    ['feria', 'feria', 'feria', 'standard'],
    ['boleto', 'boleto', 'boleto', 'standard'],
    ['colgado', 'colgado', 'colgado', 'standard'],
    ['suprema', 'suprema', 'suprema', 'standard'],
    ['chance', 'chance', 'chance', 'standard'],
    ['torta', 'torta', 'torta', 'standard'],
    ['marcador', 'marcador', 'marcador', 'standard'],
    ['propaganda', 'propaganda', 'propaganda', 'standard'],
    ['vos', 'vos', 'vos', 'standard'],
    ['tú', 'vos', 'Vos', 'rioplatense'],
    ['contigo', 'con vos', 'con vos', 'rioplatense'],
  ])('%s: headword %s, shown in its overlay sentence as “%s”', (esWord, head, shownAs, form) => {
    const w = entry(esWord)
    expect(effectiveExample(w).source).toBe('overlay')
    expect(headword(w)).toMatchObject({ text: head, form })
    expect(highlighted(w)).toBe(shownAs)
    expect(findFormRange(effectiveExample(w).sentence, head, w.pos), 'the headword is in the sentence the card shows').not.toBeNull()
  })

  it('tú and contigo are replacements: vos / con vos lead, the note names the standard Peninsular form', () => {
    for (const [esWord, form] of [['tú', 'vos'], ['contigo', 'con vos']] as const) {
      const w = entry(esWord)
      expect(w.rio).toMatchObject({ type: 'replacement', form, region: null })
      expect(headword(w)).toEqual({ text: form, form: 'rioplatense', secondary: esWord })
      const rel = relationFor(w)
      expect(rel).toMatchObject({ type: 'replacement', standardWord: esWord })
      expect(pickLocalized(rel?.note ?? null, EN_ONLY)).toContain(`"${esWord}"`)
      expect(pickLocalized(rel?.note ?? null, EN_ONLY)).toContain('Peninsular')
      expect(pickLocalized(rel?.note ?? null, RU_ONLY)).toContain(`"${esWord}"`)
    }
  })

  it('the card shows the overlay example, with its own translations, instead of the dictionary one', () => {
    const w = entry('autobús')
    const shown = effectiveExample(w)
    expect(shown.source).toBe('overlay')
    expect(shown.sentence).toBe(w.rio!.example!.es)
    expect(shown.en).toBe(w.rio!.example!.en)
    expect(shown.ru).toBe(w.rio!.example!.ru)
    expect(shown.sentence).not.toBe(w.exampleSentence.replace(/\*+/g, ''))
    expect(highlightTarget(w).sentence).toBe(shown.sentence)
  })

  it('without an overlay example the dictionary example (and its translations) is shown', () => {
    for (const esWord of ['aquí', 'metro', 'coger']) {
      const w = entry(esWord)
      const shown = effectiveExample(w)
      expect(shown.source, esWord).toBe('dictionary')
      expect(shown.en).toBe(w.exampleTranslationEn)
      expect(shown.ru).toBe(w.exampleTranslationRu)
    }
  })

  it('pass-2 failure fallback: no overlay example and none in the dictionary means the standard word keeps the headword and the form is a note', () => {
    const base = entry('cigarrillo')
    const w = { ...base, rio: { ...base.rio!, example: null } as RioInfo } // as if pass 2 had failed for it
    expect(w.exampleSentence).not.toMatch(/pucho/i)
    expect(headword(w)).toEqual({ text: 'cigarrillo', form: 'standard', secondary: null })
    expect(headwordDecision(w)).toMatchObject({ switched: false, reason: 'no-example-has-form', exampleSource: 'dictionary' })
    expect(relationFor(w)).toEqual({ type: 'replacement', rioForm: 'pucho', region: null, note: base.rio!.notes }) // the hand-written note (cigarro / cigarrillo is the usual word) still shows
    expect(highlighted(w)).toBe('cigarrillo') // never a headword that is not in its sentence
    expect(translationsFor(w)).toEqual({ en: w.enTranslation, ru: w.ruTranslation })
  })

  it('a broken overlay example (it does not contain the form) is not trusted: the card falls back to the note', () => {
    const base = entry('autobús')
    const w = { ...base, rio: { ...base.rio!, example: { es: 'Esta frase no tiene la palabra.', en: 'x', ru: 'y', wordForm: 'palabra' } } }
    expect(headwordDecision(w).switched).toBe(false)
    expect(headword(w).text).toBe('autobús')
  })

  it('parses the example from the overlay file and ignores an empty or malformed one', () => {
    const e = (example: unknown) => parseRioOverlay([{ es_word: 'x', rio_type: 'replacement', rio_form: 'y', example }]).get('x')?.example
    expect(e({ es: 'Frase y.', en: 'Sentence.', ru: 'Фраза.', word_form: 'y' })).toEqual({ es: 'Frase y.', en: 'Sentence.', ru: 'Фраза.', wordForm: 'y' })
    expect(e({ es: '', en: 'a', ru: 'b', word_form: 'y' })).toBeNull()
    expect(e('nope')).toBeNull()
    expect(e(undefined)).toBeNull()
  })
})

describe('fallback examples (pass 3)', () => {
  const withFallback = words.filter((w) => w.fallbackExample)
  const SAMPLE = ['niño', 'pequeño', 'esposo', 'mona', 'tarta', 'deprisa', 'garaje', 'muchacho', 'hermoso', 'sofá']

  it('the file has 47 examples, none for an overlay word, none for tony (a junk entry)', () => {
    expect(rawFallback).toHaveLength(47)
    expect(withFallback).toHaveLength(47)
    expect(withFallback.filter((w) => w.rio)).toEqual([])
    expect(entry('tony').fallbackExample).toBeNull()
    expect(entry('casa').fallbackExample).toBeNull()
    expect(entry('ser').fallbackExample).toBeNull() // an irregular form of itself (sos): nothing to fix
  })

  it.each(SAMPLE)('%s: the old example showed another word; the card now shows a sentence with %s itself', (esWord) => {
    const w = entry(esWord)
    expect(w.exampleSentence.replace(/\*+/g, '')).not.toMatch(new RegExp(`(^|[^\\p{L}])${esWord}(?![\\p{L}])`, 'iu'))
    const shown = effectiveExample(w)
    expect(shown.source).toBe('fallback')
    expect(shown.sentence).toBe(w.fallbackExample!.es)
    expect(shown.en).toBe(w.fallbackExample!.en)
    expect(shown.ru).toBe(w.fallbackExample!.ru)
    expect(headword(w)).toEqual({ text: esWord, form: 'standard', secondary: null }) // the standard word keeps the headword
    expect(highlighted(w)!.toLowerCase()).toBe(esWord)
    expect(findFormRange(shown.sentence, esWord, w.pos, true)).not.toBeNull()
  })

  it('every fallback sentence is valid: es_word once, the word form a substring, none of the old Rioplatense words, EN and RU present', () => {
    const rawBy = new Map(rawDictionary.map((d: { es_word: string; word_form_in_example: string | null }) => [d.es_word, d]))
    for (const w of withFallback) {
      const ex = w.fallbackExample!
      expect(ex.wordForm && ex.es.includes(ex.wordForm), w.esWord).toBeTruthy()
      expect(findFormRange(ex.es, w.esWord, w.pos, true), w.esWord).not.toBeNull()
      const oldForm = (rawBy.get(w.esWord) as { word_form_in_example: string }).word_form_in_example
      expect(new RegExp(`(^|[^\\p{L}])${oldForm}(?![\\p{L}])`, 'iu').test(ex.es), `${w.esWord} reuses its old form «${oldForm}»`).toBe(false)
      expect(ex.en.length).toBeGreaterThan(0)
      expect(ex.ru.length).toBeGreaterThan(0)
    }
  })

  it('the overlay example still wins over a fallback one, and a word with neither keeps its dictionary example', () => {
    const base = entry('autobús')
    const both = { ...base, fallbackExample: { es: 'Otra frase con autobús.', en: 'x', ru: 'y', wordForm: 'autobús' } }
    expect(effectiveExample(both).source).toBe('overlay')
    expect(effectiveExample(entry('casa')).source).toBe('dictionary')
  })

  it('parses the file and ignores empty or malformed entries', () => {
    const parsed = parseFallbackExamples([
      { es_word: 'a', es: 'Frase a.', en: 'A.', ru: 'А.', word_form: 'a' },
      { es_word: 'b', es: '', en: 'B.', ru: 'Б.', word_form: 'b' },
      { es_word: 'c', es: 'Frase c.', en: 'C.', ru: 'Ц.' },
      { es: 'Frase d.', en: 'D.', ru: 'Д.', word_form: 'd' },
      null,
    ])
    expect([...parsed.keys()]).toEqual(['a'])
    expect(() => parseFallbackExamples({})).toThrow(/array/)
  })

  it('across all 4753 cards, the headword is in the sentence shown, except irregular verb forms (ser, ver, oír, oler, detener, distraer), the letter r and tony', () => {
    const missing = words
      .filter((w) => findFormRange(effectiveExample(w).sentence, headword(w).text, w.pos, true) === null)
      .map((w) => w.esWord)
      .sort()
    expect(missing).toEqual(['detener', 'distraer', 'oler', 'oír', 'r', 'ser', 'tony', 'ver'])
    expect(words.filter((w) => highlightTarget(w).range === null)).toEqual([]) // every card still highlights something
  }, 30_000)
})

describe('std_usage (is the standard word used in everyday speech?)', () => {
  const replacements = words.filter((w) => w.rio?.type === 'replacement')

  it('every replacement carries it, and no other type does', () => {
    expect(replacements).toHaveLength(63)
    expect(replacements.filter((w) => w.rio!.stdUsage === null).map((w) => w.esWord)).toEqual([])
    expect(words.filter((w) => w.rio && w.rio.type !== 'replacement' && w.rio.stdUsage !== null)).toEqual([])
  })

  it('splits after the manual decisions: 8 not_used (unambiguously Peninsular-only words), 51 less_common, 4 equally_used', () => {
    const count = (u: string) => replacements.filter((w) => w.rio!.stdUsage === u).length
    expect([count('not_used'), count('less_common'), count('equally_used')]).toEqual([8, 51, 4])
    expect(replacements.filter((w) => w.rio!.stdUsage === 'not_used').map((w) => w.esWord).sort()).toEqual(['aparcar', 'chaval', 'gilipollas', 'guay', 'ordenador', 'patata', 'vosotros', 'vuestro'])
    // words that also exist in the region in another sense, or are used there, are never "rarely used here"
    for (const w of ['pastel', 'carro', 'escoger', 'apartamento', 'coger', 'follar', 'coño', 'cojón', 'pluma', 'falda', 'cubo', 'maya', 'portero', 'balón', 'condón', 'metro', 'mando', 'carretera', 'mantequilla', 'autobús', 'piscina', 'gasolina']) {
      expect(entry(w).rio!.stdUsage, w).toBe('less_common')
    }
  })

  it('reaches the relation: the switched headword carries it, a plain word has none', () => {
    expect(relationFor(entry('ordenador'))).toMatchObject({ standardWord: 'ordenador', standardUsage: 'not_used' })
    expect(relationFor(entry('autobús'))).toMatchObject({ standardWord: 'autobús', standardUsage: 'less_common' })
    expect(relationFor(entry('pastel'))).toMatchObject({ standardUsage: 'less_common' }) // overridden by hand
    expect(relationFor(entry('chico'))).toMatchObject({ standardWord: 'chico', standardUsage: 'equally_used' })
    expect(relationFor(entry('periódico'))).toMatchObject({ standardUsage: 'less_common' })
  })

  it('parses only the three known values', () => {
    const u = (v: unknown) => parseRioOverlay([{ es_word: 'x', rio_type: 'replacement', rio_form: 'y', std_usage: v }]).get('x')?.stdUsage
    expect(u('not_used')).toBe('not_used')
    expect(u('less_common')).toBe('less_common')
    expect(u('equally_used')).toBe('equally_used')
    expect(u('sometimes')).toBeNull()
    expect(u(undefined)).toBeNull()
    expect(u(3)).toBeNull()
  })

  it('has the labels in both languages, no Spanish word as UI chrome and no geography claim', () => {
    for (const half of [en.rio, ru.rio]) {
      expect(half.standard.length).toBeGreaterThan(0)
      expect(half.also.length).toBeGreaterThan(0)
      expect(half.pill.length).toBeGreaterThan(0)
    }
    expect(en.rio.standard).toBe('standard')
    expect(ru.rio.standard).toBe('стандарт')
    expect(en.rio.stdUsageHint).toEqual({ equally_used: 'also common', less_common: null, not_used: 'rarely used here' })
    expect(ru.rio.stdUsageHint).toEqual({ equally_used: 'тоже в ходу', less_common: null, not_used: 'здесь почти не говорят' })
    expect(strings.rio).not.toHaveProperty('inSpain')
    expect(JSON.stringify(strings.card)).not.toMatch(/estándar|rioplatense/i)
    expect(JSON.stringify(strings.rio)).not.toMatch(/estándar/i)
  })
})

describe('standard meaning shows its first gloss only', () => {
  it.each([
    ['focus, spotlight', 'focus'],
    ['marker (pen), scoreboard', 'marker (pen)'],
    ['ticket (general)', 'ticket (general)'],
    ['handsome; good-looking', 'handsome'],
    ['thing (a, b), other', 'thing (a, b)'],
    ['single', 'single'],
    ['  padded , x', 'padded'],
  ])('%j → %j', (input, expected) => expect(firstGloss(input)).toBe(expected))
})

describe('what the overlay does to the dictionary', () => {
  it('63 words lead with a Rioplatense headword (every replacement), 13 show a note only (meaning_shift, regional_only), 4677 are untouched', () => {
    const withOverlay = words.filter((w) => w.rio)
    const led = withOverlay.filter((w) => headword(w).form === 'rioplatense')
    const noteOnly = withOverlay.filter((w) => headword(w).form === 'standard' && relationFor(w))
    expect(led).toHaveLength(63)
    expect(led.every((w) => w.rio!.type === 'replacement')).toBe(true)
    expect(withOverlay.filter((w) => w.rio!.type === 'replacement')).toHaveLength(63)
    expect(noteOnly).toHaveLength(13)
    expect(noteOnly.every((w) => w.rio!.type !== 'replacement')).toBe(true)
    expect(withOverlay.filter((w) => headword(w).form === 'standard' && !relationFor(w))).toHaveLength(0)
    expect(words.filter((w) => !w.rio)).toHaveLength(words.length - 76)
    for (const w of words.filter((x) => !x.rio)) {
      expect(headword(w)).toEqual({ text: w.esWord, form: 'standard', secondary: null })
      expect(relationFor(w)).toBeNull()
    }
  })

  it('every replacement that leads really shows its form in the example it displays', { timeout: 30_000 }, () => {
    for (const w of words.filter((x) => x.rio && headword(x).form === 'rioplatense')) {
      expect(findFormRange(effectiveExample(w).sentence, w.rio!.form, w.pos), w.esWord).not.toBeNull()
      expect(highlightTarget(w).range, w.esWord).not.toBeNull()
    }
  })

  it('no overlay card shows a headword that is missing from the sentence it shows (headword text or an inflection of it)', () => {
    const missing = words
      .filter((w) => w.rio)
      .filter((w) => findFormRange(effectiveExample(w).sentence, headword(w).text, w.pos) === null)
      .map((w) => w.esWord)
    expect(missing).toEqual([])
  })

  it('makeWord defaults keep custom and synthetic words overlay-free', () => {
    expect(makeWord('casa').rio).toBeNull()
  })
})
