import type { DailyMetricsRow } from './metrics'
import type { CustomWordOp, CustomWordRow, ProgressUpdate, SettingsPatch } from './types'

/**
 * The write queue's pending contents on disk (localStorage), so that a webview killed with writes still unsent
 * does not lose them. Every entry is stamped with the time it was queued; on restore, entries older than
 * MAX_AGE_MS are dropped and counted. Storage is best-effort throughout: a missing or throwing localStorage
 * changes nothing about how the queue behaves, it just means nothing survives a kill.
 */

/** Entries older than this are not replayed (see the staleness notes in writeQueue.ts and the Debug screen). */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const KEY_PREFIX = 'riopalabras.writeQueue.v1.'

export interface Stamped<T> {
  readonly value: T
  /** Epoch milliseconds when this state was queued. */
  readonly at: number
}

export interface HiddenOpEntry {
  readonly esWord: string
  readonly hidden: boolean
}

export interface FavoriteOpEntry {
  readonly esWord: string
  readonly favorite: boolean
}

/** What is waiting to be sent, with each entry's queue time. */
export interface QueueSnapshot {
  progress: Stamped<ProgressUpdate>[]
  hidden: Stamped<HiddenOpEntry>[]
  favorites: Stamped<FavoriteOpEntry>[]
  /** The pending settings patch, with the queue time of each key (a key keeps the time of its latest value). */
  settings: { patch: SettingsPatch; at: Record<string, number> } | null
  metrics: Stamped<DailyMetricsRow>[]
  /** Custom-word saves and deletes (user_words). */
  words: Stamped<CustomWordOp>[]
}

export interface RestoreResult {
  snapshot: QueueSnapshot
  /** Entries dropped for being older than MAX_AGE_MS. */
  droppedStale: number
  /** Entries (or a whole record) that could not be read back. */
  droppedUnreadable: number
}

export interface QueueStore {
  save: (snapshot: QueueSnapshot) => void
  load: () => RestoreResult | null
}

/** The part of the Storage interface used here. */
export interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export const storageKeyFor = (userId: string) => `${KEY_PREFIX}${userId}`

export function safeLocalStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export const isEmptySnapshot = (s: QueueSnapshot) => s.progress.length === 0 && s.hidden.length === 0 && s.favorites.length === 0 && s.settings === null && s.metrics.length === 0 && s.words.length === 0

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function readProgress(raw: unknown): ProgressUpdate | null {
  if (!isObject(raw) || typeof raw.esWord !== 'string' || !raw.esWord) return null
  const nextReview = typeof raw.nextReview === 'string' ? new Date(raw.nextReview) : null
  if (!finite(raw.easeFactor) || !finite(raw.interval) || !finite(raw.repetitions) || !nextReview || Number.isNaN(nextReview.getTime())) return null
  return { esWord: raw.esWord, easeFactor: raw.easeFactor, interval: raw.interval, repetitions: raw.repetitions, nextReview }
}

function readMetrics(raw: unknown): DailyMetricsRow | null {
  if (!isObject(raw) || typeof raw.date !== 'string' || typeof raw.active !== 'boolean') return null
  const nullable = (v: unknown) => (v === null ? null : finite(v) ? v : undefined)
  const [dueAtStart, learnPool, dailyLimit] = [nullable(raw.dueAtStart), nullable(raw.learnPool), nullable(raw.dailyLimit)]
  if (!finite(raw.newWords) || !finite(raw.reviewsDone) || !finite(raw.reviewsLapsed) || dueAtStart === undefined || learnPool === undefined || dailyLimit === undefined) return null
  return { date: raw.date, newWords: raw.newWords, reviewsDone: raw.reviewsDone, reviewsLapsed: raw.reviewsLapsed, dueAtStart, learnPool, dailyLimit, active: raw.active }
}

const text = (v: unknown): v is string => typeof v === 'string'

function readWordOp(raw: unknown): CustomWordOp | null {
  if (!isObject(raw)) return null
  if (raw.kind === 'delete') return text(raw.esWord) && raw.esWord && text(raw.tombstone) ? { kind: 'delete', esWord: raw.esWord, tombstone: raw.tombstone } : null
  const r = raw.row
  if (raw.kind !== 'save' || !isObject(r)) return null
  if (!text(r.es_word) || !r.es_word || !text(r.en_translation) || !text(r.ru_translation) || !text(r.example_sentence) || !text(r.example_translation_en) || !text(r.example_translation_ru) || !text(r.pos) || typeof r.is_rioplatense_variant !== 'boolean') return null
  if (r.es_rioplatense !== null && !text(r.es_rioplatense)) return null
  const row: CustomWordRow = {
    es_word: r.es_word,
    es_rioplatense: r.es_rioplatense,
    en_translation: r.en_translation,
    ru_translation: r.ru_translation,
    example_sentence: r.example_sentence,
    example_translation_en: r.example_translation_en,
    example_translation_ru: r.example_translation_ru,
    is_rioplatense_variant: r.is_rioplatense_variant,
    // a save queued by an earlier version of the app has no marks
    region: text(r.region) ? r.region : null,
    register: text(r.register) ? r.register : null,
    es_standard: text(r.es_standard) ? r.es_standard : null,
    pos: r.pos,
  }
  return { kind: 'save', row }
}

