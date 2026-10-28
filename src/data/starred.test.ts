import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { createBatchFinisher, markKnown, selectLearnBatch, undoKnown, type KnownDeps } from './learn'
import { applyFavoriteFlag, applyHiddenFlag, applySettingsPatch } from './mutations'
import { parseSettings } from './settings'
import { LEGACY_PICKS_KEY, canStar, legacyPicks, picksMigration, settleStars, staleStars, waitingStars, type SettleDeps } from './starred'
import type { SettingsPatch, UserSettings, Word } from './types'

// "Learn sooner": which words can carry the star, in what order they wait, what happens to the star when the word is taught or marked known,
// and the one-time move of the old Learn queue (learn_picks) into stars.

const NOW = new Date(2026, 9, 5, 9, 0)
const name = (rank: number) => `w${String(rank).padStart(4, '0')}`
const unlearned = (rank: number, over: Partial<Word> = {}) => makeWord(name(rank), { rank, ...over })
const dictionary = (n: number, over: (rank: number) => Partial<Word> = () => ({})) => Array.from({ length: n }, (_, i) => unlearned(i + 1, over(i + 1)))

describe('which words can carry the star', () => {
  const cases: [string, Partial<Word>, boolean][] = [
    ['a word not started yet', {}, true],
    ['a word in progress', { repetitions: 1, nextReview: new Date(2026, 9, 9) }, false],
    ['a word well learned', { repetitions: 4, interval: 30, nextReview: new Date(2026, 10, 9) }, false],
    ['a word marked as known', { isHidden: true }, false],
    ['a word that is not drilled (a preposition: reference only)', { pos: 'prep' }, false],
    ['a word with no translation to show', { enTranslation: '', ruTranslation: '' }, false],
    ['a word the user typed in, not started', { rank: null, isCustom: true }, true],
  ]
  it.each(cases)('%s', (_label, over, expected) => {
    expect(canStar(unlearned(5, over))).toBe(expected)
  })

  it('is exactly what Learn can still teach: the words Learn draws from are the words that can be starred', () => {
    const words = dictionary(300, (r) => (r % 7 === 0 ? { isHidden: true } : r % 11 === 0 ? { repetitions: 2, nextReview: new Date(2026, 9, 20) } : r % 13 === 0 ? { pos: 'prep' } : {}))
    const taught = new Set(selectLearnBatch(words, parseSettings({ daily_new_word_limit: 300 }), NOW).words.map((w) => w.esWord))
    for (const w of words) if (taught.has(w.esWord)) expect(canStar(w), w.esWord).toBe(true)
    for (const w of words.filter((x) => !canStar(x))) expect(taught.has(w.esWord), w.esWord).toBe(false)
  })
})

describe('the order the stars wait in', () => {
  it('oldest star first; a word with no known time after the ones that have one, by rank; ties by rank', () => {
    const words = [
      unlearned(30, { isFavorite: true, starredAt: 300 }),
      unlearned(10, { isFavorite: true, starredAt: null }),
      unlearned(20, { isFavorite: true, starredAt: 100 }),
      unlearned(5, { isFavorite: true, starredAt: 300 }),
      unlearned(7, { isFavorite: false, starredAt: null }),
    ]
    expect(waitingStars(words).map((w) => w.rank)).toEqual([20, 5, 30, 10])
  })

  it('leaves out a star on a word Learn cannot teach, and says which stars those are', () => {
    const words = [
      unlearned(1, { isFavorite: true, starredAt: 1 }),
      unlearned(2, { isFavorite: true, starredAt: 2, repetitions: 3, nextReview: new Date(2026, 10, 1) }),
      unlearned(3, { isFavorite: true, starredAt: 3, isHidden: true }),
      unlearned(4, { isFavorite: true, starredAt: 4, pos: 'prep' }),
    ]
    expect(waitingStars(words).map((w) => w.rank)).toEqual([1])
    expect(staleStars(words)).toEqual([name(2), name(3), name(4)])
  })
})

