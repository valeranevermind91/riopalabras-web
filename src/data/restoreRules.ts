import type { SettingsPatch } from './types'

/**
 * What a restored settings entry may overwrite on the server.
 *
 * A restored entry is old by definition: it was queued in a run that was killed, and another device may have written
 * newer state since. The settings blob is written whole-object, so replaying the entry as it stands could put old
 * absolute values over newer ones. These rules decide, key by key, what is still safe to write. They apply only to
 * restored keys: anything queued in the running app is the user's latest action and is never second-guessed.
 *
 * - The two date-and-count pairs (today's new-word counter, and the streak) move forward only. A restored pair is
 *   written only when its date is at or after the server's; on the same date the larger count wins. An older date is
 *   skipped whole, so replaying yesterday's counter can never reset today's count and let the daily cap be bypassed.
 *   A pair that arrives incomplete cannot be compared and is skipped.
 * - Every other key is written only if the server has no value for it, or the server's row was last written before
 *   the entry was queued (updated_at, see the caveat below).
 *
 * Caveat on updated_at: the Flutter client stamps it from the device clock as a local time with no zone, which Postgres
 * reads as UTC, so a Flutter write can look up to the user's UTC offset earlier (or later) than it was. The date pairs do
 * not depend on it, which is why they carry the rule that matters; the remaining keys are cosmetic (the theme).
 */
export const DATE_COUNT_PAIRS = [
  { date: 'new_words_learned_today_date', count: 'new_words_learned_today_count' },
  { date: 'streak_last_activity_date', count: 'streak_count' },
] as const

export interface ServerSettings {
  /** The blob as the server holds it now (empty when there is no row). */
  blob: Readonly<Record<string, unknown>>
  /** When the row was last written, epoch ms; null when unknown or there is no row. */
  updatedAt: number | null
}

export interface Reconciled {
  /** What is still safe to write. */
  write: SettingsPatch
  /** Restored keys that were left out because the server is ahead. */
  skipped: string[]
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function reconcileSettingsPatch(patch: SettingsPatch, restored: ReadonlySet<string>, queuedAt: Readonly<Record<string, number>>, server: ServerSettings): Reconciled {
  const write: SettingsPatch = {}
  const skipped: string[] = []
  const handled = new Set<string>()

  for (const pair of DATE_COUNT_PAIRS) {
    const touched = [pair.date, pair.count].filter((k) => k in patch)
    if (touched.length === 0 || !touched.some((k) => restored.has(k))) continue
    touched.forEach((k) => handled.add(k))

    const date = patch[pair.date]
    const count = patch[pair.count]
    if (!restored.has(pair.date) || !restored.has(pair.count) || !isDate(date) || !isCount(count)) {
      // Half a pair, or a pair that is not what it should be: it cannot be compared with the server's, so it is not written.
      for (const k of touched) {
        if (restored.has(k)) skipped.push(k)
        else write[k] = patch[k]
      }
      continue
    }

    const serverDate = server.blob[pair.date]
    const serverCount = server.blob[pair.count]
    if (!isDate(serverDate) || date > serverDate) {
      write[pair.date] = date
      write[pair.count] = count
    } else if (date === serverDate) {
      write[pair.date] = date
      write[pair.count] = isCount(serverCount) ? Math.max(count, serverCount) : count
    } else {
      skipped.push(pair.date, pair.count)
    }
  }

  for (const [key, value] of Object.entries(patch)) {
    if (handled.has(key)) continue
    if (!restored.has(key)) {
      write[key] = value
    } else if (!(key in server.blob) || server.updatedAt === null || (queuedAt[key] ?? 0) > server.updatedAt) {
      write[key] = value
    } else {
      skipped.push(key)
    }
  }

  return { write, skipped }
}
