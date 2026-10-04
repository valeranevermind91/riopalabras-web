import type { Word } from './types'

/** Lower-case, accents and diacritics removed (so "aqui" finds "aquí" and "senor" finds "señor"). */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export interface SearchHit<T> {
  word: T
  /** Which field matched best: the dictionary word or the overlay's Rioplatense form. */
  via: 'es_word' | 'rio_form'
}

type Searchable = Pick<Word, 'esWord' | 'rank' | 'rio'>

// 0 exact, 1 prefix, 2 a later word of a phrase starts with it, 3 contained somewhere; null = no match.
function score(field: string, q: string): number | null {
  if (field === q) return 0
  if (field.startsWith(q)) return 1
  if (field.split(/\s+/).some((w) => w.startsWith(q))) return 2
  return field.includes(q) ? 3 : null
}

/**
 * Up to `limit` dictionary words whose es_word or overlay rio_form matches the query, accent- and
 * case-insensitively. Better matches first (exact, prefix, word start, substring), then by frequency rank.
 */
export function searchWords<T extends Searchable>(words: readonly T[], query: string, limit = 8): SearchHit<T>[] {
  const q = foldText(query)
  if (q === '') return []

  const hits: { hit: SearchHit<T>; score: number }[] = []
  for (const word of words) {
    const viaWord = score(foldText(word.esWord), q)
    const viaRio = word.rio ? score(foldText(word.rio.form), q) : null
    if (viaWord === null && viaRio === null) continue
    const useWord = viaWord !== null && (viaRio === null || viaWord <= viaRio)
    hits.push({ hit: { word, via: useWord ? 'es_word' : 'rio_form' }, score: useWord ? (viaWord as number) : (viaRio as number) })
  }

  const rankOf = (w: Searchable) => w.rank ?? Number.POSITIVE_INFINITY
  hits.sort((a, b) => a.score - b.score || rankOf(a.hit.word) - rankOf(b.hit.word) || a.hit.word.esWord.localeCompare(b.hit.word.esWord))
  return hits.slice(0, limit).map((h) => h.hit)
}
