// Gemini request material for the Rioplatense overlay: the system instruction, the strict
// response schema, and the per-batch user prompt. Pure data/functions — no I/O, no API key.

export const RIO_TYPES = ['replacement', 'meaning_shift', 'regional_only', 'form', 'none']
export const REGIONS = ['ar', 'uy']
export const REGISTERS = ['neutral', 'informal', 'vulgar', 'offensive']
export const CONFIDENCES = ['high', 'medium', 'low']

export const LIMITS = { note: 100, reasoning: 200, stdMeaning: 80 }

// `reasoning` comes right after `es_word` on purpose: the model writes its short justification
// before it commits to a type, which is cheap chain-of-thought inside the structured output.
export const ENTRY_KEYS = [
  'es_word',
  'reasoning',
  'rio_type',
  'rio_form',
  'region',
  'alt_form',
  'alt_region',
  'std_meaning_en',
  'std_meaning_ru',
  'register',
  'note_en',
  'note_ru',
  'example_sentence',
  'example_translation_en',
  'example_translation_ru',
  'word_form_in_example',
  'en_translation',
  'ru_translation',
  'confidence',
]

const str = (description, nullable = false) => ({ type: 'STRING', description, ...(nullable ? { nullable: true } : {}) })
const oneOf = (values, description, nullable = false) => ({
  type: 'STRING',
  enum: values,
  description,
  ...(nullable ? { nullable: true } : {}),
})

const buildProperties = (context) => ({
  es_word: str('The input es_word, copied character for character.'),
  reasoning: str(
    `HARD limit ${LIMITS.reasoning} chars, English, exactly this pattern: "AR: x; UY: y; std: z -> type" (type = your rio_type). Write it before deciding.`,
  ),
  rio_type: oneOf(RIO_TYPES, 'replacement | meaning_shift | regional_only | form | none. Default none when unsure.'),
  rio_form: str(
    'Clean headword: 1-3 words, letters/spaces/hyphens only, no punctuation, no glosses, no alternatives. ' +
      'Equals es_word for meaning_shift and regional_only. null for none.',
    true,
  ),
  region: oneOf(REGIONS, 'ar or uy ONLY when Argentina and Uruguay diverge; null when they agree or you are unsure.', true),
  alt_form: str('When both countries have their own form: the Argentine clean form (rio_form is then the Uruguayan one). Otherwise null.', true),
  alt_region: oneOf(REGIONS, 'Country of alt_form (ar when both countries have their own form); null exactly when alt_form is null.', true),
  std_meaning_en: str(`Standard (Peninsular) meaning in English, max ${LIMITS.stdMeaning} chars. meaning_shift only, else null.`, true),
  std_meaning_ru: str(`Same in Russian, max ${LIMITS.stdMeaning} chars. meaning_shift only, else null.`, true),
  register: oneOf(REGISTERS, 'How rio_form sounds as a learner would use it (rio_form, not es_word; for none, es_word): neutral | informal | vulgar | offensive.'),
  note_en: str(`HARD limit ${LIMITS.note} chars including spaces, aim for 70. Only when it prevents a real mistake, else null.`, true),
  note_ru: str(`Russian version of note_en, HARD limit ${LIMITS.note} chars including spaces (Russian runs long: aim for 70); null exactly when note_en is null.`, true),
  ...(context === 'full'
    ? {
        example_sentence: str(
          'ONLY when the current example shows neither rio_form nor alt_form: one natural Rioplatense sentence containing rio_form or alt_form (or an inflection of either). No asterisks or markdown. Else null.',
          true,
        ),
        example_translation_en: str('English translation of example_sentence; null exactly when example_sentence is null.', true),
        example_translation_ru: str('Russian translation of example_sentence; null exactly when example_sentence is null.', true),
        word_form_in_example: str(
          'Exact text of rio_form or alt_form (or an inflection of either) as it appears in example_sentence; null exactly when example_sentence is null.',
          true,
        ),
      }
    : {
        example_sentence: str('Always null: examples are written in a separate step.', true),
        example_translation_en: str('Always null.', true),
        example_translation_ru: str('Always null.', true),
        word_form_in_example: str('Always null.', true),
      }),
  ...(context === 'minimal'
    ? {
        en_translation: str('English translation of rio_form alone (only the senses that fit it). null for none.', true),
        ru_translation: str('Russian translation of rio_form alone, same rule; null exactly when en_translation is null.', true),
      }
    : {
        en_translation: str(
          'ONLY when the current translation does not fit the headword the learner sees (rio_form): English translation of rio_form alone, keeping only the senses that fit it. Else null.',
          true,
        ),
        ru_translation: str('Russian translation of rio_form alone, same rule; null exactly when en_translation is null.', true),
      }),
  confidence: oneOf(CONFIDENCES, 'high = certain and typical | medium = probable | low = unsure.'),
})

