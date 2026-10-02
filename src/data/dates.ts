// Timestamps (next_review, updated_at) are UTC instants; calendar days (streak, daily counters)
// are the device's LOCAL date. The two never mix.

const HAS_OFFSET = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i

/** Parses a timestamptz string as UTC. A string with no offset is treated as UTC, never as local time. */
export function parseUtc(value: string): Date | null {
  const trimmed = value.trim()
  const timePart = trimmed.includes('T') ? trimmed.slice(trimmed.indexOf('T')) : trimmed
  const iso = HAS_OFFSET.test(timePart) ? trimmed : `${trimmed.replace(' ', 'T')}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

export function localDateKey(date: Date = new Date()): string {
  const y = String(date.getFullYear()).padStart(4, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Field arithmetic, not a 24h subtraction, so DST changes can't land on the wrong day. */
export function localYesterdayKey(date: Date = new Date()): string {
  return localDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1))
}
