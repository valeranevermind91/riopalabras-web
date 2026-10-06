import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '../testing/fakeSupabase'
import { parseDictionary } from './dictionary'
import { headword } from './headword'
import {
  batchOf,
  createBatchFinisher,
  learnPhase,
  learnProgressUpdates,
  learnSettingsPatch,
  selectLearnBatch,
  type FinishDeps,
  type LearnBatch,
} from './learn'
import { applyProgressUpdates, applySettingsPatch } from './mutations'
import { parseSettings } from './settings'
import { createSupabaseWriteQueue } from './writeQueue'
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
  it('takes min(10, remainingToday) words', () => {
    const fresh = parseSettings({ daily_new_word_limit: 20 })
    const batch = selectLearnBatch(dictionary, fresh, NOW)
    expect(batch.words).toHaveLength(10)

    const fourLeft = parseSettings({
      daily_new_word_limit: 10,
      new_words_learned_today_count: 6,
      new_words_learned_today_date: '2026-10-02',
    })
    expect(selectLearnBatch(dictionary, fourLeft, NOW).words).toHaveLength(4)
  })

  it('draws from the next 150 candidates (rank 1 = most frequent, function words skipped), not from the head of the queue alone', () => {
    const batch = selectLearnBatch(dictionary, parseSettings(null), NOW)
    const pool = getLearnPool(dictionary)
    const window = new Set(pool.slice(0, 150).map((w) => w.esWord))
    expect(batch.words.every((w) => window.has(w.esWord))).toBe(true)
    expect(pool.slice(0, 5).map((w) => w.esWord)).toContain('ser') // the head of the queue is ser, haber, ir…
    expect(batch.words.map((w) => w.esWord).sort()).not.toEqual(pool.slice(0, 10).map((w) => w.esWord).sort())
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
    expect(batch.words.map((w) => w.esWord).sort()).toEqual(['casa', 'chico', 'perro'])
  })

  it('leaves skipped words in the pool for later batches', () => {
    const words = [
      synthetic('chico', 1, { esRioplatense: 'pibe', wordFormInExample: 'pibe' }),
      synthetic('niño', 2, { esRioplatense: 'pibe', wordFormInExample: 'pibe' }),
      synthetic('casa', 3),
    ]
    const first = selectLearnBatch(words, parseSettings(null), NOW)
    expect(first.words.map((w) => w.esWord).sort()).toEqual(['casa', 'chico'])

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
  const batch: LearnBatch = batchOf([synthetic('Hacienda', 1), synthetic('casa', 2)])

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

describe('createBatchFinisher (the batch goes through the write queue)', () => {
  const batch: LearnBatch = batchOf([synthetic('Hacienda', 1), synthetic('casa', 2), synthetic('perro', 3)])

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function harness(initialRaw: Record<string, unknown> = {}, forBatch: LearnBatch = batch) {
    const fake = fakeSupabase()
    let words: readonly Word[] = forBatch.words
    let settings = parseSettings({ streak_count: 3, streak_last_activity_date: '2026-10-01', learn_picks: ['ser'], ...initialRaw })
    const applied: string[] = []
    const getSettings = () => settings
    const queue = createSupabaseWriteQueue(fake.client, 'user-1', getSettings, { retryDelaysMs: [], sleep: () => Promise.resolve() })
    const deps: FinishDeps = {
      queue,
      getSettings,
      applyProgress: (updates) => {
        words = applyProgressUpdates(words, updates)
        applied.push('progress')
      },
      applySettings: (patch) => {
        settings = applySettingsPatch(settings, patch)
        applied.push('settings')
      },
    }
    return {
      ...fake,
      queue,
      deps,
      applied,
      getWords: () => words,
      getSettings,
      finish: createBatchFinisher(forBatch, deps),
      settled: () => vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false)),
    }
  }

  const rowsOf = (call: { rows: unknown }) => call.rows as { es_word: string; repetitions: number; interval_days: number; ease_factor: number; next_review: string }[]

  it('queues progress then settings, and the SM-2 rows and settings blob are exactly what the old direct path wrote', async () => {
    const h = harness()
    const ticket = h.finish()
    expect(ticket.saved()).toBe(false)
    await h.settled()
    expect(ticket.saved()).toBe(true)

    expect(h.calls.map((c) => c.table)).toEqual(['user_progress', 'user_settings'])
    expect(rowsOf(h.calls[0]).map((r) => r.es_word)).toEqual(['Hacienda', 'casa', 'perro']) // learn order untouched, original casing
    expect(rowsOf(h.calls[0]).every((r) => r.repetitions === 1 && r.interval_days === 0 && r.ease_factor === 2.5)).toBe(true)
    expect(rowsOf(h.calls[0]).every((r) => r.next_review === '2026-10-03T03:00:00.000Z')).toBe(true)
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
  })

  it('mirrors the batch into the store at once (optimistic, like Review): both parts, before any request completes', () => {
    const h = harness()
    h.finish()
    expect(h.applied).toEqual(['progress', 'settings'])
    expect(h.getWords().every((w) => w.repetitions === 1)).toBe(true)
    expect(h.getSettings().streakCount).toBe(4)
    expect(h.getSettings().newWordsLearnedTodayCount).toBe(3)
  })

  it('computes the settings patch from the counter as it was BEFORE the batch (never from the optimistic value)', async () => {
    const h = harness({ new_words_learned_today_count: 4, new_words_learned_today_date: '2026-10-02' })
    h.finish()
    await h.settled()
    expect((h.calls[1].rows as { settings: Record<string, unknown> }).settings.new_words_learned_today_count).toBe(7)
    expect(h.getSettings().newWordsLearnedTodayCount).toBe(7)
  })

  it('a failed progress write sends no settings; the words stay queued; a retry writes everything in order', async () => {
    const h = harness()
    h.failures.user_progress = 1
    const ticket = h.finish()
    await vi.waitFor(() => expect(h.queue.getStatus().failed).toBe(true))
    expect(h.calls.map((c) => c.table)).toEqual(['user_progress']) // the counter did not go out behind the words
    expect(ticket.saved()).toBe(false)
    expect(h.queue.getStatus()).toMatchObject({ pendingRatings: 3, pendingSettings: true })

    expect(await h.queue.retry()).toBe(true)
    expect(h.calls.map((c) => c.table)).toEqual(['user_progress', 'user_progress', 'user_settings'])
    expect(ticket.saved()).toBe(true)
  })

  it('a failed settings write keeps the saved progress; the retry sends only settings, with the same absolute counter', async () => {
    const h = harness({ new_words_learned_today_count: 4, new_words_learned_today_date: '2026-10-02' })
    h.failures.user_settings = 1
    const ticket = h.finish()
    await vi.waitFor(() => expect(h.queue.getStatus().failed).toBe(true))
    expect(ticket.saved()).toBe(false) // not saved until BOTH parts are
    expect(h.queue.getStatus()).toMatchObject({ pendingRatings: 0, pendingSettings: true })

    await h.queue.retry()
    expect(h.calls.map((c) => c.table)).toEqual(['user_progress', 'user_settings', 'user_settings']) // progress was NOT rewritten
    const first = (h.calls[1].rows as { settings: Record<string, unknown> }).settings
    const second = (h.calls[2].rows as { settings: Record<string, unknown> }).settings
    expect(second).toEqual(first)
    expect(second.new_words_learned_today_count).toBe(7) // 4 stored + 3 in this batch, once
    expect(ticket.saved()).toBe(true)
  })

  it('double-tap: the same ticket comes back and each table is written once', async () => {
    const h = harness()
    const a = h.finish()
    const b = h.finish()
    expect(b).toBe(a)
    await h.settled()
    expect(h.calls.map((c) => c.table)).toEqual(['user_progress', 'user_settings'])
    expect(h.getSettings().newWordsLearnedTodayCount).toBe(3)
  })

  it('after a full success, further calls do nothing (cannot double-count)', async () => {
    const h = harness()
    h.finish()
    await h.settled()
    h.finish()
    h.finish()
    await h.queue.flush()
    expect(h.calls).toHaveLength(2)
    expect(h.getSettings().newWordsLearnedTodayCount).toBe(3)
    expect(h.applied).toEqual(['progress', 'settings'])
  })

  it('an empty batch with nothing to change queues nothing and is saved at once', async () => {
    const empty: LearnBatch = batchOf([])
    const h = harness({ streak_last_activity_date: '2026-10-02' }, empty)
    const ticket = h.finish()
    expect(ticket.saved()).toBe(true)
    await h.queue.flush()
    expect(h.calls).toHaveLength(0)
  })
})

describe('learnPhase', () => {
  const ticket = (saved: boolean) => ({ saved: () => saved })
  it('reading until the batch is queued, done from that moment: whether it has been sent is the queue\'s business, never the screen\'s', () => {
    expect(learnPhase(null)).toBe('reading')
    expect(learnPhase(ticket(false))).toBe('done') // not sent yet (offline, retrying, failed): still done
    expect(learnPhase(ticket(true))).toBe('done')
  })
})
