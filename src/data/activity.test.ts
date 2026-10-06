import { describe, expect, it } from 'vitest'
import { fetchRecentActivity, lastDays } from '../data/metrics'

describe('the activity dots data', () => {
  it('lastDays gives seven local dates, oldest first, ending today', () => {
    expect(lastDays(new Date(2026, 9, 5, 12))).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'])
  })

  it('crosses month and year ends, and a DST change cannot skip or repeat a day', () => {
    expect(lastDays(new Date(2027, 0, 3, 12))[0]).toBe('2026-12-28')
    for (const month of [2, 9, 10]) {
      const days = lastDays(new Date(2026, month, 28, 12))
      expect(new Set(days).size).toBe(7)
    }
  })

  const clientReturning = (result: { data: unknown; error: { message: string } | null }) => {
    const calls: string[][] = []
    const builder = {
      select: (cols: string) => (calls.push(['select', cols]), builder),
      eq: (c: string, v: string) => (calls.push(['eq', c, v]), builder),
      gte: (c: string, v: string) => (calls.push(['gte', c, v]), builder),
      lte: async (c: string, v: string) => (calls.push(['lte', c, v]), result),
    }
    return { client: { from: () => builder } as never, calls }
  }

  it('reads the active days of the last week (read-only, one query)', async () => {
    const c = clientReturning({ data: [{ date: '2026-10-05', active: true }, { date: '2026-10-04', active: false }, { date: '2026-10-02', active: true }], error: null })
    const days = await fetchRecentActivity(c.client, 'user-1', new Date(2026, 9, 5, 12))
    expect([...days].sort()).toEqual(['2026-10-02', '2026-10-05'])
    expect(c.calls).toEqual([['select', 'date, active'], ['eq', 'user_id', 'user-1'], ['gte', 'date', '2026-09-29'], ['lte', 'date', '2026-10-05']])
  })

  it('rejects on a server error, so the caller can hide the dots', async () => {
    await expect(fetchRecentActivity(clientReturning({ data: null, error: { message: 'permission denied' } }).client, 'u', new Date())).rejects.toThrow('permission denied')
  })

  it('an empty answer is simply no active days', async () => {
    expect((await fetchRecentActivity(clientReturning({ data: [], error: null }).client, 'u', new Date())).size).toBe(0)
    expect((await fetchRecentActivity(clientReturning({ data: null, error: null }).client, 'u', new Date())).size).toBe(0)
  })
})
