// Builds overlay v1 from all stage-1 evidence. Analysis only; writes next to this file.
// Base per entry: run A (stage1.merged.json; the one held-back entry comes from out/s1-A.json), because A is the
// stage-1 base run (strongest model, full schema). B / Claude / legacy are only used as named proposals.
//
// CONSTRAINT, country labels (tools/rio-overlay/regionRule.mjs, applied in "rule 4c" below to every entry):
//   a `region` (and an `alt_region` with its `alt_form`) is set only when at least two independent sources say the OTHER country
//   does not use the form. The questionnaire asked only Uruguayans, so "Uruguayans use it" can never set a label: there is no
//   by-rule `uy` any more. Everything else is null ("Rioplatense, without a country").
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyRegionRule } from '../../regionRule.mjs'
import { assertAltPairs, validateEntry } from '../../validate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOLS = path.resolve(HERE, '..', '..')
const read = (...p) => JSON.parse(fs.readFileSync(path.join(TOOLS, ...p), 'utf8'))

const merged = read('results', 'stage1', 'stage1.merged.json')
const outA = new Map(read('out', 's1-A.json').map((e) => [e.es_word, e]))
const outB = new Map(read('out', 's1-B.json').map((e) => [e.es_word, e]))
const claude = new Map(read('results', 'stage1', 'claude-blind.json').map((e) => [e.es_word, e]))
const damer = read('results', 'stage1', 'damer.json')
const questionnaire = read('out', 'questionnaire', 'decisions.json')
const items = read('out', 'questionnaire', 'items.json')
const dictionary = new Map(JSON.parse(fs.readFileSync(path.join(TOOLS, '..', '..', 'public', 'words_enriched.json'), 'utf8')).map((d) => [d.es_word, d]))

// A: valid entries from the merged file, plus the held-back one(s) from the raw run
const A = new Map(merged.entries.map((e) => [e.es_word, e]))
for (const inv of merged.invalid) A.set(inv.es_word, outA.get(inv.es_word))
const words = [...A.keys()].sort((x, y) => dictionary.get(x).rank - dictionary.get(y).rank)

// agreement classes straight from audit.md (column "agreement"), cross-checked below
const auditClass = new Map()
for (const line of fs.readFileSync(path.join(TOOLS, 'results', 'stage1', 'audit.md'), 'utf8').split('\n')) {
  if (!line.startsWith('| ')) continue
  const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())
  if (cells.length === 8 && /^\d+$/.test(cells[1])) auditClass.set(cells[0], cells[6])
}
const low = (v) => (v == null ? null : String(v).toLowerCase())
const sig = (e) => JSON.stringify([e.rio_type, low(e.rio_form), e.region ?? null, low(e.alt_form)])
for (const w of words) {
  const three = sig(A.get(w)) === sig(outB.get(w)) && sig(outB.get(w)) === sig(claude.get(w))
  if ((auditClass.get(w) === '3-way agree') !== three) throw new Error(`audit.md class disagrees with a recomputation for ${w}`)
}

// questionnaire decisions by es_word; ids cross-checked against items.json
const qByWord = new Map()
for (const d of questionnaire.decisions) {
  if (items.find((i) => i.id === d.id)?.word !== d.es_word) throw new Error(`item ${d.id} word mismatch`)
  if (!qByWord.has(d.es_word)) qByWord.set(d.es_word, [])
  qByWord.get(d.es_word).push(d)
}
const n = questionnaire.n

// ---------------------------------------------------------------- helpers
const fmt = (e) => {
  if (!e) return 'missing'
  if (e.rio_type === 'none') return `none (${e.confidence})`
  return `${e.rio_type}: ${e.rio_form}${e.region ? ` @${e.region}` : ''}${e.alt_form ? ` + ${e.alt_form} @${e.alt_region}` : ''} (${e.confidence})`
}
const fromA = (a) => ({
  rio_type: a.rio_type, rio_form: a.rio_form, alt_form: a.alt_form, alt_region: a.alt_region, region: a.region, register: a.register,
  notes: a.note_en ? { en: a.note_en, ru: a.note_ru } : null,
  std_meaning: a.std_meaning_en ? { en: a.std_meaning_en, ru: a.std_meaning_ru } : null,
  translation: a.en_translation ? { en: a.en_translation, ru: a.ru_translation } : null,
  confidence: a.confidence,
})
const damerEvidence = (e) => {
  const out = []
  for (const [role, form] of [['rio_form', e.rio_form], ['alt_form', e.alt_form]]) {
    if (!form) continue
    const d = damer[form.toLowerCase()]
    if (d?.found && (d.ar || d.ur)) out.push(`DAMER: «${form}» has ${[d.ar && 'Ar', d.ur && 'Ur'].filter(Boolean).join(' and ')} label${d.ar && d.ur ? 's' : ''} (${role}, any sense)`)
  }
  return out
}
const proposalEvidence = (w) => {
  const a = A.get(w), b = outB.get(w), c = claude.get(w), legacy = dictionary.get(w).es_rioplatense
  return [`A: ${fmt(a)}`, `B: ${fmt(b)}`, `Claude: ${fmt(c)}`, `legacy: ${legacy ?? '-'}`]
}
const qEvidence = (d, extra = '') => `questionnaire n=${n}, yes=${d.yes}${extra}`

