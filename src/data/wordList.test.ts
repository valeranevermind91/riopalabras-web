import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { parseDictionary } from './dictionary'
import { parseRioOverlay } from './rio'
import { searchWords } from './search'
import type { Word } from './types'
import { NO_FILTERS, buildWordList, createViewStore, initialListView, type ListView } from './wordList'

const NOW = new Date('2026-10-06T15:00:00Z')
const day = 24 * 60 * 60 * 1000
const at = (days: number) => new Date(NOW.getTime() + days * day)
const view = (over: Partial<ListView> = {}) => ({ segment: 'learned' as const, filters: NO_FILTERS, query: '', ...over })
const names = (words: readonly Word[], v: Partial<ListView> = {}) => buildWordList(words, view(v), NOW).rows.map((r) => r.word.esWord)

// A small dictionary with every kind of word in it.
const w = (esWord: string, over: Partial<Word> = {}) => makeWord(esWord, { pos: 'n', enTranslation: `${esWord}-en`, ruTranslation: `${esWord}-ru`, ...over })
const words: Word[] = [
  w('uno', { rank: 1 }), // new
  w('dos', { rank: 2, repetitions: 1, nextReview: at(1) }), // learning, scheduled tomorrow
  w('tres', { rank: 3, repetitions: 3, nextReview: at(10) }), // established, in ten days
  w('cuatro', { rank: 4, repetitions: 2, nextReview: at(-1) }), // due yesterday
  w('cinco', { rank: 5, repetitions: 1, nextReview: at(-3) }), // due three days ago
  w('seis', { rank: 6, repetitions: 0, nextReview: at(-1), easeFactor: 2.18 }), // lapsed: reads as new, has a history
  w('siete', { rank: 7, isHidden: true, repetitions: 2, nextReview: at(5) }), // hidden, with progress
  w('ocho', { rank: 8, isHidden: true }), // hidden, never learned
  w('de', { rank: 9, pos: 'prep' }), // reference-only
  w('nueve', { rank: 10, pos: 'v', isFavorite: true }), // new verb, favourite
  w('diez', { rank: 11, pos: 'adj', repetitions: 2, nextReview: at(2), isFavorite: true }), // established adjective, favourite
  w('once', { rank: 12, pos: 'adv', repetitions: 1, nextReview: null }), // learned, no stored schedule: due
  w('mia', { rank: null, isCustom: true }), // custom: no rank
]

describe('the Learned list', () => {
  it('has the words with progress, due first, then the soonest next review, then the most common', () => {
    // due: cinco (3 days late), cuatro (1 day late), once (no schedule counts as due, sorts last by time);
    // then not due by next review: seis (lapsed, yesterday), dos (tomorrow), diez (2 days), tres (10 days)
    expect(names(words)).toEqual(['cinco', 'cuatro', 'once', 'seis', 'dos', 'diez', 'tres'])
  })

  it('leaves out hidden words (they are in Hidden) and words never touched', () => {
    const list = names(words)
    for (const absent of ['siete', 'ocho', 'uno', 'de', 'nueve', 'mia']) expect(list).not.toContain(absent)
  })

  it('includes a lapsed word, which reads as new', () => {
    const row = buildWordList(words, view(), NOW).rows.find((r) => r.word.esWord === 'seis')
    expect(row?.state).toBe('new')
  })
})

describe('the fallback when nothing is learned yet', () => {
  const untouched = [w('b', { rank: 2 }), w('a', { rank: 1 }), w('c', { rank: 3, isHidden: true })]

  it('shows every word, most common first, and says it fell back', () => {
    const list = buildWordList(untouched, view(), NOW)
    expect(list.fellBack).toBe(true)
    expect(list.segment).toBe('all')
    expect(list.rows.map((r) => r.word.esWord)).toEqual(['a', 'b', 'c'])
  })

  it('the screen always opens on Learned, and the list falls back to everything by itself while nothing is learned', () => {
    expect(initialListView()).toEqual({ segment: 'learned', filters: NO_FILTERS, query: '', scrollTop: 0 })
    expect(buildWordList(untouched, initialListView(), NOW).fellBack).toBe(true)
    expect(buildWordList(words, initialListView(), NOW).fellBack).toBe(false)
    // hidden words with progress are not "learned" for this purpose: they are in Hidden
    expect(buildWordList([w('x', { isHidden: true, repetitions: 3 }), w('y')], initialListView(), NOW).fellBack).toBe(true)
  })

  it('does not fall back when you chose All or Hidden, or when you search', () => {
    expect(buildWordList(untouched, view({ segment: 'hidden' }), NOW).fellBack).toBe(false)
    expect(buildWordList(untouched, view({ segment: 'all' }), NOW).fellBack).toBe(false)
    expect(buildWordList(untouched, view({ query: 'a' }), NOW).fellBack).toBe(false)
  })

  it('once something is learned the Learned list is the learned words only', () => {
    expect(buildWordList([...untouched, w('d', { repetitions: 1, nextReview: at(1) })], view(), NOW).rows.map((r) => r.word.esWord)).toEqual(['d'])
  })
})

