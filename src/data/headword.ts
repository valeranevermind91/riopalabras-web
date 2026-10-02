import type { Word } from './types'

// Which Spanish form a card leads with, and which word in the example sentence to highlight.
// The Rioplatense form leads only when the data proves it: a clean value, genuinely different from
// the standard word, and actually demonstrated by the example sentence's target form.

type HeadwordSource = Pick<Word, 'esWord' | 'esRioplatense' | 'wordFormInExample'>
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

export function headword(word: HeadwordSource): Headword {
  const rio = word.esRioplatense?.trim() ?? ''
  const useRio =
    rio !== '' &&
    isCleanVariant(rio) &&
    lower(rio) !== lower(word.esWord) &&
    formMatches(word.wordFormInExample, rio)

  return useRio
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
  const sentence = stripEmphasisMarkers(word.exampleSentence)
  const head = headword(word)

  const other =
    head.form === 'rioplatense'
      ? word.esWord
      : word.esRioplatense && isCleanVariant(word.esRioplatense)
        ? word.esRioplatense.trim()
        : null

  const candidates: string[] = []
  for (const term of [word.wordFormInExample?.trim() ?? '', head.text, other ?? '']) {
    if (term && !candidates.some((c) => lower(c) === lower(term))) candidates.push(term)
  }

  for (const term of candidates) {
    const range = findWholeWord(sentence, term)
    if (range) return { sentence, range }
  }
  for (const term of candidates) {
    if (term.length < 3) continue
    const range = findWordStart(sentence, term)
    if (range) return { sentence, range }
  }
  return { sentence, range: null }
}
