import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { parseDictionary } from './dictionary'
import { parseRioOverlay } from './rio'
import { searchWords } from './search'
import type { Word } from './types'
import { NO_FILTERS, activeFilterCount, buildWordList, createViewStore, initialListView, type ListView, type StageFilter } from './wordList'
import { WELL_LEARNED_DAYS, wordStatus } from './wordState'

const NOW = new Date('2026-10-06T15:00:00Z')
const day = 24 * 60 * 60 * 1000
const at = (days: number) => new Date(NOW.getTime() + days * day)
const view = (over: Partial<ListView> = {}) => ({ segment: 'started' as const, sort: 'frequency' as const, seed: 1, filters: NO_FILTERS, query: '', ...over })
const names = (words: readonly Word[], v: Partial<ListView> = {}) => buildWordList(words, view(v), NOW).rows.map((r) => r.word.esWord)

// A small dictionary with every kind of word in it.
const w = (esWord: string, over: Partial<Word> = {}) => makeWord(esWord, { pos: 'n', enTranslation: `${esWord}-en`, ruTranslation: `${esWord}-ru`, ...over })
const words: Word[] = [
  w('uno', { rank: 1 }), // new
  w('dos', { rank: 2, repetitions: 1, nextReview: at(1) }), // learning (interval 0), scheduled tomorrow
  w('tres', { rank: 3, repetitions: 3, interval: 30, nextReview: at(10) }), // well learned (interval 30), next review in ten days
  w('cuatro', { rank: 4, repetitions: 2, interval: 3, nextReview: at(-1) }), // learning, and due since yesterday
  w('cinco', { rank: 5, repetitions: 1, nextReview: at(-3) }), // learning, and due since three days ago
  w('seis', { rank: 6, repetitions: 0, nextReview: at(-1), easeFactor: 2.18 }), // lapsed by an earlier version: repetitions 0 with a schedule left behind. Learn can still teach it, so it is new and not started
  w('siete', { rank: 7, isHidden: true, repetitions: 2, nextReview: at(5) }), // hidden, with progress
  w('ocho', { rank: 8, isHidden: true }), // hidden, never learned
  w('de', { rank: 9, pos: 'prep' }), // reference-only
  w('nueve', { rank: 10, pos: 'v', isFavorite: true }), // new verb, starred: waiting to be taught
  w('diez', { rank: 11, pos: 'adj', repetitions: 2, interval: 25, nextReview: at(2), isFavorite: true }), // well learned adjective (interval 25) with a star left over: Learn has nothing to teach, so the filter does not list it
  w('once', { rank: 12, pos: 'adv', repetitions: 1, nextReview: null }), // learning, no stored schedule: due
  w('mia', { rank: null, isCustom: true }), // custom: no rank
]

