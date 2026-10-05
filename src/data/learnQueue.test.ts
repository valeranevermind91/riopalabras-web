import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWord } from '../testing/makeWord'
import { createBatchFinisher, learnPhase, type LearnBatch } from './learn'
import { applyProgressUpdates, applySettingsPatch } from './mutations'
import { bindClosingConfirmation, bindReconnectTriggers, retryEverything } from './queueTriggers'
import { parseSettings } from './settings'
import type { ProgressUpdate, Word } from './types'
import { showUnsavedNotice } from './useQueueStatus'
import { createSupabaseWriteQueue, createWriteQueue } from './writeQueue'

const NOW = new Date(2026, 9, 4, 14, 30)
const BATCH_WORDS = ['uno', 'dos', 'tres', 'cuatro']
const batch: LearnBatch = { words: BATCH_WORDS.map((w, i) => makeWord(w, { rank: i + 1 })), newCount: 4 }

type Mode = 'ok' | 'fail' | 'lost-response' // lost-response: the server applies the write but the client sees an error

/** A stand-in server that keeps state, so "landed" means landed, with failures injectable per table. */
function fakeServer() {
  const progress = new Map<string, Record<string, unknown>>()
  let settings: Record<string, unknown> = {}
  const mode: Record<string, Mode> = { user_progress: 'ok', user_settings: 'ok' }
  const requests: string[] = []
  const violations: string[] = []

  const client = {
    from: (table: string) => ({
      upsert: async (rows: unknown) => {
        requests.push(table)
        if (mode[table] === 'fail') return { error: { message: `${table} unreachable` } }
        if (table === 'user_progress') {
          for (const r of rows as { es_word: string }[]) progress.set(r.es_word, r)
        } else {
          const blob = (rows as { settings: Record<string, unknown> }).settings
          // THE rule: a counter that reaches the server must find its words already there
          if (blob.new_words_learned_today_count !== settings.new_words_learned_today_count && BATCH_WORDS.some((w) => !progress.has(w))) {
            violations.push('counter landed before the words')
          }
          settings = blob
        }
        if (mode[table] === 'lost-response') return { error: { message: `${table} response lost` } }
        return { error: null }
      },
    }),
  } as unknown as SupabaseClient

  return { client, progress, mode, requests, violations, settings: () => settings }
}

function app(initialRaw: Record<string, unknown> = {}) {
  const server = fakeServer()
  let words: readonly Word[] = batch.words
  let settings = parseSettings({ streak_count: 3, streak_last_activity_date: '2026-10-03', new_words_learned_today_count: 2, new_words_learned_today_date: '2026-10-04', ...initialRaw })
  const getSettings = () => settings
  const queue = createSupabaseWriteQueue(server.client, 'user-1', getSettings, { retryDelaysMs: [1, 1, 1], sleep: () => Promise.resolve() })
  const finish = createBatchFinisher(batch, {
    queue,
    getSettings,
    applyProgress: (u: readonly ProgressUpdate[]) => (words = applyProgressUpdates(words, u)),
    applySettings: (p) => (settings = applySettingsPatch(settings, p)),
  })
  return { ...server, queue, finish, getWords: () => words, getSettings }
}

