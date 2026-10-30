import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyReview } from '../sm2/sm2'
import { createFakeServer, initDataFor } from '../testing/fakeServer'
import { makeWord } from '../testing/makeWord'
import { createQueueStore, type StorageLike } from './queueStore'
import { createRater } from './review'
import { createLearnedAtStore, createReviewLog, type ReviewLog } from './reviewLog'
import { insertReviewLog } from './writes'
import { createSupabaseWriteQueue, type WriteQueue } from './writeQueue'

// The review log against the real supabase-js client and a fake server that behaves like the real table: append-only (SELECT and INSERT, no UPDATE,
// no DELETE), a plain insert of a known id is a conflict, and "ignore duplicates" skips it.

const T0 = Date.parse('2026-10-06T15:00:00Z')
const DAY = 86_400_000
const now = () => T0

function memoryStorage() {
  const items = new Map<string, string>()
  const storage: StorageLike & { items: Map<string, string> } = { items, getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) }
  return storage
}

describe('the review log, end to end', () => {
  let server: ReturnType<typeof createFakeServer>
  beforeEach(() => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.test')
    vi.resetModules()
    server = createFakeServer({ now: () => T0 })
    vi.stubGlobal('fetch', server.fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  /** One run of the app for a signed-in user: the real client, the real queue (over `storage`), the real log. */
  async function openApp(storage: StorageLike = memoryStorage()) {
    const { ensureSession } = await import('../lib/auth')
    const client = server.client()
    const initData = initDataFor(99)
    const auth = await ensureSession(client, initData, 99)
    if (auth.status !== 'signed-in') throw new Error('sign-in failed')
    const queue: WriteQueue = createSupabaseWriteQueue(client, auth.userId, () => null, {
      store: createQueueStore(auth.userId, storage, now),
      now,
      retryDelaysMs: [1, 1, 1],
      logRetryDelaysMs: [1, 1],
      sleep: async () => {},
      recoverSession: async () => (await ensureSession(client, initData, 99, { force: true })).status === 'signed-in',
    })
    let n = 0
    const log: ReviewLog = createReviewLog({ enqueue: queue.enqueueLog, learnedAt: createLearnedAtStore(auth.userId, memoryStorage()), newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` })
    return { client, queue, log, userId: auth.userId, storage }
  }
  const learned = (esWord = 'casa') => makeWord(esWord, { repetitions: 2, interval: 3, easeFactor: 2.5, nextReview: new Date(T0 + 3 * DAY - 1000) })
  const rows = () => server.rows('review_log')
  const logRequests = () => server.log.filter((r) => r.url === '/rest/v1/review_log')

  function rater(app: Awaited<ReturnType<typeof openApp>>, progress: unknown[] = []) {
    return createRater({ applyProgress: (u) => void progress.push(...u), applySettings: () => {}, getSettings: () => ({ raw: {} }) as never, queue: app.queue, log: app.log })
  }

  it('a Review rating writes exactly one row, with every column right', async () => {
    const app = await openApp()
    const at = new Date(T0 + 3 * DAY + 4 * 60_000)
    rater(app)(learned(), 3, at, true, { sessionId: '11111111-1111-4111-8111-111111111111', durationMs: 3300 })
    await vi.waitFor(() => expect(rows()).toHaveLength(1))
    const expected = applyReview({ easeFactor: 2.5, interval: 3, repetitions: 2 }, 3, at)
    expect(rows()[0]).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      user_id: app.userId,
      es_word: 'casa',
      reviewed_at: at.toISOString(),
      rating: 3,
      mode: 'review',
      state_before: 'review',
      elapsed_days: expect.closeTo(3 + (4 * 60_000 + 1000) / DAY, 5),
      scheduled_days: expected.interval,
      interval_after: expected.interval,
      ease_after: expected.easeFactor,
      repetitions_after: 3,
      stability_after: null,
      difficulty_after: null,
      algo: 'sm2',
      session_id: '11111111-1111-4111-8111-111111111111',
      duration_ms: 3300,
    })
    await app.queue.flush()
    expect(rows()).toHaveLength(1) // and still one
  })

  it('a session of several ratings shares one session id, and every row has an id of its own', async () => {
    const app = await openApp()
    const rate = rater(app)
    const session = app.log.startSession()
    for (const [i, word] of ['uno', 'dos', 'tres', 'cuatro'].entries()) rate(learned(word), [3, 1, 4, 2][i], new Date(T0 + 3 * DAY + i * 1000), true, { sessionId: session, durationMs: 1000 + i })
    await vi.waitFor(() => expect(rows()).toHaveLength(4))
    expect(new Set(rows().map((r) => r.session_id))).toEqual(new Set([session]))
    expect(new Set(rows().map((r) => r.id)).size).toBe(4)
    expect(rows().map((r) => [r.es_word, r.rating])).toEqual([['uno', 3], ['dos', 1], ['tres', 4], ['cuatro', 2]]) // in the order they were made
    const next = app.log.startSession() // and the next session is another
    rate(learned('cinco'), 3, new Date(T0 + 4 * DAY), true, { sessionId: next, durationMs: null })
    await vi.waitFor(() => expect(rows()).toHaveLength(5))
    expect(rows()[4].session_id).toBe(next)
    expect(next).not.toBe(session)
  })

  it('a practice row\'s scheduled_days reaches the table as the word\'s interval, or as null when it has none (never 0)', async () => {
    const app = await openApp()
    const at = new Date(T0 + DAY)
    app.log.practice({ word: makeWord('quince', { repetitions: 5, interval: 15, nextReview: new Date(T0 + 15 * DAY) }), mode: 'cloze', correct: true, sessionId: 's', durationMs: null, now: at })
    app.log.practice({ word: makeWord('cuarenta', { repetitions: 6, interval: 40, nextReview: new Date(T0 + 40 * DAY) }), mode: 'matching', correct: true, sessionId: 's', durationMs: null, now: at })
    app.log.practice({ word: makeWord('nueva', { repetitions: 1, interval: 0, nextReview: new Date(T0 + DAY) }), mode: 'cloze', correct: false, sessionId: 's', durationMs: 4000, now: at })
    await vi.waitFor(() => expect(rows()).toHaveLength(3))
    expect(rows().map((r) => [r.es_word, r.scheduled_days, r.interval_after, r.duration_ms])).toEqual([['quince', 15, 15, null], ['cuarenta', 40, 40, null], ['nueva', null, 0, 4000]])
  })

  it('a Cloze row reaches the table with its answer kind; every other row has no answer_kind in it, so it does not depend on the column', async () => {
    const app = await openApp()
    const at = new Date(T0 + DAY)
    const word = makeWord('tener', { repetitions: 5, interval: 15, nextReview: new Date(T0 + 15 * DAY) })
    for (const kind of ['exact', 'accent', 'headword', 'form', 'wrong'] as const) app.log.practice({ word, mode: 'cloze', correct: kind !== 'wrong', answerKind: kind, sessionId: 's', durationMs: null, now: at })
    app.log.practice({ word, mode: 'matching', correct: true, sessionId: 's', durationMs: null, now: at })
    rater(app)(learned('casa'), 3, new Date(T0 + 3 * DAY), true, { sessionId: null, durationMs: null })
    await vi.waitFor(() => expect(rows()).toHaveLength(7))
    expect(rows().map((r) => r.answer_kind)).toEqual(['exact', 'accent', 'headword', 'form', 'wrong', undefined, undefined])
    expect(rows().filter((r) => 'answer_kind' in r)).toHaveLength(5)
    // and it is the kind that is stored, never what the person typed
    expect(JSON.stringify(rows())).not.toMatch(/typed|answer_text/)
  })

  it('a kind the table\'s check does not allow is refused as one row\'s own fault (23514), like a mode it does not know', async () => {
    const app = await openApp()
    await expect(insertReviewLog(app.client, app.userId, [{ id: 'x', esWord: 'casa', reviewedAt: new Date(T0).toISOString(), rating: 3, mode: 'cloze', stateBefore: 'new', elapsedDays: 0, scheduledDays: null, intervalAfter: 0, easeAfter: 2.5, repetitionsAfter: 1, sessionId: null, durationMs: null, answerKind: 'typo' as never }])).rejects.toThrow()
    expect(rows()).toHaveLength(0)
  })

  it('a practice row (Matching on a Learn batch) reaches the table with the mode "practice", which review_log_mode_check allows; a mode it does not know is refused', async () => {
    const app = await openApp()
    app.log.practice({ word: makeWord('nueva', { repetitions: 1, interval: 0, nextReview: new Date(T0 + DAY) }), mode: 'practice', correct: true, sessionId: 's', durationMs: null, now: new Date(T0) })
    await vi.waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0]).toMatchObject({ es_word: 'nueva', mode: 'practice', rating: 3, state_before: 'learning', scheduled_days: null, interval_after: 0, repetitions_after: 1 })
    // the control: the rule is the table's, so an unknown mode does not get in
    const row = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', esWord: 'casa', reviewedAt: new Date(T0).toISOString(), rating: 3, mode: 'quiz' as never, stateBefore: 'review' as const, elapsedDays: 3, scheduledDays: 3, intervalAfter: 3, easeAfter: 2.5, repetitionsAfter: 2, sessionId: null, durationMs: null }
    await expect(insertReviewLog(app.client, app.userId, [row])).rejects.toThrow()
    expect(rows()).toHaveLength(1)
  })

  it('a duplicate id does not create a second row, and is not an error: the same row sent twice is one row', async () => {
    const app = await openApp()
    const row = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', esWord: 'casa', reviewedAt: new Date(T0).toISOString(), rating: 3, mode: 'review' as const, stateBefore: 'review' as const, elapsedDays: 3, scheduledDays: 8, intervalAfter: 8, easeAfter: 2.5, repetitionsAfter: 3, sessionId: null, durationMs: null }
    await insertReviewLog(app.client, app.userId, [row])
    await expect(insertReviewLog(app.client, app.userId, [row])).resolves.toBeUndefined()
    await expect(insertReviewLog(app.client, app.userId, [row, { ...row, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }])).resolves.toBeUndefined() // the known one skipped, the new one kept
    expect(rows().map((r) => r.id)).toEqual([row.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])
    // the control: a plain insert of a known id IS a conflict, so it is the ignore that makes the difference
    const { error } = await app.client.from('review_log').insert({ id: row.id, user_id: app.userId, es_word: 'casa' })
    expect(error?.code).toBe('23505')
  })

  it('a retry after an answer that never arrived cannot make a duplicate: the server had the row, the client resends it, there is still one', async () => {
    const app = await openApp()
    let attempts = 0
    server.spy.beforeRest = ({ method, table }) => {
      if (method === 'POST' && table === 'review_log') attempts++
    }
    server.break.loseAnswerOf = 'review_log' // the write happens, the answer is lost: the queue thinks it failed
    app.log.practice({ word: learned(), mode: 'cloze', correct: true, sessionId: 's', durationMs: 10, now: new Date(T0 + 3 * DAY) })
    await vi.waitFor(() => expect(rows()).toHaveLength(1))
    await vi.waitFor(() => expect(app.queue.getStatus().logGaveUp).toBe(true)) // it could not tell, and it did not stop trying
    expect(attempts).toBeGreaterThan(1) // it sent the same row more than once...
    expect(rows()).toHaveLength(1) // ...and the table still has one
    server.break.loseAnswerOf = null
    await app.queue.retry()
    await vi.waitFor(() => expect(app.queue.getStatus().pendingLog).toBe(0))
    expect(rows()).toHaveLength(1)
  })

  it('a queued row survives a restart and is replayed once: after the run that could not send it, the next run sends it and the one after sends nothing', async () => {
    const storage = memoryStorage()
    const first = await openApp(storage)
    server.break.missingTable = 'review_log'
    first.log.practice({ word: learned(), mode: 'matching', correct: true, sessionId: 's', durationMs: null, now: new Date(T0 + 3 * DAY) })
    await vi.waitFor(() => expect(first.queue.getStatus().logGaveUp).toBe(true))
    expect(rows()).toHaveLength(0)

    server.break.missingTable = null
    const second = await openApp(storage)
    expect(second.queue.restore().restored).toBe(1)
    await vi.waitFor(() => expect(rows()).toHaveLength(1))
    await vi.waitFor(() => expect(second.queue.getStatus().pendingLog).toBe(0))

    const before = logRequests().length
    const third = await openApp(storage)
    expect(third.queue.restore().restored).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(logRequests().length).toBe(before) // nothing sent a second time
    expect(rows()).toHaveLength(1)
  })

  it('the client never updates or deletes a row: only inserts that ignore duplicates, and the table would refuse anything else', async () => {
    const app = await openApp()
    const rate = rater(app)
    for (let i = 0; i < 5; i++) rate(learned(`w${i}`), 3, new Date(T0 + 3 * DAY + i), true, { sessionId: 's', durationMs: null })
    await vi.waitFor(() => expect(rows()).toHaveLength(5))
    await app.queue.flush()
    expect(new Set(logRequests().map((r) => r.method))).toEqual(new Set(['POST']))
    expect(logRequests().every((r) => r.status === 201)).toBe(true)
    // the control: the fake does refuse the writes the client must never make (as the real table, with no UPDATE and no DELETE grant)
    const id = rows()[0].id
    expect((await app.client.from('review_log').update({ rating: 1 }).eq('id', id)).error?.code).toBe('42501')
    expect((await app.client.from('review_log').delete().eq('id', id)).error?.code).toBe('42501')
    expect((await app.client.from('review_log').upsert({ id, user_id: app.userId, es_word: 'x', rating: 1 }, { onConflict: 'id' })).error?.code).toBe('42501') // a merging upsert is an UPDATE
    expect(rows().find((r) => r.id === id)?.rating).toBe(3) // untouched
  })

  it('a write failure of the log (refused, missing, unreachable) leaves the rating saved and the app untouched', async () => {
    for (const [why, breakIt, unbreak] of [
      ['refused by policy', () => (server.break.forbidTable = 'review_log'), () => (server.break.forbidTable = null)],
      ['the table is not there', () => (server.break.missingTable = 'review_log'), () => (server.break.missingTable = null)],
      ['a row the table refuses', () => (server.break.rejectRowsWhere = () => true), () => (server.break.rejectRowsWhere = null)],
    ] as const) {
      server = createFakeServer({ now: () => T0 })
      vi.stubGlobal('fetch', server.fetch)
      const app = await openApp()
      const applied: unknown[] = []
      breakIt()
      const update = rater(app, applied)(learned(), 3, new Date(T0 + 3 * DAY), true, { sessionId: 's', durationMs: 100 })
      await vi.waitFor(() => expect(app.queue.getStatus().logGaveUp, why).toBe(true))
      // the rating itself: applied in memory, and on the server
      expect(applied, why).toHaveLength(1)
      await vi.waitFor(() => expect(server.rows('user_progress'), why).toHaveLength(1))
      expect(server.rows('user_progress')[0]).toMatchObject({ es_word: 'casa', interval_days: update.interval })
      // and nothing the UI shows is affected
      expect(app.queue.getStatus(), why).toMatchObject({ unsaved: false, failed: false, stuck: false, authRejected: false, pendingRatings: 0 })
      expect(rows(), why).toHaveLength(0)
      // the row waits, and goes when the table is back
      unbreak()
      await app.queue.retry()
      await vi.waitFor(() => expect(rows(), why).toHaveLength(1))
    }
  })

  it('no network at all: the rating is queued and the log row with it, nothing waits, and both go when the network is back', async () => {
    const app = await openApp()
    server.break.networkDown = true
    const applied: unknown[] = []
    const started = performance.now()
    rater(app, applied)(learned(), 3, new Date(T0 + 3 * DAY), true, { sessionId: 's', durationMs: 100 })
    expect(performance.now() - started).toBeLessThan(500)
    expect(applied).toHaveLength(1)
    await vi.waitFor(() => expect(app.queue.getStatus().failed).toBe(true)) // the progress lane says so, as it always did
    expect(app.queue.getStatus().pendingLog).toBe(1)
    server.break.networkDown = false
    await app.queue.retry()
    await vi.waitFor(() => expect(rows()).toHaveLength(1))
    expect(server.rows('user_progress')).toHaveLength(1)
  })
})