const result = new Map() // es_word -> overlay entry
const basis = new Map() // es_word -> short description of the base used
const notes = [] // things that did not fit the rules

function make(w, fields, status, evidence, flags = [], base = 'A') {
  result.set(w, { es_word: w, rank: dictionary.get(w).rank, ...fields, status, flags, evidence })
  basis.set(w, base)
}
const none = (a) => ({ rio_type: 'none', rio_form: null, alt_form: null, alt_region: null, region: null, register: a.register, notes: null, std_meaning: null, translation: null, confidence: a.confidence })

// ---------------------------------------------------------------- rule 1: manual decisions
const REJECT = { mona: 27, picado: 35, polla: 43, puto: 39 }
const handled = new Set()
for (const [w, id] of Object.entries(REJECT)) {
  const d = qByWord.get(w).find((x) => x.id === id)
  if (d.decision !== 'REMOVE_OR_AR_ONLY') throw new Error(`${w}: questionnaire no longer says REMOVE`)
  make(w, none(A.get(w)), 'rejected', [qEvidence(d, ' (REMOVE)') + ', rejected by decision', ...proposalEvidence(w).map((s) => 'rejected proposal context, ' + s)], [], 'A (type none; register kept from A)')
  handled.add(w)
}

// linyera (item 30): kept despite 5/8
{
  const d = qByWord.get('vagabundo').find((x) => x.id === 30)
  make('vagabundo', fromA(A.get('vagabundo')), 'accepted', [qEvidence(d, ' (5/8, below the usual threshold; kept by decision)'), ...damerEvidence(A.get('vagabundo')), 'A and B agree: replacement linyera'], [], 'A')
  handled.add('vagabundo')
}

// foco (item 33): kept despite 5/8. Its `uy` below is only a proposal: rule 4c judges every country label. It had an alt_form lámpara with no country, which is not a regional variant: dropped (see the evidence below).
{
  const d = qByWord.get('foco').find((x) => x.id === 33)
  const b = outB.get('foco')
  const fields = {
    rio_type: 'meaning_shift', rio_form: 'foco', alt_form: null, alt_region: null, region: 'uy', register: b.register, notes: null,
    std_meaning: { en: b.std_meaning_en, ru: b.std_meaning_ru }, translation: { en: b.en_translation, ru: b.ru_translation }, confidence: 'medium',
  }
  make('foco', fields, 'accepted', [qEvidence(d, ' (5/8, below the usual threshold; kept by decision)'), 'proposal from B (A said none): meaning_shift foco = light bulb', 'no alt_form: «lámpara» was one respondent\'s own word ("Digo lámpara", R9, item 33) with no country, and A has lamparita and foco in both AR and UY, so neither is a regional variant of the other', ...damerEvidence({ rio_form: 'foco' })], [], 'B (A said none)')
  handled.add('foco')
}

// cigarrillo -> pucho, condón -> forro
{
  const b = outB.get('cigarrillo')
  make('cigarrillo', { rio_type: 'replacement', rio_form: 'pucho', alt_form: null, alt_region: null, region: null, register: b.register, notes: null, std_meaning: null, translation: null, confidence: b.confidence }, 'accepted',
    ['manual decision: replacement pucho, both countries', ...damerEvidence({ rio_form: 'pucho' }), 'proposed by B (informal, high) and the legacy field; A and Claude said none', 'questionnaire item 25 (cigarro → pucho): n=8, yes=8'], [], 'manual (form from B / legacy)')
  handled.add('cigarrillo')
  make('condón', { rio_type: 'replacement', rio_form: 'forro', alt_form: null, alt_region: null, region: null, register: 'informal', notes: null, std_meaning: null, translation: null, confidence: 'medium' }, 'accepted',
    ['manual decision: replacement forro, both countries', ...damerEvidence({ rio_form: 'forro' }), 'legacy field: forro; A, B and Claude all proposed preservativo instead', 'not asked in the questionnaire'], ['register_unverified: informal chosen for slang forro, no source gives it'], 'manual (form from legacy)')
  handled.add('condón')
}

// portero -> golero (uy) + arquero (ar)
{
  const d24 = qByWord.get('portero').find((x) => x.id === 24)
  const a = A.get('portero')
  make('portero', { ...fromA(a), rio_form: 'golero', region: 'uy', alt_form: 'arquero', alt_region: 'ar' }, 'accepted',
    [qEvidence(d24, ' (item 24: golero)'), 'questionnaire item 23: «arquero» n=8, yes=' + qByWord.get('portero').find((x) => x.id === 23).yes, 'golero proposed by Claude (uy) with arquero (ar); A said arquero', ...damerEvidence({ rio_form: 'arquero' })], [], 'A, rio_form/alt_form swapped by decision')
  handled.add('portero')
}

