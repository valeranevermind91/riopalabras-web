import { headword, isOwnRioplatense, type HeadwordSource } from './headword'
import type { Localized, RioRegion, RioType, StdUsage } from './rio'
import type { Word } from './types'

/**
 * How a card relates its headword to the standard Spanish word. Normalized so the UI doesn't care
 * where the data came from (the typed overlay, or the legacy es_rioplatense field as a fallback).
 */
export type Relation = {
  type: RioType
  /** The Rioplatense form leads the card: the standard word is shown as the secondary note. */
  standardWord?: string
  /** How common the standard word is: only a soft hint shown after it ("also common", "rarely used here"), never a claim about geography. Absent when unknown. */
  standardUsage?: StdUsage | null
  /** The standard word keeps the headword (the example doesn't show the form): the Rioplatense form is a note. */
  rioForm?: string
  /** For the note line next to rioForm: where it is used. */
  region?: RioRegion | null
  altForm?: string
  altRegion?: RioRegion | null
  note?: Localized | null
  /** What the word means in standard Spanish (meaning_shift only). */
  stdMeaning?: Localized | null
} | null

export function relationFor(word: HeadwordSource): Relation {
  const head = headword(word)
  const rio = word.rio

  if (!rio) {
    // A Rioplatense word the user added: the standard equivalent, in the same line a dictionary word uses.
    if (isOwnRioplatense(word)) return word.esStandard ? { type: 'replacement', standardWord: word.esStandard } : null
    // Legacy fallback: only the replacement shape can be derived from the free-text field.
    if (head.form === 'rioplatense' && head.secondary) return { type: 'replacement', standardWord: head.secondary }
    return null
  }

  const common = {
    type: rio.type,
    ...(rio.altForm ? { altForm: rio.altForm, altRegion: rio.altRegion } : {}),
    ...(rio.notes ? { note: rio.notes } : {}),
  }

  if (rio.type === 'replacement') {
    return head.form === 'rioplatense'
      ? { ...common, standardWord: head.secondary ?? word.esWord, standardUsage: rio.stdUsage }
      : { ...common, rioForm: rio.form, region: rio.region }
  }
  // meaning_shift, regional_only, form: the headword stays es_word; the note (and for a shifted
  // meaning, the standard one) explains the Rioplatense side.
  return { ...common, ...(rio.type === 'meaning_shift' && rio.stdMeaning ? { stdMeaning: rio.stdMeaning } : {}) }
}

/** The region tag that belongs next to the headword: not for a replacement whose form is only a note (the note carries its own). */
export function headwordRegion(word: HeadwordSource): RioRegion | null {
  const rio = word.rio
  if (isOwnRioplatense(word)) return word.region ?? null
  if (!rio?.region) return null
  if (rio.type === 'replacement' && headword(word).form !== 'rioplatense') return null
  return rio.region
}

/**
 * The register to label the headword with (informal, vulgar, offensive, pejorative), or null for neutral / unknown.
 * The overlay's register describes rio_form, so it is shown only when the card's headword is that form
 * (a replacement whose headword stayed the standard word carries no register: the form is only a note there).
 */
export function headwordRegister(word: HeadwordSource): string | null {
  const rio = word.rio
  if (isOwnRioplatense(word)) return !word.register || word.register === 'neutral' ? null : word.register
  if (!rio || rio.register === 'neutral') return null
  if (rio.type === 'replacement' && headword(word).form !== 'rioplatense') return null
  return rio.register
}

/**
 * The translations to show. The overlay's override describes the Rioplatense headword (or, for
 * meaning_shift / regional_only, the Rioplatense meaning), so a replacement whose headword stayed
 * the standard word keeps the dictionary translation: "coger" must not show "to grab" alone.
 */
export function translationsFor(word: Word): { en: string; ru: string } {
  const t = word.rio?.translation
  const dictionary = { en: word.enTranslation, ru: word.ruTranslation }
  if (!word.rio || !t) return dictionary
  if (word.rio.type === 'replacement' && headword(word).form !== 'rioplatense') return dictionary
  return { en: t.en || dictionary.en, ru: t.ru || dictionary.ru }
}