function readHidden(raw: unknown): HiddenOpEntry | null {
  if (!isObject(raw) || typeof raw.esWord !== 'string' || !raw.esWord || typeof raw.hidden !== 'boolean') return null
  return { esWord: raw.esWord, hidden: raw.hidden }
}

function readFavorite(raw: unknown): FavoriteOpEntry | null {
  if (!isObject(raw) || typeof raw.esWord !== 'string' || !raw.esWord || typeof raw.favorite !== 'boolean') return null
  return { esWord: raw.esWord, favorite: raw.favorite }
}

/** Turns a stored list of {value, at} into stamped entries, dropping the stale and the unreadable (counted). */
function readList<T>(list: unknown, read: (raw: unknown) => T | null, cutoff: number, tally: { stale: number; unreadable: number }): Stamped<T>[] {
  if (!Array.isArray(list)) {
    if (list !== undefined) tally.unreadable++
    return []
  }
  const out: Stamped<T>[] = []
  for (const entry of list) {
    const at = isObject(entry) ? entry.at : undefined
    const value = isObject(entry) ? read(entry.value) : null
    if (!finite(at) || value === null) tally.unreadable++
    else if (at < cutoff) tally.stale++
    else out.push({ value, at })
  }
  return out
}

/** The queue's store for one signed-in user: its own key, and a user id inside the record that must match. */
export function createQueueStore(userId: string, storage: StorageLike | null = safeLocalStorage(), now: () => number = Date.now): QueueStore {
  const key = storageKeyFor(userId)

  return {
    save(snapshot) {
      if (!storage) return
      try {
        if (isEmptySnapshot(snapshot)) {
          storage.removeItem(key)
          return
        }
        storage.setItem(
          key,
          JSON.stringify({
            v: 1,
            userId,
            savedAt: now(),
            progress: snapshot.progress.map((e) => ({ value: { ...e.value, nextReview: e.value.nextReview.toISOString() }, at: e.at })),
            hidden: snapshot.hidden,
            favorites: snapshot.favorites,
            settings: snapshot.settings,
            metrics: snapshot.metrics,
            words: snapshot.words,
          }),
        )
      } catch {
        // storage full, blocked or missing: the in-memory queue carries on exactly as before
      }
    },

    load() {
      if (!storage) return null
      let text: string | null
      try {
        text = storage.getItem(key)
      } catch {
        return null
      }
      if (text === null) return null

      let record: unknown
      try {
        record = JSON.parse(text)
      } catch {
        return { snapshot: { progress: [], hidden: [], favorites: [], settings: null, metrics: [], words: [] }, droppedStale: 0, droppedUnreadable: 1 }
      }
      // Never another account's queue, even if it somehow sits under this key.
      if (!isObject(record) || record.v !== 1 || record.userId !== userId) {
        return { snapshot: { progress: [], hidden: [], favorites: [], settings: null, metrics: [], words: [] }, droppedStale: 0, droppedUnreadable: isObject(record) && record.userId !== userId ? 0 : 1 }
      }

      const cutoff = now() - MAX_AGE_MS
      const tally = { stale: 0, unreadable: 0 }
      const progress = readList(record.progress, readProgress, cutoff, tally)
      const hidden = readList(record.hidden, readHidden, cutoff, tally)
      const favorites = readList(record.favorites, readFavorite, cutoff, tally)
      const metrics = readList(record.metrics, readMetrics, cutoff, tally)
      const words = readList(record.words, readWordOp, cutoff, tally)

      let settings: QueueSnapshot['settings'] = null
      if (isObject(record.settings) && isObject(record.settings.patch) && isObject(record.settings.at)) {
        const patch: SettingsPatch = {}
        const at: Record<string, number> = {}
        for (const [k, value] of Object.entries(record.settings.patch)) {
          const stamp = (record.settings.at as Record<string, unknown>)[k]
          if (!finite(stamp)) tally.unreadable++
          else if (stamp < cutoff) tally.stale++
          else {
            patch[k] = value
            at[k] = stamp
          }
        }
        if (Object.keys(patch).length > 0) settings = { patch, at }
      } else if (record.settings !== null && record.settings !== undefined) {
        tally.unreadable++
      }

      return { snapshot: { progress, hidden, favorites, settings, metrics, words }, droppedStale: tally.stale, droppedUnreadable: tally.unreadable }
    },
  }
}
