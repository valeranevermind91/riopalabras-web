import { headword } from './headword'
import type { MatchVia } from './search'
import type { Word } from './types'
import { wordKey } from './words'

export interface RowTitle {
  /** The word the row leads with. */
  title: string
  /** The other form of the same word, shown first in the muted line, so two words never read alike. */
  alt: string | null
}

const differs = (a: string, b: string) => wordKey(a) !== wordKey(b)

/**
 * What a row leads with.
 *
 * In a search, the form that matched leads and the other form sits beside it: typing "ciga" finds cigarrillo with
 * "pucho" in the muted line, typing "pucho" finds pucho with "cigarrillo" in the muted line. So the row says by itself
 * why it is there.
 *
 * Otherwise the card's rule: the Rioplatense form leads where the cards use it, and the standard word, the word's own
 * form, goes in the muted line whenever the headword is not it, so cigarro and cigarrillo (both "pucho") can be told apart.
 */
export function rowTitle(word: Word, via: MatchVia | null): RowTitle {
  const rio = word.rio?.form
  if (rio && differs(rio, word.esWord)) {
    if (via === 'rio_form') return { title: rio, alt: word.esWord }
    if (via === 'es_word') return { title: word.esWord, alt: rio }
  }
  const head = headword(word)
  const alt = head.secondary && differs(head.secondary, head.text) ? head.secondary : null
  return { title: head.text, alt }
}
