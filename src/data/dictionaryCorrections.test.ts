import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDictionary } from './dictionary'
import { genderArticle, parseNounGender } from './gender'
import { headword, highlightTarget } from './headword'
import { clozeTarget, isPracticeWord } from './practice'
import { isInLearnPool } from './stats'
import { wordStatus } from './wordState'

// Corrections to single dictionary entries after a word report or an evidence check. Each is a decision with its reason; the test keeps it from going stale.

const raw: { es_word: string; pos: string; en_translation: string; ru_translation: string }[] = JSON.parse(readFileSync('public/words_enriched.json', 'utf8'))
const entry = (esWord: string) => raw.find((d) => d.es_word === esWord)
const words = parseDictionary(raw)
const word = (esWord: string) => words.find((w) => w.esWord === esWord)!

describe('words removed from the dictionary', () => {
  // boy, baby and wow are English words the frequency list counted, shown as Spanish nouns/interjections with a sentence that used the English word (ASALE's
  // Diccionario de americanismos: "voz inglesa", no Argentine or Uruguayan sense; Spanish Wiktionary has no Spanish section for baby or wow). tony's gloss
  // ("high-class snob") belonged to another word (its legacy value was "cheto"); the real word is a circus clown, rare in Uruguay.
  const removed = ['boy', 'baby', 'wow', 'tony']
  const standard = { boy: 'chico', baby: 'bebé', wow: 'guau', tony: 'payaso' }

  it.each(removed)('%s is in no shipped data file and not in the fallback source', (esWord) => {
    expect(entry(esWord), 'dictionary').toBeUndefined()
    const fallback: { es_word: string }[] = JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))
    expect(fallback.map((e) => e.es_word), 'public fallback').not.toContain(esWord)
    const source = JSON.parse(readFileSync('tools/rio-overlay/results/overlay-v1/examples.fallback.json', 'utf8'))
    expect(Object.keys(source.examples), 'fallback source').not.toContain(esWord)
    const overlay: { es_word: string }[] = JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))
    expect(overlay.map((e) => e.es_word), 'overlay').not.toContain(esWord)
  })

  it.each(Object.entries(standard))('%s is gone but the Spanish word for it, %s, is still taught', (_removed, spanish) => {
    expect(entry(spanish)).toBeDefined()
  })
})

describe('jo: a short gloss, not a sentence', () => {
  it('reads like a gloss in both languages and says it is mild and from Spain', () => {
    const jo = entry('jo')!
    expect(jo.en_translation).toBe('damn!, darn! (mild; Spain)')
    expect(jo.ru_translation).toBe('чёрт!, блин! (мягко; Испания)')
  })
})

describe('pa: a preposition ("para" shortened), not a noun', () => {
  it('is a preposition like para, so it is reference only: not offered in Learn, not in Review or practice', () => {
    expect(entry('pa')!.pos).toBe('prep')
    expect(entry('para')!.pos).toBe('prep')
    for (const esWord of ['pa', 'para']) {
      const w = word(esWord)
      expect(isInLearnPool(w), `${esWord} in the Learn pool`).toBe(false)
      expect(isPracticeWord({ ...w, repetitions: 3 }), `${esWord} in practice`).toBe(false)
      expect(wordStatus(w, new Date()).kind, `${esWord} status`).toBe('reference')
    }
  })
})

describe('gil: the gloss leads with the slang, not the surname, and the headword is lower case', () => {
  it('says "fool, sucker (informal)" in English and «дурак, простофиля (разг.)» in Russian', () => {
    const gil = entry('gil')!
    expect(gil.en_translation).toBe('fool, sucker (informal)')
    expect(gil.ru_translation).toBe('дурак, простофиля (разг.)')
  })

  // The capital was left over from the surname Gil, which the frequency list had counted. Nobody had progress, hidden or favorite rows under "Gil" (checked in Supabase
  // before the rename), so the key could change; the client matches by lower-cased key everywhere (wordKey), but writes upsert on the exact string.
  it('is keyed "gil", with no "Gil" left, and the card, the highlight and Cloze work with it', () => {
    expect(entry('gil')).toBeDefined()
    expect(entry('Gil')).toBeUndefined()
    const gil = word('gil')
    expect(gil.wordFormInExample).toBe('gil')
    expect(headword(gil).text).toBe('gil')
    const { sentence, range } = highlightTarget(gil)
    expect(range).not.toBeNull()
    expect(sentence.slice(range!.start, range!.end)).toBe('gil')
    expect(clozeTarget(gil)?.target).toBe('gil')
  })
})