export const CONTEXTS = ['minimal', 'sense', 'full']
export const DEFAULT_CONTEXT = 'minimal'

function checkContext(context) {
  if (!CONTEXTS.includes(context)) throw new Error(`context must be one of ${CONTEXTS.join(', ')}`)
  return context
}

/** Gemini generateContent `responseSchema`: an array with exactly one object per input word. */
export function buildResponseSchema({ context = DEFAULT_CONTEXT } = {}) {
  return {
    type: 'ARRAY',
    description: 'One entry per input word, in input order.',
    items: {
      type: 'OBJECT',
      properties: buildProperties(checkContext(context)),
      required: ENTRY_KEYS,
      propertyOrdering: ENTRY_KEYS,
    },
  }
}

export const RESPONSE_SCHEMA = buildResponseSchema()

const HINT_PARAGRAPH = `

Each word also carries a "legacy_es_rioplatense" hint. It is unverified free text from an earlier automated pass and is often wrong, so use it only as a lead.`


const CONTEXT_PARAGRAPH = {
  full: 'Each word arrives with context: part of speech, the current English and Russian translations, the current example sentence with its translations, and the exact word form used in that example. Judge the word yourself.',
  sense: 'Each word arrives with its part of speech and a short English gloss of the dictionary\'s current meaning. The gloss only tells you which sense of the word is meant; it says nothing about whether a Rioplatense form exists. Judge the word yourself.',
  minimal: 'Each word arrives with only its part of speech. Judge the word yourself.',
}

const EXAMPLE_SECTION = {
  full: `EXAMPLE FIELDS (example_sentence, example_translation_en, example_translation_ru, word_form_in_example)
The current example is provided. If it already shows the Rioplatense form (rio_form or alt_form, or an inflection of either, such as a plural or a conjugated form), leave all four fields null. Only when it shows neither, write ONE natural sentence in Rioplatense Spanish (at most about 100 characters, voseo where a verb addresses "vos") that contains rio_form or alt_form (or an inflection of either; either country's form is fine), with English and Russian translations, and put in word_form_in_example the exact text of that form as it appears in your sentence (same spelling and accents; capitalised only if it starts the sentence). The four fields are all set or all null. Never use asterisks or any markdown.`,
  sense: `EXAMPLE FIELDS (example_sentence, example_translation_en, example_translation_ru, word_form_in_example)
Example sentences are written in a separate later step. Leave all four fields null.`,
  minimal: `EXAMPLE FIELDS (example_sentence, example_translation_en, example_translation_ru, word_form_in_example)
Example sentences are written in a separate later step. Leave all four fields null.`,
}