describe('All and Hidden', () => {
  it('All is every word, hidden and custom included, most common first, custom words (no rank) last', () => {
    expect(names(words, { segment: 'all' })).toEqual(['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'de', 'nueve', 'diez', 'once', 'mia'])
  })

  it('Hidden is the words marked as known, with or without progress', () => {
    expect(names(words, { segment: 'hidden' })).toEqual(['siete', 'ocho'])
    expect(buildWordList(words, view({ segment: 'hidden' }), NOW).rows.every((r) => r.state === 'hidden')).toBe(true)
  })
})

describe('filters', () => {
  const learnedWith = (filters: Partial<typeof NO_FILTERS>, segment: ListView['segment'] = 'learned') => names(words, { segment, filters: { ...NO_FILTERS, ...filters } })

  it('state: one at a time, by the derived state (a due word is Due, not Established)', () => {
    expect(learnedWith({ state: 'due' })).toEqual(['cinco', 'cuatro', 'once'])
    expect(learnedWith({ state: 'established' })).toEqual(['diez', 'tres']) // cuatro is established by repetitions but due, so it is under Due
    expect(learnedWith({ state: 'learning' })).toEqual(['dos'])
    expect(learnedWith({ state: 'new' })).toEqual(['seis']) // the lapsed word
    expect(learnedWith({ state: 'new' }, 'all')).toEqual(['uno', 'seis', 'nueve', 'mia'])
  })

  it('favourites', () => {
    expect(learnedWith({ favourites: true }, 'all')).toEqual(['nueve', 'diez'])
    expect(learnedWith({ favourites: true })).toEqual(['diez']) // only the learned one
  })

  it('part of speech (codes and spelled-out names both count)', () => {
    expect(learnedWith({ pos: 'verb' }, 'all')).toEqual(['nueve'])
    expect(learnedWith({ pos: 'adj' }, 'all')).toEqual(['diez'])
    expect(learnedWith({ pos: 'adv' }, 'all')).toEqual(['once'])
    expect(buildWordList([w('x', { pos: 'verb' }), w('y', { pos: 'noun' })], view({ segment: 'all', filters: { ...NO_FILTERS, pos: 'verb' } }), NOW).rows.map((r) => r.word.esWord)).toEqual(['x'])
    expect(learnedWith({ pos: 'noun' }, 'all')).toContain('uno')
  })

  it('combine: every filter must hold, inside the segment', () => {
    expect(learnedWith({ state: 'established', favourites: true })).toEqual(['diez'])
    expect(learnedWith({ state: 'established', pos: 'adj' })).toEqual(['diez'])
    expect(learnedWith({ state: 'due', pos: 'adv' })).toEqual(['once'])
    expect(learnedWith({ state: 'new', favourites: true }, 'all')).toEqual(['nueve'])
    expect(learnedWith({ state: 'learning', favourites: true })).toEqual([]) // nothing matches both
  })

  it('the Hidden list ignores a state chip (every word in it is hidden), but keeps favourites and part of speech', () => {
    expect(learnedWith({ state: 'due' }, 'hidden')).toEqual(['siete', 'ocho'])
    expect(learnedWith({ pos: 'verb' }, 'hidden')).toEqual([])
  })
})

describe('search', () => {
  const dictionary = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')), parseRioOverlay(JSON.parse(readFileSync('public/rio_overlay.json', 'utf8'))))
  const hits = (q: string) => searchWords(dictionary, q, Number.POSITIVE_INFINITY, { translations: true })

  it('finds a word through its Spanish form, accent-insensitively', () => {
    const hit = hits('periodico').find((h) => h.word.esWord === 'periódico')
    expect(hit?.via).toBe('es_word')
    expect(hits('PERIÓDICO')[0].word.esWord).toBe('periódico')
  })

  it('finds a word through its Rioplatense form and says so', () => {
    const hit = hits('aca').find((h) => h.word.esWord === 'aquí')
    expect(hit?.via).toBe('rio_form')
  })

  it('finds a word through its English translation', () => {
    const hit = hits('newspaper').find((h) => h.word.esWord === 'periódico')
    expect(hit?.via).toBe('en')
  })

  it('finds a word through its Russian translation', () => {
    const hit = hits('газета').find((h) => h.word.esWord === 'periódico')
    expect(hit?.via).toBe('ru')
  })

  it('ranks exact before prefix before word-start before substring, and Spanish before translations on a tie', () => {
    const small = [
      w('xcasa', { rank: 1, enTranslation: 'z', ruTranslation: 'z' }), // substring
      w('casas', { rank: 2, enTranslation: 'z', ruTranslation: 'z' }), // prefix
      w('la casa', { rank: 3, enTranslation: 'z', ruTranslation: 'z' }), // word start
      w('casa', { rank: 4, enTranslation: 'z', ruTranslation: 'z' }), // exact
      w('hogar', { rank: 0, enTranslation: 'casa', ruTranslation: 'z' }), // exact, but through English
    ]
    expect(searchWords(small, 'casa', 99, { translations: true }).map((h) => h.word.esWord)).toEqual(['casa', 'hogar', 'casas', 'la casa', 'xcasa'])
  })

  it('has no cap here (the Debug preview keeps its 8), and does not look at translations unless asked', () => {
    const many = Array.from({ length: 50 }, (_, i) => w(`casa${i}`, { rank: i + 1 }))
    expect(searchWords(many, 'casa', Number.POSITIVE_INFINITY, { translations: true })).toHaveLength(50)
    expect(searchWords(many, 'casa')).toHaveLength(8)
    expect(searchWords([w('perro', { enTranslation: 'dog' })], 'dog')).toEqual([]) // spanish-only by default
  })

  describe('in the list', () => {
    it('a query searches every word whatever the segment: hidden, unlearned, reference-only and custom ones too', () => {
      expect(names(words, { segment: 'learned', query: 'siete' })).toEqual(['siete']) // hidden, found from Learned
      expect(names(words, { segment: 'hidden', query: 'uno' })).toEqual(['uno']) // new, found from Hidden
      expect(names(words, { segment: 'learned', query: 'mia-en' })).toEqual(['mia']) // custom, through English
    })

    it('rows carry the state of the word and how it matched', () => {
      const list = buildWordList(words, view({ query: 'siete-ru' }), NOW)
      expect(list.searching).toBe(true)
      expect(list.rows[0]).toMatchObject({ state: 'hidden', via: 'ru' })
    })

    it('the chips still narrow the results (and the segment does not)', () => {
      expect(names(words, { query: 'e', filters: { ...NO_FILTERS, favourites: true } })).toEqual(['nueve', 'diez'])
      expect(names(words, { query: 'o', filters: { ...NO_FILTERS, state: 'due' } })).toEqual(expect.arrayContaining(['cuatro', 'cinco', 'once']))
    })

    it('a Rioplatense match carries the marker, a Spanish one does not', () => {
      const rio = w('guapo', { rank: 1, rio: { form: 'fachero', type: 'replacement', translation: null } as never })
      const list = buildWordList([rio], view({ segment: 'all', query: 'fachero' }), NOW)
      expect(list.rows[0].via).toBe('rio_form')
      expect(buildWordList([rio], view({ segment: 'all', query: 'guapo' }), NOW).rows[0].via).toBe('es_word')
    })

    it('an empty or blank query is not a search', () => {
      expect(buildWordList(words, view({ query: '   ' }), NOW).searching).toBe(false)
    })
  })
})

describe('the list view store', () => {
  it('holds the view between visits and starts empty', () => {
    const store = createViewStore()
    expect(store.get()).toBeNull()
    const saved: ListView = { segment: 'all', filters: { ...NO_FILTERS, pos: 'verb' }, query: 'ca', scrollTop: 1440 }
    store.set(saved)
    expect(store.get()).toEqual(saved)
  })
})
