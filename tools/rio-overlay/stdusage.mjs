// "Is the standard word itself used in everyday speech?" A narrow pass over the accepted overlay entries whose
// Rioplatense form differs from es_word. The answer is only a soft hint shown after the standard word on the card
// ("also common" / "rarely used here"), never a claim about where it is used. Pure functions: scope, prompt, schema,
// validator; no I/O. The model gets es_word, rio_form, pos and region only: no example, no legacy hint, no evidence.

export const STD_USAGE_VALUES = ['not_used', 'less_common', 'equally_used']
export const STD_USAGE_KEYS = ['es_word', 'reason', 'std_usage']
export const MAX_REASON = 160

const str = (description) => ({ type: 'STRING', description })
export const STD_USAGE_SCHEMA = {
  type: 'ARRAY',
  description: 'One entry per input item, in input order.',
  items: {
    type: 'OBJECT',
    properties: {
      es_word: str('The input es_word, copied character for character.'),
      reason: str(`One short line in English, at most ${MAX_REASON} characters, written BEFORE you decide: how people actually talk in the region about es_word.`),
      std_usage: { type: 'STRING', enum: STD_USAGE_VALUES, description: 'not_used | less_common | equally_used' },
    },
    required: STD_USAGE_KEYS,
    propertyOrdering: STD_USAGE_KEYS,
  },
}

export const STD_USAGE_SYSTEM_PROMPT = `You are a careful dialectologist of Rioplatense Spanish (Argentina and Uruguay).

For each entry you receive a standard Spanish word (es_word), the Rioplatense form that is also in use (rio_form), the part of speech (pos), and where the Rioplatense form is used (region: "uy" Uruguay, "ar" Argentina, null both).

Answer ONE question only: is es_word ITSELF used in everyday speech in that region? Not whether people understand it, but whether they would say it themselves in a normal conversation. Answer with std_usage:
- not_used: people do not say es_word in everyday speech there. They understand it, but it sounds foreign, Peninsular (from Spain), bookish or formal. Example of the kind of pair: "zumo" next to "jugo".
- less_common: both words are used in everyday speech, but the Rioplatense form is clearly the preferred one and es_word is the rarer of the two.
- equally_used: both words are completely normal and about equally common; neither sounds foreign or marked.

Write "reason" first: one short line (at most ${MAX_REASON} characters, English) about how people really talk. Then give std_usage. If you are not sure whether es_word is used, prefer less_common over not_used: "not_used" is a strong claim.

OUTPUT
Return a JSON array with exactly one object per entry, in the same order, with es_word copied character for character from the input.`

/** Accepted overlay entries whose rio_form differs from es_word (the pairs where a label for the other word is needed). */
export function selectStdUsageScope(overlay, dictionary) {
  const byWord = new Map(dictionary.map((d) => [d.es_word, d]))
  const items = []
  for (const e of overlay) {
    if (e.status !== 'accepted' || e.rio_type === 'none' || !e.rio_form) continue
    if (e.rio_form.toLowerCase() === e.es_word.toLowerCase()) continue
    const d = byWord.get(e.es_word)
    if (!d) continue
    items.push({ es_word: e.es_word, rank: e.rank ?? d.rank, pos: d.pos, rio_form: e.rio_form, region: e.region ?? null, type: e.rio_type })
  }
  return items.sort((a, b) => a.rank - b.rank)
}

export function buildStdUsageUserText(items) {
  const payload = items.map((i) => ({ es_word: i.es_word, rio_form: i.rio_form, pos: i.pos, region: i.region }))
  return `Answer the question for each of these ${items.length} entries. Return one object per entry, in this order, echoing es_word exactly.\n\n${JSON.stringify(payload, null, 1)}`
}

/** Never repairs: returns the problems, nothing else. */
export function validateStdUsage(row, item) {
  const errors = []
  const warnings = []
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { errors: ['not_an_object'], warnings }

  const extra = Object.keys(row).filter((k) => !STD_USAGE_KEYS.includes(k))
  const missing = STD_USAGE_KEYS.filter((k) => !(k in row))
  if (missing.length) errors.push(`missing_keys: ${missing.join(',')}`)
  if (extra.length) errors.push(`unexpected_keys: ${extra.join(',')}`)
  if (missing.length) return { errors, warnings }

  if (row.es_word !== item.es_word) errors.push(`es_word_echo: got ${JSON.stringify(row.es_word)}`)
  if (!STD_USAGE_VALUES.includes(row.std_usage)) errors.push(`bad_std_usage: ${JSON.stringify(row.std_usage)}`)
  if (typeof row.reason !== 'string' || row.reason.trim() === '') errors.push('reason_empty')
  else {
    if (row.reason.includes('*')) errors.push('asterisk: reason')
    if (row.reason.includes('\n')) errors.push('reason_not_one_line')
    if ([...row.reason].length > MAX_REASON) errors.push(`reason_too_long: ${[...row.reason].length} > ${MAX_REASON}`)
  }
  return { errors, warnings }
}
