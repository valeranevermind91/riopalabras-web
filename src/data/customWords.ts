import { customRegion, customRegister, type CustomRegister } from './customMarks'
import { addToQueue, removeKeys } from './learnPicks'
import type { RioRegion } from './rio'
import type { CustomWordRow, SettingsPatch, UserSettings, Word } from './types'
import { customWordFromRow, wordKey } from './words'
import type { WriteQueue } from './writeQueue'

// A user's own words (user_words). The same table and rules the Flutter app uses: one row per (user_id, es_word), es_word kept
// exactly as typed, a single word of at most 50 characters (the proxy's limit), a part of speech picked from five, and both
// translations before it can be taught. Deleting leaves a tombstone in the settings blob (pending_word_deletes, the lowercased
// key) so that the Flutter app's pull does not bring the word back; a new word removes any tombstone for its key.

export const MAX_WORD_LENGTH = 50

/** The part-of-speech codes a custom word can have, in the order the form offers them ("custom" is "Other"). */
export const POS_CODES = ['v', 'n', 'adj', 'adv', 'custom'] as const
export type PosCode = (typeof POS_CODES)[number]

export type SpanishProblem = 'empty' | 'spaces' | 'too-long'

/** The typed word, trimmed, or what is wrong with it: a single word, no whitespace inside, at most 50 characters. */
export function checkSpanish(raw: string): { ok: true; word: string } | { ok: false; problem: SpanishProblem } {
  const word = raw.trim()
  if (word === '') return { ok: false, problem: 'empty' }
  if (/\s/.test(word)) return { ok: false, problem: 'spaces' }
  if (word.length > MAX_WORD_LENGTH) return { ok: false, problem: 'too-long' }
  return { ok: true, word }
}

export type DuplicateVia = 'es_word' | 'es_rioplatense' | 'overlay'
export interface Duplicate {
  word: Word
  via: DuplicateVia
}

/**
 * Whether the typed word is already there: it equals a word's es_word, its legacy es_rioplatense, or a Rioplatense form of
 * its overlay entry, the main one or the alternative (the web has overlay data the Flutter app does not). Trimmed and lowercased, no accent folding (café ≠ cafe),
 * against every word, hidden ones included. The first word that matches, es_word before the Rioplatense forms.
 */
export function findDuplicate(words: readonly Word[], typed: string): Duplicate | null {
  const target = wordKey(typed)
  if (target === '') return null
  for (const word of words) {
    if (wordKey(word.esWord) === target) return { word, via: 'es_word' }
    if (word.esRioplatense && wordKey(word.esRioplatense) === target) return { word, via: 'es_rioplatense' }
    if (word.rio && (wordKey(word.rio.form) === target || (word.rio.altForm && wordKey(word.rio.altForm) === target))) return { word, via: 'overlay' }
  }
  return null
}

/** What the form holds. */
export interface WordValues {
  esWord: string
  pos: PosCode | null
  enTranslation: string
  ruTranslation: string
  exampleSentence: string
  exampleTranslationEn: string
  exampleTranslationRu: string
  /** Not typed: they come back from enrichment (or stay as the word has them). */
  esRioplatense: string | null
  isRioplatenseVariant: boolean
  /** Where a Rioplatense word is used (null: both countries, or unknown). */
  region: RioRegion | null
  /** How a Rioplatense word sounds (null: unknown). */
  register: CustomRegister | null
  /** The standard-Spanish equivalent of a Rioplatense word. */
  esStandard: string | null
}

export type SaveProblem = 'word' | 'pos' | 'translations'

/** What is needed to save: the word, the part of speech and BOTH translations (a word with one cannot be taught or reviewed). */
export function checkSave(values: WordValues): { ok: true } | { ok: false; problem: SaveProblem } {
  if (!checkSpanish(values.esWord).ok) return { ok: false, problem: 'word' }
  if (!values.pos) return { ok: false, problem: 'pos' }
  if (values.enTranslation.trim() === '' || values.ruTranslation.trim() === '') return { ok: false, problem: 'translations' }
  return { ok: true }
}

/** The row to write: exactly the twelve columns the client owns, es_word as typed (trimmed), text trimmed. */
export function rowFromValues(values: WordValues): CustomWordRow {
  return {
    es_word: values.esWord.trim(),
    es_rioplatense: values.esRioplatense?.trim() || null,
    en_translation: values.enTranslation.trim(),
    ru_translation: values.ruTranslation.trim(),
    example_sentence: values.exampleSentence.trim(),
    example_translation_en: values.exampleTranslationEn.trim(),
    example_translation_ru: values.exampleTranslationRu.trim(),
    is_rioplatense_variant: values.isRioplatenseVariant,
    region: customRegion(values.region),
    register: customRegister(values.register),
    es_standard: values.esStandard?.trim() || null,
    pos: values.pos ?? 'custom',
  }
}

/** An empty form. */
export const blankValues = (): WordValues => ({
  esWord: '',
  pos: null,
  enTranslation: '',
  ruTranslation: '',
  exampleSentence: '',
  exampleTranslationEn: '',
  exampleTranslationRu: '',
  esRioplatense: null,
  isRioplatenseVariant: false,
  region: null,
  register: null,
  esStandard: null,
})

/** The form's values for a word already there (editing). */
export function valuesOf(word: Word): WordValues {
  return {
    esWord: word.esWord,
    pos: (POS_CODES as readonly string[]).includes(word.pos) ? (word.pos as PosCode) : 'custom',
    enTranslation: word.enTranslation,
    ruTranslation: word.ruTranslation,
    exampleSentence: word.exampleSentence,
    exampleTranslationEn: word.exampleTranslationEn,
    exampleTranslationRu: word.exampleTranslationRu,
    esRioplatense: word.esRioplatense,
    isRioplatenseVariant: word.isRioplatenseVariant,
    region: word.region,
    register: customRegister(word.register),
    esStandard: word.esStandard,
  }
}

