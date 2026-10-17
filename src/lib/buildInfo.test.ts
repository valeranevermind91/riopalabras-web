import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILD_HASH, BUILD_TIME, VERSION_LABEL, formatBuildDate, formatVersion } from './buildInfo'

/** The build-time half lives at the repository root (buildInfo.ts, used by vite.config.ts); loaded fresh with git faked. */
async function loadBuildInfo(exec: () => Buffer, env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  vi.doMock('node:child_process', () => ({ execSync: exec }))
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string)
  return import('../../buildInfo.ts')
}

afterEach(() => {
  vi.doUnmock('node:child_process')
  vi.unstubAllEnvs()
})

describe('the build info injected into the app', () => {
  it('is the short hash of the commit from git, with the moment of the build (an instant, not a UTC date)', async () => {
    const { buildInfo } = await loadBuildInfo(() => Buffer.from('1a2b3c4\n'), { VERCEL_GIT_COMMIT_SHA: '' })
    const before = Date.now()
    const info = buildInfo()
    expect(Object.keys(info).sort()).toEqual(['builtAt', 'hash'])
    expect(info.hash).toBe('1a2b3c4')
    expect(info.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) // a full timestamp: which day it was depends on where it is read
    expect(new Date(info.builtAt).toISOString()).toBe(info.builtAt)
    expect(Math.abs(Date.parse(info.builtAt) - before)).toBeLessThan(5000)
  })

  it('prefers the commit Vercel provides, cut to seven characters', async () => {
    const { buildInfo } = await loadBuildInfo(() => Buffer.from('ffffff'), { VERCEL_GIT_COMMIT_SHA: '0123456789abcdef' })
    expect(buildInfo().hash).toBe('0123456')
  })

  it('without git (it throws) the hash is "dev" and the build carries on', async () => {
    const { buildInfo, buildDefines } = await loadBuildInfo(
      () => {
        throw new Error('git: command not found')
      },
      { VERCEL_GIT_COMMIT_SHA: '' },
    )
    expect(buildInfo().hash).toBe('dev')
    expect(() => buildDefines()).not.toThrow()
  })

  it('an empty answer from git is "dev" too', async () => {
    const { buildInfo } = await loadBuildInfo(() => Buffer.from('  \n'), { VERCEL_GIT_COMMIT_SHA: '' })
    expect(buildInfo().hash).toBe('dev')
  })

  it('is handed to vite as define entries (JSON strings), under the names the app reads', async () => {
    const { buildDefines } = await loadBuildInfo(() => Buffer.from('abc1234'), { VERCEL_GIT_COMMIT_SHA: '' })
    const defines = buildDefines()
    expect(Object.keys(defines).sort()).toEqual(['__APP_BUILD_TIME__', '__APP_HASH__'])
    expect(JSON.parse(defines.__APP_HASH__)).toBe('abc1234')
    expect(JSON.parse(defines.__APP_BUILD_TIME__)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('the app reads them back (vitest defines them like the build does), and package.json\'s version is not involved', () => {
    expect(BUILD_HASH.length).toBeGreaterThan(0)
    expect(BUILD_TIME).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(VERSION_LABEL).toBe(formatVersion(BUILD_HASH, formatBuildDate(BUILD_TIME)))
    expect(VERSION_LABEL).toMatch(/ · \d{4}-\d{2}-\d{2}$/) // the format: <hash> · YYYY-MM-DD
    expect(VERSION_LABEL).not.toContain('0.0.0')
  })
})

describe('the build day, in the reader\'s own time zone', () => {
  // 02:30 UTC on the 17th is still the evening of the 16th in the Americas, and already the 17th (or later) everywhere east of Greenwich.
  const built = '2026-10-17T02:30:00.000Z'

  it('is the day of the reader\'s zone, not the UTC day: the evening build reads as yesterday west of Greenwich, never as tomorrow', () => {
    expect(formatBuildDate(built, 'America/Montevideo')).toBe('2026-10-16') // UTC-3: the case that was wrong (the UTC day is the 17th)
    expect(formatBuildDate(built, 'America/Los_Angeles')).toBe('2026-10-16')
    expect(formatBuildDate(built, 'America/New_York')).toBe('2026-10-16')
    expect(formatBuildDate(built, 'UTC')).toBe('2026-10-17')
    expect(formatBuildDate(built, 'Europe/Moscow')).toBe('2026-10-17')
    expect(formatBuildDate(built, 'Asia/Tokyo')).toBe('2026-10-17')
    expect(formatBuildDate(built, 'Pacific/Auckland')).toBe('2026-10-17') // UTC+13: 15:30 on the 17th
    expect(formatBuildDate('2026-10-17T11:30:00.000Z', 'Pacific/Auckland')).toBe('2026-10-18') // a build the reader sees a day later: still its true day there
  })

  it('uses the device\'s own zone when none is named (the tests run in America/Montevideo)', () => {
    expect(formatBuildDate(built)).toBe('2026-10-16')
    expect(formatBuildDate('2026-10-17T05:00:00.000Z')).toBe('2026-10-17') // 02:00 in Montevideo
  })

  it('never reads as a future date in any zone: at any moment the build is already behind, its day is today or earlier there', () => {
    const zones = ['Pacific/Pago_Pago', 'Pacific/Honolulu', 'America/Los_Angeles', 'America/Montevideo', 'Atlantic/Azores', 'UTC', 'Europe/Madrid', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Tokyo', 'Pacific/Auckland', 'Pacific/Kiritimati']
    const day = (at: number, zone: string) => formatBuildDate(new Date(at).toISOString(), zone)
    for (let step = 0; step < 24 * 14; step++) {
      const builtAt = Date.UTC(2026, 9, 1) + step * 3600_000
      for (const now of [builtAt, builtAt + 1, builtAt + 3600_000, builtAt + 5 * 3600_000, builtAt + 30 * 3600_000]) {
        for (const zone of zones) expect(day(builtAt, zone) <= day(now, zone), `${zone}: built ${new Date(builtAt).toISOString()}, read ${new Date(now).toISOString()}`).toBe(true)
      }
    }
  })

  it('is in the format it always was: four-digit year, two-digit month and day', () => {
    for (const zone of ['America/Montevideo', 'Asia/Tokyo', 'UTC']) expect(formatBuildDate('2026-01-05T12:00:00.000Z', zone)).toBe('2026-01-05')
    expect(formatVersion('1a2b3c4', formatBuildDate(built, 'America/Montevideo'))).toBe('1a2b3c4 · 2026-10-16')
    expect(formatVersion('dev', formatBuildDate(built, 'UTC'))).toBe('dev · 2026-10-17')
  })

  it('is empty, so the version reads without a date, when there is no usable moment or zone', () => {
    for (const bad of ['', 'not a date', '2026-13-45T99:99:99Z']) expect(formatBuildDate(bad), JSON.stringify(bad)).toBe('')
    expect(formatBuildDate(built, 'Mars/Olympus')).toBe('')
    expect(formatVersion('abc1234', formatBuildDate(''))).toBe('abc1234')
  })
})
