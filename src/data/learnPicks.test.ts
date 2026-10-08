import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '../testing/fakeSupabase'
import { makeWord } from '../testing/makeWord'
import { WordDetail } from '../screens/WordDetail'
import { ordinal } from '../strings'
import { createBatchFinisher, learnSettingsPatch, markKnown, selectLearnBatch, undoKnown } from './learn'
import { MAX_LEARN_PICKS, addToQueue, livePicks, queuePosition, removeFromQueue, toggleQueued } from './learnPicks'
import { applyHiddenFlag, applyProgressUpdates, applySettingsPatch } from './mutations'
import { parseSettings } from './settings'
import type { Word } from './types'
import { NO_FILTERS, buildWordList } from './wordList'
import { createSupabaseWriteQueue, createWriteQueue } from './writeQueue'

const NOW = new Date(2026, 9, 5, 14, 30)
const TODAY = '2026-10-05'
const rioForm = { type: 'regional_only', form: 'x', altForm: null, altRegion: null, region: 'uy', register: 'neutral', notes: null, stdMeaning: null, translation: null, stdUsage: null, example: null, confidence: 'high' } as never

/** n unlearned words in rank order, palabra001 …; `rio` lists the (1-based) ranks that are Rioplatense overlay words. */
function dictionary(n: number, rio: number[] = []): Word[] {
  return Array.from({ length: n }, (_, i) => makeWord(`palabra${String(i + 1).padStart(3, '0')}`, { rank: i + 1, rio: rio.includes(i + 1) ? rioForm : null }))
}
const name = (n: number) => `palabra${String(n).padStart(3, '0')}`
const names = (words: readonly Word[]) => words.map((w) => w.esWord)
const isRio = (w: Word) => w.rio !== null

const settingsWith = (picks: string[] | undefined, over: Record<string, unknown> = {}) =>
  parseSettings({ daily_new_word_limit: 20, streak_count: 2, streak_last_activity_date: '2026-10-04', some_future_key: { a: 1 }, ...(picks ? { learn_picks: picks } : {}), ...over })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('what the queue is', () => {
  it('stored as Flutter stores it: an ordered list of trimmed, lowercased es_word, a new one on the end', () => {
    const words = [makeWord('Casa', { rank: 1 }), makeWord('perro', { rank: 2 })]
    let settings = settingsWith(undefined)
    const first = addToQueue(settings, words, words[1])
    expect(first).toMatchObject({ ok: true, position: 1, patch: { learn_picks: ['perro'] } })
    settings = applySettingsPatch(settings, (first as { patch: Record<string, unknown> }).patch)
    const second = addToQueue(settings, words, words[0])
    expect(second).toMatchObject({ ok: true, position: 2, patch: { learn_picks: ['perro', 'casa'] } })
  })

  it('only a word that is not started can be queued: in progress, known well, hidden and reference-only ones are refused', () => {
    const settings = settingsWith(undefined)
    const refused = (w: Word) => addToQueue(settings, [w], w)
    expect(refused(makeWord('a', { repetitions: 1 }))).toEqual({ ok: false, reason: 'not-startable' })
    expect(refused(makeWord('b', { repetitions: 3 }))).toEqual({ ok: false, reason: 'not-startable' })
    expect(refused(makeWord('c', { isHidden: true }))).toEqual({ ok: false, reason: 'not-startable' })
    expect(refused(makeWord('d', { pos: 'prep' }))).toEqual({ ok: false, reason: 'not-startable' })
    expect(refused(makeWord('e', { ruTranslation: '' }))).toEqual({ ok: false, reason: 'not-startable' })
    expect(refused(makeWord('f')).ok).toBe(true)
  })

  it('removing keeps the order of the rest, and is a no-op for a word that is not queued', () => {
    const settings = settingsWith(['a', 'b', 'c'])
    expect(removeFromQueue(settings, makeWord('B'))).toEqual({ learn_picks: ['a', 'c'] })
    expect(removeFromQueue(settings, makeWord('z'))).toBeNull()
  })

  it('a pick that went stale (learned elsewhere, hidden, deleted) is not served and not counted, and stays in the stored list', () => {
    const words = [makeWord('uno', { rank: 1 }), makeWord('dos', { rank: 2, repetitions: 2 }), makeWord('tres', { rank: 3, isHidden: true })]
    expect(names(livePicks(words, ['dos', 'uno', 'tres', 'borrada']))).toEqual(['uno'])
    const settings = settingsWith(['dos', 'uno', 'tres', 'borrada'])
    const added = addToQueue(settings, [...words, makeWord('cuatro', { rank: 4 })], words[0])
    expect(added).toEqual({ ok: false, reason: 'already' })
  })

  it('says its place among the words that can still be taught', () => {
    const words = [makeWord('uno', { rank: 1 }), makeWord('dos', { rank: 2, repetitions: 2 }), makeWord('tres', { rank: 3 })]
    const live = livePicks(words, ['dos', 'uno', 'tres'])
    expect(queuePosition(live, words[0])).toBe(1)
    expect(queuePosition(live, words[2])).toBe(2)
    expect(queuePosition(live, words[1])).toBeNull()
  })

  it('has ordinals that read right: 1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 50th', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 50, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '50th', '101st', '111th'])
  })
})

