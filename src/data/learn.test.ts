import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '../testing/fakeSupabase'
import { parseDictionary } from './dictionary'
import { headword } from './headword'
import {
  createBatchFinisher,
  learnProgressUpdates,
  learnSettingsPatch,
  selectLearnBatch,
  type FinishDeps,
  type LearnBatch,
} from './learn'
import { applyProgressUpdates, applySettingsPatch } from './mutations'
import { parseSettings } from './settings'
import { getLearnPool } from './stats'
import type { Word } from './types'

const dictionary = parseDictionary(JSON.parse(readFileSync('public/words_enriched.json', 'utf8')))
const NOW = new Date(2026, 9, 2, 14, 30) // local, Montevideo

function synthetic(esWord: string, rank: number, overrides: Partial<Word> = {}): Word {
  return Object.freeze({
    esWord,
    esRioplatense: null,
    rio: null,
    fallbackExample: null,
    enTranslation: 'x',
    ruTranslation: 'y',
    exampleSentence: '',
    exampleTranslationEn: '',
    exampleTranslationRu: '',
    wordFormInExample: null,
    isRioplatenseVariant: false,
    pos: 'n',
    frequency: 1000 - rank,
    rank,
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: null,
    isFavorite: false,
    isHidden: false,
    isCustom: false,
    isEnriched: true,
    ...overrides,
  })
}

describe('selectLearnBatch', () => {
  it('takes min(10, remainingToday) words in rank order', () => {
    const fresh = parseSettings({ daily_new_word_limit: 20 })
    const batch = selectLearnBatch(dictionary, fresh, NOW)
    expect(batch.words).toHaveLength(10)
    const ranks = batch.words.map((w) => w.rank as number)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))

    const fourLeft = parseSettings({
      daily_new_word_limit: 10,
      new_words_learned_today_count: 6,
      new_words_learned_today_date: '2026-10-02',
    })
    expect(selectLearnBatch(dictionary, fourLeft, NOW).words).toHaveLength(4)
  })

  it('serves the most frequent reviewable words first (rank 1 = most frequent), skipping function words', () => {
    const batch = selectLearnBatch(dictionary, parseSettings(null), NOW)
    const ranks = batch.words.map((w) => w.rank)
    expect(ranks[0]).toBe(5) // "ser" — ranks 1-4 (de, ella, que, el) are non-reviewable parts of speech
    expect(batch.words[0].esWord).toBe('ser')
    expect(Math.max(...(ranks as number[]))).toBeLessThan(50)
  })

  it('is empty when the daily allowance is used up', () => {
    const done = parseSettings({
      daily_new_word_limit: 10,
      new_words_learned_today_count: 10,
      new_words_learned_today_date: '2026-10-02',
    })
    expect(selectLearnBatch(dictionary, done, NOW).words).toHaveLength(0)
    expect(selectLearnBatch(dictionary, parseSettings({ daily_new_word_limit: 0 }), NOW).words).toHaveLength(0)
  })

  it('is empty when the pool is empty', () => {
    const learned = dictionary.map((w) => Object.freeze({ ...w, repetitions: 1 }))
    expect(selectLearnBatch(learned, parseSettings(null), NOW).words).toHaveLength(0)
  })

  it('never puts two words with the same headword in one batch, and keeps scanning until full', () => {
    const words = [
      synthetic('chico', 1, { esRioplatense: 'pibe', wordFormInExample: 'pibe' }),
      synthetic('niño', 2, { esRioplatense: 'pibe', wordFormInExample: 'pibe' }),
      synthetic('PIBE', 3), // collides case-insensitively
      synthetic('casa', 4),
      synthetic('perro', 5),
    ]
    const batch = selectLearnBatch(words, parseSettings({ daily_new_word_limit: 3 }), NOW)
    expect(batch.words.map((w) => w.esWord)).toEqual(['chico', 'casa', 'perro'])
  })

  it('leaves skipped words in the pool for later batches', () => {
    const words = [
      synthetic('chico', 1, { esRioplatense: 'pibe', wordFormInExample: 'pibe' }),
      synthetic('niño', 2, { esRioplatense: 'pibe', wordFormInExample: 'pibe' }),
      synthetic('casa', 3),
    ]
    const first = selectLearnBatch(words, parseSettings(null), NOW)
    expect(first.words.map((w) => w.esWord)).toEqual(['chico', 'casa'])

    const afterFirst = applyProgressUpdates(words, learnProgressUpdates(first, NOW))
    expect(getLearnPool(afterFirst).map((w) => w.esWord)).toEqual(['niño'])
    expect(selectLearnBatch(afterFirst, parseSettings(null), NOW).words.map((w) => w.esWord)).toEqual(['niño'])
  })

  it('uses real dictionary headwords: the six "pibe" words never share a batch', () => {
    const cluster = dictionary.filter((w) => ['chico', 'niño', 'muchacho', 'chaval', 'crío', 'boy', 'casa'].includes(w.esWord))
    expect(cluster.filter((w) => headword(w).text === 'pibe')).toHaveLength(6)
    const batch = selectLearnBatch(cluster, parseSettings(null), NOW)
    expect(batch.words.filter((w) => headword(w).text === 'pibe')).toHaveLength(1)
    expect(batch.words.map((w) => w.esWord)).toContain('casa')
  })

  it('a full real-dictionary batch has no duplicate headwords', () => {
    const batch = selectLearnBatch(dictionary, parseSettings({ daily_new_word_limit: 20 }), NOW)
    const heads = batch.words.map((w) => headword(w).text.toLowerCase())
    expect(new Set(heads).size).toBe(heads.length)
  })

  it('excludes learned and hidden words from the pool', () => {
    const words = [
      synthetic('a', 1, { repetitions: 1 }),
      synthetic('b', 2, { isHidden: true }),
      synthetic('c', 3, { pos: 'prep' }),
      synthetic('d', 4, { ruTranslation: '' }),
      synthetic('e', 5),
    ]
    expect(selectLearnBatch(words, parseSettings(null), NOW).words.map((w) => w.esWord)).toEqual(['e'])
  })

  it('records how many words in the batch were never learned', () => {
    const batch = selectLearnBatch([synthetic('a', 1), synthetic('b', 2)], parseSettings(null), NOW)
    expect(batch.newCount).toBe(2)
  })
})