describe('the Started list', () => {
  it('has the words studied (repetitions above 0), in the chosen order (most common first by default)', () => {
    expect(names(words)).toEqual(['dos', 'tres', 'cuatro', 'cinco', 'diez', 'once'])
  })

  it('leaves out hidden words (they are in Hidden) and words never touched', () => {
    const list = names(words)
    for (const absent of ['siete', 'ocho', 'uno', 'de', 'nueve', 'mia']) expect(list).not.toContain(absent)
  })

  it('does not include a lapsed word (repetitions 0 with a schedule left behind): Learn can still teach it, so it is new', () => {
    expect(names(words)).not.toContain('seis')
    const row = buildWordList(words, view({ segment: 'all' }), NOW).rows.find((r) => r.word.esWord === 'seis')
    expect(row?.status).toEqual({ kind: 'new', due: false, started: false })
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

  it('Recently studied: by the last review, newest first, words never reviewed last', () => {
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
    expect(names(words, { segment: 'started', sort: 'due' })).toEqual(['cinco', 'cuatro', 'dos', 'diez', 'tres', 'once'])
    expect(names(words, { segment: 'all', sort: 'due', filters: { ...NO_FILTERS, favourites: true } })).toEqual(['nueve'])
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
      for (const filters of [{ ...NO_FILTERS, favourites: true }, { ...NO_FILTERS, pos: 'verb' as const }, { ...NO_FILTERS, favourites: true, custom: false, pos: 'noun' as const }]) {
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

  it('counts the filters that are on (the stage and Due filters do not count where they are not offered)', () => {
    expect(activeFilterCount(NO_FILTERS, 'all')).toBe(0)
    expect(activeFilterCount({ ...NO_FILTERS, stage: 'learning', due: true, favourites: true, pos: 'verb' }, 'all')).toBe(4)
    expect(activeFilterCount({ ...NO_FILTERS, stage: 'learning', due: true }, 'hidden')).toBe(0)
    expect(activeFilterCount({ ...NO_FILTERS, stage: 'learning', due: true }, 'hidden', true)).toBe(2) // searching shows them again
  })
})

describe('All and Hidden', () => {
  it('All is every word, hidden and custom included, most common first, custom words (no rank) last', () => {
    expect(names(words, { segment: 'all' })).toEqual(['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'de', 'nueve', 'diez', 'once', 'mia'])
  })

  it('Hidden is the words marked as known, with or without progress', () => {
    expect(names(words, { segment: 'hidden' })).toEqual(['siete', 'ocho'])
    expect(buildWordList(words, view({ segment: 'hidden' }), NOW).rows.every((r) => r.status.kind === 'hidden')).toBe(true)
  })
})

describe('filters', () => {
  const learnedWith = (filters: Partial<typeof NO_FILTERS>, segment: ListView['segment'] = 'started') => names(words, { segment, filters: { ...NO_FILTERS, ...filters } })

  it('stage: one at a time, by interval; a word that is due keeps its stage and stays under it', () => {
    expect(learnedWith({ stage: 'learning' })).toEqual(['dos', 'cuatro', 'cinco', 'once']) // cuatro, cinco and once are due and still learning
    expect(learnedWith({ stage: 'wellLearned' })).toEqual(['tres', 'diez'])
    expect(learnedWith({ stage: 'new' })).toEqual([]) // nothing started is new
    expect(learnedWith({ stage: 'new' }, 'all')).toEqual(['uno', 'seis', 'nueve', 'mia']) // seis, the lapsed word, is new
    expect(learnedWith({ stage: 'reference' }, 'all')).toEqual(['de'])
  })

  it('Due now is its own filter and overlaps the stages: learning and due is both', () => {
    expect(learnedWith({ due: true })).toEqual(['cuatro', 'cinco', 'once'])
    expect(learnedWith({ stage: 'learning', due: true })).toEqual(['cuatro', 'cinco', 'once'])
    expect(learnedWith({ stage: 'wellLearned', due: true })).toEqual([]) // tres and diez are not due yet
    expect(learnedWith({ stage: 'wellLearned', due: true }, 'all')).toEqual([])
    const dueMature = [w('maduro', { rank: 1, repetitions: 5, interval: 60, nextReview: at(-1) })]
    expect(names(dueMature, { segment: 'all', filters: { ...NO_FILTERS, stage: 'wellLearned', due: true } })).toEqual(['maduro'])
    expect(names(dueMature, { segment: 'all', filters: { ...NO_FILTERS, stage: 'wellLearned' } })).toEqual(['maduro']) // and it is still under well learned without Due
  })

  it('"Learn sooner" lists the words waiting to be taught, and only those: a star on a word Learn can no longer teach is not listed', () => {
    expect(learnedWith({ favourites: true }, 'all')).toEqual(['nueve']) // diez is learned and still carries a star: nothing is waiting
    expect(learnedWith({ favourites: true })).toEqual([]) // the Learned list holds no waiting word
    const hiddenStar = [w('oculta', { rank: 1, isFavorite: true, isHidden: true }), w('de', { rank: 2, pos: 'prep', isFavorite: true })]
    expect(names(hiddenStar, { segment: 'all', filters: { ...NO_FILTERS, favourites: true } })).toEqual([]) // known, and reference-only
  })

  it('part of speech (codes and spelled-out names both count)', () => {
    expect(learnedWith({ pos: 'verb' }, 'all')).toEqual(['nueve'])
    expect(learnedWith({ pos: 'adj' }, 'all')).toEqual(['diez'])
    expect(learnedWith({ pos: 'adv' }, 'all')).toEqual(['once'])
    expect(buildWordList([w('x', { pos: 'verb' }), w('y', { pos: 'noun' })], view({ segment: 'all', filters: { ...NO_FILTERS, pos: 'verb' } }), NOW).rows.map((r) => r.word.esWord)).toEqual(['x'])
    expect(learnedWith({ pos: 'noun' }, 'all')).toContain('uno')
  })

  it('combine: every filter must hold, inside the segment', () => {
    expect(learnedWith({ stage: 'wellLearned', favourites: true })).toEqual([])
    expect(learnedWith({ stage: 'wellLearned', pos: 'adj' })).toEqual(['diez'])
    expect(learnedWith({ due: true, pos: 'adv' })).toEqual(['once'])
    expect(learnedWith({ stage: 'new', favourites: true }, 'all')).toEqual(['nueve'])
    expect(learnedWith({ stage: 'learning', favourites: true })).toEqual([]) // nothing matches both
  })

  it('the Hidden list ignores the stage and Due chips (every word in it is hidden), but keeps favourites and part of speech; a search brings them back', () => {
    expect(learnedWith({ stage: 'wellLearned' }, 'hidden')).toEqual(['siete', 'ocho'])
    expect(learnedWith({ due: true }, 'hidden')).toEqual(['siete', 'ocho'])
    expect(names(words, { segment: 'hidden', query: 'o', filters: { ...NO_FILTERS, due: true } })).not.toContain('ocho') // searching, the Due chip applies again
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
      expect(names(words, { segment: 'started', query: 'siete' })).toEqual(['siete']) // hidden, found from Started
      expect(names(words, { segment: 'hidden', query: 'uno' })).toEqual(['uno']) // new, found from Hidden
      expect(names(words, { segment: 'started', query: 'mia-en' })).toEqual(['mia']) // custom, through English
    })

    it('rows carry the status of the word and how it matched', () => {
      const list = buildWordList(words, view({ query: 'siete-ru' }), NOW)
      expect(list.searching).toBe(true)
      expect(list.rows[0]).toMatchObject({ status: { kind: 'hidden' }, via: 'ru' })
    })

    it('the chips still narrow the results (and the segment does not)', () => {
      expect(names(words, { query: 'e', filters: { ...NO_FILTERS, favourites: true } })).toEqual(['nueve'])
      expect(names(words, { query: 'o', filters: { ...NO_FILTERS, due: true } })).toEqual(expect.arrayContaining(['cuatro', 'cinco', 'once']))
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

describe('a word rated Again', () => {
  const again = w('otra', { rank: 13, repetitions: 1, interval: 0, easeFactor: 2.18, nextReview: new Date(NOW.getTime() + 10 * 60 * 1000) })
  const list = [w('uno', { rank: 1 }), again]

  it('is in the Started list and under Learning, and not under New', () => {
    expect(names(list, { segment: 'started' })).toEqual(['otra'])
    expect(names(list, { segment: 'started', filters: { ...NO_FILTERS, stage: 'learning' } })).toEqual(['otra'])
    expect(names(list, { segment: 'started', filters: { ...NO_FILTERS, stage: 'new' } })).toEqual([])
    expect(names(list, { segment: 'all', filters: { ...NO_FILTERS, stage: 'new' } })).toEqual(['uno'])
  })

  it('is learning on its row throughout, and due once the ten minutes are up: it stays under Learning', () => {
    const status = (at: Date) => buildWordList(list, view({ segment: 'started' }), at).rows[0].status
    expect(status(NOW)).toEqual({ kind: 'learning', due: false, started: true })
    expect(status(new Date(NOW.getTime() + 10 * 60 * 1000))).toEqual({ kind: 'learning', due: true, started: true })
    const later = new Date(NOW.getTime() + 10 * 60 * 1000)
    expect(buildWordList(list, view({ segment: 'started', filters: { ...NO_FILTERS, stage: 'learning' } }), later).rows.map((r) => r.word.esWord)).toEqual(['otra'])
  })
})

// The row's dot and the filters are one definition (wordStatus): a row's dot is the kind it appears under in the Progress filter, and its Due badge is the Due filter.
describe('the dot, the filters and the segments agree', () => {
  const NOT_HIDDEN_STAGES: readonly StageFilter[] = ['new', 'learning', 'wellLearned', 'reference']
  /** Every kind of word there is: each stage on each side of the 21-day line, due and not, reference-only, hidden, custom, lapsed. */
  const everything: Word[] = []
  let n = 0
  for (const repetitions of [0, 1, 2, 5]) {
    for (const interval of [0, 1, WELL_LEARNED_DAYS - 1, WELL_LEARNED_DAYS, 100]) {
      for (const nextReview of [null, at(-5), at(5)]) {
        for (const extra of [{}, { isHidden: true }, { pos: 'prep' }, { enTranslation: '', ruTranslation: '' }, { isCustom: true, rank: null }]) {
          everything.push(w(`w${n++}`, { rank: n, repetitions, interval, nextReview, ...extra }))
        }
      }
    }
  }
  const all = (filters: Partial<typeof NO_FILTERS> = {}, segment: ListView['segment'] = 'all') => buildWordList(everything, view({ segment, filters: { ...NO_FILTERS, ...filters } }), NOW).rows

  it('every row appears under the Progress filter of its own dot, and under no other', () => {
    for (const stage of NOT_HIDDEN_STAGES) {
      for (const row of all({ stage })) expect(row.status.kind, `${row.word.esWord} under ${stage}`).toBe(stage) // the dot a row shows is its kind
    }
    for (const row of all()) {
      const { kind } = row.status
      if (kind === 'hidden') continue
      const under = NOT_HIDDEN_STAGES.filter((stage) => all({ stage }).some((r) => r.word.esWord === row.word.esWord))
      expect(under, row.word.esWord).toEqual([kind])
    }
  })

  it('a row has the Due badge exactly when it appears under the Due filter', () => {
    const dueNames = new Set(all({ due: true }).map((r) => r.word.esWord))
    for (const row of all()) expect(row.status.due, row.word.esWord).toBe(dueNames.has(row.word.esWord))
  })

  it('no word falls outside every filter: each word that is not hidden sits under exactly one of New, Learning, Well learned and Reference only', () => {
    const rows = all()
    expect(rows.length).toBe(everything.length)
    const seen = new Map<string, number>()
    for (const stage of NOT_HIDDEN_STAGES) for (const r of all({ stage })) seen.set(r.word.esWord, (seen.get(r.word.esWord) ?? 0) + 1)
    for (const row of rows) {
      if (row.word.isHidden) expect(seen.has(row.word.esWord), `${row.word.esWord} is hidden`).toBe(false)
      else expect(seen.get(row.word.esWord), row.word.esWord).toBe(1)
    }
    expect(rows.filter((r) => !r.word.isHidden).length).toBe([...seen.values()].length)
  })

  it('every hidden word is in the Known list, and nothing else is', () => {
    const known = all({}, 'hidden').map((r) => r.word.esWord)
    expect(known.sort()).toEqual(everything.filter((x) => x.isHidden).map((x) => x.esWord).sort())
  })

  it('the Started list is the studied words that are not hidden, reference-only ones included — and it agrees with each word\'s status', () => {
    for (const row of all({}, 'started')) {
      expect(row.word.repetitions, row.word.esWord).toBeGreaterThan(0)
      expect(row.word.isHidden).toBe(false)
    }
    const started = new Set(all({}, 'started').map((r) => r.word.esWord))
    for (const x of everything) expect(started.has(x.esWord), x.esWord).toBe(wordStatus(x, NOW).started)
  })
})
