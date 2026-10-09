import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSection } from '../DataSection'
import { makeWord } from '../testing/makeWord'
import { selectLearnBatch } from './learn'
import { previewLearnBatch, previewLine } from './learnPreview'
import { parseSettings } from './settings'
import type { Word } from './types'

const NOW = new Date(2026, 9, 8, 9, 0)
const name = (rank: number) => `w${String(rank).padStart(4, '0')}`
const dictionary = (n: number): Word[] => Array.from({ length: n }, (_, i) => makeWord(name(i + 1), { rank: i + 1 }))
const words = dictionary(3000)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

const cases: [string, Record<string, unknown>][] = [
  ['no start_rank', { daily_new_word_limit: 10 }],
  ['a start_rank', { daily_new_word_limit: 10, start_rank: 1000 }],
  ['a start_rank and queued words (one from each side)', { daily_new_word_limit: 10, start_rank: 1000, learn_picks: [name(2500), name(40)] }],
  ['a smaller day (4 left)', { daily_new_word_limit: 10, start_rank: 1000, new_words_learned_today_count: 6, new_words_learned_today_date: '2026-10-08' }],
  ['the daily limit reached', { daily_new_word_limit: 10, new_words_learned_today_count: 10, new_words_learned_today_date: '2026-10-08' }],
]

describe('the Debug preview of the next Learn batch', () => {
  it.each(cases)('is exactly the batch Learn would select, in the same order (%s)', (_label, raw) => {
    const settings = parseSettings(raw)
    const batch = selectLearnBatch(words, settings, NOW)
    const preview = previewLearnBatch(words, settings, NOW)
    expect(preview.entries.map((e) => e.esWord)).toEqual(batch.words.map((w) => w.esWord))
    expect(preview.entries.map((e) => e.rank)).toEqual(batch.words.map((w) => w.rank))
    expect(preview.startRank).toBe(settings.startRank)
  })

  it('says where each word came from: queued, the window above start_rank, or the range below it', () => {
    const preview = previewLearnBatch(words, parseSettings({ daily_new_word_limit: 10, start_rank: 1000, learn_picks: [name(2500), name(40)] }), NOW)
    expect(preview.entries.slice(0, 2).map((e) => [e.rank, e.source])).toEqual([[2500, 'queued'], [40, 'queued']]) // a queued word is "queued" on whichever side of start_rank it is
    const rest = preview.entries.slice(2)
    expect(rest.filter((e) => e.source === 'window')).toHaveLength(6)
    expect(rest.filter((e) => e.source === 'below')).toHaveLength(2)
    for (const e of rest) expect(e.source === 'below').toBe(e.rank! < 1000)
  })

  it('with no start_rank nothing is "below"', () => {
    const preview = previewLearnBatch(words, parseSettings({ daily_new_word_limit: 10 }), NOW)
    expect(preview.startRank).toBeNull()
    expect(preview.entries.every((e) => e.source === 'window')).toBe(true)
  })

  it('is read-only: it consumes nothing, and Learn selects the same batch before and after', () => {
    const settings = parseSettings({ daily_new_word_limit: 10, start_rank: 1000, learn_picks: [name(2500)], streak_count: 4 })
    const before = JSON.stringify(settings)
    const wordsBefore = words.map((w) => w.repetitions)
    const first = selectLearnBatch(words, settings, NOW).words.map((w) => w.esWord)
    for (let i = 0; i < 5; i++) previewLearnBatch(words, settings, NOW)
    expect(JSON.stringify(settings)).toBe(before) // the settings (and so the day's counter and the queue) are untouched
    expect(words.map((w) => w.repetitions)).toEqual(wordsBefore) // no word moved on
    expect(selectLearnBatch(words, settings, NOW).words.map((w) => w.esWord)).toEqual(first)
    expect(previewLearnBatch(words, settings, NOW).entries.map((e) => e.esWord)).toEqual(first)
  })

  it('writes nothing: the module takes no queue and no setters, only words and settings', () => {
    expect(previewLearnBatch.length).toBe(3)
  })

  it('a line shows the rank, the word and where it came from; a custom word has no rank', () => {
    expect(previewLine({ esWord: 'casa', rank: 120, source: 'below' })).toBe('120  casa  (below start_rank)')
    expect(previewLine({ esWord: 'mia', rank: null, source: 'queued' })).toBe('—  mia  (queued)')
  })
})

describe('the Debug Data section shows it', () => {
  const render = (raw: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(DataSection, {
        state: {
          status: 'ready',
          data: {
            words,
            settings: parseSettings(raw),
            stats: { total: 0, learned: 0, reviewDue: 0, learnPool: 0, newToLearn: 0, favorites: 0, hidden: 0, custom: 0, streak: 0, dailyLimit: 10, remainingToday: 10 },
            diagnostics: { baseCount: 0, orphanProgress: 0, orphanFavorites: 0, orphanHidden: 0 },
            learnPoolPreview: [],
          } as never,
        },
      }),
    )
  const text = (html: string) => html.replace(/<[^>]+>/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean)

  it('start_rank above the list, then one line per word, in the order the batch presents them', () => {
    const settings = parseSettings({ daily_new_word_limit: 10, start_rank: 1000 })
    const lines = text(render({ daily_new_word_limit: 10, start_rank: 1000 }))
    const at = lines.indexOf('Next Learn batch (the real selection, read-only)')
    expect(at).toBeGreaterThan(-1)
    expect(lines[at + 1]).toBe('start_rank: 1000')
    const expected = previewLearnBatch(words, settings, NOW).entries.map(previewLine)
    expect(expected).toHaveLength(10)
    expect(lines.slice(at + 2, at + 12)).toEqual(expected)
  })

  it('"none" without a start_rank, and a plain note when the day has nothing to hand out', () => {
    const none = text(render({ daily_new_word_limit: 10 }))
    expect(none[none.indexOf('Next Learn batch (the real selection, read-only)') + 1]).toBe('start_rank: none')
    expect(text(render({ daily_new_word_limit: 10, new_words_learned_today_count: 10, new_words_learned_today_date: '2026-10-08' }))).toContain('(empty: nothing left to learn today, or nothing left in the pool)')
  })
})
