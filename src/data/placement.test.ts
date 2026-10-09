import { describe, expect, it, vi } from 'vitest'
import { seededRandom } from '../lib/random'
import { makeWord } from '../testing/makeWord'
import { BAND_COUNT, BAND_SIZE, START_RANK_KEY, WALL, buildPlacement, fromStartRank, placementPool, placementResult, savePlacement, startRankFor, type PlacementBand } from './placement'
import { headword } from './headword'
import { selectLearnBatch } from './learn'
import { WINDOW_SIZE } from './learnPick'
import { applySettingsPatch } from './mutations'
import { mergeSettingsRaw, parseSettings } from './settings'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import type { Word } from './types'
import { createWriteQueue } from './writeQueue'

// A dictionary of n ordinary words, ranks 1..n.
const dictionary = (n: number, over: (rank: number) => Partial<Word> = () => ({})): Word[] => Array.from({ length: n }, (_, i) => makeWord(`w${String(i + 1).padStart(4, '0')}`, { rank: i + 1, ...over(i + 1) }))
const DAY = new Date(2026, 9, 8, 9, 0)

describe('the five bands', () => {
  const words = dictionary(1000)

  it('are five sets of five, and ascend in rarity: the first starts at the most frequent word, the last is at the rare end', () => {
    const bands = buildPlacement(words, seededRandom(1))!
    expect(bands).toHaveLength(BAND_COUNT)
    for (const band of bands) expect(band.words).toHaveLength(BAND_SIZE)
    expect(bands.map((b) => b.startRank)).toEqual([1, 201, 401, 601, 801]) // five equal parts of the list
    const ranks = bands.map((b) => b.words.map((w) => w.rank!))
    expect(Math.min(...ranks[0])).toBeLessThanOrEqual(200)
    expect(Math.min(...ranks[4])).toBeGreaterThanOrEqual(801)
    expect(Math.max(...ranks[4])).toBeLessThanOrEqual(1000)
  })

  it('cover the rank range and do not overlap: every word of band k lies in its own part, over many runs', () => {
    const starts = [1, 201, 401, 601, 801, 1001]
    for (let run = 0; run < 300; run++) {
      const bands = buildPlacement(words, seededRandom(run))!
      bands.forEach((band, k) => {
        for (const w of band.words) {
          expect(w.rank!, `run ${run} band ${k}`).toBeGreaterThanOrEqual(starts[k])
          expect(w.rank!, `run ${run} band ${k}`).toBeLessThan(starts[k + 1])
        }
      })
    }
    // together the parts tile 1..1000 exactly
    expect(starts[0]).toBe(1)
    expect(starts[5] - 1).toBe(1000)
  })

  it('the same word never appears twice in one run, and a run has 25 different words', () => {
    for (let run = 0; run < 300; run++) {
      const all = buildPlacement(words, seededRandom(run))!.flatMap((b) => b.words.map((w) => w.esWord))
      expect(all).toHaveLength(25)
      expect(new Set(all).size).toBe(25)
    }
  })

  it('differ from run to run (and the same random numbers give the same run)', () => {
    const names = (seed: number) => buildPlacement(words, seededRandom(seed))!.flatMap((b) => b.words.map((w) => w.esWord)).join()
    expect(names(1)).toBe(names(1))
    expect(new Set(Array.from({ length: 20 }, (_, i) => names(i + 1))).size).toBe(20)
    // with real randomness too
    expect(buildPlacement(words)!.flatMap((b) => b.words.map((w) => w.esWord)).join()).not.toBe(buildPlacement(words)!.flatMap((b) => b.words.map((w) => w.esWord)).join())
  })

  it('draw only from words Learn could teach: dictionary words with both translations, not learned, not hidden, a part of speech that is drilled', () => {
    const mixed = dictionary(600, (rank) => {
      if (rank % 6 === 1) return { isCustom: true }
      if (rank % 6 === 2) return { isHidden: true }
      if (rank % 6 === 3) return { repetitions: 2 }
      if (rank % 6 === 4) return { enTranslation: '' }
      if (rank % 6 === 5) return { pos: 'prep' }
      return {}
    })
    const eligible = mixed.filter((w) => w.rank! % 6 === 0)
    expect(placementPool(mixed).map((w) => w.esWord)).toEqual(eligible.map((w) => w.esWord))
    for (let run = 0; run < 50; run++) {
      for (const band of buildPlacement(mixed, seededRandom(run))!) for (const w of band.words) expect(w.rank! % 6, w.esWord).toBe(0)
    }
    // the parts are cut from the eligible words, so each band's lowest rank is an eligible word's
    for (const band of buildPlacement(mixed, seededRandom(1))!) expect(band.startRank % 6).toBe(0)
  })

  it('never shows two words with the same headword in a run (in any band)', () => {
    const twins = dictionary(500, (rank) => (rank % 2 === 0 ? {} : {}))
    // every word has a twin: same esWord casing is not possible, so give two words one headword through the Rioplatense form
    const withTwins = twins.map((w, i) => (i % 2 === 1 ? { ...w, esRioplatense: 'comun', wordFormInExample: 'comun', exampleSentence: 'Es comun.' } : w))
    const heads = (bands: PlacementBand[]) => bands.flatMap((b) => b.words.map((w) => headword(w).text.toLowerCase()))
    for (let run = 0; run < 100; run++) {
      const list = heads(buildPlacement(withTwins, seededRandom(run))!)
      expect(new Set(list).size).toBe(list.length)
    }
  })

  it('is not possible without enough words: fewer than five in some part gives no test', () => {
    expect(buildPlacement(dictionary(24))).toBeNull()
    expect(buildPlacement(dictionary(25))).not.toBeNull()
    expect(buildPlacement([])).toBeNull()
    expect(buildPlacement(dictionary(300, () => ({ repetitions: 1 })))).toBeNull() // everything already learned
  })
})

