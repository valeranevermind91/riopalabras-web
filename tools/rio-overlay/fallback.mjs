// Pass 3 of the Rioplatense overlay: dictionary words that are NOT in the client overlay but still carry an old
// example written for the legacy Rioplatense form (niño → "pibe", mona → "borracha"). The card shows es_word as the
// headword, so it needs a sentence that contains es_word. Pure functions: scope, prompt, schema, validator; no I/O.

import { findFormRange } from '../../src/data/rio.ts'
import { legacyForms } from './compare.mjs'
import { EXAMPLE_KEYS, containsWholeWord } from './examples.mjs'

const str = (description) => ({ type: 'STRING', description })
export const FALLBACK_SCHEMA = {
  type: 'ARRAY',
  description: 'One entry per input item, in input order.',
  items: {
    type: 'OBJECT',
    properties: {
      es_word: str('The input es_word, copied character for character.'),
      example_es: str('ONE natural, neutral Spanish sentence, about 8 to 14 words, using es_word once in its standard sense. No asterisks or markdown.'),
      example_en: str('Natural English translation of example_es.'),
      example_ru: str('Natural Russian translation of example_es.'),
      word_form_in_example: str('The exact text of es_word (or an inflection of it) as it appears in example_es: a substring of example_es.'),
    },
    required: EXAMPLE_KEYS,
    propertyOrdering: EXAMPLE_KEYS,
  },
}

export const FALLBACK_SYSTEM_PROMPT = `You write one example sentence per entry for a vocabulary app for Russian-speaking learners of Spanish.

For each entry you receive a standard Spanish word (es_word), its part of speech, its meaning, and some words to avoid.

RULES
- Write exactly ONE natural, neutral, everyday Spanish sentence of about 8 to 14 words, in standard Spanish (not regional slang), that a learner could reuse.
- The sentence must contain es_word EXACTLY ONCE, in the standard sense given as "meaning" (if the meaning lists several senses, use the first or most common one). An inflection is fine: a plural, a feminine form, a conjugated verb. Never put the word in quotes and never explain it.
- Never use any of the words in "avoid": they are regional alternatives that this card must not show.
- The readers live in Uruguay. Write standard Spanish with NO Peninsular-only (Spain) vocabulary or grammar. In particular never use: coche, aparcar and its forms, ordenador, móvil, coger, conducir, vale, zumo, patata, melocotón, fresa, bolígrafo, nevera, grifo, salón, vosotros / vuestro / os and their verb forms (-áis, -éis), or the pronoun tú. Prefer auto, estacionar, computadora, celular, manejar, jugo, papa, frutilla, heladera, canilla, living.
- If a verb addresses the reader, use voseo (vos, tenés, podés, querés, venís, sabés, hacés, decís, necesitás) or avoid addressing anyone (an impersonal form, or the first or third person). Never tienes, puedes, quieres, vienes, sabes, eres, haces, dices or other tú forms.
- Keep it tame: no profanity, no sexual content, no insults. If a word has a vulgar or offensive sense, use an everyday, harmless sense or setting.
- example_en: a natural English translation. example_ru: a natural Russian translation.
- word_form_in_example: the exact text of es_word as it appears in your sentence (same spelling, accents and capitalisation); it must be a substring of example_es.
- No asterisks, no markdown, no quotation marks around the word.

OUTPUT
Return a JSON array with exactly one object per entry, in the same order, with es_word copied character for character from the input.`

const stripMarkers = (s) => (s ?? '').replace(/\*+/g, '')
const lower = (s) => (s ?? '').toLowerCase()

/** Entries with a known reason not to write a sentence for them (junk rows that need re-enrichment first). */
export const FALLBACK_EXCLUDED = {
  tony: 'junk entry (a name with a nonsense translation), flagged needs_re_enrichment',
}

