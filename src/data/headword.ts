import { findFormRange, type FormRange } from './rio'
import type { Word } from './types'

// Which Spanish form a card leads with, and which word in the example sentence to highlight.
// The Rioplatense form leads only when the data proves it. With the typed overlay: a replacement whose
// form (or an inflection of it) appears in the example sentence. Without it (the overlay failed to
// load, or a custom word): the legacy rule, a clean es_rioplatense value genuinely different from the
// standard word and actually demonstrated by the example sentence's target form.

export type HeadwordSource = Pick<Word, 'esWord' | 'esRioplatense' | 'wordFormInExample'> &
  Partial<Pick<Word, 'rio' | 'pos' | 'exampleSentence' | 'exampleTranslationEn' | 'exampleTranslationRu'>>
type HighlightSource = HeadwordSource & Pick<Word, 'exampleSentence'>

export type HeadwordForm = 'rioplatense' | 'standard'

export interface Headword {
  text: string
  form: HeadwordForm
  /** The standard word, shown as a small note — only when the Rioplatense form is the headword. */
  secondary: string | null
}

export interface HighlightRange {
  start: number
  end: number
}

export interface HighlightResult {
  /** The example sentence with `**` markdown noise removed; `range` indexes into this string. */
  sentence: string
  range: HighlightRange | null
}

// Letters, combining marks and hyphens; single-space separated; at most 3 words.
const CLEAN_VARIANT = /^[\p{L}\p{M}-]+(?: [\p{L}\p{M}-]+){0,2}$/u
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}]'

const lower = (s: string) => s.trim().toLowerCase()

export function isCleanVariant(value: string): boolean {
  return CLEAN_VARIANT.test(value.trim())
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Equal ignoring case, or an inflection of it: a shared prefix of ≥3 chars and ≥ (shorter length − 2). */
export function formMatches(wordForm: string | null, variant: string): boolean {
  if (!wordForm) return false
  const a = lower(wordForm)
  const b = lower(variant)
  if (!a || !b) return false
  if (a === b) return true
  const prefix = commonPrefixLength(a, b)
  return prefix >= 3 && prefix >= Math.min(a.length, b.length) - 2
}

export interface EffectiveExample {
  /** The example sentence with `**` markers removed. */
  sentence: string
  /** The exact form the example demonstrates, as stored with it. */
  wordForm: string | null
  en: string
  ru: string
  source: 'overlay' | 'dictionary'
}

/** The example a card shows: the overlay's pass-2 sentence when there is one, otherwise the dictionary's. */
export function effectiveExample(word: HeadwordSource): EffectiveExample {
  const overlay = word.rio?.example
  if (overlay) return { sentence: stripEmphasisMarkers(overlay.es), wordForm: overlay.wordForm, en: overlay.en, ru: overlay.ru, source: 'overlay' }
  return {
    sentence: stripEmphasisMarkers(word.exampleSentence ?? ''),
    wordForm: word.wordFormInExample?.trim() || null,
    en: word.exampleTranslationEn ?? '',
    ru: word.exampleTranslationRu ?? '',
    source: 'dictionary',
  }
}

export type HeadwordReason =
  | 'no-overlay'
  | 'legacy'
  | 'not-replacement'
  | 'unclean-form'
  | 'same-as-es-word'
  | 'overlay-example-has-form'
  | 'dictionary-example-has-form'
  | 'no-example-has-form'

export interface HeadwordDecision {
  switched: boolean
  reason: HeadwordReason
  /** The text in the shown example that proved the form (as written there), when the overlay switched the headword. */
  matched: string | null
  /** Which example the card shows. */
  exampleSource: 'overlay' | 'dictionary'
}

/**
 * Why a card leads with the Rioplatense form or not. `headword()` is built on this, so the explanation cannot drift.
 * A replacement ALWAYS leads with its form, provided the example the card shows (the overlay's, else the
 * dictionary's) contains it. If neither does (a pass-2 failure), the standard word keeps the headword and the
 * form is shown as a note, so no card leads with a word that is not visible in its sentence.
 */
export function headwordDecision(word: HeadwordSource): HeadwordDecision {
  const example = effectiveExample(word)
  const rio = word.rio
  const base = { matched: null, exampleSource: example.source } as const
  if (!rio) {
    if (word.esRioplatense) return { ...base, switched: legacyHeadword(word) !== null, reason: 'legacy' }
    return { ...base, switched: false, reason: 'no-overlay' }
  }
  if (rio.type !== 'replacement') return { ...base, switched: false, reason: 'not-replacement' }
  if (!isCleanVariant(rio.form)) return { ...base, switched: false, reason: 'unclean-form' }
  if (lower(rio.form) === lower(word.esWord)) return { ...base, switched: false, reason: 'same-as-es-word' }
  const range = findFormRange(example.sentence, rio.form, word.pos)
  if (!range) return { ...base, switched: false, reason: 'no-example-has-form' }
  return {
    switched: true,
    reason: example.source === 'overlay' ? 'overlay-example-has-form' : 'dictionary-example-has-form',
    matched: example.sentence.slice(range.start, range.end),
    exampleSource: example.source,
  }
}

/** The legacy rule: a clean es_rioplatense value, different from es_word, shown by the example's word form. */
function legacyHeadword(word: HeadwordSource): string | null {
  const rio = word.esRioplatense?.trim() ?? ''
  const useRio = rio !== '' && isCleanVariant(rio) && lower(rio) !== lower(word.esWord) && formMatches(word.wordFormInExample, rio)
  return useRio ? rio : null
}

export function headword(word: HeadwordSource): Headword {
  if (word.rio) {
    return headwordDecision(word).switched
      ? { text: word.rio.form, form: 'rioplatense', secondary: word.esWord }
      : { text: word.esWord, form: 'standard', secondary: null }
  }

  const rio = legacyHeadword(word)
  return rio !== null
    ? { text: rio, form: 'rioplatense', secondary: word.esWord }
    : { text: word.esWord, form: 'standard', secondary: null }
}

export function stripEmphasisMarkers(sentence: string): string {
  return sentence.replace(/\*+/g, '')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// No lookbehind (older iOS WebViews reject it): the leading boundary is matched and then skipped.
function findWholeWord(sentence: string, term: string): HighlightRange | null {
  const re = new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])(${escapeRegExp(term)})(?!${WORD_CHAR})`, 'iu')
  const m = re.exec(sentence)
  if (!m) return null
  const start = m.index + m[1].length
  return { start, end: start + m[2].length }
}

// Last resort: the term starts a longer word (obstáculo → obstáculos, culpar → culparte).
function findWordStart(sentence: string, term: string): HighlightRange | null {
  const re = new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])(${escapeRegExp(term)}${WORD_CHAR}*)`, 'iu')
  const m = re.exec(sentence)
  if (!m) return null
  const start = m.index + m[1].length
  return { start, end: start + m[2].length }
}