describe('the cap', () => {
  const words = dictionary(80)

  it('refuses the 51st word, with the queue unchanged', () => {
    const picks = words.slice(0, MAX_LEARN_PICKS).map((w) => w.esWord)
    const settings = settingsWith(picks)
    expect(addToQueue(settings, words, words[MAX_LEARN_PICKS])).toEqual({ ok: false, reason: 'full' })
    expect(addToQueue(settingsWith(picks.slice(0, 49)), words, words[49]).ok).toBe(true)
  })

  it('through the button: nothing is applied or queued for the write, and the refusal is reported', () => {
    let current = settingsWith(words.slice(0, MAX_LEARN_PICKS).map((w) => w.esWord))
    const applied: unknown[] = []
    const sent: unknown[] = []
    const result = toggleQueued(words[MAX_LEARN_PICKS], { getSettings: () => current, words, applySettings: (p) => applied.push(p), queue: { enqueueSettings: (p) => sent.push(p) } })
    expect(result).toEqual({ done: 'refused', reason: 'full' })
    expect([applied, sent]).toEqual([[], []])
    current = applySettingsPatch(current, {})
    expect(current.learnPicks).toHaveLength(MAX_LEARN_PICKS)
  })

  it('a pick gone stale does not use up a place', () => {
    const picks = words.slice(0, MAX_LEARN_PICKS).map((w) => w.esWord)
    const withLearned = words.map((w, i) => (i < 3 ? { ...w, repetitions: 2 } : w))
    expect(addToQueue(settingsWith(picks), withLearned, withLearned[MAX_LEARN_PICKS]).ok).toBe(true)
  })
})

