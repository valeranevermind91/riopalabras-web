// Pass 2 of the Rioplatense overlay: one new example sentence per entry whose current example does not
// show the Rioplatense form or sense. Pure functions (scope, prompt, response schema, validator); no I/O.
// The form matcher is the client's own (src/data/rio.ts), so "contains the form" means the same thing here and there.

import { findFormRange } from '../../src/data/rio.ts'

export const EXAMPLE_KEYS = ['es_word', 'example_es', 'example_en', 'example_ru', 'word_form_in_example']

const str = (description) => ({ type: 'STRING', description })
export const EXAMPLE_SCHEMA = {
  type: 'ARRAY',
  description: 'One entry per input item, in input order.',
  items: {
    type: 'OBJECT',
    properties: {
      es_word: str('The input es_word, copied character for character.'),
      example_es: str('ONE natural everyday Spanish sentence, about 8 to 14 words, containing rio_form exactly once. No asterisks or markdown.'),
      example_en: str('Natural English translation of example_es.'),
      example_ru: str('Natural Russian translation of example_es.'),
      word_form_in_example: str('The exact text of rio_form (or an inflection of it) as it appears in example_es: a substring of example_es.'),
    },
    required: EXAMPLE_KEYS,
    propertyOrdering: EXAMPLE_KEYS,
  },
}

export const SYSTEM_PROMPT = `You write one example sentence per entry for a vocabulary app for Russian-speaking learners who live in Uruguay and want to sound natural to the people around them.

For each entry you receive the standard Spanish word (es_word), the Rioplatense form to teach (rio_form), what it means, and where it is used.

RULES
- Write exactly ONE natural, everyday Spanish sentence of about 8 to 14 words, the way a Rioplatense speaker really says it. Use voseo where a verb addresses "vos". If region is "uy", an Uruguayan setting is welcome when it comes naturally (the barrio, la rambla, el mate); if "ar", an Argentine one; if null, keep it neutral.
- The sentence must contain rio_form EXACTLY ONCE, spelled as given. An inflection is fine (a plural, a conjugated verb). Never put the form in quotes and never explain it.
- For type replacement or form: never use es_word in the sentence (not even inflected), and never use alt_form either: only rio_form.
- For type meaning_shift and regional_only the word looks like the standard one, so the sentence must make the Rioplatense meaning (given as "meaning") clear from context, and must not use the standard meaning (given as "standard_meaning" when there is one). A note, when present, tells you how the word is really used.
- Keep it tame: no profanity or sexual content. If the entry itself is vulgar, pick an everyday, harmless sense or setting.
- example_en: a natural English translation. example_ru: a natural Russian translation.
- word_form_in_example: the exact text of the form as it appears in your sentence (same spelling, accents and capitalisation); it must be a substring of example_es.
- No asterisks, no markdown, no quotation marks around the form.

OUTPUT
Return a JSON array with exactly one object per entry, in the same order, with es_word copied character for character from the input.`

const stripMarkers = (s) => (s ?? '').replace(/\*+/g, '')
const lower = (s) => (s ?? '').toLowerCase()

/**
 * The entries that need a new example:
 *  (a) replacements whose dictionary example (** stripped) lacks rio_form or an inflection of it;
 *  (b) every meaning_shift / regional_only / form entry (es_word == rio_form there for the first two, so
 *      a string match proves nothing about the sense).
 * `overlay` is overlay.v1.json, `dictionary` public/words_enriched.json.
 */
export function selectScope(overlay, dictionary) {
  const byWord = new Map(dictionary.map((d) => [d.es_word, d]))
  const scope = []
  for (const e of overlay) {
    if (e.status !== 'accepted' || e.rio_type === 'none' || !e.rio_form) continue
    const d = byWord.get(e.es_word)
    if (!d) continue
    let reason = null
    if (e.rio_type === 'replacement') {
      if (!findFormRange(stripMarkers(d.example_sentence), e.rio_form, d.pos)) reason = 'replacement: dictionary example lacks the form'
    } else reason = `${e.rio_type}: the sense needs an example`
    if (!reason) continue
    scope.push({
      es_word: e.es_word,
      rank: e.rank ?? d.rank,
      pos: d.pos,
      type: e.rio_type,
      rio_form: e.rio_form,
      region: e.region,
      alt_form: e.alt_form,
      alt_region: e.alt_region,
      register: e.register,
      meaning_en: e.translation?.en ?? d.en_translation,
      standard_meaning_en: e.rio_type === 'meaning_shift' ? e.std_meaning?.en ?? null : null,
      note_en: e.notes?.en ?? null,
      reason,
    })
  }
  return scope.sort((a, b) => a.rank - b.rank)
}