// manual triage (Valera): accepted replacements, rejected non-dialect differences, and words deliberately left pending
const MANUAL_ACCEPT = {
  aquí: { form: 'acá' }, quizá: { form: 'capaz' }, quizás: { form: 'capaz' }, vuestro: { form: 'su' }, vosotros: { form: 'ustedes' },
  metro: { form: 'subte', region: 'ar' }, apartamento: { form: 'departamento', region: 'ar' }, escoger: { form: 'elegir' },
  cabello: { form: 'pelo' }, carro: { form: 'auto' }, fila: { form: 'cola' },
  // tú / contigo: type changed from "form" to "replacement" by decision, so the card leads with vos / con vos.
  // The notes are written here, by hand, as asked: they name the standard (Peninsular) form.
  tú: {
    form: 'vos', confidence: 'high', evidence: 'type changed from form to replacement by decision (standard Peninsular form: tú)',
    notes: { en: 'Standard (Peninsular) form: "tú". Rioplatense speakers say "vos".', ru: 'Стандартная (испанская) форма: "tú". В Рио-де-ла-Плате говорят "vos".' },
  },
  contigo: {
    form: 'con vos', confidence: 'high', evidence: 'type changed from form to replacement by decision (standard Peninsular form: contigo)',
    notes: { en: 'Standard (Peninsular) form: "contigo". Rioplatense says "con vos".', ru: 'Стандартная (испанская) форма: "contigo". В Рио-де-ла-Плате: "con vos".' },
  },
}
for (const [w, m] of Object.entries(MANUAL_ACCEPT)) {
  if (handled.has(w)) throw new Error(`${w} is already handled by an earlier rule`)
  const a = A.get(w), b = outB.get(w)
  const aMatches = a.rio_type === 'replacement' && low(a.rio_form) === low(m.form)
  const bMatches = b.rio_type === 'replacement' && low(b.rio_form) === low(m.form)
  const source = aMatches ? a : bMatches ? b : a // register / notes come from a model entry for the same form, else A
  const fields = {
    rio_type: 'replacement', rio_form: m.form, alt_form: null, alt_region: null, region: m.region ?? null, register: source.register,
    notes: m.notes ?? (aMatches && a.note_en ? { en: a.note_en, ru: a.note_ru } : null), std_meaning: null,
    translation: a.en_translation ? { en: a.en_translation, ru: a.ru_translation } : b.en_translation && bMatches ? { en: b.en_translation, ru: b.ru_translation } : null,
    confidence: m.confidence ?? 'medium',
  }
  make(w, fields, 'accepted', ['manual accept (Valera)', ...(m.evidence ? [m.evidence] : []), ...damerEvidence(fields), ...proposalEvidence(w)], [], `A${aMatches ? '' : bMatches ? ' (form and register from B)' : ' (form set by decision)'}, manual accept`)
  handled.add(w)
}
for (const w of ['hermoso', 'bello', 'rostro', 'empleo', 'vacación', 'norteamericano']) {
  if (handled.has(w)) throw new Error(`${w} is already handled by an earlier rule`)
  make(w, none(A.get(w)), 'rejected', ['manual reject (Valera): not a dialect difference', ...proposalEvidence(w).map((e) => 'rejected proposal context, ' + e)], [], 'A (type none; register kept from A)')
  handled.add(w)
}
const MANUAL_PENDING = ['niño', 'pequeño', 'muchacho'] // evidence appended after the rules have run

// tony
make('tony', none(A.get('tony')), 'accepted', ['manual decision: none (junk entry)', ...proposalEvidence('tony')], ['needs_re_enrichment'], 'A (type none)')
handled.add('tony')

// ---------------------------------------------------------------- rules 2-4
function proposalFor(w, d) {
  const b = outB.get(w), c = claude.get(w), legacy = low(dictionary.get(w).es_rioplatense) ?? ''
  const asked = low(d.asked)
  if (d.kind === 'replacement') {
    if (b.rio_type !== 'none' && low(b.rio_form) === asked) return { source: 'B', entry: b }
    if (c.rio_type !== 'none' && low(c.rio_form) === asked) return { source: 'Claude', entry: c }
    if (legacy.split(/[/,;]| o /).map((s) => s.trim()).includes(asked)) return { source: 'legacy', entry: null }
  } else {
    if (['meaning_shift', 'regional_only'].includes(b.rio_type) && low(b.rio_form) === low(w)) return { source: 'B', entry: b }
    if (['meaning_shift', 'regional_only'].includes(c.rio_type) && low(c.rio_form) === low(w)) return { source: 'Claude', entry: c }
  }
  return null
}