const TRANSLATION_SECTION = {
  full: `TRANSLATION FIELDS (en_translation, ru_translation)
These translate the headword the learner sees, which is rio_form. If the current translation already fits rio_form, leave both null. Otherwise give a translation of rio_form alone: keep only the senses that fit it, and drop any sense that belongs only to the standard word. Worked example: es_word pluma (current translation "feather; pen"), rio_form lapicera -> en_translation "pen", ru_translation "ручка" (not "feather"). For a meaning_shift the translation is the Rioplatense meaning, and the standard meaning goes in std_meaning_en / std_meaning_ru. Concise comma-separated senses, in natural Russian. Both or neither.`,
  sense: `TRANSLATION FIELDS (en_translation, ru_translation)
These translate the headword the learner sees, which is rio_form. If the English gloss you were given already fits rio_form, leave both null. Otherwise give a translation of rio_form alone: keep only the senses that fit it, and drop any sense that belongs only to the standard word. Worked example: es_word pluma (gloss "feather; pen"), rio_form lapicera -> en_translation "pen", ru_translation "ручка" (not "feather"). For a meaning_shift the translation is the Rioplatense meaning, and the standard meaning goes in std_meaning_en / std_meaning_ru. Concise comma-separated senses, in natural Russian. Both or neither.`,
  minimal: `TRANSLATION FIELDS (en_translation, ru_translation)
These translate the headword the learner sees, which is rio_form. For every entry that is not none, give both: a translation of rio_form alone, keeping only the senses that fit it and dropping any sense that belongs only to the standard word. Worked example: es_word pluma, rio_form lapicera -> en_translation "pen", ru_translation "ручка" (not "feather"). For a meaning_shift the translation is the Rioplatense meaning, and the standard meaning goes in std_meaning_en / std_meaning_ru. Concise comma-separated senses, in natural Russian. For none both are null.`,
}

/** The system instruction. The hint paragraph is included only when the hint is actually sent to the model. */
export function buildSystemPrompt({ withHint = false, context = DEFAULT_CONTEXT } = {}) {
  checkContext(context)
  return `You are a careful dialectologist of Rioplatense Spanish (Argentina and Uruguay), building a data layer for a vocabulary app. The users are Russian-speaking learners who live in Uruguay and want to sound natural to the people around them.

TASK
For each dictionary word you receive, decide whether it has a Rioplatense angle and describe it in the structured format. "Rioplatense" means Argentina and Uruguay together. Record the COMMON Rioplatense form. Name a country only when the two countries genuinely diverge.

${CONTEXT_PARAGRAPH[context]}${withHint ? HINT_PARAGRAPH : ''}

ONLY A REAL, DOCUMENTED DIFFERENCE COUNTS. A preference of frequency or formality that exists in every variety of Spanish (for example "usar" versus "utilizar") is not a Rioplatense angle: answer none. Never invent forms, meanings or regional claims. When you are not sure, answer none with confidence "low": a wrong claim is worse than a missed one. If es_word is not a real standard Spanish word (a personal name, a loanword, an interjection, an abbreviation), answer none.

REASONING FIRST
Write "reasoning" before you decide, in exactly this pattern: "AR: x; UY: y; std: z -> type". x is what Argentines say for the concept, y what Uruguayans say, z the standard (Peninsular) word or meaning, and type is the rio_type you then choose. Fill in x, y and z honestly before you choose the type and the region; if you do not know one of them, write "?" and prefer none. At most 200 characters, in English.

THE FIVE TYPES (rio_type)
- replacement: the standard word is X, but Rioplatense speakers say Y instead. es_word is X, rio_form is Y. Example: periódico -> diario.
- meaning_shift: the SAME word means something different in everyday Rioplatense. rio_form equals es_word, and std_meaning_en / std_meaning_ru say what it means in standard (Peninsular) Spanish. Example: vereda (standard: a narrow path or trail; Rioplatense: the sidewalk).
- form: a grammatical form differs AND the difference is notable: a pronoun, or an irregular voseo form (for example ser -> sos). rio_form MUST differ from es_word. Ordinary voseo conjugations (tener -> tenés instead of tienes, comer -> comés) are NOT flagged: the app treats voseo as a general grammar rule, so a regular verb is none unless it has some other angle.
- regional_only: a word genuinely characteristic of the River Plate. es_word IS the Rioplatense word and rio_form equals es_word. This includes a word that is itself the Rioplatense form of a standard word (for example a pronoun or interjection that Rioplatense speakers use in place of the standard one): never use "form" for it, because form requires rio_form to differ from es_word. Be conservative. Example: che (the attention-getting interjection).
- none: no Rioplatense angle. This is the DEFAULT. Ordinary vocabulary used the same way everywhere (casa, comer, ayer) is none. For none, rio_form, region, alt_form, alt_region, std_meaning_*, note_*, the example fields and the translation fields are all null; register still describes the word itself.

REGION
- region is null when Argentina and Uruguay agree, or when you know of no difference. That is the normal case.
- When Argentina and Uruguay use DIFFERENT forms, put the Uruguayan form in rio_form with region "uy", and the Argentine form in alt_form with alt_region "ar". This is only a storage convention: the app shows both equally.
- If only one country uses the Rioplatense form and the other uses the standard word, set region to that country and leave alt_form and alt_region null.

CLEAN FORM (rio_form and alt_form)
A clean headword is 1 to 3 words made only of letters (accents allowed), single spaces and hyphens. No digits and no punctuation of any kind: no commas, slashes, parentheses, quotes, exclamation or question marks. No glosses, no explanations, no alternatives. Lower case unless it is a proper noun. If the Rioplatense expression cannot be written as such a headword, use none instead.

${EXAMPLE_SECTION[context]}

${TRANSLATION_SECTION[context]}

VULGAR OR TABOO STANDARD MEANING
When the standard meaning of es_word is vulgar or taboo in everyday Rioplatense speech and an ordinary, everyday word is used for that meaning instead, record it as replacement: es_word is the standard word, rio_form is the everyday word, and the warning goes in note_en / note_ru (what es_word sounds like to Rioplatense ears, and what to say). Do not use meaning_shift for this, and do not make the vulgar word the rio_form.

REGISTER AND NOTES
register describes how rio_form sounds when a learner uses it: neutral, informal, vulgar or offensive. It describes rio_form, not es_word; for none, which has no rio_form, it describes es_word. note_en and note_ru are only for cases where a learner could make a real mistake without them, for example: standard "coger" means "to take, to grab", but in Argentina and Uruguay it is vulgar (to have sex) and the everyday verb is "agarrar". Otherwise both are null (both or neither).

LENGTH LIMITS ARE HARD
note_en and note_ru must each be at most 100 characters INCLUDING spaces; aim for about 70. Russian runs longer than English, so shorten the Russian first. reasoning is at most 200 characters. Anything longer is rejected.

OUTPUT
Return a JSON array with exactly one entry per input word, in the same order, with es_word copied character for character from the input (accents and capitalisation included).`
}