describe('what Finish writes', () => {
  const batch: LearnBatch = { words: [synthetic('Hacienda', 1), synthetic('casa', 2)], newCount: 2 }

  it('progress: every word gets repetitions 1, interval 0, ease 2.5, due tomorrow at local midnight', () => {
    const updates = learnProgressUpdates(batch, NOW)
    expect(updates.map((u) => u.esWord)).toEqual(['Hacienda', 'casa'])
    for (const u of updates) {
      expect(u).toMatchObject({ repetitions: 1, interval: 0, easeFactor: 2.5 })
      expect(u.nextReview.toISOString()).toBe('2026-10-03T03:00:00.000Z')
    }
  })

  it('settings: streak and today\'s counter in one patch', () => {
    const settings = parseSettings({ streak_count: 3, streak_last_activity_date: '2026-10-01' })
    expect(learnSettingsPatch(settings, batch, NOW)).toEqual({
      streak_count: 4,
      streak_last_activity_date: '2026-10-02',
      new_words_learned_today_count: 2,
      new_words_learned_today_date: '2026-10-02',
    })
  })

  it('settings: a second batch the same day only moves the counter', () => {
    const settings = parseSettings({
      streak_count: 4,
      streak_last_activity_date: '2026-10-02',
      new_words_learned_today_count: 10,
      new_words_learned_today_date: '2026-10-02',
    })
    expect(learnSettingsPatch(settings, batch, NOW)).toEqual({
      new_words_learned_today_count: 12,
      new_words_learned_today_date: '2026-10-02',
    })
  })
})

