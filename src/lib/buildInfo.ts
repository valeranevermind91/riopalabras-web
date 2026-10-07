// Replaced at build time by vite's `define` (see buildInfo.ts at the repository root); undefined where nothing defines them.
declare const __APP_HASH__: string | undefined
declare const __APP_BUILD_DATE__: string | undefined

export const BUILD_HASH: string = typeof __APP_HASH__ === 'string' && __APP_HASH__ ? __APP_HASH__ : 'dev'
export const BUILD_DATE: string = typeof __APP_BUILD_DATE__ === 'string' && __APP_BUILD_DATE__ ? __APP_BUILD_DATE__ : ''

/** "v1a2b3c4 · 2026-10-07"; a build without a commit (no git) reads "dev · 2026-10-07". */
export function formatVersion(hash: string, date: string): string {
  const name = hash === 'dev' ? 'dev' : `v${hash}`
  return date ? `${name} · ${date}` : name
}

export const VERSION_LABEL = formatVersion(BUILD_HASH, BUILD_DATE)
