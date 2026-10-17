import { execSync } from 'node:child_process'

/**
 * The short commit hash and the moment of this build, injected into the app by vite's `define` (see vite.config.ts) and shown in
 * Settings > About. The moment is an instant (ISO 8601, UTC), not a date: which calendar day it was depends on where the reader is, so the app
 * works that out on the device (src/lib/buildInfo.ts). A date made here would be the UTC one, and for anyone west of Greenwich a build made in
 * the evening would read as tomorrow. Vercel hands the commit over in an environment variable; elsewhere it is asked of git; without either
 * (no git, a source archive) the hash is "dev", and the build carries on.
 */
export function buildInfo(): { hash: string; builtAt: string } {
  let hash = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? ''
  if (!hash) {
    try {
      hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      hash = ''
    }
  }
  return { hash: hash || 'dev', builtAt: new Date().toISOString() }
}

/** The vite `define` entries for the build info. */
export function buildDefines(): Record<string, string> {
  const { hash, builtAt } = buildInfo()
  return { __APP_HASH__: JSON.stringify(hash), __APP_BUILD_TIME__: JSON.stringify(builtAt) }
}