describe('where Learn starts: the first band with two or fewer marked decides it', () => {
  const starts = [1, 201, 401, 601, 801]
  const at = (counts: number[]) => startRankFor(counts, starts)

  it('the wall is two of five', () => {
    expect(WALL).toBe(2)
  })

  it('the first band with two or fewer decides: the start is that band\'s lowest rank', () => {
    expect(at([5, 4, 2, 0, 0])).toBe(401)
    expect(at([5, 5, 5, 2, 1])).toBe(601)
    expect(at([4, 1, 5, 5, 5])).toBe(201) // a later band that is all marked again changes nothing
    expect(at([5, 5, 5, 5, 2])).toBe(801)
  })

  it('every band with three or more marked: the last band\'s lowest rank', () => {
    expect(at([5, 5, 5, 5, 5])).toBe(801)
    expect(at([3, 3, 3, 3, 3])).toBe(801)
    expect(at([4, 3, 4, 3, 5])).toBe(801)
  })

  it('three is not a wall and two is', () => {
    expect(at([3, 3, 3, 3, 3])).toBe(801)
    expect(at([3, 3, 3, 3, 2])).toBe(801) // the wall is the last band: its lowest rank, the same number
    expect(at([3, 3, 2, 3, 3])).toBe(401)
  })

  it('one lucky hit in the rare band moves nothing: the wall in the middle stops it', () => {
    expect(at([5, 5, 1, 0, 1])).toBe(401)
    expect(at([5, 4, 0, 0, 1])).toBe(401)
    expect(at([5, 5, 5, 5, 1])).toBe(801) // and with a real vocabulary up to the last band, one hit there is the whole answer
    expect(at([5, 5, 5, 5, 0])).toBe(801)
  })

  it('a first band with two or fewer is a beginner: no start rank, the default start is right', () => {
    expect(at([2, 5, 5, 5, 5])).toBeNull()
    expect(at([0, 0, 0, 0, 0])).toBeNull()
    expect(at([1, 4, 4, 4, 4])).toBeNull()
    expect(at([0, 5, 5, 5, 5])).toBeNull() // however much comes later
  })

  it('selecting none and continuing is allowed: none marked is a beginner', () => {
    const bands = buildPlacement(dictionary(1000), seededRandom(3))!
    expect(placementResult(bands, bands.map(() => new Set<string>()))).toEqual({ startRank: null, marked: [] })
  })

  it('is worked out from the words really marked, band by band', () => {
    const bands = buildPlacement(dictionary(1000), seededRandom(3))!
    const all = (k: number, n: number) => new Set(bands[k].words.slice(0, n).map((w) => w.esWord))
    const selected = [all(0, 5), all(1, 4), all(2, 2), all(3, 5), all(4, 5)] // band 3 is the wall; the later bands are marked in full
    const result = placementResult(bands, selected)
    expect(result.startRank).toBe(bands[2].startRank)
    expect(result.marked).toHaveLength(5 + 4 + 2 + 5 + 5)
    expect(new Set(result.marked).size).toBe(result.marked.length)
    // a word marked in another band's set does not count for this one
    const stray = placementResult(bands, [new Set(bands[1].words.map((w) => w.esWord)), new Set(), new Set(), new Set(), new Set()])
    expect(stray.marked).toEqual([])
  })
})

