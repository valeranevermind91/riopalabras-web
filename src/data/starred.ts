import { isInLearnPool } from './stats'
import type { SettingsPatch, UserSettings, Word } from './types'
import { compareByRank, wordKey } from './words'
import type { WriteQueue } from './writeQueue'

// "Learn sooner": the star on a word. One idea, one control: the person wants to learn this word, and Learn draws such words before the others, at its normal
// daily pace. It is a preference, not a queue: there is no cap (200 starred words are simply taught over the next weeks), and no list of its own. The
// stars live where favourites always did (the user_favorites table, one row per word, with the time it was starred).
//
// The rules: only a word Learn can still teach can be starred (it is the one thing the star can do something for); a word that is learned, marked as known,
// or never taught loses its star (so a star that is set always means "waiting": nothing appears set that affects nothing); and the stars are taught
// oldest first, so nothing starves. A batch gives starred words at most STARRED_SHARE of its slots; the rest is the usual pick.

/** The share of a batch the starred words may take. The rest keeps the usual mix: the below-start share, and the Rioplatense guarantee. */
export const STARRED_SHARE = 0.7

/** How many of a batch's slots starred words may take: round(0.7 × size), at least one, never more than the batch holds. */
export const starredSlots = (size: number, share: number = STARRED_SHARE): number => (size <= 0 ? 0 : Math.min(size, Math.max(1, Math.round(size * share))))

/** Whether a word can carry the star: only a word Learn can still teach (not started, not hidden, a part of speech that is drilled, translated). */
export const canStar = isInLearnPool

/** The stars that are waiting, in the order Learn teaches them: oldest star first; stars with no known time, and ties, by frequency rank. */
export function waitingStars(words: readonly Word[]): Word[] {
  return words
    .filter((w) => w.isFavorite && canStar(w))
    .sort((a, b) => (a.starredAt ?? Infinity) - (b.starredAt ?? Infinity) || compareByRank(a, b))
}

/** Stars that now do nothing: the word was learned, marked as known, or can never be taught. They are cleared (a star that is set always means "waiting"). */
export function staleStars(words: readonly Word[]): string[] {
  return words.filter((w) => w.isFavorite && !canStar(w)).map((w) => w.esWord)
}

// ---- the old queue, once ----

/** The key the Learn queue used in the settings blob (an ordered list of es_word, trimmed and lowercased). It is gone: its words become stars, once. */
export const LEGACY_PICKS_KEY = 'learn_picks'

/** The words the old queue held, in order, or null when the account has no such key (nothing to migrate: the migration has run, or never was needed). */
export function legacyPicks(settings: Pick<UserSettings, 'raw'>): string[] | null {
  const raw = settings.raw[LEGACY_PICKS_KEY]
  if (raw === undefined) return null
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
}

export interface PicksMigration {
  /** The queued words that can still be taught and are not starred yet: they get the star. */
  star: string[]
  /** Removes the key from the blob, which is what marks the migration done. */
  patch: SettingsPatch
}

/** The one-time move of the old queue into stars, or null when there is nothing to do (no key). The key always goes, even when no word needs a star. */
export function picksMigration(words: readonly Word[], settings: Pick<UserSettings, 'raw'>): PicksMigration | null {
  const picks = legacyPicks(settings)
  if (picks === null) return null
  const byKey = new Map(words.map((w) => [wordKey(w.esWord), w] as const))
  const seen = new Set<string>()
  const star: string[] = []
  for (const pick of picks) {
    const key = wordKey(pick)
    if (seen.has(key)) continue
    seen.add(key)
    const word = byKey.get(key)
    if (word && canStar(word) && !word.isFavorite) star.push(word.esWord)
  }
  return { star, patch: { [LEGACY_PICKS_KEY]: null } }
}

// ---- settling the stars at launch ----

export interface SettleDeps {
  words: readonly Word[]
  settings: Pick<UserSettings, 'raw'>
  applyFavorite: (esWords: readonly string[], favorite: boolean) => void
  applySettings: (patch: SettingsPatch) => void
  queue: Pick<WriteQueue, 'enqueueFavorite' | 'enqueueSettings'>
}

export interface Settled {
  /** Words that got the star from the old queue (the migration). */
  migrated: string[]
  /** Stars cleared because the word can no longer be taught (learned or marked known elsewhere, by placement, on another device). */
  cleared: string[]
}

/**
 * Runs once per launch, with the data loaded: first the old queue becomes stars (and its key leaves the blob, so it never runs again), then any star
 * that does nothing is cleared. The stars are cleared the moment Learn teaches a word or a word is marked as known; this catches the other routes
 * (the placement test, another device, an older version of the app).
 */
export function settleStars(deps: SettleDeps): Settled {
  const migration = picksMigration(deps.words, deps.settings)
  const migrated = migration?.star ?? []
  if (migration) {
    deps.applySettings(migration.patch)
    deps.queue.enqueueSettings(migration.patch)
    if (migrated.length > 0) deps.applyFavorite(migrated, true)
    for (const esWord of migrated) deps.queue.enqueueFavorite(esWord, true)
  }
  // The migrated words are teachable by construction, so they are never in this list.
  const cleared = staleStars(deps.words)
  if (cleared.length > 0) {
    deps.applyFavorite(cleared, false)
    for (const esWord of cleared) deps.queue.enqueueFavorite(esWord, false)
  }
  return { migrated, cleared }
}
