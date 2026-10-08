import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { parseDictionary } from './dictionary'
import { parseRioOverlay } from './rio'
import { searchWords } from './search'
import type { Word } from './types'
import { NO_FILTERS, activeFilterCount, buildWordList, createViewStore, initialListView, type ListView } from './wordList'

const NOW = new Date('2026-10-06T15:00:00Z')
const day = 24 * 60 * 60 * 1000
const at = (days: number) => new Date(NOW.getTime() + days * day)
const view = (over: Partial<ListView> = {}) => ({ segment: 'learned' as const, sort: 'frequency' as const, seed: 1, filters: NO_FILTERS, query: '', ...over })
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
  it('has the words with progress, in the chosen order (most common first by default)', () => {
    expect(names(words)).toEqual(['dos', 'tres', 'cuatro', 'cinco', 'seis', 'diez', 'once'])
  })

  it('leaves out hidden words (they are in Hidden) and words never touched', () => {
    const list = names(words)
    for (const absent of ['siete', 'ocho', 'uno', 'de', 'nueve', 'mia']) expect(list).not.toContain(absent)
  })

  it('includes a lapsed word, which reads as new', () => {
    const row = buildWordList(words, view(), NOW).rows.find((r) => r.word.esWord === 'seis')
    expect(row?.state).toBe('new')
  })

  it('is empty while nothing is learned, and says so rather than showing something else', () => {
    const untouched = [w('b', { rank: 2 }), w('a', { rank: 1 }), w('c', { rank: 3, isHidden: true, repetitions: 3 })]
    expect(buildWordList(untouched, view(), NOW).rows).toEqual([]) // a hidden word with progress is in Hidden, not here
  })
})

describe('where the screen opens', () => {
  it('on All, most common first, with nothing filtered', () => {
    expect(initialListView()).toEqual({ segment: 'all', sort: 'frequency', seed: 0, filters: NO_FILTERS, query: '', scrollTop: 0 })
  })
})