describe('keeping the result', () => {
  function target(raw: Record<string, unknown> = {}) {
    let current = parseSettings(raw)
    const hidden: [readonly string[], boolean][] = []
    const settings: Record<string, unknown>[] = []
    const batches: [readonly string[], boolean][] = []
    const sent: string[][] = []
    const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async (p) => void settings.push(p), sendHidden: async (ops) => void sent.push(ops.map((o) => o.esWord)) }, { retryDelaysMs: [1], sleep: async () => {} })
    const deps = {
      getSettings: () => current,
      applyHidden: (words: readonly string[], on: boolean) => void hidden.push([words, on]),
      applySettings: vi.fn((patch: Record<string, unknown>) => void (current = applySettingsPatch(current, patch))),
      queue: {
        enqueueHiddenBatch: (words: readonly string[], on: boolean) => {
          batches.push([words, on])
          queue.enqueueHiddenBatch(words, on)
        },
        enqueueSettings: (p: Record<string, unknown>) => void queue.enqueueSettings(p),
      },
    }
    return { deps, hidden, batches, settings, sent, queue, settingsNow: () => current }
  }
  const marked = Array.from({ length: 25 }, (_, i) => `w${i}`)

  it('writes start_rank through the settings lane, and hides the marked words in ONE batch (one request, not 25)', async () => {
    const t = target()
    savePlacement({ startRank: 401, marked }, t.deps)
    await vi.waitFor(() => expect(t.queue.getStatus().unsaved).toBe(false))
    expect(t.deps.applySettings).toHaveBeenCalledWith({ [START_RANK_KEY]: 401 })
    expect(t.settings).toEqual([{ start_rank: 401 }])
    expect(t.hidden).toEqual([[marked, true]]) // in memory at once, in one call
    expect(t.batches).toEqual([[marked, true]])
    expect(t.sent).toHaveLength(1) // one request to the hidden lane
    expect(t.sent[0].sort()).toEqual([...marked].sort())
  })

  it('a beginner\'s result writes no start_rank, but the words the person marked are still hidden', async () => {
    const t = target()
    savePlacement({ startRank: null, marked: ['w1', 'w2'] }, t.deps)
    await vi.waitFor(() => expect(t.queue.getStatus().unsaved).toBe(false))
    expect(t.settings).toEqual([])
    expect(t.deps.applySettings).not.toHaveBeenCalled()
    expect(t.sent).toEqual([['w1', 'w2']])
  })

  it('a retake with the beginner pattern clears start_rank: the key is removed, and the other settings stay', async () => {
    const t = target({ start_rank: 801, daily_new_word_limit: 12, theme_preference: 'dark', learn_picks: ['a'] })
    savePlacement({ startRank: null, marked: ['w1'] }, t.deps)
    await vi.waitFor(() => expect(t.queue.getStatus().unsaved).toBe(false))
    expect(t.settings).toEqual([{ start_rank: null }]) // one patch: the key goes
    expect(t.settingsNow().startRank).toBeNull()
    expect(t.settingsNow().raw).toEqual({ daily_new_word_limit: 12, theme_preference: 'dark', learn_picks: ['a'] }) // no start_rank key, the rest untouched
    expect('start_rank' in t.settingsNow().raw).toBe(false)
    expect(t.sent).toEqual([['w1']]) // and the marked words are still hidden
  })

  it('a first run with the beginner pattern writes nothing about start_rank: there is nothing to clear', async () => {
    const t = target({ daily_new_word_limit: 12 })
    savePlacement({ startRank: null, marked: ['w1'] }, t.deps)
    await vi.waitFor(() => expect(t.queue.getStatus().unsaved).toBe(false))
    expect(t.settings).toEqual([])
    expect(t.deps.applySettings).not.toHaveBeenCalled()
    expect(t.sent).toEqual([['w1']])
  })

  it('a retake with a start rank replaces the old one (and does not clear it)', () => {
    const t = target({ start_rank: 801 })
    savePlacement({ startRank: 401, marked: [] }, t.deps)
    expect(t.settingsNow().startRank).toBe(401)
    expect(t.deps.applySettings.mock.calls.map((c) => c[0])).toEqual([{ start_rank: 401 }])
  })

  it('an empty result writes nothing at all (and a skip never gets here)', async () => {
    const t = target()
    savePlacement({ startRank: null, marked: [] }, t.deps)
    expect(t.hidden).toEqual([])
    expect(t.batches).toEqual([])
    expect(t.settings).toEqual([])
    expect(t.queue.getStatus().unsaved).toBe(false)
  })

  it('taking the test again replaces start_rank and hides the newly marked words; it never un-hides anything', async () => {
    const t = target()
    savePlacement({ startRank: 401, marked: ['a', 'b'] }, t.deps)
    savePlacement({ startRank: 801, marked: ['c'] }, t.deps)
    await vi.waitFor(() => expect(t.queue.getStatus().unsaved).toBe(false))
    expect(t.deps.applySettings.mock.calls.map((c) => c[0])).toEqual([{ start_rank: 401 }, { start_rank: 801 }])
    expect(t.hidden.every(([, on]) => on)).toBe(true)
    expect(t.batches.every(([, on]) => on)).toBe(true)
    expect(t.sent.flat().sort()).toEqual(['a', 'b', 'c'])
    expect(t.sent.flat().some((w) => w.startsWith('-'))).toBe(false)
  })

  it('the hidden lane gets them in one request because they go in together: one enqueue per word would not', async () => {
    const sent: number[] = []
    const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {}, sendHidden: async (ops) => void sent.push(ops.length) }, { retryDelaysMs: [1], sleep: async () => {} })
    for (const w of ['a', 'b', 'c']) queue.enqueueHidden(w, true)
    await vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))
    expect(sent.length).toBeGreaterThan(1) // the old way: the first word leaves alone
    const batched: number[] = []
    const q2 = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {}, sendHidden: async (ops) => void batched.push(ops.length) }, { retryDelaysMs: [1], sleep: async () => {} })
    q2.enqueueHiddenBatch(['a', 'b', 'c'], true)
    await vi.waitFor(() => expect(q2.getStatus().unsaved).toBe(false))
    expect(batched).toEqual([3])
  })
})

