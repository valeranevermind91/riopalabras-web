import type { UiLanguage } from '../lib/language'
import type { ThemeChoice } from '../lib/theme'
import type { RioExample, RioInfo, RioRegion } from './rio'

export interface Word {
  readonly esWord: string
  /** Legacy free-text Rioplatense form. Only set when the typed overlay failed to load (or for custom words). */
  readonly esRioplatense: string | null
  /** The typed Rioplatense overlay entry, when the word has an accepted one. */
  readonly rio: RioInfo | null
  /** A neutral sentence with es_word, for words whose dictionary example shows another word (pass 3). */
  readonly fallbackExample: RioExample | null
  readonly enTranslation: string
  readonly ruTranslation: string
  readonly exampleSentence: string
  readonly exampleTranslationEn: string
  readonly exampleTranslationRu: string
  readonly wordFormInExample: string | null
  readonly isRioplatenseVariant: boolean
  /** Custom words only (null for a dictionary word, whose overlay entry says it): where a Rioplatense word is used; null for both countries or unknown. */
  readonly region: RioRegion | null
  /** Custom words only: how a Rioplatense word sounds (informal, vulgar, ...); null when unknown. */
  readonly register: string | null
  /** Custom words only: the standard-Spanish equivalent of a Rioplatense word. */
  readonly esStandard: string | null
  readonly pos: string
  /** Raw corpus count (higher = more common). Never sort by this — use `rank`. */
  readonly frequency: number
  /** 1 = most frequent. Null for custom words, which have no place in the ranking. */
  readonly rank: number | null

  readonly easeFactor: number
  readonly interval: number
  readonly repetitions: number
  readonly nextReview: Date | null
  readonly isFavorite: boolean
  readonly isHidden: boolean
  readonly isCustom: boolean
  readonly isEnriched: boolean
}

export interface UserSettings {
  readonly dailyNewWordLimit: number
  readonly streakCount: number
  readonly streakLastActivityDate: string | null
  readonly newWordsLearnedTodayCount: number
  readonly newWordsLearnedTodayDate: string | null
  readonly showRuTranslation: boolean
  readonly showEnTranslation: boolean
  /** The synced theme choice (system / light / dark); null until the user has picked one on any device. */
  readonly themeChoice: ThemeChoice | null
  /** The interface language chosen by the user ('en' or 'ru'); null until they choose (it then follows Telegram's language). */
  readonly uiLanguage: UiLanguage | null
  /** Where Learn starts in the frequency order (the placement test's result); null for the default start. */
  readonly startRank: number | null
  readonly learnPicks: readonly string[]
  readonly pendingWordDeletes: readonly string[]
  /** The complete blob as read, unknown keys included — merge into this when writing settings back. */
  readonly raw: Readonly<Record<string, unknown>>
}

/** One word's SM-2 state to persist and mirror into the in-memory store. */
export interface ProgressUpdate {
  /** The word's ORIGINAL dictionary casing — conflict matching in Postgres is case-sensitive. */
  readonly esWord: string
  readonly easeFactor: number
  readonly interval: number
  readonly repetitions: number
  readonly nextReview: Date
}

/** The columns of a user_words row that the client writes (user_id is added by the writer; id, created_at and word_form_in_example are never sent). */
export interface CustomWordRow {
  /** Exactly as typed: the table's UNIQUE (user_id, es_word) is case-sensitive. */
  es_word: string
  es_rioplatense: string | null
  en_translation: string
  ru_translation: string
  example_sentence: string
  example_translation_en: string
  example_translation_ru: string
  is_rioplatense_variant: boolean
  /** 'ar' | 'uy' | null (the column has a CHECK). */
  region: string | null
  /** 'neutral' | 'informal' | 'vulgar' | 'offensive' | 'pejorative' | null (the column has a CHECK). */
  register: string | null
  /** The standard-Spanish equivalent of a Rioplatense headword. */
  es_standard: string | null
  pos: string
}

/**
 * One custom word's latest change, queued in its own lane: save it (an upsert on (user_id, es_word)), or delete it. A delete
 * names the word in its STORED casing (what the row is matched by) and the lowercased key the tombstone in
 * pending_word_deletes goes by.
 */
export type CustomWordOp = { kind: 'save'; row: CustomWordRow } | { kind: 'delete'; esWord: string; tombstone: string }

/** Keys to merge into the user_settings blob (snake_case, exactly as stored). A key whose value is `null` is removed from the blob. */
export type SettingsPatch = Record<string, unknown>
