// The shape of one rio_overlay entry. Mirrors RESPONSE_SCHEMA in schema.mjs (a test keeps the two in sync).
// Lives under tools/ for now; it moves into src/ when the client starts consuming the overlay.

export type RioType = 'replacement' | 'meaning_shift' | 'regional_only' | 'form' | 'none'
export type RioRegion = 'ar' | 'uy'
export type RioRegister = 'neutral' | 'informal' | 'vulgar' | 'offensive'
export type RioConfidence = 'high' | 'medium' | 'low'

export interface RioOverlayEntry {
  /** Echoes the dictionary es_word exactly. */
  es_word: string
  rio_type: RioType
  /** Clean 1–3 word headword. Equals es_word for meaning_shift / regional_only; null for none. */
  rio_form: string | null
  /** null = both countries agree (or unknown); set only when Argentina and Uruguay diverge. */
  region: RioRegion | null
  /** The other country's form when the countries diverge. */
  alt_form: string | null
  alt_region: RioRegion | null
  /** What the word means in standard (Peninsular) Spanish — meaning_shift only. */
  std_meaning_en: string | null
  std_meaning_ru: string | null
  register: RioRegister
  /** ≤100 chars, only when it prevents a real mistake. */
  note_en: string | null
  note_ru: string | null
  /** Set (all four together) only when the current example does not show the Rioplatense form. */
  example_sentence: string | null
  example_translation_en: string | null
  example_translation_ru: string | null
  word_form_in_example: string | null
  /** Set (both together) only when the current translation belongs to the other variant. */
  en_translation: string | null
  ru_translation: string | null
  confidence: RioConfidence
  /** ≤200 chars; kept for the audit, never shipped. */
  reasoning: string
}

export const RIO_ENTRY_KEYS = [
  'es_word',
  'reasoning',
  'rio_type',
  'rio_form',
  'region',
  'alt_form',
  'alt_region',
  'std_meaning_en',
  'std_meaning_ru',
  'register',
  'note_en',
  'note_ru',
  'example_sentence',
  'example_translation_en',
  'example_translation_ru',
  'word_form_in_example',
  'en_translation',
  'ru_translation',
  'confidence',
] as const satisfies readonly (keyof RioOverlayEntry)[]

// Compile-time guarantee that the key list is exhaustive: adding a field to the interface fails the build here.
type MissingKeys = Exclude<keyof RioOverlayEntry, (typeof RIO_ENTRY_KEYS)[number]>
export const _keysAreExhaustive: MissingKeys extends never ? true : never = true
