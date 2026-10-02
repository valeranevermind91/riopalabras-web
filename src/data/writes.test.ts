import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '../testing/fakeSupabase'
import { parseSettings } from './settings'
import { toProgressRow, upsertProgress, writeSettings } from './writes'

const NOW = new Date('2026-10-02T15:00:00.000Z')
const DUE = new Date(2026, 9, 3) // tomorrow, local midnight (Montevideo) = 2026-10-03T03:00:00.000Z

describe('upsertProgress', () => {
  it('writes the exact user_progress rows with UTC ISO timestamps and the original casing', async () => {
    const { client, calls } = fakeSupabase()
    await upsertProgress(
      client,
      'user-1',
      [
        { esWord: 'Hacienda', easeFactor: 2.5, interval: 0, repetitions: 1, nextReview: DUE },
        { esWord: 'casa', easeFactor: 2.18, interval: 3, repetitions: 2, nextReview: DUE },
      ],
      NOW,
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('user_progress')
    expect(calls[0].options).toEqual({ onConflict: 'user_id,es_word' })
    expect(calls[0].rows).toEqual([
      {
        user_id: 'user-1',
        es_word: 'Hacienda',
        ease_factor: 2.5,
        interval_days: 0,
        repetitions: 1,
        next_review: '2026-10-03T03:00:00.000Z',
        updated_at: '2026-10-02T15:00:00.000Z',
      },
      {
        user_id: 'user-1',
        es_word: 'casa',
        ease_factor: 2.18,
        interval_days: 3,
        repetitions: 2,
        next_review: '2026-10-03T03:00:00.000Z',
        updated_at: '2026-10-02T15:00:00.000Z',
      },
    ])
  })

  it('writes only the five documented columns plus user_id', () => {
    const row = toProgressRow('u', { esWord: 'x', easeFactor: 2.5, interval: 0, repetitions: 1, nextReview: DUE }, NOW.toISOString())
    expect(Object.keys(row).sort()).toEqual(
      ['ease_factor', 'es_word', 'interval_days', 'next_review', 'repetitions', 'updated_at', 'user_id'].sort(),
    )
  })

  it('sends nothing for an empty list', async () => {
    const { client, calls } = fakeSupabase()
    await upsertProgress(client, 'user-1', [], NOW)
    expect(calls).toHaveLength(0)
  })

  it('throws (never swallows) when Supabase reports an error', async () => {
    const { client, failures } = fakeSupabase()
    failures.user_progress = 1
    await expect(
      upsertProgress(client, 'user-1', [{ esWord: 'casa', easeFactor: 2.5, interval: 0, repetitions: 1, nextReview: DUE }], NOW),
    ).rejects.toThrow('user_progress: boom from user_progress')
  })
})

describe('writeSettings', () => {
  const current = parseSettings({
    daily_new_word_limit: 12,
    streak_count: 7,
    learn_picks: ['ser', 'estar'],
    pending_word_deletes: ['foo'],
    some_future_key: { nested: true },
  })

  it('upserts the WHOLE blob with the patch merged in, preserving unknown keys', async () => {
    const { client, calls } = fakeSupabase()
    const written = await writeSettings(client, 'user-1', current, { streak_count: 8, streak_last_activity_date: '2026-10-02' }, NOW)

    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('user_settings')
    expect(calls[0].options).toEqual({ onConflict: 'user_id' })
    expect(calls[0].rows).toEqual({
      user_id: 'user-1',
      settings: {
        daily_new_word_limit: 12,
        streak_count: 8,
        learn_picks: ['ser', 'estar'],
        pending_word_deletes: ['foo'],
        some_future_key: { nested: true },
        streak_last_activity_date: '2026-10-02',
      },
      updated_at: '2026-10-02T15:00:00.000Z',
    })
    expect(written).toEqual((calls[0].rows as { settings: unknown }).settings)
  })

  it('does not mutate the in-memory settings it merged from', async () => {
    const { client } = fakeSupabase()
    await writeSettings(client, 'user-1', current, { streak_count: 99 }, NOW)
    expect(current.raw.streak_count).toBe(7)
  })

  it('throws when Supabase reports an error', async () => {
    const { client, failures } = fakeSupabase()
    failures.user_settings = 1
    await expect(writeSettings(client, 'user-1', current, { streak_count: 1 }, NOW)).rejects.toThrow(
      'user_settings: boom from user_settings',
    )
  })
})