describe('sorting', () => {
  const order = (sort: ListView['sort'], segment: ListView['segment'] = 'all') => names(words, { segment, sort })

  it('Frequency: most common first, words with no rank (custom) last', () => {
    expect(order('frequency')).toEqual(['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'de', 'nueve', 'diez', 'once', 'mia'])
  })

  it('A to Z: by the word as the row shows it, accents ignored', () => {
    const tricky = [w('zorro', { rank: 1 }), w('árbol', { rank: 2 }), w('arbusto', { rank: 3 }), w('Barco', { rank: 4 }), w('ñandú', { rank: 5 })]
    expect(names(tricky, { segment: 'all', sort: 'az' })).toEqual(['árbol', 'arbusto', 'Barco', 'ñandú', 'zorro'])
  })

  it('Due soonest: the earliest next review first, words with no due date last (lapsed and never-learned ones have none)', () => {
    // cinco (3 days late), cuatro (1 day late), dos (tomorrow), diez (in 2 days), siete (hidden, in 5 days), tres (in 10 days)
    // once is learned but has no stored schedule; seis lapsed (no due date): all after the dated ones, by frequency
    expect(order('due').slice(0, 6)).toEqual(['cinco', 'cuatro', 'dos', 'diez', 'siete', 'tres'])
    expect(order('due').slice(6)).toEqual(['uno', 'seis', 'ocho', 'de', 'nueve', 'once', 'mia'])
  })

  it('Recently learned: by the last review, newest first, words never reviewed last', () => {
    const reviewed = [
      w('viejo', { rank: 1, repetitions: 3, interval: 10, nextReview: at(1) }), // reviewed 9 days ago
      w('ayer', { rank: 2, repetitions: 2, interval: 4, nextReview: at(3) }), // reviewed yesterday
      w('hoy', { rank: 3, repetitions: 1, interval: 0, nextReview: at(1) }), // learned today: due at the start of tomorrow
      w('lapso', { rank: 4, repetitions: 0, interval: 0, nextReview: at(-2) }), // lapsed two days ago
      w('nunca', { rank: 5 }),
    ]
    expect(names(reviewed, { segment: 'all', sort: 'recent' })).toEqual(['hoy', 'ayer', 'lapso', 'viejo', 'nunca'])
  })

  it('sorts inside the segment and under the filters', () => {
    expect(names(words, { segment: 'learned', sort: 'due' })).toEqual(['cinco', 'cuatro', 'dos', 'diez', 'tres', 'seis', 'once'])
    expect(names(words, { segment: 'all', sort: 'due', filters: { ...NO_FILTERS, favourites: true } })).toEqual(['diez', 'nueve'])
  })

  it('a search keeps its own order, how well it matches, whatever the sort', () => {
    const small = [w('xcasa', { rank: 1 }), w('casa', { rank: 2 })]
    for (const sort of ['frequency', 'az', 'due', 'recent'] as const) expect(names(small, { query: 'casa', sort })).toEqual(['casa', 'xcasa'])
  })

  describe('Random', () => {
    const big = Array.from({ length: 300 }, (_, i) => w(`palabra${String(i).padStart(3, '0')}`, { rank: i + 1, isFavorite: i % 3 === 0, pos: i % 2 === 0 ? 'n' : 'v' }))
    const random = (seed: number, over: Partial<ListView> = {}) => names(big, { segment: 'all', sort: 'random', seed, ...over })

    it('is the same order for the same seed, however many times the list is built', () => {
      expect(random(42)).toEqual(random(42))
      expect(random(42)).toEqual(random(42))
    })

    it('is a different order for a different seed, and not the plain frequency order', () => {
      expect(random(42)).not.toEqual(random(43))
      expect(random(42)).not.toEqual(names(big, { segment: 'all', sort: 'frequency' }))
    })

    it('the filtered list is the whole shuffle with the other words taken out: same words, same relative order', () => {
      const whole = random(21)
      for (const filters of [{ ...NO_FILTERS, favourites: true }, { ...NO_FILTERS, pos: 'verb' as const }, { ...NO_FILTERS, favourites: true, queued: false, custom: false, pos: 'noun' as const }]) {
        const filtered = random(21, { filters })
        expect(filtered.length).toBeGreaterThan(0)
        expect(filtered.length).toBeLessThan(whole.length)
        expect(whole.filter((name) => filtered.includes(name))).toEqual(filtered)
      }
    })

    it('removing a word from the filtered set leaves the others in the same relative order', () => {
      const favourites = { ...NO_FILTERS, favourites: true }
      const before = random(33, { filters: favourites })
      expect(before.length).toBeGreaterThan(10)
      for (const removed of [before[0], before[Math.floor(before.length / 2)], before[before.length - 1]]) {
        const after = names(
          big.map((word) => (word.esWord === removed ? ({ ...word, isFavorite: false } as Word) : word)), // un-starred
          { segment: 'all', sort: 'random', seed: 33, filters: favourites },
        )
        expect(after).toHaveLength(before.length - 1)
        expect(after).toEqual(before.filter((name) => name !== removed)) // nothing else moved
      }
    })

    it('the same holds in the Hidden list: bringing one word back leaves the rest where they were', () => {
      const hiddenBig = big.map((word, i) => (i % 4 === 0 ? ({ ...word, isHidden: true } as Word) : word))
      const before = names(hiddenBig, { segment: 'hidden', sort: 'random', seed: 5 })
      const brought = before[3]
      const after = names(hiddenBig.map((word) => (word.esWord === brought ? ({ ...word, isHidden: false } as Word) : word)), { segment: 'hidden', sort: 'random', seed: 5 })
      expect(after).toEqual(before.filter((name) => name !== brought))
    })

    it('shows every word of the filtered list exactly once, nothing added and nothing lost', () => {
      for (const filters of [NO_FILTERS, { ...NO_FILTERS, favourites: true }, { ...NO_FILTERS, pos: 'verb' as const }]) {
        const plain = names(big, { segment: 'all', sort: 'frequency', filters })
        const shuffled = random(9, { filters })
        expect(shuffled).toHaveLength(plain.length)
        expect(new Set(shuffled).size).toBe(shuffled.length) // no word twice
        expect([...shuffled].sort()).toEqual([...plain].sort()) // the same words
      }
    })

    it('does not depend on the sort that was chosen before (it always starts from the same list)', () => {
      expect(names(big, { segment: 'all', sort: 'random', seed: 5 })).toEqual(names(big, { segment: 'all', sort: 'random', seed: 5, filters: NO_FILTERS }))
    })

    it('putting a filter on and taking it off gives the same order back (the seed is what fixes it)', () => {
      const before = random(11)
      random(11, { filters: { ...NO_FILTERS, favourites: true } })
      expect(random(11)).toEqual(before)
    })

    it('is ignored during a search: the match order stays', () => {
      const small = [w('xcasa', { rank: 1 }), w('casa', { rank: 2 })]
      for (const seed of [1, 2, 3, 4, 5, 6]) expect(names(small, { query: 'casa', sort: 'random', seed })).toEqual(['casa', 'xcasa'])
    })
  })

  it('counts the filters that are on (the state filter does not count where it is not offered)', () => {
    expect(activeFilterCount(NO_FILTERS, 'all')).toBe(0)
    expect(activeFilterCount({ state: 'due', favourites: true, queued: false, custom: false, pos: 'verb' }, 'all')).toBe(3)
    expect(activeFilterCount({ state: 'due', favourites: false, queued: false, custom: false, pos: null }, 'hidden')).toBe(0)
    expect(activeFilterCount({ state: 'due', favourites: false, queued: false, custom: false, pos: null }, 'hidden', true)).toBe(1) // searching shows it again
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

  it('state: one at a time, by the derived state (a due word is Due now, not Known well)', () => {
    expect(learnedWith({ state: 'due' })).toEqual(['cuatro', 'cinco', 'once'])
    expect(learnedWith({ state: 'established' })).toEqual(['tres', 'diez']) // cuatro is established by repetitions but due, so it is under Due
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
    const saved: ListView = { segment: 'all', sort: 'az', seed: 7, filters: { ...NO_FILTERS, pos: 'verb' }, query: 'ca', scrollTop: 1440 }
    store.set(saved)
    expect(store.get()).toEqual(saved)
  })
})