// The clean-up after the grammatical-gender study (the owner's list, 15 November): English words and forms of other words that the frequency list counted, entries tagged
// as nouns that are not, and two fixed phrases that were listed as words.
describe('the clean-up after the gender study', () => {
  const noun = JSON.parse(readFileSync('public/noun_gender.json', 'utf8')) as { e: Record<string, string> }
  const gendered = parseDictionary(raw, null, null, parseNounGender(noun))
  const keyed = (esWord: string) => gendered.find((w) => w.esWord === esWord)!

  describe('removed', () => {
    // miro (I look) and detente (stop!) are forms of mirar and detener, which are taught; charles is a name; house is an English word (a music genre), like boy and baby;
    // rica is the feminine of rico; may. is the abbreviation of May. (repente, which only appeared in the phrase "de repente" and was listed as a noun, is renamed: see below.)
    const removed = ['miro', 'detente', 'charles', 'house', 'rica', 'may.']
    const kept = { miro: 'mirar', detente: 'detener', rica: 'rico' }

    it.each(removed)('%s is in no shipped data file, not in the fallback source and has no article', (esWord) => {
      expect(entry(esWord), 'dictionary').toBeUndefined()
      const fallback: { es_word: string }[] = JSON.parse(readFileSync('public/examples_fallback.json', 'utf8'))
      expect(fallback.map((e) => e.es_word), 'public fallback').not.toContain(esWord)
      const source = JSON.parse(readFileSync('tools/rio-overlay/results/overlay-v1/examples.fallback.json', 'utf8'))
      expect(Object.keys(source.examples), 'fallback source').not.toContain(esWord)
      const overlay: { es_word: string }[] = JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))
      expect(overlay.map((e) => e.es_word), 'overlay').not.toContain(esWord)
      expect(Object.keys(noun.e), 'noun articles').not.toContain(esWord)
    })

    it.each(Object.entries(kept))('%s is gone but %s is still taught', (_removed, taught) => {
      expect(entry(taught)).toBeDefined()
    })

    it('the dictionary has 4743 entries: the 4749 it had, less these six and repente, which came back as "de repente"', () => {
      expect(raw.length).toBe(4743)
    })
  })

  describe('re-tagged', () => {
    it.each([
      ['etcétera', 'adv'],
      ['malo', 'adj'],
      ['federal', 'adj'],
      ['católico', 'adj'],
      ['mía', 'determiner'],
      ['tuya', 'determiner'],
      ['te', 'pron'],
      ['mi', 'determiner'],
      ['i', 'letter'],
      ['t', 'letter'],
      ['través', 'prep'],
    ])('%s is %s', (esWord, pos) => {
      expect(entry(esWord)!.pos).toBe(pos)
    })

    it('the ones that are now a pronoun, a determiner, a letter or a preposition are reference only (like pa and the other letters), and the adjectives are taught', () => {
      for (const esWord of ['mía', 'tuya', 'te', 'mi', 'i', 't', 'través']) {
        const w = word(esWord)
        expect(isInLearnPool(w), `${esWord} in the Learn pool`).toBe(false)
        expect(wordStatus(w, new Date()).kind, `${esWord} status`).toBe('reference')
      }
      for (const esWord of ['malo', 'federal', 'católico', 'etcétera']) expect(isInLearnPool(word(esWord)), `${esWord} in the Learn pool`).toBe(true)
    })

    it('none of them has an article any more or still (an adjective, a pronoun, a letter has no gender to show)', () => {
      for (const esWord of ['etcétera', 'malo', 'federal', 'católico', 'mía', 'tuya', 'te', 'mi', 'i', 't', 'través']) expect(genderArticle(keyed(esWord)), esWord).toBeNull()
    })

    it('católico: "Catholic" / «католический», with an example that uses it as an adjective in the form of the headword', () => {
      const c = entry('católico') as unknown as Record<string, string>
      expect(c.en_translation).toBe('Catholic')
      expect(c.ru_translation).toBe('католический')
      expect(c.example_sentence).toBe('Polonia es un país muy católico.')
      expect(c.example_translation_en).toBe('Poland is a very Catholic country.')
      expect(c.example_translation_ru).toBe('Польша — очень католическая страна.')
      expect(c.word_form_in_example).toBe('católico')
      expect(clozeTarget(word('católico'))?.target).toBe('católico')
    })

    it('través keeps its gloss, which now says it is the "a través de" of the preposition', () => {
      expect(entry('través')!.en_translation).toBe('across, through (in "a través de")')
    })
  })

  describe('renamed', () => {
    // No rows for veras or gana in user_progress, user_hidden_words or user_favorites (checked by the owner in Supabase on 15 November), so the key can change.
    it('veras is "de veras", an adverb: "really, truly", with the sentence that already had it, and the card and the highlight work with the phrase (Cloze does not blank a two-word form)', () => {
      expect(entry('veras')).toBeUndefined()
      const e = entry('de veras') as unknown as Record<string, string | number>
      expect(e.pos).toBe('adv')
      expect(e.en_translation).toBe('really, truly')
      expect(e.ru_translation).toBe('правда, в самом деле')
      expect(e.rank).toBe(1213)
      const w = word('de veras')
      expect(headword(w).text).toBe('de veras')
      const { sentence, range } = highlightTarget(w)
      expect(sentence.slice(range!.start, range!.end)).toBe('De veras')
      expect(clozeTarget(w)).toBeNull() // a form of two words is never blanked (like con vos, control remoto): the phrase is taught in Learn, Review and Matching
      expect(genderArticle(keyed('de veras'))).toBeNull()
    })

    it('repente is "de repente", an adverb: "suddenly" / «вдруг, внезапно», with a voseo sentence, and the card and the highlight work with the phrase', () => {
      // No rows for repente in user_progress, user_hidden_words or user_favorites (checked by the owner in Supabase on 15 November). It was a noun ("suddenness") that only
      // ever appeared in "de repente"; it was removed in this clean-up and restored under the phrase, like veras.
      expect(entry('repente')).toBeUndefined()
      const e = entry('de repente') as unknown as Record<string, string | number>
      expect(e.pos).toBe('adv')
      expect(e.en_translation).toBe('suddenly')
      expect(e.ru_translation).toBe('вдруг, внезапно')
      expect(e.rank).toBe(1423)
      expect(e.example_sentence).toBe('Estábamos charlando tranquilos y, de repente, me dijo: «Mirá lo que encontré».')
      expect(e.example_translation_en).toBe('We were chatting calmly and suddenly he said: “Look what I found.”')
      expect(e.example_translation_ru).toBe('Мы спокойно болтали, и вдруг он сказал: «Смотри, что я нашел».')
      expect(e.word_form_in_example).toBe('de repente')
      const w = word('de repente')
      expect(headword(w).text).toBe('de repente')
      const { sentence, range } = highlightTarget(w)
      expect(sentence.slice(range!.start, range!.end)).toBe('de repente')
      expect(clozeTarget(w)).toBeNull() // a two-word form is not blanked
      expect(isInLearnPool(w)).toBe(true)
      expect(Object.keys(noun.e)).not.toContain('repente')
      expect(genderArticle(keyed('de repente'))).toBeNull()
    })

    it('gana is "ganas", the plural the example uses and "tener ganas de" is made of, with the article "las"', () => {
      expect(entry('gana')).toBeUndefined()
      const e = entry('ganas') as unknown as Record<string, string | number>
      expect(e.pos).toBe('n')
      expect(e.rank).toBe(1276)
      expect(e.en_translation).toBe("desire, urge (in 'tener ganas de' - to feel like)")
      expect(e.ru_translation).toBe("желание, охота (в выражении 'tener ganas de' - хотеть)")
      expect(noun.e.ganas).toBe('las')
      expect(genderArticle(keyed('ganas'))).toBe('las')
      expect(Object.keys(noun.e)).not.toContain('gana')
      const w = word('ganas')
      expect(clozeTarget(w)?.target).toBe('ganas')
    })
  })
})