/**
 * The first occurrence to highlight in the example sentence. Candidates in order: the stored
 * word form, the headword, then the other form (only if it is a usable word). Whole-word matches
 * across all candidates win; only if none match does a candidate that starts a longer word count.
 * Never falls straight back to the standard word on a Rioplatense-first card.
 */
export function highlightTarget(word: HighlightSource): HighlightResult {
  const example = effectiveExample(word)
  const sentence = example.sentence
  const head = headword(word)

  // The other forms worth trying after the headword: the standard word on a Rioplatense-first card,
  // otherwise the Rioplatense form(s), from the overlay or from the legacy field.
  const others: string[] = []
  if (head.form === 'rioplatense') others.push(word.esWord)
  else if (word.rio) others.push(word.rio.form, ...(word.rio.altForm ? [word.rio.altForm] : []))
  else if (word.esRioplatense && isCleanVariant(word.esRioplatense)) others.push(word.esRioplatense.trim())

  const candidates: string[] = []
  for (const term of [example.wordForm ?? '', head.text, ...others]) {
    if (term && !candidates.some((c) => lower(c) === lower(term))) candidates.push(term)
  }

  for (const term of candidates) {
    const range = findWholeWord(sentence, term)
    if (range) return { sentence, range }
  }
  // Overlay forms also match inflected: the term is the headword or one of the Rioplatense forms.
  const rioForms = word.rio ? [word.rio.form, ...(word.rio.altForm ? [word.rio.altForm] : [])].map(lower) : []
  for (const term of candidates) {
    if (!rioForms.includes(lower(term))) continue
    const range: FormRange | null = findFormRange(sentence, term, word.pos)
    if (range) return { sentence, range }
  }
  for (const term of candidates) {
    if (term.length < 3) continue
    const range = findWordStart(sentence, term)
    if (range) return { sentence, range }
  }
  return { sentence, range: null }
}