for (const w of words) {
  if (handled.has(w)) continue
  const a = A.get(w)
  const decisions = qByWord.get(w) ?? []
  const keep = decisions.filter((d) => d.decision === 'KEEP')
  const other = decisions.filter((d) => d.decision !== 'KEEP')
  if (other.length) notes.push(`${w}: questionnaire decision ${other.map((d) => d.decision).join(',')} not covered by a manual rule`)

  if (keep.length) {
    const d = keep[0]
    const matches = d.mapping.status === "claim is A's entry"
    if (matches && a.rio_type !== 'none') {
      make(w, fromA(a), 'accepted', [qEvidence(d), ...damerEvidence(a), `A: ${fmt(a)}`, ...(auditClass.get(w) === '3-way agree' ? ['3-way agree'] : [])], [], 'A')
      continue
    }
    const p = proposalFor(w, d)
    if (!p) {
      make(w, fromA(a), 'pending', [qEvidence(d), `questionnaire asked «${d.asked}» but no model proposal matches it`, ...proposalEvidence(w)], [], 'A (no usable proposal)')
      notes.push(`${w}: questionnaire KEEP for «${d.asked}», but no A/B/Claude/legacy proposal matches; left pending`)
      continue
    }
    const e = p.entry
    const fields = {
      rio_type: d.kind === 'replacement' ? 'replacement' : e.rio_type,
      rio_form: d.kind === 'replacement' ? d.asked : w,
      // The questionnaire only asked Uruguayans, so it sets no country label. The proposing source's own region (B or Claude's entry; the legacy field has
      // none) is only a candidate: rule 4c keeps it when two independent families of sources say the other country does not use the form.
      alt_form: null, alt_region: null, region: e?.region ?? null,
      register: e?.register ?? A.get(w).register,
      notes: null,
      std_meaning: e?.std_meaning_en ? { en: e.std_meaning_en, ru: e.std_meaning_ru } : null,
      translation: e?.en_translation ? { en: e.en_translation, ru: e.ru_translation } : null,
      confidence: 'medium',
    }
    const ev = [qEvidence(d), `proposal from ${p.source} (A said ${a.rio_type === 'none' ? 'none' : fmt(a)}); no country label from the questionnaire (it only asked Uruguayans); the proposal's own region, if any, is judged by rule 4c`, ...damerEvidence(fields)]
    const cl = claude.get(w)
    if (p.source === 'Claude' && cl.alt_form) ev.push(`Claude also proposed ${cl.alt_form} (${cl.alt_region}); not added (not asked)`)
    make(w, fields, 'accepted', ev, [], `${p.source} (A said none), confidence medium`)
    if (p.source === 'legacy' && w === 'cigarro') {
      const reg = outB.get('cigarrillo').register
      result.get(w).register = reg
      result.get(w).evidence.push(`register ${reg} taken from B's entry for the same form (cigarrillo → pucho)`)
    }
    continue
  }

  // rule 4
  const three = auditClass.get(w) === '3-way agree'
  if (three) make(w, fromA(a), 'accepted', ['3-way agree', ...damerEvidence(a)], [], 'A')
  else {
    const reason = `no questionnaire item; A, B and Claude do not agree (audit class: ${auditClass.get(w)})`
    make(w, fromA(a), 'pending', [reason, ...damerEvidence(a), ...proposalEvidence(w), ...(merged.invalid.some((i) => i.es_word === w) ? [`A fails validation: ${merged.invalid.find((i) => i.es_word === w).errors.join('; ')}`] : [])], [], 'A')
  }
}

for (const w of MANUAL_PENDING) {
  if (result.get(w).status !== 'pending') throw new Error(`${w} was expected to stay pending`)
  result.get(w).evidence.push('manual triage (Valera): left pending')
}

// ---------------------------------------------------------------- rule 4b: manual overrides from questionnaire free text
// Applied after every automatic step, before the validator (so the new register value is checked too). Each one is a hand decision.
const FREE_TEXT_REASON = 'questionnaire free-text (Salto respondent)'
const CIGARRO_NOTE = {
  form: 'pucho',
  register: 'informal',
  notes: {
    en: '"Cigarro" or "cigarrillo" is the more usual everyday word; "pucho" is the colloquial one.',
    ru: '"Cigarro" или "cigarrillo" — более обычное слово в повседневной речи; "pucho" — разговорное.',
  },
}
const MANUAL_OVERRIDES = {
  vagabundo: {
    form: 'linyera',
    register: 'pejorative',
    notes: {
      en: 'Dismissive word. The neutral phrase is "persona en situación de calle".',
      ru: 'Пренебрежительное слово. Нейтральное выражение: "persona en situación de calle".',
    },
  },
  cigarrillo: CIGARRO_NOTE,
  cigarro: CIGARRO_NOTE, // same note, same reason: it is the same pucho entry from the other standard word
}
const manualOverrideLog = []
for (const [w, ov] of Object.entries(MANUAL_OVERRIDES)) {
  const o = result.get(w)
  if (!o || o.status !== 'accepted' || o.rio_form !== ov.form) throw new Error(`manual override for ${w}: expected an accepted entry with rio_form ${ov.form}`)
  manualOverrideLog.push({ es_word: w, rio_form: o.rio_form, register: { from: o.register, to: ov.register }, hadNote: o.notes !== null })
  o.register = ov.register
  o.notes = ov.notes
  o.evidence.push(`manual override (Valera): register ${ov.register} and a note; reason: ${FREE_TEXT_REASON}`)
}