describe('createBatchFinisher', () => {
  const batch: LearnBatch = { words: [synthetic('Hacienda', 1), synthetic('casa', 2), synthetic('perro', 3)], newCount: 3 }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function harness(initialRaw: Record<string, unknown> = {}) {
    const fake = fakeSupabase()
    let words: readonly Word[] = batch.words
    let settings = parseSettings({ streak_count: 3, streak_last_activity_date: '2026-10-01', learn_picks: ['ser'], ...initialRaw })
    const applied: string[] = []
    const deps: FinishDeps = {
      client: fake.client,
      userId: 'user-1',
      getSettings: () => settings,
      applyProgress: (updates) => {
        words = applyProgressUpdates(words, updates)
        applied.push('progress')
      },
      applySettings: (patch) => {
        settings = applySettingsPatch(settings, patch)
        applied.push('settings')
      },
    }
    return { ...fake, deps, applied, getWords: () => words, getSettings: () => settings, finish: createBatchFinisher(batch, deps) }
  }

  it('writes progress first, then settings, and mirrors each into the store after it succeeds', async () => {
    const h = harness()
    await h.finish()

    expect(h.calls.map((c) => c.table)).toEqual(['user_progress', 'user_settings'])
    expect(h.applied).toEqual(['progress', 'settings'])

    const progressRows = h.calls[0].rows as { es_word: string; repetitions: number; interval_days: number; ease_factor: number; next_review: string }[]
    expect(progressRows.map((r) => r.es_word)).toEqual(['Hacienda', 'casa', 'perro'])
    expect(progressRows.every((r) => r.repetitions === 1 && r.interval_days === 0 && r.ease_factor === 2.5)).toBe(true)
    expect(progressRows.every((r) => r.next_review === '2026-10-03T03:00:00.000Z')).toBe(true)

    expect(h.calls[1].rows).toMatchObject({
      user_id: 'user-1',
      settings: {
        streak_count: 4,
        streak_last_activity_date: '2026-10-02',
        new_words_learned_today_count: 3,
        new_words_learned_today_date: '2026-10-02',
        learn_picks: ['ser'], // unknown-to-this-screen keys survive
      },
    })
    expect(h.getWords().every((w) => w.repetitions === 1)).toBe(true)
    expect(h.getSettings().streakCount).toBe(4)
  })

  it('a failed progress write applies nothing, and a retry writes everything', async () => {
    const h = harness()
    h.failures.user_progress = 1
    await expect(h.finish()).rejects.toThrow('user_progress: boom from user_progress')
    expect(h.applied).toEqual([])
    expect(h.getWords().every((w) => w.repetitions === 0)).toBe(true)

    await h.finish()
    expect(h.calls.map((c) => c.table)).toEqual(['user_progress', 'user_progress', 'user_settings'])
    expect(h.applied).toEqual(['progress', 'settings'])
  })

  it('a failed settings write keeps the saved progress; the retry resumes at settings and counts the batch once', async () => {
    const h = harness({ new_words_learned_today_count: 4, new_words_learned_today_date: '2026-10-02' })
    h.failures.user_settings = 1
    await expect(h.finish()).rejects.toThrow('user_settings: boom from user_settings')
    expect(h.applied).toEqual(['progress'])
    expect(h.getSettings().newWordsLearnedTodayCount).toBe(4) // store untouched by the failed write

    await h.finish()
    // progress was NOT rewritten on retry
    expect(h.calls.map((c) => c.table)).toEqual(['user_progress', 'user_settings', 'user_settings'])
    expect(h.applied).toEqual(['progress', 'settings'])
    // counter = 4 stored + 3 in this batch, even though the store's words already read as learned
    expect((h.calls[2].rows as { settings: Record<string, unknown> }).settings.new_words_learned_today_count).toBe(7)
    expect(h.getSettings().newWordsLearnedTodayCount).toBe(7)
  })

  it('a retry after an ambiguous settings failure writes the same absolute value (idempotent)', async () => {
    const h = harness()
    h.failures.user_settings = 1
    await expect(h.finish()).rejects.toThrow()
    await h.finish()
    const first = (h.calls[1].rows as { settings: unknown }).settings
    const second = (h.calls[2].rows as { settings: unknown }).settings
    expect(second).toEqual(first)
  })

  it('double-submit: concurrent calls share one run, so each table is written once', async () => {
    const h = harness()
    const a = h.finish()
    const b = h.finish()
    expect(b).toBe(a)
    await Promise.all([a, b])
    expect(h.calls.map((c) => c.table)).toEqual(['user_progress', 'user_settings'])
  })

  it('after a full success, further calls do nothing (cannot double-count)', async () => {
    const h = harness()
    await h.finish()
    await h.finish()
    await h.finish()
    expect(h.calls).toHaveLength(2)
    expect(h.getSettings().newWordsLearnedTodayCount).toBe(3)
  })

  it('skips the settings write when there is nothing to change', async () => {
    const empty: LearnBatch = { words: [], newCount: 0 }
    const h = harness({ streak_last_activity_date: '2026-10-02' })
    const finish = createBatchFinisher(empty, h.deps)
    await finish()
    expect(h.calls).toHaveLength(0)
  })
})