/** The default system instruction: no hint, minimal context. */
export const SYSTEM_PROMPT = buildSystemPrompt()

/**
 * The per-batch user turn, as JSON. What the model sees depends on `context`:
 *  - minimal: es_word and pos only
 *  - sense:   plus the current English translation
 *  - full:    plus the Russian translation and the current example (sentence, translations, word form)
 * The legacy hint is sent only on request. The dictionary example is never sent in minimal or sense mode.
 */
export function buildUserPrompt(inputs, { withHint = false, context = DEFAULT_CONTEXT } = {}) {
  checkContext(context)
  const payload = inputs.map((w) => ({
    es_word: w.es_word,
    pos: w.pos,
    ...(context !== 'minimal' ? { en_translation: w.en_translation } : {}),
    ...(context === 'full'
      ? {
          ru_translation: w.ru_translation,
          example_sentence: (w.example_sentence ?? '').replace(/\*+/g, ''),
          example_translation_en: w.example_translation_en,
          example_translation_ru: w.example_translation_ru,
          word_form_in_example: w.word_form_in_example,
        }
      : {}),
    ...(withHint ? { legacy_es_rioplatense: w.es_rioplatense ?? null } : {}),
  }))
  return `Analyze these ${inputs.length} dictionary words. Return one entry per word, in this order, echoing es_word exactly.\n\n${JSON.stringify(payload, null, 1)}`
}