// ---------------------------------------------------------------- rule 4c: country labels need two independent sources
// See the constraint at the top and tools/rio-overlay/regionRule.mjs. A label no two families of sources support is dropped (null), and a pair
// stands only if both of its labels do. The questionnaire is not a source for this. The one exception is named here, with its reason:
// a label that rests on a fact about the world, not on what sources say. It is reported as an exception, never as a two-source finding.
const EXTRALINGUISTIC_LABELS = {
  metro: { region: 'ar', reason: 'there is no subway in Uruguay, so "subte" can only name a foreign system there' },
}
const regionLog = []
const usedExceptions = new Set()
for (const w of words) {
  const o = result.get(w)
  if (!o.region && !o.alt_form) continue
  const r = applyRegionRule(o, { A: A.get(w), B: outB.get(w), Claude: claude.get(w), DAMER: damer }, EXTRALINGUISTIC_LABELS)
  const before = { region: o.region, alt_form: o.alt_form, alt_region: o.alt_region }
  o.region = r.region
  o.alt_form = r.alt_form
  o.alt_region = r.alt_region
  o.evidence.push(...r.log)
  if (r.usedException) usedExceptions.add(w)
  regionLog.push({ es_word: w, rio_form: o.rio_form, status: o.status, before, after: { region: o.region, alt_form: o.alt_form, alt_region: o.alt_region }, lines: r.log })
}
for (const w of Object.keys(EXTRALINGUISTIC_LABELS)) if (!usedExceptions.has(w)) throw new Error(`extralinguistic label for ${w} was not used: remove it or fix the entry`)

// ---------------------------------------------------------------- rule 5: validator
const validatorIssues = []
for (const w of words) {
  const o = result.get(w)
  const schemaEntry = {
    es_word: w, reasoning: `AR: ?; UY: ?; std: ? -> ${o.rio_type}`, rio_type: o.rio_type, rio_form: o.rio_form, region: o.region, alt_form: o.alt_form, alt_region: o.alt_region,
    std_meaning_en: o.std_meaning?.en ?? null, std_meaning_ru: o.std_meaning?.ru ?? null, register: o.register, note_en: o.notes?.en ?? null, note_ru: o.notes?.ru ?? null,
    example_sentence: null, example_translation_en: null, example_translation_ru: null, word_form_in_example: null,
    en_translation: o.translation?.en ?? null, ru_translation: o.translation?.ru ?? null, confidence: o.confidence,
  }
  const r = validateEntry(schemaEntry, dictionary.get(w))
  o.validator = { errors: r.errors, warnings: r.warnings.filter((x) => !/^(none_high_confidence|translation_unchanged)/.test(x)) }
  if (r.errors.length) {
    validatorIssues.push({ w, errors: r.errors, status: o.status, flags: o.flags })
    if (o.status === 'accepted') {
      o.status = 'pending'
      o.evidence.push('validator: ' + r.errors.join('; ') + ' -> pending')
    }
  }
}

// ---------------------------------------------------------------- pass 2: generated examples (examples.v1.json)
// Written by tools/rio-overlay/generate-examples.mjs. A replacement example ships to the client now (review "auto");
// meaning_shift / regional_only / form examples stay "pending" here until they are confirmed by hand.
// Examples confirmed by hand (Valera): the meaning_shift / regional_only entries read and approved, plus tú and contigo
// (now replacements). A generated example is "auto" (replacement, automatic checks) or "pending" (waits for this list).
const CONFIRMED_EXAMPLES = new Set(['foco', 'guapo', 'mina', 'saco', 'feria', 'boleto', 'colgado', 'suprema', 'chance', 'torta', 'marcador', 'propaganda', 'vos', 'tú', 'contigo'])
const SHIPPED_REVIEWS = ['auto', 'confirmed']
const examplesPath = path.join(HERE, 'examples.v1.json')
const pass2 = fs.existsSync(examplesPath) ? JSON.parse(fs.readFileSync(examplesPath, 'utf8')) : null
const staleExamples = []
for (const w of words) {
  const o = result.get(w)
  const ex = pass2?.examples?.[w]
  if (!ex) continue
  if (o.status !== 'accepted' || o.rio_type === 'none' || ex.rio_form !== o.rio_form) {
    staleExamples.push(w) // the entry changed since the example was written: do not attach it
    continue
  }
  o.example = { es: ex.es, en: ex.en, ru: ex.ru, word_form: ex.word_form }
  o.example_review = ex.review === 'pending' && CONFIRMED_EXAMPLES.has(w) ? 'confirmed' : ex.review
  o.evidence.push(`pass-2 example (${pass2.meta.model}), review: ${o.example_review}${o.example_review === 'confirmed' ? ' (Valera)' : ''}`)
}