describe('a star clears when the word is no longer waiting', () => {
  const deps = () => {
    const stars: [string, boolean][] = []
    const hidden: [string, boolean][] = []
    const known: KnownDeps = {
      queue: { enqueueHidden: (w, h) => void hidden.push([w, h]), enqueueFavorite: (w, on) => void stars.push([w, on]) },
      applyHidden: vi.fn(),
      applyFavorite: vi.fn(),
    }
    return { known, stars, hidden }
  }
  const starredPool = () => dictionary(300, (r) => (r <= 40 ? { isFavorite: true, starredAt: r } : {}))

  it('marking a starred word as known clears its star, and the next star takes its place in the batch', () => {
    const d = deps()
    const batch = selectLearnBatch(starredPool(), parseSettings({ daily_new_word_limit: 10 }), NOW)
    expect(batch.words.slice(0, 7).map((w) => w.rank)).toEqual([1, 2, 3, 4, 5, 6, 7])
    const next = markKnown(batch, 2, d.known)
    expect(d.hidden).toEqual([[name(3), true]])
    expect(d.stars).toEqual([[name(3), false]]) // the star goes with it
    expect(d.known.applyFavorite).toHaveBeenCalledWith([name(3)], false)
    expect(next.words).toHaveLength(10)
    expect(next.words.slice(0, 7).map((w) => w.rank)).toEqual([1, 2, 4, 5, 6, 7, 8]) // the star that did not fit took the place
  })

  it('Undo puts the star back with the word', () => {
    const d = deps()
    const batch = selectLearnBatch(starredPool(), parseSettings({ daily_new_word_limit: 10 }), NOW)
    const undone = undoKnown(markKnown(batch, 2, d.known), d.known)
    expect(d.stars).toEqual([[name(3), false], [name(3), true]])
    expect(d.known.applyFavorite).toHaveBeenLastCalledWith([name(3)], true)
    expect(undone.words.map((w) => w.esWord)).toEqual(batch.words.map((w) => w.esWord))
  })

  it('marking a word that was not starred touches no star', () => {
    const d = deps()
    const batch = selectLearnBatch(dictionary(300), parseSettings({ daily_new_word_limit: 10 }), NOW)
    undoKnown(markKnown(batch, 0, d.known), d.known)
    expect(d.stars).toEqual([])
    expect(d.known.applyFavorite).not.toHaveBeenCalled()
  })

  describe('finishing a batch', () => {
    const finisher = (words: readonly Word[]) => {
      let current = words
      let settings: UserSettings = parseSettings({ daily_new_word_limit: 10 })
      const stars: [string, boolean][] = []
      const batch = selectLearnBatch(words, settings, NOW)
      const finish = createBatchFinisher(batch, {
        queue: { enqueueBatch: vi.fn(() => ({ saved: async () => true }) as never), enqueueFavorite: (w, on) => void stars.push([w, on]) },
        getSettings: () => settings,
        applyProgress: vi.fn(),
        applySettings: (p: SettingsPatch) => void (settings = applySettingsPatch(settings, p)),
        applyFavorite: (e, on) => void (current = applyFavoriteFlag(current, e, on)),
        getWords: () => current,
      })
      return { batch, finish, stars, words: () => current, unstar: (e: string) => void (current = applyFavoriteFlag(current, [e], false)) }
    }

    it('clears the star of every word the batch taught, in memory and in the queue, and of no other', () => {
      const f = finisher(dictionary(300, (r) => (r <= 40 ? { isFavorite: true, starredAt: r } : {})))
      f.finish()
      expect(f.stars.map(([w]) => w).sort()).toEqual(f.batch.words.filter((w) => w.isFavorite).map((w) => w.esWord).sort())
      expect(f.stars).toHaveLength(7)
      expect(f.stars.every(([, on]) => on === false)).toBe(true)
      expect(f.words().filter((w) => w.isFavorite).map((w) => w.rank)).toEqual(Array.from({ length: 33 }, (_, i) => i + 8)) // 8..40 are still waiting
    })

    it('clears nothing when nothing in the batch was starred, and writes nothing for it', () => {
      const f = finisher(dictionary(300))
      f.finish()
      expect(f.stars).toEqual([])
    })

    it('a double tap clears once', () => {
      const f = finisher(dictionary(300, (r) => (r <= 40 ? { isFavorite: true, starredAt: r } : {})))
      f.finish()
      f.finish()
      expect(f.stars).toHaveLength(7)
    })

    it('reads the star as it is when the batch is finished: one taken off meanwhile is not cleared again', () => {
      const f = finisher(dictionary(300, (r) => (r <= 40 ? { isFavorite: true, starredAt: r } : {})))
      f.unstar(name(1))
      f.finish()
      expect(f.stars.map(([w]) => w)).not.toContain(name(1))
      expect(f.stars).toHaveLength(6)
    })
  })
})

