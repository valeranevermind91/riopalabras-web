import { strings } from '../strings'
import type { Word } from './types'

/** Human label for a part-of-speech code; unknown codes fall back to the capitalised code. */
export function posLabel(pos: string): string {
  const code = pos.trim().toLowerCase()
  const label = strings.pos[code]
  if (label) return label
  return code ? code[0].toUpperCase() + code.slice(1) : code
}

/** A custom word tagged "Other" has no real part of speech worth showing. */
export function showPosBadge(word: Pick<Word, 'isCustom' | 'pos'>): boolean {
  return !(word.isCustom && word.pos.trim().toLowerCase() === 'custom') && word.pos.trim() !== ''
}