export interface CustomWordDeps {
  /** Every word the client has (for the duplicate check and the queue's cap). */
  words: readonly Word[]
  /** The latest settings, read at the moment of the action. */
  getSettings: () => UserSettings
  applySettings: (patch: SettingsPatch) => void
  upsertCustomWord: (word: Word) => void
  removeCustomWord: (esWord: string) => void
  queue: Pick<WriteQueue, 'enqueueCustomWord' | 'enqueueCustomDelete' | 'enqueueSettings'>
}

export type AddResult =
  | { status: 'invalid'; problem: SaveProblem }
  | { status: 'duplicate'; duplicate: Duplicate }
  /** `queue`: put on the Learn queue, or not because the queue is full. */
  | { status: 'added'; queue: 'queued' | 'full' }

const saveSettings = (patch: SettingsPatch, deps: Pick<CustomWordDeps, 'applySettings' | 'queue'>) => {
  if (Object.keys(patch).length === 0) return
  deps.applySettings(patch)
  deps.queue.enqueueSettings(patch)
}

/**
 * Adds a word: checks it, looks for a duplicate (nothing is written on a hit), saves it through the write queue, and in ONE
 * settings patch removes a tombstone for its key (a Flutter sync would delete the new row otherwise) and puts it on the Learn
 * queue, where custom words have to be: they have no frequency rank, so the 150-word window would never reach them. A full
 * queue still saves the word.
 */
export function addCustomWord(values: WordValues, deps: CustomWordDeps): AddResult {
  const checked = checkSave(values)
  if (!checked.ok) return { status: 'invalid', problem: checked.problem }
  const duplicate = findDuplicate(deps.words, values.esWord)
  if (duplicate) return { status: 'duplicate', duplicate }

  const row = rowFromValues(values)
  const word = customWordFromRow(row)
  deps.upsertCustomWord(word)
  deps.queue.enqueueCustomWord(row)

  const settings = deps.getSettings()
  const key = wordKey(row.es_word)
  const patch: SettingsPatch = {}
  if (settings.pendingWordDeletes.some((k) => wordKey(k) === key)) patch.pending_word_deletes = settings.pendingWordDeletes.filter((k) => wordKey(k) !== key)
  const queued = addToQueue(settings, [...deps.words, word], word)
  if (queued.ok) patch.learn_picks = queued.patch.learn_picks
  saveSettings(patch, deps)

  return { status: 'added', queue: queued.ok || queued.reason === 'already' ? 'queued' : 'full' }
}

export type EditResult = { status: 'invalid'; problem: SaveProblem } | { status: 'saved' }

/** Saves changes to a custom word: the same upsert on the same key (es_word is never changed). Its progress is not touched. */
export function editCustomWord(word: Word, values: WordValues, deps: Pick<CustomWordDeps, 'upsertCustomWord' | 'queue'>): EditResult {
  const checked = checkSave({ ...values, esWord: word.esWord })
  if (!checked.ok) return { status: 'invalid', problem: checked.problem }
  const row = rowFromValues({ ...values, esWord: word.esWord })
  deps.upsertCustomWord(customWordFromRow(row))
  deps.queue.enqueueCustomWord(row)
  return { status: 'saved' }
}

/**
 * Deletes a custom word. The tombstone (the lowercased key, in pending_word_deletes, Flutter's shape) is queued in the settings
 * lane, which goes out before the delete does; the delete itself uses the word's stored casing. The word also leaves the Learn
 * queue. Progress, favourite and hidden rows are left alone, as the Flutter app leaves them.
 */
export function deleteCustomWord(word: Word, deps: CustomWordDeps): boolean {
  if (!word.isCustom) return false
  const settings = deps.getSettings()
  const key = wordKey(word.esWord)
  const patch: SettingsPatch = { ...removeKeys(settings, [word.esWord]) }
  patch.pending_word_deletes = settings.pendingWordDeletes.some((k) => wordKey(k) === key) ? [...settings.pendingWordDeletes] : [...settings.pendingWordDeletes, key]
  saveSettings(patch, deps)
  deps.removeCustomWord(word.esWord)
  deps.queue.enqueueCustomDelete(word.esWord)
  return true
}

/**
 * Where the write queue gets the clearing of tombstones from. The queue exists before the user's state has loaded; once it
 * has, `use` points this at the loaded settings, and a delete that reached the server clears its tombstone there too (every
 * settings write sends the whole blob, so a tombstone left in memory would be written back). Before that it clears nothing:
 * the Flutter app's own sync clears a leftover tombstone the next time it runs.
 */
export function createTombstoneClearer() {
  let source: { read: () => UserSettings; apply: (patch: SettingsPatch) => void } | null = null
  return {
    use: (next: { read: () => UserSettings; apply: (patch: SettingsPatch) => void } | null) => {
      source = next
    },
    clear: (tombstones: readonly string[]): SettingsPatch | null => {
      const patch = tombstoneClearPatch(source?.read() ?? null, tombstones)
      if (patch) source?.apply(patch)
      return patch
    },
  }
}

/** The settings patch that clears these tombstones once their rows are deleted, or null when none of them is there. */
export function tombstoneClearPatch(settings: UserSettings | null, tombstones: readonly string[]): SettingsPatch | null {
  if (!settings) return null
  const gone = new Set(tombstones.map(wordKey))
  const kept = settings.pendingWordDeletes.filter((k) => !gone.has(wordKey(k)))
  return kept.length === settings.pendingWordDeletes.length ? null : { pending_word_deletes: kept }
}