describe('the next batch', () => {
  it('takes the queued words first, in the order they were queued, whatever their rank', () => {
    const words = dictionary(300)
    const batch = selectLearnBatch(words, settingsWith([name(120), name(7), name(250)]), NOW)
    expect(names(batch.words).slice(0, 3)).toEqual([name(120), name(7), name(250)])
    expect(batch.words).toHaveLength(10)
  })

  it('fills the rest from the usual spread over the window, never with a queued word twice', () => {
    const words = dictionary(300)
    const picks = [name(120), name(7), name(250)]
    const batch = selectLearnBatch(words, settingsWith(picks), NOW)
    const filler = batch.words.slice(3)
    expect(filler).toHaveLength(7)
    for (const w of filler) expect(picks).not.toContain(w.esWord)
    // the same seven the batch would have drawn for seven slots from a pool without the queued words
    const plain = selectLearnBatch(
      words.filter((w) => !picks.includes(w.esWord)),
      settingsWith(undefined, { daily_new_word_limit: 7 }),
      NOW,
    )
    expect(new Set(names(filler))).toEqual(new Set(names(plain.words)))
    expect(new Set(names(batch.words)).size).toBe(10)
  })

  it('respects the day: the batch is min(10, what is left today), queued words included', () => {
    const words = dictionary(300)
    const picks = [name(5), name(6), name(7), name(8)]
    const threeLeft = settingsWith(picks, { daily_new_word_limit: 5, new_words_learned_today_count: 2, new_words_learned_today_date: TODAY })
    const batch = selectLearnBatch(words, threeLeft, NOW)
    expect(names(batch.words)).toEqual([name(5), name(6), name(7)]) // three slots, all taken by the queue; the fourth waits
    expect(batch.words).toHaveLength(3)

    const none = selectLearnBatch(words, settingsWith(picks, { daily_new_word_limit: 5, new_words_learned_today_count: 5, new_words_learned_today_date: TODAY }), NOW)
    expect(none.words).toHaveLength(0)
  })

  it('a queue longer than the batch gives the batch only its first ten, and the rest stay queued', () => {
    const words = dictionary(300)
    const picks = Array.from({ length: 14 }, (_, i) => name(100 + i))
    const batch = selectLearnBatch(words, settingsWith(picks), NOW)
    expect(names(batch.words)).toEqual(picks.slice(0, 10))
    expect(learnSettingsPatch(settingsWith(picks), batch, NOW)).toMatchObject({ learn_picks: picks.slice(10) })
  })

  it('leaves out a queued word that can no longer be taught, without a fuss', () => {
    const words = dictionary(300).map((w) => (w.esWord === name(7) ? { ...w, isHidden: true } : w))
    const batch = selectLearnBatch(words, settingsWith([name(120), name(7), name(250)]), NOW)
    expect(names(batch.words).slice(0, 2)).toEqual([name(120), name(250)])
  })

  it('with nothing queued the batch is exactly what it was', () => {
    const words = dictionary(300)
    expect(names(selectLearnBatch(words, settingsWith(undefined), NOW).words)).toEqual(names(selectLearnBatch(words, settingsWith([]), NOW).words))
    expect(selectLearnBatch(words, settingsWith(['no existe']), NOW).words).toHaveLength(10)
  })

  describe('the Rioplatense guarantee holds for the batch as a whole', () => {
    it('a queued Rioplatense word is the batch\'s one: the filler is not forced to widen its search for another', () => {
      // palabra200 is the only other overlay word and lies past the 150-word window: without a queued overlay word the filler
      // would reach out for it every day (see the test below); with one queued it must not.
      const words = dictionary(300, [40, 200])
      for (let day = 0; day < 40; day++) {
        const batch = selectLearnBatch(words, settingsWith([name(40)]), new Date(2026, 9, 1 + day, 9, 0))
        expect(batch.words[0].esWord).toBe(name(40))
        expect(batch.words.filter(isRio).map((w) => w.esWord)).toEqual([name(40)])
        expect(batch.words).toHaveLength(10)
      }
    })

    it('without a queued Rioplatense word the filler adds one, on every day', () => {
      const words = dictionary(300, [40, 200])
      for (let day = 0; day < 40; day++) {
        const batch = selectLearnBatch(words, settingsWith([name(5), name(9)]), new Date(2026, 9, 1 + day, 9, 0))
        expect(batch.words.slice(0, 2).some(isRio)).toBe(false)
        expect(batch.words.some(isRio)).toBe(true)
      }
    })

    it('the filler widens past its window for one slot, as before, when the queue has none', () => {
      const words = dictionary(400, [300])
      const batch = selectLearnBatch(words, settingsWith([name(5)]), NOW)
      expect(names(batch.words)).toContain(name(300))
      expect(batch.words).toHaveLength(10)
    })
  })
})