describe('the old Learn queue (learn_picks), once', () => {
  const settings = (picks: unknown): Pick<UserSettings, 'raw'> => ({ raw: picks === undefined ? { daily_new_word_limit: 10 } : { daily_new_word_limit: 10, [LEGACY_PICKS_KEY]: picks } })

  it('reads the queue in order, and says "no queue" when the key is absent (the migration has run, or was never needed)', () => {
    expect(legacyPicks(settings(['b', 'a']))).toEqual(['b', 'a'])
    expect(legacyPicks(settings(undefined))).toBeNull()
    expect(legacyPicks(settings('garbage'))).toEqual([]) // a key that is there but unreadable is still removed
    expect(legacyPicks(settings(['a', 3, null, 'b']))).toEqual(['a', 'b'])
  })

  it('stars the queued words that can still be taught, in queue order, and removes the key', () => {
    const words = dictionary(50, (r) => (r === 9 ? { isHidden: true } : r === 11 ? { repetitions: 2, nextReview: new Date(2026, 10, 1) } : r === 12 ? { isFavorite: true, starredAt: 5 } : {}))
    const m = picksMigration(words, settings([name(30), name(9), name(11), name(12), name(4), 'not-in-the-dictionary', name(30)]))!
    expect(m.star).toEqual([name(30), name(4)]) // not the hidden one, not the learned one, not the one already starred, not a stranger, each once
    expect(m.patch).toEqual({ [LEGACY_PICKS_KEY]: null })
  })

  it('matches words by key, so a queue written in lowercase finds a custom word typed with capitals', () => {
    const words = [...dictionary(5), makeWord('Zapallito', { rank: null, isCustom: true })]
    expect(picksMigration(words, settings(['zapallito']))!.star).toEqual(['Zapallito'])
  })

  it('has nothing to do for an account without the key', () => {
    expect(picksMigration(dictionary(5), settings(undefined))).toBeNull()
  })

  it('an empty queue still removes the key (so it is not looked at again)', () => {
    expect(picksMigration(dictionary(5), settings([]))).toEqual({ star: [], patch: { [LEGACY_PICKS_KEY]: null } })
  })

  describe('settling at launch', () => {
    const rig = (initial: Record<string, unknown>, initialWords: readonly Word[]) => {
      let current = parseSettings(initial)
      let words = initialWords
      const stars: [string, boolean][] = []
      const patches: SettingsPatch[] = []
      const deps = (): SettleDeps => ({
        words,
        settings: current,
        applyFavorite: (e, on) => void (words = applyFavoriteFlag(words, e, on)),
        applySettings: (p) => void (current = applySettingsPatch(current, p)),
        queue: { enqueueFavorite: (w, on) => void stars.push([w, on]), enqueueSettings: (p) => void patches.push(p) },
      })
      return { deps, stars, patches, words: () => words, settings: () => current }
    }

    it('runs the migration once: the second launch finds no key, and writes nothing', () => {
      const r = rig({ daily_new_word_limit: 10, some_future_key: { a: 1 }, [LEGACY_PICKS_KEY]: [name(3), name(8)] }, dictionary(20))
      const first = settleStars(r.deps())
      expect(first.migrated).toEqual([name(3), name(8)])
      expect(r.stars).toEqual([[name(3), true], [name(8), true]])
      expect(r.patches).toEqual([{ [LEGACY_PICKS_KEY]: null }])
      expect(r.settings().raw[LEGACY_PICKS_KEY]).toBeUndefined()
      expect(r.settings().raw.some_future_key).toEqual({ a: 1 }) // every other key stays
      expect(r.words().filter((w) => w.isFavorite).map((w) => w.esWord)).toEqual([name(3), name(8)])

      const second = settleStars(r.deps())
      expect(second).toEqual({ migrated: [], cleared: [] })
      expect(r.stars).toHaveLength(2) // nothing new was written
      expect(r.patches).toHaveLength(1)
    })

    it('clears the stars that do nothing: a word learned or marked known elsewhere, or by the placement test', () => {
      const words = dictionary(20, (r) => (r === 2 ? { isFavorite: true, starredAt: 1, repetitions: 2, nextReview: new Date(2026, 10, 1) } : r === 3 ? { isFavorite: true, starredAt: 2, isHidden: true } : r === 4 ? { isFavorite: true, starredAt: 3 } : {}))
      const r = rig({ daily_new_word_limit: 10 }, words)
      expect(settleStars(r.deps())).toEqual({ migrated: [], cleared: [name(2), name(3)] })
      expect(r.stars).toEqual([[name(2), false], [name(3), false]])
      expect(r.words().filter((w) => w.isFavorite).map((w) => w.esWord)).toEqual([name(4)]) // the waiting star stays
      expect(settleStars(r.deps()).cleared).toEqual([]) // and nothing is left to clear
    })

    it('a star set by the migration is not cleared by the same pass', () => {
      const r = rig({ [LEGACY_PICKS_KEY]: [name(5)] }, dictionary(20))
      expect(settleStars(r.deps())).toEqual({ migrated: [name(5)], cleared: [] })
    })

    it('does nothing for an account with no queue and no stale stars: no write at all', () => {
      const r = rig({ daily_new_word_limit: 10 }, applyHiddenFlag(dictionary(20), [name(1)], true))
      expect(settleStars(r.deps())).toEqual({ migrated: [], cleared: [] })
      expect(r.stars).toEqual([])
      expect(r.patches).toEqual([])
    })
  })
})