const stuck = (q: { getStatus: () => { stuck: boolean } }) => vi.waitFor(() => expect(q.getStatus().stuck).toBe(true))
const idle = (q: { getStatus: () => { unsaved: boolean } }) => vi.waitFor(() => expect(q.getStatus().unsaved).toBe(false))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a failing Learn batch', () => {
  it('surfaces in Learn, keeps the words queued, turns the closing confirmation on, raises the Home banner once stuck, and drains on reconnect', async () => {
    const a = app()
    const confirmation: boolean[] = []
    const unbind = bindClosingConfirmation(a.queue, (on) => confirmation.push(on))
    a.mode.user_progress = 'fail' // offline

    // Finish batch
    const ticket = a.finish()
    expect(confirmation).toEqual([true]) // closing confirmation on as soon as the batch is queued
    expect(learnPhase(ticket, a.queue.getStatus())).toBe('saving')
    expect(showUnsavedNotice(a.queue.getStatus())).toBe(false) // retries still running: no banner yet

    // The automatic retries run out
    await stuck(a.queue)
    expect(learnPhase(ticket, a.queue.getStatus())).toBe('error') // Learn shows Failed / Retry
    expect(a.queue.getStatus().error).toContain('user_progress unreachable') // the message Learn displays
    expect(showUnsavedNotice(a.queue.getStatus())).toBe(true) // Home banner
    expect(confirmation).toEqual([true]) // still on
    expect(a.queue.getStatus()).toMatchObject({ pendingRatings: 4, pendingSettings: true }) // every word and the settings patch are still queued
    expect(a.progress.size).toBe(0)
    expect(a.requests.filter((t) => t === 'user_settings')).toHaveLength(0) // the counter has not gone out

    // The store already shows the batch (optimistic), so the rest of the app is consistent meanwhile
    expect(a.getWords().every((w) => w.repetitions === 1)).toBe(true)
    expect(a.getSettings().newWordsLearnedTodayCount).toBe(6)

    // Back online
    a.mode.user_progress = 'ok'
    const win = (() => {
      const listeners: (() => void)[] = []
      return { addEventListener: (_: string, f: () => void) => listeners.push(f), removeEventListener: () => {}, fire: () => listeners.forEach((f) => f()) }
    })()
    const off = bindReconnectTriggers(() => retryEverything({ queue: a.queue, retryDegraded: undefined }), {
      online: win as never,
      document: { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'hidden' } as never,
      activated: () => () => {},
    })
    win.fire()
    await idle(a.queue)

    expect(learnPhase(ticket, a.queue.getStatus())).toBe('done')
    expect(ticket.saved()).toBe(true)
    expect(showUnsavedNotice(a.queue.getStatus())).toBe(false) // banner went away by itself
    expect(confirmation).toEqual([true, false]) // closing confirmation off again
    expect([...a.progress.keys()].sort()).toEqual([...BATCH_WORDS].sort())
    expect(a.settings()).toMatchObject({ new_words_learned_today_count: 6, streak_count: 4, new_words_learned_today_date: '2026-10-04' })
    expect(a.violations).toEqual([])
    off()
    unbind()
  })
})

describe('the settings update is both-or-neither with the words', () => {
  it('while the words cannot be written, the counter is never written either', async () => {
    const a = app()
    a.mode.user_progress = 'fail'
    a.finish()
    await stuck(a.queue)
    expect(a.requests).not.toContain('user_settings')
    expect(a.settings()).toEqual({}) // neither landed
    expect(a.queue.getStatus()).toMatchObject({ pendingRatings: 4, pendingSettings: true }) // both still queued
  })

  it('across many failure patterns the counter never reaches the server ahead of the words, and both end up landed exactly once', async () => {
    const patterns: [Mode, Mode][] = [
      ['fail', 'ok'],
      ['ok', 'fail'],
      ['fail', 'fail'],
      ['lost-response', 'ok'],
      ['ok', 'lost-response'],
      ['lost-response', 'lost-response'],
    ]
    for (const [progressMode, settingsMode] of patterns) {
      const a = app()
      a.mode.user_progress = progressMode
      a.mode.user_settings = settingsMode
      const ticket = a.finish()
      await stuck(a.queue)
      expect(ticket.saved(), `${progressMode}/${settingsMode}`).toBe(false)

      a.mode.user_progress = 'ok'
      a.mode.user_settings = 'ok'
      expect(await a.queue.retry()).toBe(true)
      expect(ticket.saved(), `${progressMode}/${settingsMode}`).toBe(true)
      expect(a.violations, `${progressMode}/${settingsMode}`).toEqual([])
      expect([...a.progress.keys()].sort()).toEqual([...BATCH_WORDS].sort())
      expect(a.settings(), `${progressMode}/${settingsMode}`).toMatchObject({ new_words_learned_today_count: 6, streak_count: 4 })
    }
  })

  it('one side landing alone is visible: words in, counter pending → the batch is NOT saved and Learn keeps showing Retry', async () => {
    const a = app()
    a.mode.user_settings = 'fail'
    const ticket = a.finish()
    await stuck(a.queue)
    expect([...a.progress.keys()]).toHaveLength(4) // the words did land
    expect(a.settings()).toEqual({}) // the counter did not
    expect(ticket.saved()).toBe(false)
    expect(learnPhase(ticket, a.queue.getStatus())).toBe('error')
    expect(a.queue.getStatus()).toMatchObject({ pendingRatings: 0, pendingSettings: true }) // only the settings part is queued, so only it is retried
  })
})