// Peninsular-only (Spain) vocabulary and grammar. The cards are for readers in Uruguay, so the new sentences must not
// teach it: the prompt names the main cases and this list is what the validator enforces. Each entry: a pattern for
// whole words (case-insensitive) and what to write instead. Entries that match the card's own word are exempt for it
// (gafas, vaquero, ayuntamiento, dormitorio, enhorabuena are es_words here).
const W = (alternatives) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{M}\\p{N}])`, 'iu')
export const PENINSULAR_BANS = [
  { name: 'coche', re: W('coches?'), prefer: 'auto' },
  { name: 'aparcar', re: /(?<![\p{L}\p{M}\p{N}])apar(?:c|qu)\p{L}*/iu, prefer: 'estacionar' },
  { name: 'ordenador', re: W('ordenador(?:es)?'), prefer: 'computadora' },
  { name: 'móvil', re: W('móvil(?:es)?'), prefer: 'celular' },
  { name: 'coger', re: W('cog(?:er|e|es|en|emos|ió|ieron|í|ía|ían|erá|erán|eré|ida|ido|idos|idas|iendo|erse|erlo|erla)|coja|cojo|cojas|cojan'), prefer: 'agarrar' },
  { name: 'conducir', re: /(?<![\p{L}\p{M}\p{N}])(?:conduc\p{L}*|conduzc\p{L}*|condujer\p{L}*)(?![\p{L}\p{M}\p{N}])/iu, prefer: 'manejar' },
  { name: 'vosotros', re: W('vosotros|vosotras|vuestr[oa]s?|os|sois|vais'), prefer: 'ustedes / su' },
  { name: 'vosotros verb forms', re: /(?<![\p{L}\p{M}\p{N}])\p{L}+(?:áis|éis|aíais|eíais|ád|ed)(?![\p{L}\p{M}\p{N}])/iu, prefer: 'ustedes + 3rd person plural' },
  { name: 'tú', re: W('tú'), prefer: 'vos' },
  { name: 'tú verb forms', re: W('tienes|puedes|quieres|vienes|sabes|eres|haces|dices|debes|necesitas|entiendes|piensas|empiezas|pides|sigues|sientes|vuelves|duermes|pones|oyes|conoces|pareces|prefieres|trabajas|hablas|vives|comes|estudias|llegas|llevas|miras'), prefer: 'voseo (tenés, podés, querés, venís, sabés, hacés, decís…) or an impersonal form' },
  { name: 'vale', re: W('vale(?! la pena| más| menos| mucho| poco| tanto)'), prefer: 'dale / bueno / de acuerdo' }, // "vale la pena" is fine everywhere
  { name: 'zumo', re: W('zumos?'), prefer: 'jugo' },
  { name: 'patata', re: W('patatas?'), prefer: 'papa' },
  { name: 'melocotón', re: W('melocotones|melocotón'), prefer: 'durazno' },
  { name: 'fresa', re: W('fresas?'), prefer: 'frutilla' },
  { name: 'judías', re: W('judías?'), prefer: 'porotos' },
  { name: 'bolígrafo', re: W('bolígrafos?'), prefer: 'lapicera / birome' },
  { name: 'bañador', re: W('bañador(?:es)?'), prefer: 'malla' },
  { name: 'jersey', re: W('jerséis|jersey(?:s)?'), prefer: 'buzo / suéter' },
  { name: 'sujetador', re: W('sujetador(?:es)?'), prefer: 'corpiño' },
  { name: 'billete', re: W('billetes?'), prefer: 'boleto / pasaje' },
  { name: 'nevera', re: W('neveras?'), prefer: 'heladera' },
  { name: 'grifo', re: W('grifos?'), prefer: 'canilla' },
  { name: 'salón', re: W('salón|salones'), prefer: 'living' },
  { name: 'guay', re: W('guay'), prefer: 'bárbaro / copado' },
  { name: 'chaval', re: W('chaval(?:es|a|as)?'), prefer: 'gurí / pibe' },
  { name: 'currar', re: W('curr(?:ar|o|a|as|an|amos|é|ó|aron|ando)|curro'), prefer: 'laburar / trabajar' },
  { name: 'mogollón', re: W('mogollón'), prefer: 'un montón' },
  { name: 'molar', re: W('mola|molan|molaba'), prefer: 'gustar' },
  { name: 'flipar', re: W('flipar|flipo|flipas|flipa|flipan|flipé|flipó'), prefer: 'alucinar' },
  { name: 'joder', re: W('joder|jodido|jodida|hostia|hostias|coño'), prefer: 'a tame exclamation' },
]

/** Peninsular-only words found in `text` (empty when clean); entries that match the card's own word are skipped. */
export function peninsularHits(text, ownWord = '') {
  const hits = []
  for (const ban of PENINSULAR_BANS) {
    if (ownWord && ban.re.test(ownWord)) continue
    const m = text.match(ban.re)
    if (m) hits.push({ name: ban.name, found: m[0], prefer: ban.prefer })
  }
  return hits
}

const wholeMatch = (text, form, pos, loose = true) => {
  const r = findFormRange(text, form, pos, loose)
  return Boolean(r && r.start === 0 && r.end === text.length)
}

/**
 * Words that:
 *  - are not an accepted overlay entry (`clientOverlay` is public/rio_overlay.json),
 *  - show an example sentence that contains neither es_word nor an inflection of it (the shared matcher, loose accents), and
 *  - whose word_form_in_example is NOT a form of es_word but the old Rioplatense form from the legacy es_rioplatense field.
 * Irregular forms of the same word (ser → sos) fail the first two tests but pass the third in reverse: they are not here.
 * `dictionary` is the raw public/words_enriched.json (it still has es_rioplatense).
 */
export function selectFallbackScope(dictionary, clientOverlay) {
  const accepted = new Set(clientOverlay.map((e) => lower(e.es_word)))
  const scope = []
  const excluded = []
  for (const d of dictionary) {
    if (accepted.has(lower(d.es_word))) continue
    const sentence = stripMarkers(d.example_sentence)
    if (!sentence.trim()) continue
    if (findFormRange(sentence, d.es_word, d.pos, true)) continue
    const wf = (d.word_form_in_example ?? '').trim()
    if (!wf || wholeMatch(wf, d.es_word, d.pos)) continue // the stored form is a form of es_word: nothing to fix
    const old = legacyForms(d.es_rioplatense)
    const pointsAtOldForm = old.some((f) => wholeMatch(wf, f, undefined) || wholeMatch(wf, f, 'v'))
    if (!pointsAtOldForm) continue // an irregular form of es_word itself (sos, ves, huele): the sentence is fine
    const item = {
      es_word: d.es_word,
      rank: d.rank,
      pos: d.pos,
      meaning_en: d.en_translation,
      old_word_form: wf,
      old_sentence: sentence,
      avoid: [...new Set([wf, ...old, ...(d.es_rioplatense ? [] : [])].map((x) => x.trim()).filter(Boolean))],
    }
    if (FALLBACK_EXCLUDED[d.es_word]) excluded.push({ ...item, reason: FALLBACK_EXCLUDED[d.es_word] })
    else scope.push(item)
  }
  const byRank = (a, b) => a.rank - b.rank
  return { scope: scope.sort(byRank), excluded: excluded.sort(byRank) }
}

export function buildFallbackUserText(items) {
  const payload = items.map((i) => ({ es_word: i.es_word, pos: i.pos, meaning: i.meaning_en, avoid: i.avoid }))
  return `Write one example sentence for each of these ${items.length} entries. Return one object per entry, in this order, echoing es_word exactly.\n\n${JSON.stringify(payload, null, 1)}`
}

/** How many separate times es_word (or an inflection of it) occurs. */
function countLoose(sentence, form, pos) {
  let rest = sentence
  let n = 0
  for (;;) {
    const r = findFormRange(rest, form, pos, true)
    if (!r) return n
    n++
    rest = rest.slice(r.end)
  }
}

/** Never repairs: returns the problems, nothing else. */
export function validateFallback(row, item) {
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
  if (!wholeMatch(wf, item.es_word, item.pos)) errors.push(`word_form_not_es_word: ${JSON.stringify(wf)} is not «${item.es_word}» or an inflection of it`)

  const n = countLoose(es, item.es_word, item.pos)
  if (n === 0) errors.push(`example_lacks_es_word: «${item.es_word}»`)
  else if (n > 1) errors.push(`es_word_repeated: ${n} times`)

  for (const word of item.avoid) {
    if (containsWholeWord(es, word)) errors.push(`avoided_word_present: «${word}»`)
  }
  for (const hit of peninsularHits(es, item.es_word)) errors.push(`peninsular_word_present: «${hit.found}» (${hit.name}; write ${hit.prefer})`)

  if (!/[\p{Script=Cyrillic}]/u.test(ru)) errors.push('example_ru_not_russian')
  if (!/[A-Za-z]/.test(en) || /[\p{Script=Cyrillic}]/u.test(en)) errors.push('example_en_not_english')

  const words = (es.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).length
  if (words < 5 || words > 20) errors.push(`length: ${words} words`)
  else if (words < 8 || words > 14) warnings.push(`length_outside_8_14: ${words} words`)
  return { errors, warnings }
}