/** The model sees only what it needs: no dictionary example, no evidence. */
export function buildUserText(items) {
  const payload = items.map((i) => ({
    es_word: i.es_word,
    pos: i.pos,
    type: i.type,
    rio_form: i.rio_form,
    region: i.region ?? null,
    alt_form: i.alt_form ?? null,
    register: i.register,
    meaning: i.meaning_en,
    ...(i.standard_meaning_en ? { standard_meaning: i.standard_meaning_en } : {}),
    ...(i.note_en ? { note: i.note_en } : {}),
  }))
  return `Write one example sentence for each of these ${items.length} entries. Return one object per entry, in this order, echoing es_word exactly.\n\n${JSON.stringify(payload, null, 1)}`
}

const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}]'
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const containsWholeWord = (sentence, word) => new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])${escapeRegExp(word)}(?!${WORD_CHAR})`, 'iu').test(sentence)

/** How many separate times the form (or an inflection of it) occurs. */
export function countForm(sentence, form, pos) {
  let rest = sentence
  let n = 0
  for (;;) {
    const r = findFormRange(rest, form, pos)
    if (!r) return n
    n++
    rest = rest.slice(r.end)
  }
}

/**
 * @param row   one object from the model
 * @param item  the scope item it answers
 * Never repairs anything: returns the problems, nothing else.
 */
export function validateExample(row, item) {
  const errors = []
  const warnings = []
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { errors: ['not_an_object'], warnings }

  const extra = Object.keys(row).filter((k) => !EXAMPLE_KEYS.includes(k))
  const missing = EXAMPLE_KEYS.filter((k) => !(k in row))
  if (missing.length) errors.push(`missing_keys: ${missing.join(',')}`)
  if (extra.length) errors.push(`unexpected_keys: ${extra.join(',')}`)
  if (missing.length) return { errors, warnings }

  if (row.es_word !== item.es_word) errors.push(`es_word_echo: got ${JSON.stringify(row.es_word)}`)
  for (const k of EXAMPLE_KEYS) {
    if (typeof row[k] !== 'string' || row[k].trim() === '') errors.push(`empty_or_not_string: ${k}`)
    else if (row[k].includes('*')) errors.push(`asterisk: ${k}`)
  }
  if (errors.length) return { errors, warnings }

  const { example_es: es, example_en: en, example_ru: ru, word_form_in_example: wf } = row
  if (!es.includes(wf)) errors.push(`word_form_not_substring: ${JSON.stringify(wf)}`)
  const whole = findFormRange(wf, item.rio_form, item.pos)
  if (!whole || whole.start !== 0 || whole.end !== wf.length) errors.push(`word_form_not_rio_form: ${JSON.stringify(wf)} is not «${item.rio_form}» or an inflection of it`)

  const occurrences = countForm(es, item.rio_form, item.pos)
  if (occurrences === 0) errors.push(`example_lacks_rio_form: «${item.rio_form}»`)
  else if (occurrences > 1) errors.push(`rio_form_repeated: ${occurrences} times`)

  if ((item.type === 'replacement' || item.type === 'form') && lower(item.es_word) !== lower(item.rio_form) && containsWholeWord(es, item.es_word)) {
    errors.push(`standard_word_present: «${item.es_word}»`)
  }

  if (!/[\p{Script=Cyrillic}]/u.test(ru)) errors.push('example_ru_not_russian')
  if (!/[A-Za-z]/.test(en) || /[\p{Script=Cyrillic}]/u.test(en)) errors.push('example_en_not_english')

  const words = (es.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).length
  if (words < 5 || words > 20) errors.push(`length: ${words} words`)
  else if (words < 8 || words > 14) warnings.push(`length_outside_8_14: ${words} words`)
  return { errors, warnings }
}
