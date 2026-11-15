import { headword, type HeadwordSource } from './headword'
import type { Word } from './types'

// The grammatical gender of a noun, as the article that goes before the headword on a card: "la casa", "el agua", "el/la estudiante", "las gafas".
// It is display only. The article is a field of its own on the word (`gender`); esWord, the key (wordKey), the search, the duplicate check, Matching and the lists never see it.
// The data is public/noun_gender.json, built by tools/gender (the article read from the example sentences, a suffix rule and a model, then checked by hand): { v: 1, e: { key: value } },
// where the value is the article alone when the card shows the key itself ("la"), and the whole display ("el subte") when the card's headword is another form of the word
// (a Rioplatense replacement). A word with no entry (a word with two genders by meaning, a name, a custom word) shows no article: no article is better than a wrong one.

export type NounArticle = 'el' | 'la' | 'el/la' | 'los' | 'las'

/** An entry: the article, and the form of the word it was made for (the headword the card must be showing for the article to be shown). */
export interface NounGender {
  readonly article: NounArticle
  readonly form: string
}

const ARTICLES: ReadonlySet<string> = new Set<NounArticle>(['el', 'la', 'el/la', 'los', 'las'])
const WHOLE = /^(el\/la|el|la|los|las) (\S.*)$/

function toEntry(key: string, value: unknown): NounGender | null {
  if (typeof value !== 'string') return null
  if (ARTICLES.has(value)) return Object.freeze({ article: value as NounArticle, form: key })
  const m = WHOLE.exec(value)
  if (!m || m[2] !== m[2].trim()) return null
  return Object.freeze({ article: m[1] as NounArticle, form: m[2] })
}

/** Keyed by the word's key (trimmed, lower case). Malformed entries are skipped; anything that is not the file gives null (the app then shows no articles). */
export function parseNounGender(raw: unknown): ReadonlyMap<string, NounGender> | null {
  if (!raw || typeof raw !== 'object') return null
  const file = raw as Record<string, unknown>
  if (file.v !== 1 || !file.e || typeof file.e !== 'object' || Array.isArray(file.e)) return null
  const map = new Map<string, NounGender>()
  for (const [key, value] of Object.entries(file.e)) {
    const entry = toEntry(key, value)
    if (entry) map.set(key, entry)
  }
  return map
}

export type GenderSource = HeadwordSource & Partial<Pick<Word, 'gender'>>

/**
 * The article to show before the headword the card shows, or null. Shown only for a dictionary noun, and only when the entry was made for the very form the card
 * leads with: when the overlay does not lead (its example does not show the Rioplatense word) the card shows the standard word and the Rioplatense word's article
 * would be another word's.
 */
export function genderArticle(word: GenderSource): NounArticle | null {
  const entry = word.gender
  if (!entry || word.isCustom === true || word.pos !== 'n') return null
  return headword(word).text.trim().toLowerCase() === entry.form.toLowerCase() ? entry.article : null
}

const SINGULAR: Record<NounArticle, readonly string[]> = { el: ['el'], la: ['la'], 'el/la': ['el', 'la'], los: [], las: [] }
const PLURAL: Record<NounArticle, readonly string[]> = { el: ['los'], la: ['las'], 'el/la': ['los', 'las'], los: ['los'], las: ['las'] }

/** What a typed answer has to be to count with an article in front of it (Cloze): the article that goes with the singular, and the one that goes with the plural. */
export function answerArticles(article: NounArticle): { singular: readonly string[]; plural: readonly string[]; pluralOnly: boolean } {
  return { singular: SINGULAR[article], plural: PLURAL[article], pluralOnly: article === 'los' || article === 'las' }
}