describe('Learn starts from start_rank', () => {
  const words = dictionary(400)
  const batchRanks = (raw: Record<string, unknown>, day = DAY) => selectLearnBatch(words, parseSettings({ daily_new_word_limit: 10, ...raw }), day).words.map((w) => w.rank!)

  it('reads start_rank from the settings (a number above 1; anything else is the default start)', () => {
    expect(parseSettings({ start_rank: 401 }).startRank).toBe(401)
    for (const bad of [0, 1, -5, 'x', null, NaN, {}]) expect(parseSettings({ start_rank: bad }).startRank).toBeNull()
    expect(parseSettings({}).startRank).toBeNull()
  })

  it('without start_rank the window opens at the first unlearned word', () => {
    expect(Math.min(...batchRanks({}))).toBeLessThan(40)
  })

  it('with it, most of the batch is from start_rank on (the 150-word window starts there) and a few words are from below it (see startBias.test.ts)', () => {
    for (let day = 0; day < 30; day++) {
      const ranks = batchRanks({ start_rank: 200 }, new Date(2026, 9, 1 + day, 9, 0))
      expect(ranks).toHaveLength(10)
      const up = ranks.filter((r) => r >= 200)
      expect(up).toHaveLength(7)
      for (const r of up) expect(r).toBeLessThanOrEqual(349) // 150 words from rank 200
      for (const r of ranks.filter((r) => r < 200)) expect(r).toBeGreaterThanOrEqual(1)
    }
  })

  it('the window starts at the LATER of the first unlearned word and start_rank: learned words move it on', () => {
    const learned = words.map((w) => (w.rank! <= 300 ? { ...w, repetitions: 1 } : w))
    const ranks = selectLearnBatch(learned, parseSettings({ daily_new_word_limit: 10, start_rank: 200 }), DAY).words.map((w) => w.rank!)
    expect(Math.min(...ranks)).toBeGreaterThanOrEqual(301) // the first unlearned is 301, later than 200
    const ahead = selectLearnBatch(learned, parseSettings({ daily_new_word_limit: 10, start_rank: 350 }), DAY).words.map((w) => w.rank!)
    expect(ahead.filter((r) => r >= 350)).toHaveLength(7) // start_rank is later than 301: the window starts there
    expect(ahead.filter((r) => r < 350 && r >= 301)).toHaveLength(3) // and the unlearned words between are the range below it
  })

  it('the Rioplatense guarantee holds for the batch as a whole: a Rioplatense word from start_rank on, or one below it, is in the batch', () => {
    const rio = { type: 'regional_only', form: 'x', altForm: null, altRegion: null, region: 'uy', register: 'neutral', notes: null, stdMeaning: null, translation: null, stdUsage: null, example: null, confidence: 'high' } as never
    for (const [label, rank] of [['inside the window', 250], ['below the start rank', 20]] as const) {
      const dict = dictionary(400, (r) => (r === rank ? { rio } : {}))
      for (let day = 0; day < 20; day++) {
        const batch = selectLearnBatch(dict, parseSettings({ daily_new_word_limit: 10, start_rank: 200 }), new Date(2026, 9, 1 + day, 9, 0))
        expect(batch.words.map((w) => w.rank), `${label}, day ${day}`).toContain(rank)
      }
    }
  })

  it('when nothing is left from start_rank on, Learn uses the whole pool rather than being empty', () => {
    const ranks = batchRanks({ start_rank: 99999 })
    expect(ranks).toHaveLength(10)
    expect(Math.min(...ranks)).toBeLessThan(150)
  })

  it('fromStartRank: the pool from the rank on, custom words (no rank) kept, the pool itself when there is no rank or nothing left', () => {
    const pool = [...dictionary(10), makeWord('mia', { rank: null, isCustom: true })]
    expect(fromStartRank(pool, null)).toBe(pool)
    expect(fromStartRank(pool, 6).map((w) => w.esWord)).toEqual(['w0006', 'w0007', 'w0008', 'w0009', 'w0010', 'mia'])
    expect(fromStartRank(dictionary(10), 50).length).toBe(10)
  })

  it('the window is still 150 words', () => {
    expect(WINDOW_SIZE).toBe(150)
  })
})

