import { headword } from './headword'
import type { Word } from './types'

/**
 * How a card relates its headword to the standard Spanish word. Normalized so the UI doesn't care
 * where the data came from; today only 'replacement' is derived (from legacy es_rioplatense).
 */
export type Relation = {
  type: 'replacement' | 'meaning_shift' | 'regional_only' | 'form'
  standardWord?: string
  note?: string
  register?: string
} | null

export function relationFor(word: Pick<Word, 'esWord' | 'esRioplatense' | 'wordFormInExample'>): Relation {
  const head = headword(word)
  if (head.form === 'rioplatense' && head.secondary) {
    return { type: 'replacement', standardWord: head.secondary }
  }
  // TODO(data pass): derive 'meaning_shift' | 'regional_only' | 'form' once the dictionary carries
  // explicit relation data (see the data audit: the legacy es_rioplatense field can't express them).
  return null
}
