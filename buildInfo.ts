import { execSync } from 'node:child_process'

/**
 * The short commit hash and the date of this build, injected into the app by vite's `define` (see vite.config.ts) and shown in
 * Settings > About. Vercel hands the commit over in an environment variable; elsewhere it is asked of git; without either
 * (no git, a source archive) the hash is "dev", and the build carries on.
 */
export function buildInfo(): { hash: string; date: string } {
  let hash = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? ''
  if (!hash) {
    try {
      hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      hash = ''
    }
  }
  return { hash: hash || 'dev', date: new Date().toISOString().slice(0, 10) }
}

/** The vite `define` entries for the build info. */
export function buildDefines(): Record<string, string> {
  const { hash, date } = buildInfo()
  return { __APP_HASH__: JSON.stringify(hash), __APP_BUILD_DATE__: JSON.stringify(date) }
}