describe('no double-apply when a retry lands after the first attempt actually succeeded', () => {
  it('lost response on progress: the retry rewrites the same rows (idempotent upsert) and nothing more', async () => {
    const a = app()
    a.mode.user_progress = 'lost-response'
    a.finish()
    await stuck(a.queue)
    expect(a.progress.size).toBe(4) // it did land the first time
    const first = [...a.progress.values()].map((r) => ({ ...r, updated_at: undefined }))

    a.mode.user_progress = 'ok'
    await a.queue.retry()
    expect(a.progress.size).toBe(4)
    expect([...a.progress.values()].map((r) => ({ ...r, updated_at: undefined }))).toEqual(first) // same SM-2 state, not advanced a second time
  })

  it('lost response on settings: the counter is written as the same absolute number, not added again', async () => {
    const a = app()
    a.mode.user_settings = 'lost-response'
    a.finish()
    await stuck(a.queue)
    expect(a.settings()).toMatchObject({ new_words_learned_today_count: 6 }) // landed the first time

    a.mode.user_settings = 'ok'
    await a.queue.retry()
    expect(a.settings()).toMatchObject({ new_words_learned_today_count: 6, streak_count: 4 }) // 2 + 4, once
    expect(a.getSettings().newWordsLearnedTodayCount).toBe(6)
  })

  it('pressing Finish batch repeatedly, before or after the retry, queues the batch once', async () => {
    const a = app()
    a.mode.user_progress = 'fail'
    const t1 = a.finish()
    await stuck(a.queue)
    const t2 = a.finish()
    expect(t2).toBe(t1)
    a.mode.user_progress = 'ok'
    await a.queue.retry()
    const requestsAfterSave = a.requests.length
    a.finish()
    a.finish()
    await a.queue.flush()
    expect(a.requests).toHaveLength(requestsAfterSave) // no further request for a batch that is already saved
    expect(a.settings()).toMatchObject({ new_words_learned_today_count: 6 })
    expect(a.getSettings().newWordsLearnedTodayCount).toBe(6)
  })
})

describe('tickets', () => {
  const upd = (w: string, repetitions = 1): ProgressUpdate => ({ esWord: w, easeFactor: 2.5, interval: 0, repetitions, nextReview: NOW })

  function queue(failProgress: () => boolean = () => false) {
    const sent: string[] = []
    const q = createWriteQueue(
      {
        sendProgress: async (u) => {
          if (failProgress()) throw new Error('down')
          sent.push(...u.map((x) => `${x.esWord}:${x.repetitions}`))
        },
        sendSettings: async () => {},
      },
      { retryDelaysMs: [], sleep: () => Promise.resolve() },
    )
    return { q, sent }
  }

  it('a batch is saved only once its words are sent; a newer state of one of its words moves the wait to that state', async () => {
    let down = true
    const { q, sent } = queue(() => down)
    const ticket = q.enqueueBatch([upd('a'), upd('b')], {})
    await vi.waitFor(() => expect(q.getStatus().failed).toBe(true))
    expect(ticket.saved()).toBe(false)

    q.enqueueProgress(upd('a', 5)) // a later rating replaces the unsent state of 'a'
    down = false
    await q.retry()
    expect(ticket.saved()).toBe(true)
    expect(sent.sort()).toEqual(['a:5', 'b:1']) // the superseded state was never sent
  })

  it('a word listed twice in one batch still resolves', async () => {
    const { q } = queue()
    const ticket = q.enqueueBatch([upd('a', 1), upd('a', 2)], {})
    await vi.waitFor(() => expect(ticket.saved()).toBe(true))
  })

  it('a batch whose patch is empty depends on its words only; an empty batch is saved immediately', async () => {
    const { q } = queue()
    expect(q.enqueueBatch([], {}).saved()).toBe(true)
    const ticket = q.enqueueBatch([upd('a')], {})
    await vi.waitFor(() => expect(ticket.saved()).toBe(true))
  })

  it('settings merged by a later patch still count: the ticket waits for a request that covers its version', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const settingsSent: unknown[] = []
    const q = createWriteQueue(
      { sendProgress: async () => {}, sendSettings: async (p) => void (await gate, settingsSent.push(p)) },
      { retryDelaysMs: [], sleep: () => Promise.resolve() },
    )
    const ticket = q.enqueueBatch([], { new_words_learned_today_count: 3 })
    // the batch had no words, so only settings; a second patch arrives while the first request is in flight
    const first = q.enqueueBatch([upd('x')], { streak_count: 9 })
    release()
    await vi.waitFor(() => expect(first.saved()).toBe(true))
    expect(ticket.saved()).toBe(true)
    expect(settingsSent.length).toBeGreaterThanOrEqual(1)
  })
})
