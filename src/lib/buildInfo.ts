// Replaced at build time by vite's `define` (see buildInfo.ts at the repository root); undefined where nothing defines them.
declare const __APP_HASH__: string | undefined
declare const __APP_BUILD_TIME__: string | undefined

export const BUILD_HASH: string = typeof __APP_HASH__ === 'string' && __APP_HASH__ ? __APP_HASH__ : 'dev'
/** The moment of the build, ISO 8601 in UTC ('2026-10-17T02:30:00.000Z'); empty where nothing defines it. */
export const BUILD_TIME: string = typeof __APP_BUILD_TIME__ === 'string' && __APP_BUILD_TIME__ ? __APP_BUILD_TIME__ : ''

/**
 * The calendar day of a build moment as the reader lives it: 'YYYY-MM-DD' in their time zone (the device's, or `timeZone` where a test names one).
 * Not the UTC day: a build made at 22:30 in Montevideo is already the next day in UTC, and a date taken from the UTC clock reads as tomorrow to
 * everyone west of Greenwich. Empty when there is no usable moment (a build without one, or text that is not a date).
 */
export function formatBuildDate(builtAt: string, timeZone?: string): string {
  const moment = new Date(builtAt)
  if (!builtAt || Number.isNaN(moment.getTime())) return ''
  try {
    const parts: Record<string, string> = {}
    for (const part of new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(moment)) parts[part.type] = part.value
    return `${parts.year}-${parts.month}-${parts.day}`
  } catch {
    return '' // a zone Intl does not know
  }
}

/** "v1a2b3c4 · 2026-10-07"; a build without a commit (no git) reads "dev · 2026-10-07". */
export function formatVersion(hash: string, date: string): string {
  const name = hash === 'dev' ? 'dev' : `v${hash}`
  return date ? `${name} · ${date}` : name
}

/** The version as Settings shows it: the hash, and the build's day in the user's own time zone. */
export const VERSION_LABEL = formatVersion(BUILD_HASH, formatBuildDate(BUILD_TIME))