describe('the app settles the stars once per launch', () => {
  const app = readFileSync('src/App.tsx', 'utf8')
  const effect = app.match(/const settledFor = useRef[\s\S]*?\}, \[queue, readyData, userId\]\)/)?.[0] ?? ''

  it('runs settleStars on the loaded data, and no more than once for a user', () => {
    expect(effect).toMatch(/settleStars\(\{ words: readyData\.words, settings: readyData\.settings, applyFavorite: readyData\.applyFavorite, applySettings: readyData\.applySettings, queue \}\)/)
    expect(effect).toMatch(/settledFor\.current === userId/)
    expect(effect).toMatch(/settledFor\.current = userId/)
  })

  it('waits for a clean load: with the favourites still failing, "no stars" would be a wrong picture', () => {
    expect(effect).toMatch(/readyData\.degraded\.length > 0\) return/)
  })

  it('needs the write queue as well, so the cleared stars and the removed key are sent', () => {
    expect(effect).toMatch(/!queue \|\| !readyData \|\| !userId/)
  })
})

describe('the Learn screen hands the star to Learn\'s two actions', () => {
  const learn = readFileSync('src/screens/Learn.tsx', 'utf8')

  it('"Already know it" clears and restores the star through the screen\'s own data', () => {
    expect(learn).toMatch(/const knownDeps = \{ queue, applyHidden: data\.applyHidden, applyFavorite: data\.applyFavorite \}/)
  })

  it('finishing a batch clears the stars of the words it taught through the same data', () => {
    expect(learn).toMatch(/createBatchKeeper\(\{[\s\S]*?applyFavorite: data\.applyFavorite,/)
  })
})
