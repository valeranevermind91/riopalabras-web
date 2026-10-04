import type { RioExample, RioInfo } from './rio'

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

/** Keys to merge into the user_settings blob (snake_case, exactly as stored). */
export type SettingsPatch = Record<string, unknown>