// ---------------------------------------------------------------- pass 4: is the standard word itself used? (std-usage.v1.json)
// Written by `node tools/rio-overlay/generate-examples.mjs --pass stdusage --run NAME`. It decides how a card labels the
// other word: "in Spain" (not_used) or "also" (less_common / equally_used). Manual overrides go here, applied AFTER the
// model, each with a reason; there are none yet (the model's answers are being sanity-checked first).
// std_usage is only a soft hint on the card ("rarely used here", "also common"), never a geography claim. Manual decisions, all final,
// applied AFTER the model's answers:
//  1. eight words that do occur in the region, in another sense or less often;
//  2. eleven words that have another everyday sense in the region;
//  3. the principle: "not_used" stays ONLY where es_word is unambiguously Peninsular-only AND has no other common sense in
//     Rioplatense. Every other entry the model called not_used goes down to less_common (when unsure, it goes down).
const OCCURS_IN_REGION = 'does occur in the region, in another sense or less often, so "rarely used here" would be false (decided by hand)'
const ANOTHER_SENSE = 'has another everyday sense in the region (decided by hand)'
const NOT_USED_KEPT = {
  vuestro: 'the Peninsular possessive of vosotros; Rioplatense uses su / de ustedes, and vuestro has no other sense',
  vosotros: 'Peninsular-only pronoun; Rioplatense says ustedes in every context, and it has no other sense',
  ordenador: 'Peninsular word for a computer (computadora here); the "one who orders" sense is rare and bookish',
  patata: 'Peninsular word for potato (papa here); no other common sense',
  aparcar: 'Peninsular verb for parking (estacionar here); no other sense',
  gilipollas: 'Peninsular vulgar insult (boludo / pelotudo here); no other sense',
  chaval: 'Peninsular slang for a kid (pibe / gurí here); no other sense',
  guay: 'Peninsular slang for "cool" (copado / bárbaro here); no other sense',
}
const DOWNGRADED_BY_PRINCIPLE = {
  enfadado: 'unsure: understood and sometimes used in the region, not clearly Peninsular-only',
  enfadar: 'unsure: understood and sometimes used in the region, not clearly Peninsular-only',
  coste: 'unsure: a standard variant of costo that does appear in formal and written Spanish in the region',
  gasolina: 'standard in most of Latin America and used in the region too (nafta is just the preferred word)',
  apresurar: 'a formal verb, not Peninsular-only; it is used in the region',
  piscina: 'used in Uruguay (pileta is the Argentine preference), so not unambiguously Peninsular',
  autobús: 'used in Uruguay in formal and official speech; not Peninsular-only',
  furgoneta: 'used in the region for the commercial vehicle; not clearly Peninsular-only',
  calcetín: 'standard across Latin America; not unambiguously Peninsular-only',
  tejado: 'a common word for a tiled roof in the region as well (techo is the general one)',
  halar: 'Latin American, not Peninsular, so the "Peninsular-only" test fails',
}
const STD_USAGE_OVERRIDES = {
  ...Object.fromEntries(['pastel', 'carro', 'escoger', 'apartamento', 'coger', 'follar', 'coño', 'cojón'].map((w) => [w, { std_usage: 'less_common', reason: `${w} ${OCCURS_IN_REGION}` }])),
  ...Object.fromEntries(['pluma', 'falda', 'cubo', 'maya', 'portero', 'balón', 'condón', 'metro', 'mando', 'carretera', 'mantequilla'].map((w) => [w, { std_usage: 'less_common', reason: `${w} ${ANOTHER_SENSE}` }])),
  ...Object.fromEntries(Object.entries(DOWNGRADED_BY_PRINCIPLE).map(([w, why]) => [w, { std_usage: 'less_common', reason: `${w}: ${why}; not unambiguously Peninsular-only, so downgraded from not_used (decided by hand)` }])),
} // { es_word: { std_usage: 'not_used' | 'less_common' | 'equally_used', reason } }
const usagePath = path.join(HERE, 'std-usage.v1.json')
const pass4 = fs.existsSync(usagePath) ? JSON.parse(fs.readFileSync(usagePath, 'utf8')) : null
const staleUsage = []
for (const w of words) {
  const o = result.get(w)
  const u = pass4?.usage?.[w]
  if (!u) continue
  if (o.status !== 'accepted' || o.rio_type === 'none' || low(o.rio_form) === low(w) || low(u.rio_form) !== low(o.rio_form)) {
    staleUsage.push(w) // the entry changed since the answer was written: do not attach it
    continue
  }
  o.std_usage = u.std_usage
  o.std_usage_reason = u.reason
  o.evidence.push(`std_usage ${u.std_usage} (${pass4.meta.model}): ${u.reason}`)
}
for (const [w, ov] of Object.entries(STD_USAGE_OVERRIDES)) {
  const o = result.get(w)
  if (!o || o.status !== 'accepted') throw new Error(`std_usage override for ${w}: not an accepted entry`)
  o.std_usage = ov.std_usage
  o.std_usage_reason = ov.reason
  o.evidence.push(`std_usage ${ov.std_usage} by manual override (Valera): ${ov.reason}`)
}
// the principle: whatever is still not_used must be on the kept list, and everything on the kept list must still be not_used
for (const w of words) {
  const o = result.get(w)
  if (o.std_usage === 'not_used' && !NOT_USED_KEPT[w]) {
    o.std_usage = 'less_common'
    o.std_usage_reason = `${w}: not unambiguously Peninsular-only, so downgraded from not_used by the rule (when unsure it goes down) (decided by hand)`
    o.evidence.push(`std_usage less_common by manual rule (Valera): ${o.std_usage_reason}`)
  }
}
for (const [w, why] of Object.entries(NOT_USED_KEPT)) {
  const o = result.get(w)
  if (!o || o.std_usage !== 'not_used') throw new Error(`${w} is on the not_used kept list but is not not_used`)
  o.std_usage_reason = `${why} (kept by hand)`
  o.evidence.push(`std_usage not_used kept by manual decision (Valera): ${why}`)
}