describe('when a word leaves the queue', () => {
  const settings0 = () => settingsWith([name(120), name(7), name(250), name(260)], { new_words_learned_today_count: 6, new_words_learned_today_date: TODAY })

  function session(picks?: string[]) {
    const fake = fakeSupabase()
    let words: readonly Word[] = dictionary(300)
    let current = picks ? settingsWith(picks, { new_words_learned_today_count: 0, new_words_learned_today_date: TODAY }) : settings0()
    const getSettings = () => current
    const queue = createSupabaseWriteQueue(fake.client, 'user-1', getSettings, { retryDelaysMs: [], sleep: () => Promise.resolve() })
    const applySettings = (p: Record<string, unknown>) => (current = applySettingsPatch(current, p))
    const deps = { queue, applyHidden: (esWords: readonly string[], hidden: boolean) => (words = applyHiddenFlag(words, esWords, hidden)), getSettings, applySettings }
    const applyProgress = (u: Parameters<typeof applyProgressUpdates>[1]) => (words = applyProgressUpdates(words, u))
    return { fake, queue, deps, getWords: () => words, getSettings, applySettings, applyProgress }
  }
  const settingsWrites = (s: ReturnType<typeof session>) => s.fake.calls.filter((c) => c.table === 'user_settings').map((c) => (c.rows as { settings: Record<string, unknown> }).settings)

  it('an abandoned batch leaves the queue exactly as it was: drawing, reading and leaving write nothing', () => {
    const s = session()
    const before = [...s.getSettings().learnPicks]
    const batch = selectLearnBatch(s.getWords(), s.getSettings(), NOW)
    expect(names(batch.words).slice(0, 4)).toEqual(before)
    expect(s.getSettings().learnPicks).toEqual(before)
    expect(s.fake.calls).toHaveLength(0)
    expect(s.queue.getStatus().unsaved).toBe(false)
    // the next time Learn opens, the same words lead again
    expect(names(selectLearnBatch(s.getWords(), s.getSettings(), NOW).words).slice(0, 4)).toEqual(before)
  })

  it('a completed batch clears exactly the words it taught: the queued ones that fit go, the one that did not stays', async () => {
    const s = session()
    const picks = [name(120), name(7), name(250), name(260), name(270)]
    s.applySettings({ learn_picks: picks, daily_new_word_limit: 20, new_words_learned_today_count: 16, new_words_learned_today_date: TODAY })
    const batch = selectLearnBatch(s.getWords(), s.getSettings(), NOW) // four left today: the first four of the queue
    expect(names(batch.words)).toEqual(picks.slice(0, 4))

    createBatchFinisher(batch, { queue: s.queue, getSettings: s.getSettings, applyProgress: s.applyProgress, applySettings: s.applySettings })()
    await vi.waitFor(() => expect(s.queue.getStatus().unsaved).toBe(false))
    expect(s.getSettings().learnPicks).toEqual([name(270)])
    const written = settingsWrites(s).at(-1)!
    expect(written.learn_picks).toEqual([name(270)])
    expect(written.new_words_learned_today_count).toBe(20)
    expect(written.some_future_key).toEqual({ a: 1 })
  })

  it('only the taught words go: a queued word that was swapped out of the batch stays queued', () => {
    const s = session([name(100), name(101), name(102)])
    const batch = selectLearnBatch(s.getWords(), s.getSettings(), NOW)
    const patch = learnSettingsPatch(s.getSettings(), { ...batch, words: batch.words.filter((w) => w.esWord !== name(101)) }, NOW)
    expect(patch.learn_picks).toEqual([name(101)])
  })

  it('no learn_picks key is written for a user who never queued anything', () => {
    const s = session()
    s.applySettings({ learn_picks: undefined })
    const noQueue = parseSettings({ daily_new_word_limit: 20 })
    expect(Object.keys(learnSettingsPatch(noQueue, selectLearnBatch(s.getWords(), noQueue, NOW), NOW))).not.toContain('learn_picks')
  })

  it('"Already know it" on a queued word takes it out of the queue at once, through the settings lane, and the next queued word steps in', async () => {
    const s = session([name(100), name(101), name(102), name(103), name(104), name(105), name(106), name(107), name(108), name(109), name(110), name(111)])
    let batch = selectLearnBatch(s.getWords(), s.getSettings(), NOW)
    expect(names(batch.words)).toEqual(Array.from({ length: 10 }, (_, i) => name(100 + i)))

    batch = markKnown(batch, 1, s.deps)
    expect(s.getSettings().learnPicks).not.toContain(name(101))
    expect(s.getSettings().learnPicks).toHaveLength(11)
    // the batch keeps its size, queued words still lead in order, and the next in line (110) took the gap at the end of them
    expect(names(batch.words)).toEqual([name(100), name(102), name(103), name(104), name(105), name(106), name(107), name(108), name(109), name(110)])
    expect(s.getWords().find((w) => w.esWord === name(101))!.isHidden).toBe(true)
    await vi.waitFor(() => expect(s.queue.getStatus().unsaved).toBe(false))
    expect(settingsWrites(s).at(-1)!.learn_picks).toEqual(s.getSettings().learnPicks)
    expect(settingsWrites(s).at(-1)!.some_future_key).toEqual({ a: 1 })
  })

  it('a filler word marked as known leaves the queue alone (nothing is written to the settings)', async () => {
    const s = session([name(100)])
    let batch = selectLearnBatch(s.getWords(), s.getSettings(), NOW)
    expect(batch.words[0].esWord).toBe(name(100))
    batch = markKnown(batch, 5, s.deps)
    await vi.waitFor(() => expect(s.queue.getStatus().unsaved).toBe(false))
    expect(settingsWrites(s)).toHaveLength(0)
    expect(s.getSettings().learnPicks).toEqual([name(100)])
  })

  it('with no queued word left to step in, a filler takes the gap, behind the queued words', () => {
    const s = session([name(100), name(101), name(102)])
    let batch = selectLearnBatch(s.getWords(), s.getSettings(), NOW)
    batch = markKnown(batch, 0, s.deps)
    expect(names(batch.words).slice(0, 2)).toEqual([name(101), name(102)])
    expect(batch.words).toHaveLength(10)
    expect(s.getSettings().learnPicks).toEqual([name(101), name(102)])
  })

  it('Undo puts the word back where it stood in the queue and in the batch, and the one that stepped in goes back to waiting', () => {
    const picks = Array.from({ length: 12 }, (_, i) => name(100 + i))
    const s = session(picks)
    const original = selectLearnBatch(s.getWords(), s.getSettings(), NOW)
    const marked = markKnown(original, 1, s.deps)
    const undone = undoKnown(marked, s.deps)
    expect(s.getSettings().learnPicks).toEqual(picks)
    expect(names(undone.words)).toEqual(names(original.words))
    expect(names(undone.overflow)).toEqual([name(110), name(111)])
    expect(s.getWords().find((w) => w.esWord === name(101))!.isHidden).toBe(false)
  })

  it('Undo with a filler that took the gap puts everything back', () => {
    const s = session([name(100), name(101)])
    const original = selectLearnBatch(s.getWords(), s.getSettings(), NOW)
    const undone = undoKnown(markKnown(original, 0, s.deps), s.deps)
    expect(names(undone.words)).toEqual(names(original.words))
    expect(s.getSettings().learnPicks).toEqual([name(100), name(101)])
  })

  it('the Rioplatense guarantee survives marking a queued Rioplatense word as known', () => {
    const fake = fakeSupabase()
    const words = dictionary(300, [105, 200])
    let current = settingsWith([name(100), name(105), name(106)])
    const queue = createSupabaseWriteQueue(fake.client, 'user-1', () => current, { retryDelaysMs: [], sleep: () => Promise.resolve() })
    const deps = { queue, applyHidden: () => {}, getSettings: () => current, applySettings: (p: Record<string, unknown>) => (current = applySettingsPatch(current, p)) }
    const batch = markKnown(selectLearnBatch(words, current, NOW), 1, deps)
    expect(batch.words.some(isRio)).toBe(true)
    expect(batch.words).toHaveLength(10)
  })
})

