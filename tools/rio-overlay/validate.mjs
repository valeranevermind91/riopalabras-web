// Validation of Gemini's overlay entries. Reports problems; never repairs them.
// isCleanForm / formMatches duplicate src/data/headword.ts on purpose (this tool is plain Node, no TS
// toolchain); validate.test.mjs asserts the two implementations agree.

import { CONFIDENCES, ENTRY_KEYS, LIMITS, REGIONS, REGISTERS, RIO_TYPES } from './schema.mjs'

const CLEAN_FORM = /^[\p{L}\p{M}-]+(?: [\p{L}\p{M}-]+){0,2}$/u
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}]'

const lower = (s) => s.trim().toLowerCase()

// "AR: x; UY: y; std: z -> type": the country check the model must write before it chooses a type.
const REASONING_PATTERN = /^AR:\s*[\s\S]+?;\s*UY:\s*[\s\S]+?;\s*std:\s*[\s\S]+?\s*->\s*(replacement|meaning_shift|regional_only|form|none)\b/

export function isCleanForm(value) {
  return typeof value === 'string' && value === value.trim() && CLEAN_FORM.test(value)
}

function commonPrefixLength(a, b) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Equal ignoring case, or an inflection of it: a shared prefix of >=3 chars and >= (shorter length - 2). */
export function formMatches(wordForm, variant) {
  if (!wordForm) return false
  const a = lower(wordForm)
  const b = lower(variant)
  if (!a || !b) return false
  if (a === b) return true
  const prefix = commonPrefixLength(a, b)
  return prefix >= 3 && prefix >= Math.min(a.length, b.length) - 2
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function containsWholeWord(sentence, term) {
  const re = new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])${escapeRegExp(term)}(?!${WORD_CHAR})`, 'iu')
  return re.test(sentence)
}

/** True if the sentence contains the form itself or an inflection of it. */
export function showsForm(sentence, form) {
  if (!sentence || !form) return false
  if (containsWholeWord(sentence, form)) return true
  if (form.includes(' ')) return false
  return sentence.split(/[^\p{L}\p{M}\p{N}-]+/u).some((token) => token && formMatches(token, form))
}

const hasAsterisk = (v) => typeof v === 'string' && v.includes('*')

/**
 * @param entry  one object as returned by the model
 * @param input  the dictionary context sent for that word
 * @returns {{errors: string[], warnings: string[], flags: string[], currentExampleShowsForm: boolean | null}}
 *   flags: audit notes that are neither errors nor warnings (needs_example_check: no new example was supplied).
 *   currentExampleShowsForm: for such entries, whether the dictionary example's sentence contains rio_form or alt_form; else null.
 */
export function validateEntry(entry, input) {
  return { flags: [], currentExampleShowsForm: null, ...validateEntryRules(entry, input) }
}

function validateEntryRules(entry, input) {
  const errors = []
  const warnings = []
  const flags = []
  let currentExampleShowsForm = null
  const err = (code, detail) => errors.push(detail ? `${code}: ${detail}` : code)
  const warn = (code, detail) => warnings.push(detail ? `${code}: ${detail}` : code)

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { errors: ['not_an_object'], warnings }
  }

  // ---- shape: every key present, nothing extra ----
  const missing = ENTRY_KEYS.filter((k) => !(k in entry))
  const extra = Object.keys(entry).filter((k) => !ENTRY_KEYS.includes(k))
  if (missing.length) err('missing_keys', missing.join(','))
  if (extra.length) err('unexpected_keys', extra.join(','))
  if (missing.length) return { errors, warnings }

  // ---- echo + enums ----
  if (entry.es_word !== input.es_word) err('es_word_echo', `got ${JSON.stringify(entry.es_word)}, expected ${JSON.stringify(input.es_word)}`)
  if (!RIO_TYPES.includes(entry.rio_type)) err('bad_rio_type', String(entry.rio_type))
  if (entry.region !== null && !REGIONS.includes(entry.region)) err('bad_region', String(entry.region))
  if (entry.alt_region !== null && !REGIONS.includes(entry.alt_region)) err('bad_alt_region', String(entry.alt_region))
  if (!REGISTERS.includes(entry.register)) err('bad_register', String(entry.register))
  if (!CONFIDENCES.includes(entry.confidence)) err('bad_confidence', String(entry.confidence))
  if (typeof entry.reasoning !== 'string' || entry.reasoning.trim() === '') err('reasoning_empty')
  else {
    if (entry.reasoning.length > LIMITS.reasoning) err('reasoning_too_long', `${entry.reasoning.length} > ${LIMITS.reasoning}`)
    const m = entry.reasoning.match(REASONING_PATTERN)
    if (!m) err('reasoning_pattern', 'expected "AR: x; UY: y; std: z -> type"')
    else if (m[1] !== entry.rio_type) err('reasoning_type_mismatch', `reasoning ends in ${m[1]} but rio_type is ${entry.rio_type}`)
  }

  // ---- string-or-null fields really are one or the other ----
  for (const key of ENTRY_KEYS) {
    const v = entry[key]
    if (v !== null && typeof v !== 'string') err('bad_type', `${key} must be a string or null`)
    else if (typeof v === 'string' && v.trim() === '' && key !== 'es_word') err('empty_string', `${key} is an empty string (use null)`)
    else if (hasAsterisk(v)) err('asterisk', `${key} contains *`)
  }
  if (errors.some((e) => e.startsWith('bad_type'))) return { errors, warnings }

  const OPTIONAL = [
    'rio_form', 'region', 'alt_form', 'alt_region', 'std_meaning_en', 'std_meaning_ru', 'note_en', 'note_ru',
    'example_sentence', 'example_translation_en', 'example_translation_ru', 'word_form_in_example', 'en_translation', 'ru_translation',
  ]

  // ---- none: nothing else may be filled in ----
  if (entry.rio_type === 'none') {
    const filled = OPTIONAL.filter((k) => entry[k] !== null)
    if (filled.length) err('none_has_data', filled.join(','))
    if (entry.confidence === 'high') warn('none_high_confidence', 'check that a high-confidence none is not a missed angle')
    return { errors, warnings }
  }

  // ---- rio_form ----
  const form = entry.rio_form
  if (form === null) {
    err('rio_form_missing')
    return { errors, warnings }
  }
  if (!isCleanForm(form)) err('rio_form_not_clean', JSON.stringify(form))
  const sameAsWord = lower(form) === lower(input.es_word)
  if ((entry.rio_type === 'meaning_shift' || entry.rio_type === 'regional_only') && !sameAsWord) {
    err('rio_form_should_equal_es_word', `${entry.rio_type}: ${JSON.stringify(form)} vs ${JSON.stringify(input.es_word)}`)
  }
  if ((entry.rio_type === 'replacement' || entry.rio_type === 'form') && sameAsWord) {
    err('rio_form_equals_es_word', `${entry.rio_type} needs a different form`)
  }
  if (/^\p{Lu}/u.test(form) && !/^\p{Lu}/u.test(input.es_word)) warn('rio_form_capitalised', form)

  if (entry.rio_type === 'form') warn('form_type_notable_only', 'form is for pronouns and irregular voseo only; regular voseo is a general rule')

  // ---- region / alternative ----
  if ((entry.alt_form === null) !== (entry.alt_region === null)) err('alt_pair_mismatch', 'alt_form and alt_region must be set together')
  if (entry.alt_form !== null) {
    if (!isCleanForm(entry.alt_form)) err('alt_form_not_clean', JSON.stringify(entry.alt_form))
    if (entry.region === null) err('alt_without_region', 'alt_form is set but region is null')
    if (entry.region !== null && entry.alt_region === entry.region) err('alt_region_same_as_region', entry.region)
    if (lower(entry.alt_form) === lower(form)) err('alt_form_equals_rio_form', entry.alt_form)
  }

  // ---- standard meaning: meaning_shift only ----
  const hasStd = entry.std_meaning_en !== null || entry.std_meaning_ru !== null
  if (entry.rio_type === 'meaning_shift') {
    if (entry.std_meaning_en === null || entry.std_meaning_ru === null) err('std_meaning_missing', 'meaning_shift needs both std_meaning_en and std_meaning_ru')
    for (const k of ['std_meaning_en', 'std_meaning_ru']) {
      if (entry[k] && entry[k].length > LIMITS.stdMeaning) err('std_meaning_too_long', `${k} ${entry[k].length} > ${LIMITS.stdMeaning}`)
    }
  } else if (hasStd) {
    err('std_meaning_not_allowed', `${entry.rio_type} must not set std_meaning_*`)
  }

  // ---- notes ----
  if ((entry.note_en === null) !== (entry.note_ru === null)) err('note_pair_mismatch', 'note_en and note_ru must be set together')
  for (const k of ['note_en', 'note_ru']) {
    if (entry[k] && entry[k].length > LIMITS.note) err('note_too_long', `${k} ${entry[k].length} > ${LIMITS.note}`)
  }

  // ---- example group: all four or none ----
  // The example may use either country's form, so everything below accepts rio_form OR alt_form.
  const forms = [form, entry.alt_form].filter((f) => f !== null)
  const showsEither = (sentence) => forms.some((f) => showsForm(sentence, f))
  const matchesEither = (wordForm) => forms.some((f) => formMatches(wordForm, f))

  const EXAMPLE = ['example_sentence', 'example_translation_en', 'example_translation_ru', 'word_form_in_example']
  const exampleSet = EXAMPLE.filter((k) => entry[k] !== null)
  if (exampleSet.length !== 0 && exampleSet.length !== EXAMPLE.length) {
    err('example_group_partial', `set: ${exampleSet.join(',') || 'none'}`)
  } else if (exampleSet.length === EXAMPLE.length) {
    const sentence = entry.example_sentence
    if (!showsEither(sentence)) err('example_missing_rio_form', `sentence contains neither ${forms.map((f) => JSON.stringify(f)).join(' nor ')} nor an inflection of either`)
    if (!containsWholeWord(sentence, entry.word_form_in_example)) err('word_form_not_in_sentence', JSON.stringify(entry.word_form_in_example))
    if (!matchesEither(entry.word_form_in_example)) err('word_form_not_rio_form', `${JSON.stringify(entry.word_form_in_example)} matches neither ${forms.map((f) => JSON.stringify(f)).join(' nor ')}`)
    if (showsEither(stripAsterisks(input.example_sentence)) && matchesEither(input.word_form_in_example)) {
      warn('example_replaced_unnecessarily', 'the current example already showed a Rioplatense form')
    }
  } else {
    // No new example. Not an error: the model may not have seen the dictionary example at all. Report,
    // deterministically, whether the CURRENT example contains rio_form or alt_form; those that don't
    // are the queue for the later example-generation pass.
    flags.push('needs_example_check')
    currentExampleShowsForm = showsEither(stripAsterisks(input.example_sentence))
  }

  // ---- translation override: both or neither ----
  if ((entry.en_translation === null) !== (entry.ru_translation === null)) err('translation_pair_mismatch', 'en_translation and ru_translation must be set together')
  if (entry.en_translation !== null && entry.en_translation === input.en_translation && entry.ru_translation === input.ru_translation) {
    warn('translation_unchanged', 'override equals the current translation')
  }

  // ---- audit hints (not failures) ----
  if (entry.confidence === 'low') warn('low_confidence', 'non-none entry with low confidence')
  if (entry.register === 'vulgar' || entry.register === 'offensive' || entry.register === 'pejorative') warn('sensitive_register', entry.register)

  return { errors, warnings, flags, currentExampleShowsForm }
}

function stripAsterisks(s) {
  return (s ?? '').replace(/\*+/g, '')
}

/** Validates a whole batch response against its inputs: matching by echoed es_word, no gaps, no strangers, no duplicates. */
export function validateBatch(response, inputs) {
  const results = new Map() // es_word -> { entry, errors, warnings }
  const batchErrors = []

  if (!Array.isArray(response)) {
    return { results, batchErrors: ['response_not_an_array'] }
  }

  const byWord = new Map(inputs.map((w) => [w.es_word, w]))
  for (const entry of response) {
    const word = entry && typeof entry === 'object' ? entry.es_word : undefined
    const input = byWord.get(word)
    if (!input) {
      batchErrors.push(`unexpected_es_word: ${JSON.stringify(word)}`)
      continue
    }
    if (results.has(word)) {
      batchErrors.push(`duplicate_es_word: ${JSON.stringify(word)}`)
      continue
    }
    results.set(word, { entry, flags: [], currentExampleShowsForm: null, ...validateEntry(entry, input) })
  }
  const missing = inputs.filter((w) => !results.has(w.es_word)).map((w) => w.es_word)
  if (missing.length) batchErrors.push(`missing_words: ${missing.map((w) => JSON.stringify(w)).join(',')}`)

  return { results, batchErrors }
}

/**
 * Entries whose alt_form and alt_region are not set together: an alternative form with no country (or a country with no form). The two are one
 * fact, "this other country says it like this", so a form without its country is meaningless and a card cannot show it honestly. `validateEntry`
 * reports the same thing per entry (alt_pair_mismatch); this is for a whole list, as the overlay build and the shipped export are checked.
 * Returns [{ es_word, problem }], empty when every entry is fine.
 */
export function altPairProblems(entries) {
  const problems = []
  for (const e of entries) {
    const form = e.alt_form ?? null
    const region = e.alt_region ?? null
    if (form !== null && region === null) problems.push({ es_word: e.es_word, problem: `alt_form ${JSON.stringify(form)} has no alt_region` })
    else if (form === null && region !== null) problems.push({ es_word: e.es_word, problem: `alt_region ${JSON.stringify(region)} has no alt_form` })
  }
  return problems
}

/** Throws, naming every entry, when any has an alt_form without an alt_region (or the reverse). The overlay build calls it before it writes anything. */
export function assertAltPairs(entries) {
  const problems = altPairProblems(entries)
  if (problems.length > 0) {
    throw new Error(`overlay build refused: ${problems.map((p) => `${p.es_word}: ${p.problem}`).join('; ')}. An alternative form needs the country that uses it (alt_region), or it is not an alternative form: drop it.`)
  }
}
