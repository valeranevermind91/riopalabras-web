import type { Word } from './types'

/** Lower-case, accents and diacritics removed (so "aqui" finds "aquí" and "senor" finds "señor"). */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Which field a hit matched through. */
export type MatchVia = 'es_word' | 'rio_form' | 'en' | 'ru'

export interface SearchHit<T> {
  word: T
  /** Which field matched best: the dictionary word, the overlay's Rioplatense form, or (when asked for) a translation. */
  via: MatchVia
}

type Searchable = Pick<Word, 'esWord' | 'rank' | 'rio'> & Partial<Pick<Word, 'enTranslation' | 'ruTranslation'>>

export interface SearchOptions {
  /** Also search the English and Russian translations. */
  translations?: boolean
}

// A later word of a phrase or a later meaning ("of, from") counts as a word start.
const SPLIT = /[\s,;/()]+/

// 0 exact, 1 prefix, 2 a later word of a phrase starts with it, 3 contained somewhere; null = no match.
function score(field: string, q: string): number | null {
  if (field === q) return 0
  if (field.startsWith(q)) return 1
  if (field.split(SPLIT).some((w) => w.startsWith(q))) return 2
  return field.includes(q) ? 3 : null
}

interface Folded {
  es: string
  rio: string | null
  en: string
  ru: string
}

// Folding 4,700 words x 4 fields on every keystroke would be wasted work: words are immutable, so fold each once.
const foldedCache = new WeakMap<object, Folded>()
function foldedFields(word: Searchable): Folded {
  let folded = foldedCache.get(word)
  if (!folded) {
    folded = { es: foldText(word.esWord), rio: word.rio ? foldText(word.rio.form) : null, en: foldText(word.enTranslation ?? ''), ru: foldText(word.ruTranslation ?? '') }
    foldedCache.set(word, folded)
  }
  return folded
}

const PRIORITY: Record<MatchVia, number> = { es_word: 0, rio_form: 1, en: 2, ru: 3 }

/**
 * Up to `limit` words whose es_word or overlay rio_form (and, with `translations`, English or Russian translation)
 * matches the query, accent- and case-insensitively. Better matches first (exact, prefix, word start, substring), then
 * Spanish before Rioplatense before English before Russian, then by frequency rank.
 */
export function searchWords<T extends Searchable>(words: readonly T[], query: string, limit = 8, options: SearchOptions = {}): SearchHit<T>[] {
  const q = foldText(query)
  if (q === '') return []

  const hits: { hit: SearchHit<T>; score: number }[] = []
  for (const word of words) {
    const f = foldedFields(word)
    let best: { via: MatchVia; score: number } | null = null
    const consider = (via: MatchVia, field: string | null) => {
      if (field === null) return
      const s = score(field, q)
      if (s !== null && (best === null || s < best.score || (s === best.score && PRIORITY[via] < PRIORITY[best.via]))) best = { via, score: s }
    }
    consider('es_word', f.es)
    consider('rio_form', f.rio)
    if (options.translations) {
      consider('en', f.en)
      consider('ru', f.ru)
    }
    if (best) hits.push({ hit: { word, via: (best as { via: MatchVia }).via }, score: (best as { score: number }).score })
  }

  const rankOf = (w: Searchable) => w.rank ?? Number.POSITIVE_INFINITY
  hits.sort((a, b) => a.score - b.score || PRIORITY[a.hit.via] - PRIORITY[b.hit.via] || rankOf(a.hit.word) - rankOf(b.hit.word) || a.hit.word.esWord.localeCompare(b.hit.word.esWord))
  return hits.slice(0, limit).map((h) => h.hit)
}
