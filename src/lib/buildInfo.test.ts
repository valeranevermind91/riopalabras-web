import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILD_DATE, BUILD_HASH, VERSION_LABEL } from './buildInfo'

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
  it('is the short hash of the commit from git, with today\'s date', async () => {
    const { buildInfo } = await loadBuildInfo(() => Buffer.from('1a2b3c4\n'), { VERCEL_GIT_COMMIT_SHA: '' })
    expect(buildInfo()).toEqual({ hash: '1a2b3c4', date: new Date().toISOString().slice(0, 10) })
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
    expect(Object.keys(defines).sort()).toEqual(['__APP_BUILD_DATE__', '__APP_HASH__'])
    expect(JSON.parse(defines.__APP_HASH__)).toBe('abc1234')
    expect(JSON.parse(defines.__APP_BUILD_DATE__)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('the app reads them back (vitest defines them like the build does), and package.json\'s version is not involved', () => {
    expect(BUILD_HASH.length).toBeGreaterThan(0)
    expect(BUILD_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(VERSION_LABEL).toContain(BUILD_DATE)
    expect(VERSION_LABEL).not.toContain('0.0.0')
  })
})