// ---------------------------------------------------------------- rule 6: an alternative form has its country
// Nothing is written when an entry has an alt_form without an alt_region (or the reverse): no manual decision outranks this.
assertAltPairs(words.map((w) => result.get(w)))

// ---------------------------------------------------------------- write
const ordered = words.map((w) => result.get(w))
const OUT_FIELDS = ['es_word', 'rank', 'rio_type', 'rio_form', 'alt_form', 'alt_region', 'region', 'register', 'notes', 'std_meaning', 'translation', 'confidence', 'status', 'flags', 'std_usage', 'std_usage_reason', 'example', 'example_review', 'evidence']
const overlay = ordered.map((o) => Object.fromEntries(OUT_FIELDS.map((k) => [k, o[k] ?? null])))
fs.writeFileSync(path.join(HERE, 'overlay.v1.json'), JSON.stringify(overlay, null, 2))
const CLIENT_FIELDS = ['es_word', 'rio_type', 'rio_form', 'alt_form', 'alt_region', 'region', 'register', 'notes', 'std_meaning', 'translation', 'std_usage', 'confidence']
// an example goes to the client when it passed the automatic checks (replacements) or was confirmed by hand; the rest stay out
const client = ordered
  .filter((o) => o.status === 'accepted' && o.rio_type !== 'none')
  .map((o) => ({ ...Object.fromEntries(CLIENT_FIELDS.map((k) => [k, o[k] ?? null])), ...(o.example && SHIPPED_REVIEWS.includes(o.example_review) ? { example: o.example } : {}) }))
fs.writeFileSync(path.join(HERE, 'overlay.v1.client.json'), JSON.stringify(client, null, 2))

const tally = (list, f) => list.reduce((a, o) => ((a[f(o)] = (a[f(o)] ?? 0) + 1), a), {})
const counts = { status: tally(ordered, (o) => o.status), type: tally(ordered, (o) => o.rio_type), statusByType: {} }
for (const s of ['accepted', 'rejected', 'pending']) counts.statusByType[s] = tally(ordered.filter((o) => o.status === s), (o) => o.rio_type)