describe('the blob', () => {
  it('queueing writes the whole blob with every other key kept, learn_picks being the only one that changed', async () => {
    const fake = fakeSupabase()
    const words = dictionary(20)
    let current = settingsWith([name(3)], { theme_preference: 'dark', show_ru_translation: false, pending_word_deletes: ['x'] })
    const queue = createSupabaseWriteQueue(fake.client, 'user-1', () => current, { retryDelaysMs: [], sleep: () => Promise.resolve() })
    const result = toggleQueued(words[4], { getSettings: () => current, words, applySettings: (p) => (current = applySettingsPatch(current, p)), queue })
    expect(result).toEqual({ done: 'queued', position: 2 })
    await vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))
    const written = (fake.calls.find((c) => c.table === 'user_settings')!.rows as { settings: Record<string, unknown> }).settings
    expect(written).toEqual({
      daily_new_word_limit: 20,
      streak_count: 2,
      streak_last_activity_date: '2026-10-04',
      some_future_key: { a: 1 },
      theme_preference: 'dark',
      show_ru_translation: false,
      pending_word_deletes: ['x'],
      learn_picks: [name(3), name(5)],
    })
  })

  it('taking a word out writes the shorter list, again with the other keys', async () => {
    const fake = fakeSupabase()
    const words = dictionary(20)
    let current = settingsWith([name(3), name(5), name(7)])
    const queue = createSupabaseWriteQueue(fake.client, 'user-1', () => current, { retryDelaysMs: [], sleep: () => Promise.resolve() })
    expect(toggleQueued(words[4], { getSettings: () => current, words, applySettings: (p) => (current = applySettingsPatch(current, p)), queue })).toEqual({ done: 'removed' })
    await vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))
    const written = (fake.calls.find((c) => c.table === 'user_settings')!.rows as { settings: Record<string, unknown> }).settings
    expect(written.learn_picks).toEqual([name(3), name(7)])
    expect(written.some_future_key).toEqual({ a: 1 })
  })

  it('two quick taps both count: each reads the latest settings', () => {
    const words = dictionary(20)
    let current = settingsWith(undefined)
    const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
    const deps = { getSettings: () => current, words, applySettings: (p: Record<string, unknown>) => (current = applySettingsPatch(current, p)), queue }
    toggleQueued(words[0], deps)
    toggleQueued(words[1], deps)
    expect(current.learnPicks).toEqual([name(1), name(2)])
  })
})

