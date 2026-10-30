import { formMatches } from './headword'
import { foldAccents } from './practice'
import type { Word } from './types'

// The line Cloze adds when it shows the answer: "vas — from ir". It names the dictionary word a form comes from and nothing more: the person, number and tense
// are not in our data (see BACKLOG.md), and a label that cannot be vouched for is worse than none for the person who reads it to learn.
//
// It is said only when it is true. The form in an example is not always an inflection of the dictionary word: for some words the example shows the
// Rioplatense replacement instead (auto for coche, pibe for chico), and "auto — from coche" would be a false claim. So it is left out for
//   - a word the user added (nothing is known about how its example relates to it),
//   - a form that is the word itself, up to case and accents (Dónde / donde),
//   - a form that is the Rioplatense replacement the dictionary records for the word, unless it is just the word's plural (vacación / vacaciones),
//   - for anything but a verb, a form with no stem in common with the word (cheto / tony, erre / r), which is a different word.

const canon = (text: string): string => foldAccents(text.trim().toLowerCase())

/** The plural of a word by the ordinary rule, ignoring accents: casa / casas, animal / animales. (Not a test of anything else.) */
const isPlainPlural = (form: string, lemma: string): boolean => {
  const f = canon(form)
  const l = canon(lemma)
  return f === `${l}s` || f === `${l}es`
}

/** True when `form` is the Rioplatense replacement the dictionary records for `word` (the overlay's, or the legacy field when the overlay did not load). */
function isReplacementForm(word: Pick<Word, 'esWord' | 'rio' | 'esRioplatense'>, form: string): boolean {
  const lemma = canon(word.esWord)
  const candidates: string[] = []
  if (word.rio?.type === 'replacement') candidates.push(word.rio.form, ...(word.rio.altForm ? [word.rio.altForm] : []))
  if (word.esRioplatense) candidates.push(word.esRioplatense)
  return candidates.some((candidate) => canon(candidate) !== lemma && formMatches(form, candidate))
}

/**
 * The dictionary word `form` (as it stands in the example) comes from, when it is a different form of that word, else null. Cloze's targets are single words
 * (clozeTarget leaves out anything with a space), so a form with a space never arrives here.
 */
export function lemmaOfForm(word: Pick<Word, 'esWord' | 'pos' | 'isCustom' | 'rio' | 'esRioplatense'>, form: string): string | null {
  if (word.isCustom) return null
  const lemma = word.esWord.trim()
  if (lemma === '' || /\s/.test(lemma) || form.trim() === '' || /\s/.test(form.trim())) return null
  if (canon(form) === canon(lemma)) return null
  if (isReplacementForm(word, form) && !isPlainPlural(form, lemma)) return null
  // The overlay does not record every replacement (the dictionary's own free-text field does, and it is dropped once the overlay has loaded), so a form that shares
  // no stem with its word is not taken for a form of it: cheto is not a form of tony. Only a verb is let off this, because its irregular forms look nothing like
  // the infinitive (vas / ir, sos / ser) and the replacement verbs are all in the overlay.
  if (word.pos !== 'v' && !formMatches(form, lemma)) return null
  return lemma
}
