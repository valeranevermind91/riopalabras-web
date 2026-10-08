import { parseUtc } from './dates'
import type { Overlay, UserWordRow } from './overlay'
import { customRegion, customRegister } from './customMarks'
import type { Word } from './types'

const NON_REVIEWABLE_POS = new Set(['art', 'prep', 'conj', 'contraction', 'determiner', 'pron'])

/** The one matching key for every table: trimmed + lowercased es_word. No diacritic folding (café ≠ cafe). */
export function wordKey(esWord: string): string {
  return esWord.trim().toLowerCase()
}

export function isReviewablePos(pos: string): boolean {
  return !NON_REVIEWABLE_POS.has(pos.toLowerCase())
}

export function hasTranslations(word: Word): boolean {
  return word.enTranslation.trim() !== '' && word.ruTranslation.trim() !== ''
}

/** "Most common first": rank ascending (rank 1 = most frequent). Custom words (no rank) sort after all ranked words. */
export function compareByRank(a: Word, b: Word): number {
  if (a.rank !== null && b.rank !== null) return a.rank - b.rank
  if (a.rank !== null) return -1
  if (b.rank !== null) return 1
  return a.esWord.localeCompare(b.esWord)
}

export interface MergeDiagnostics {
  baseCount: number
  customCount: number
  /** Cloud rows whose es_word matches neither a dictionary word nor a custom word — ignored. */
  orphanProgress: number
  orphanFavorites: number
  orphanHidden: number
  /** Custom rows sharing an es_word with a dictionary word; the custom row wins, as in the Flutter reconcile. */
  customShadowingBase: number
}

export interface MergedWords {
  /** Every word (base + custom), sorted by rank ascending. */
  words: readonly Word[]
  byKey: ReadonlyMap<string, Word>
  diagnostics: MergeDiagnostics
}

export function customWordFromRow(row: UserWordRow): Word {
  const enTranslation = row.en_translation ?? ''
  const ruTranslation = row.ru_translation ?? ''
  return {
    esWord: row.es_word.trim(),
    esRioplatense: row.es_rioplatense?.trim() || null,
    rio: null,
    fallbackExample: null,
    enTranslation,
    ruTranslation,
    exampleSentence: row.example_sentence ?? '',
    exampleTranslationEn: row.example_translation_en ?? '',
    exampleTranslationRu: row.example_translation_ru ?? '',
    wordFormInExample: null,
    isRioplatenseVariant: row.is_rioplatense_variant === true,
    region: customRegion(row.region),
    register: customRegister(row.register),
    esStandard: row.es_standard?.trim() || null,
    pos: row.pos?.trim() || 'custom',
    frequency: 0,
    rank: null,
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: null,
    isFavorite: false,
    isHidden: false,
    isCustom: true,
    isEnriched: enTranslation.trim() !== '' && ruTranslation.trim() !== '',
  }
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

/** Pure: overlays the user's cloud rows onto the immutable dictionary and returns new Word objects. */
export function mergeWords(base: readonly Word[], overlay: Overlay): MergedWords {
  const byKey = new Map<string, Word>()
  for (const word of base) byKey.set(wordKey(word.esWord), word)

  // A word the Flutter app deleted offline is still in the cloud until its tombstone is processed: it is not shown meanwhile
  // (the Flutter app's own pull skips it the same way).
  const tombstoned = new Set(stringList(overlay.settings?.pending_word_deletes).map(wordKey))

  let customShadowingBase = 0
  for (const row of overlay.customWords) {
    const key = wordKey(row.es_word)
    if (!key || tombstoned.has(key)) continue
    if (byKey.get(key)?.isCustom === false) customShadowingBase++
    byKey.set(key, customWordFromRow(row))
  }

  let orphanProgress = 0
  for (const row of overlay.progress) {
    const key = wordKey(row.es_word)
    const existing = byKey.get(key)
    if (!existing) {
      orphanProgress++
      continue
    }
    byKey.set(key, {
      ...existing,
      easeFactor: row.ease_factor ?? existing.easeFactor,
      interval: row.interval_days ?? existing.interval,
      repetitions: row.repetitions ?? existing.repetitions,
      nextReview: row.next_review ? parseUtc(row.next_review) : existing.nextReview,
    })
  }

  const applyFlag = (esWords: readonly string[], patch: Partial<Pick<Word, 'isFavorite' | 'isHidden'>>) => {
    let orphans = 0
    for (const esWord of esWords) {
      const key = wordKey(esWord)
      const existing = byKey.get(key)
      if (!existing) {
        orphans++
        continue
      }
      byKey.set(key, { ...existing, ...patch })
    }
    return orphans
  }
  const orphanFavorites = applyFlag(overlay.favorites, { isFavorite: true })
  const orphanHidden = applyFlag(overlay.hidden, { isHidden: true })

  const words = [...byKey.values()].map((w) => Object.freeze(w)).sort(compareByRank)

  return {
    words: Object.freeze(words),
    byKey,
    diagnostics: {
      baseCount: base.length,
      customCount: words.filter((w) => w.isCustom).length,
      orphanProgress,
      orphanFavorites,
      orphanHidden,
      customShadowingBase,
    },
  }
}