describe('removing a key through the settings lane', () => {
  it('a key patched to null is removed from the blob, every other patched key is set, and the rest stays', () => {
    expect(mergeSettingsRaw({ a: 1, b: 2, c: 3 }, { b: null, c: 4, d: 5 })).toEqual({ a: 1, c: 4, d: 5 })
    expect(mergeSettingsRaw({ a: 1 }, { zzz: null })).toEqual({ a: 1 }) // removing what is not there is nothing
    expect(mergeSettingsRaw({ a: 1 }, {})).toEqual({ a: 1 })
  })

  it('does not change what it was given', () => {
    const raw = { a: 1, b: 2 }
    mergeSettingsRaw(raw, { b: null })
    expect(raw).toEqual({ a: 1, b: 2 })
  })
})

describe('the stored blob after a retake that finds a beginner', () => {
  it('has no start_rank, and its other keys are untouched (through the queue, the real client and a fake server)', async () => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.test')
    vi.resetModules()
    const server = createFakeServer({ now: () => Date.parse('2026-10-08T12:00:00Z') })
    vi.stubGlobal('fetch', server.fetch)
    try {
      const { ensureSession } = await import('../lib/auth')
      const { createSupabaseWriteQueue } = await import('./writeQueue')
      const client = server.client()
      const auth = await ensureSession(client, initDataFor(9), 9)
      if (auth.status !== 'signed-in') throw new Error('sign-in failed')
      const blob = { start_rank: 801, daily_new_word_limit: 12, theme_preference: 'dark', learn_picks: ['casa'], some_future_key: { a: 1 } }
      server.tables.set('user_settings', [{ user_id: auth.userId, settings: blob }])
      let settings = parseSettings(blob)
      const queue = createSupabaseWriteQueue(client, auth.userId, () => settings, { retryDelaysMs: [1], sleep: async () => {} })

      savePlacement(
        { startRank: null, marked: ['uno', 'dos'] }, // the first set had two or fewer marked
        { getSettings: () => settings, applyHidden: () => {}, applySettings: (p) => void (settings = applySettingsPatch(settings, p)), queue },
      )
      await vi.waitFor(() => expect(queue.getStatus().unsaved).toBe(false))

      const stored = server.rows('user_settings')[0].settings as Record<string, unknown>
      expect('start_rank' in stored).toBe(false)
      expect(stored).toEqual({ daily_new_word_limit: 12, theme_preference: 'dark', learn_picks: ['casa'], some_future_key: { a: 1 } })
      expect(server.rows('user_hidden_words').map((r) => r.es_word).sort()).toEqual(['dos', 'uno']) // the marked words are hidden all the same
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })
})