describe('the Words screen: the Queued filter', () => {
  const words = dictionary(10).map((w, i) => (i === 8 ? { ...w, isFavorite: true } : w))
  const queued = new Set([name(2), name(5), name(9)])
  const rows = (filters = {}) => buildWordList(words, { segment: 'all', filters: { ...NO_FILTERS, ...filters }, query: '', sort: 'frequency' }, NOW, queued).rows.map((r) => r.word.esWord)

  it('shows only the queued words, in the order the list has, like Favourites', () => {
    expect(rows({ queued: true })).toEqual([name(2), name(5), name(9)])
    expect(rows({ favourites: true })).toEqual([name(9)])
  })

  it('combines with the other filters', () => {
    expect(rows({ queued: true, favourites: true })).toEqual([name(9)])
  })

  it('is off by default', () => {
    expect(rows()).toHaveLength(10)
  })
})

describe('the word detail', () => {
  const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {} })
  const noop = () => {}
  const detail = (word: Word, words: readonly Word[], settings = settingsWith(undefined)) =>
    renderToStaticMarkup(createElement(WordDetail, { word, data: { words, settings, getSettings: () => settings, applyFavorite: noop, applyHidden: noop, applySettings: noop } as never, queue }))
  const base = makeWord('casa', { rank: 1 })

  it('offers "Queue for Learn" next to "Add to favourites" for a word that is not started', () => {
    const html = detail(base, [base])
    expect(html).toMatch(/Add to favourites<\/button><button[^>]*aria-pressed="false"[^>]*>Queue for Learn<\/button>/)
  })

  it('reads "Queued — remove" when the word is already queued', () => {
    const html = detail(base, [base], settingsWith(['casa']))
    expect(html).toMatch(/aria-pressed="true"[^>]*>Queued — remove<\/button>/)
    expect(html).not.toContain('Queue for Learn')
  })

  it('has no such action for a word in progress, a word known well, a hidden word or a reference-only one (absent, not disabled)', () => {
    for (const word of [makeWord('a', { repetitions: 1, nextReview: new Date(NOW.getTime() + 86_400_000) }), makeWord('b', { repetitions: 4, nextReview: new Date(NOW.getTime() + 9 * 86_400_000) }), makeWord('c', { isHidden: true }), makeWord('d', { pos: 'prep' })]) {
      const html = detail(word, [word])
      expect(html).not.toContain('Queue for Learn')
      expect(html).not.toContain('Queued')
      expect(html).not.toContain('disabled')
    }
  })

  it('says "Beyond today\'s batch" on a queued word whose place is past what is left today, and not on one that will be reached', () => {
    const words = dictionary(30)
    const picks = words.slice(0, 5).map((w) => w.esWord)
    const threeLeft = settingsWith(picks, { daily_new_word_limit: 5, new_words_learned_today_count: 2, new_words_learned_today_date: TODAY })
    expect(detail(words[2], words, threeLeft)).not.toContain('Beyond today')
    expect(detail(words[3], words, threeLeft)).toContain('Beyond today&#x27;s batch')
    expect(detail(words[4], words, threeLeft)).toContain('Beyond today&#x27;s batch')
  })

  it('says nothing about the queue until it is used (the confirmation comes from a tap)', () => {
    expect(detail(base, [base])).not.toContain('in line')
  })

  it('the queue does not become a control on the list row', () => {
    const row = readFileSync('src/components/WordRow.tsx', 'utf8')
    expect(row).not.toMatch(/queue/i)
  })
})