const md = []
md.push('# Overlay v1 report', '')
md.push(`${ordered.length} entries (the stage-1 words). Client export: ${client.length} entries (status accepted and rio_type not none).`, '')
md.push('## Counts', '', '| status | entries | by rio_type |', '|---|---|---|')
for (const s of ['accepted', 'pending', 'rejected']) md.push(`| ${s} | ${counts.status[s] ?? 0} | ${Object.entries(counts.statusByType[s]).map(([k, v]) => `${k} ${v}`).join(', ')} |`)
md.push('', `By rio_type overall: ${Object.entries(counts.type).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '')
md.push('## Base used per entry', '', 'Base = run A (`stage1.merged.json`; the one entry A failed validation on, apartamento, from `out/s1-A.json`) for every entry: A is the stage-1 base run and the only source with the full schema. Entries that deviate from A:', '')
for (const w of words) if (basis.get(w) !== 'A') md.push(`- ${w}: ${basis.get(w)}`)
md.push('', '## Rejected', '')
for (const o of ordered.filter((x) => x.status === 'rejected')) md.push(`- ${o.es_word} (rank ${o.rank}): ${o.evidence[0]}`)
md.push('', '## Pending (the short list for further checks)', '', `${ordered.filter((o) => o.status === 'pending').length} entries, by dictionary rank. Each shows the reason and the competing proposals.`, '')
for (const o of ordered.filter((x) => x.status === 'pending')) {
  md.push(`- **${o.es_word}** (rank ${o.rank}): ${o.evidence[0]}`)
  for (const e of o.evidence.slice(1)) md.push(`  - ${e}`)
}
const weak = ordered.filter((o) => o.status === 'accepted' && o.evidence.some((e) => e.startsWith('questionnaire')) && (o.evidence.some((e) => /^proposal from/.test(e)) || (!o.evidence.some((e) => e.startsWith('DAMER')) && !o.evidence.includes('3-way agree'))))
md.push('', '## Accepted on questionnaire evidence only (the weakest accepted entries)', '', 'Either the form came from a proposal where A said none (confidence medium, no country label), or the only support is the questionnaire (no DAMER label, no 3-way agreement).', '')
for (const o of weak) md.push(`- ${o.es_word} → ${o.rio_form}${o.region ? ` @${o.region}` : ''} (${o.confidence}): ${o.evidence.filter((e) => e.startsWith('questionnaire') || e.startsWith('proposal')).join('; ')}`)
md.push('', '## Country labels (the two-source rule)', '', 'A `region` (and an `alt_region` with its `alt_form`) is set only when at least two independent sources say the other country does not use the form (A and B are both Gemini, so they count as one family). The questionnaire only asked Uruguayans, so it never sets one. A pair stands only if both of its labels do. Every entry that had a label before the rule:', '')
for (const r of regionLog) {
  const was = `${r.before.region ?? '-'}${r.before.alt_form ? ` + ${r.before.alt_form} @${r.before.alt_region}` : ''}`
  const now = `${r.after.region ?? '-'}${r.after.alt_form ? ` + ${r.after.alt_form} @${r.after.alt_region}` : ''}`
  md.push(`- **${r.es_word}** → ${r.rio_form} (${r.status}): ${was} → ${now}`)
  for (const line of r.lines) md.push(`  - ${line}`)
}
md.push('', '## Manual overrides from questionnaire free text', '', `Reason recorded for each: ${FREE_TEXT_REASON}.`, '')
for (const m of manualOverrideLog) md.push(`- ${m.es_word} → ${m.rio_form}: register ${m.register.from} → ${m.register.to}; note ${m.hadNote ? 'replaced' : 'added'} (EN and RU)`)
md.push('', '## Pass 2 examples', '')
if (!pass2) md.push('No examples.v1.json: no pass-2 examples attached.')
else {
  const attached = ordered.filter((o) => o.example)
  const auto = attached.filter((o) => o.example_review === 'auto')
  const confirmed = attached.filter((o) => o.example_review === 'confirmed')
  const pending = attached.filter((o) => o.example_review === 'pending')
  md.push(`Generated by \`${pass2.meta.model}\` (run \`${pass2.meta.run}\`): ${pass2.meta.generated} of ${pass2.meta.selected} in scope, ${pass2.meta.failed} failed, cost about $${(pass2.meta.costUsd ?? 0).toFixed(4)}.`, '')
  md.push(`Shipped to the client: ${auto.length + confirmed.length} (${auto.length} replacements that passed the automatic checks, ${confirmed.length} confirmed by hand). Still held back (pending): ${pending.length}.`, '')
  md.push('| word | form | type | review | sentence | EN | RU |', '|---|---|---|---|---|---|---|')
  for (const o of attached) md.push(`| ${o.es_word} | ${o.rio_form} | ${o.rio_type} | ${o.example_review} | ${o.example.es} | ${o.example.en} | ${o.example.ru} |`)
  if (pass2.failed.length) {
    md.push('', 'Failed (listed, never edited; the client falls back to the old behaviour for these):', '')
    for (const f of pass2.failed) md.push(`- ${f.es_word} (${f.rio_form}): ${f.errors.join('; ')}`)
  }
  if (staleExamples.length) md.push('', `Not attached (the entry changed since the example was written): ${staleExamples.join(', ')}`)
}
md.push('', '## Standard-word usage (pass 4)', '')
if (!pass4) md.push('No std-usage.v1.json: no std_usage attached.')
else {
  const withUsage = ordered.filter((o) => o.std_usage)
  const groups = { not_used: 'hint "rarely used here"', less_common: 'no hint', equally_used: 'hint "also common"' }
  md.push(`Question asked of \`${pass4.meta.model}\` (run \`${pass4.meta.run}\`), per entry whose form differs from es_word: is es_word itself used in everyday speech in that region? ${pass4.meta.generated} answered, ${pass4.meta.failed} failed, cost about $${(pass4.meta.costUsd ?? 0).toFixed(4)}. Overrides applied: ${Object.keys(STD_USAGE_OVERRIDES).length}.`, '')
  for (const [value, label] of Object.entries(groups)) {
    const list = withUsage.filter((o) => o.std_usage === value)
    md.push(`### ${value} (${list.length}; card shows: ${label})`, '')
    for (const o of list) md.push(`- ${o.es_word} → ${o.rio_form}${o.region ? ` @${o.region}` : ''}: ${o.std_usage_reason}`)
    md.push('')
  }
  if (staleUsage.length) md.push(`Not attached (the entry changed since the answer was written): ${staleUsage.join(', ')}`, '')
  md.push('### Final not_used list (kept only where es_word is unambiguously Peninsular-only and has no other common sense)', '')
  for (const o of withUsage.filter((x) => x.std_usage === 'not_used')) md.push(`- ${o.es_word} → ${o.rio_form}: ${o.std_usage_reason}`)
  md.push('')
}
md.push('', '## Validator', '')
if (!validatorIssues.length) md.push('No errors.')
for (const v of validatorIssues) md.push(`- ${v.w}: ${v.errors.join('; ')} (status now ${result.get(v.w).status}${v.flags.length ? ', flags: ' + v.flags.join(', ') : ''})`)
md.push('', '## Flags', '')
for (const o of ordered.filter((x) => x.flags.length)) md.push(`- ${o.es_word}: ${o.flags.join('; ')}`)
if (notes.length) md.push('', '## Did not fit the rules', '', ...notes.map((x) => `- ${x}`))
fs.writeFileSync(path.join(HERE, 'report.md'), md.join('\n') + '\n')

console.log(JSON.stringify({ total: ordered.length, status: counts.status, type: counts.type, client: client.length, validatorIssues: validatorIssues.map((v) => `${v.w}: ${v.errors.join('; ')} (${result.get(v.w).status})`), notes }, null, 1))
console.log('\nPENDING (by rank):')
for (const o of ordered.filter((x) => x.status === 'pending')) console.log(String(o.rank).padStart(5), o.es_word.padEnd(12), o.evidence.filter((e) => /^(A|B|Claude|legacy):/.test(e)).join(' | '))
