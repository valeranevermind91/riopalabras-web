// The typed Rioplatense overlay (public/rio_overlay.json): what the client knows about a word's
// Rioplatense side. Only accepted, non-"none" entries are ever in the file; the parser still skips
// anything that is not.

export type RioType = 'replacement' | 'meaning_shift' | 'regional_only' | 'form'
export type RioRegion = 'uy' | 'ar'
export type Lang = 'en' | 'ru'
/** Is the standard word itself used in everyday Rioplatense speech? Decides how a card labels it. */
export type StdUsage = 'not_used' | 'less_common' | 'equally_used'

export interface Localized {
  readonly en: string
  readonly ru: string
}

/** A pass-2 example sentence that shows the Rioplatense form or sense. */
export interface RioExample {
  readonly es: string
  readonly en: string
  readonly ru: string
  /** The exact text of the form inside `es`. */
  readonly wordForm: string | null
}

export interface RioInfo {
  readonly type: RioType
  /** rio_form: the Rioplatense headword candidate (equals the standard word for meaning_shift / regional_only). */
  readonly form: string
  readonly altForm: string | null
  readonly altRegion: RioRegion | null
  /** Null means both countries. */
  readonly region: RioRegion | null
  readonly register: string
  readonly notes: Localized | null
  readonly stdMeaning: Localized | null
  /** Replaces the dictionary translation where it applies (see translationsFor). */
  readonly translation: Localized | null
  /** For a replacement: is es_word itself used in everyday speech there? Null when unknown or not applicable. */
  readonly stdUsage: StdUsage | null
  /** When present it replaces the dictionary example on the card. */
  readonly example: RioExample | null
  readonly confidence: string
}

const TYPES: readonly string[] = ['replacement', 'meaning_shift', 'regional_only', 'form']

const STD_USAGES: readonly string[] = ['not_used', 'less_common', 'equally_used']
const stdUsage = (v: unknown): StdUsage | null => (typeof v === 'string' && STD_USAGES.includes(v) ? (v as StdUsage) : null)
const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const region = (v: unknown): RioRegion | null => (v === 'uy' || v === 'ar' ? v : null)

function localized(v: unknown): Localized | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const en = clean(o.en) ?? ''
  const ru = clean(o.ru) ?? ''
  return en || ru ? { en, ru } : null
}

function parseExample(v: unknown): RioExample | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const es = clean(o.es)
  if (!es) return null
  return { es, en: clean(o.en) ?? '', ru: clean(o.ru) ?? '', wordForm: clean(o.word_form) }
}

/**
 * Pass 3: neutral example sentences for dictionary words outside the overlay whose old example showed another
 * word (public/examples_fallback.json). Keyed by trimmed lower-case es_word; malformed entries are skipped.
 */
export function parseFallbackExamples(raw: unknown): ReadonlyMap<string, RioExample> {
  if (!Array.isArray(raw)) throw new Error('Fallback examples are not a JSON array')
  const out = new Map<string, RioExample>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const esWord = clean(e.es_word)
    const example = parseExample(e)
    if (!esWord || !example || !example.wordForm) continue
    const key = esWord.toLowerCase()
    if (!out.has(key)) out.set(key, example)
  }
  return out
}

/** The first meaning of a comma- or semicolon-separated gloss list, ignoring separators inside parentheses: "focus, spotlight" → "focus". */
export function firstGloss(text: string): string {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && (c === ',' || c === ';')) return text.slice(0, i).trim()
  }
  return text.trim()
}

/** Parses the overlay file into a map keyed by trimmed lower-case es_word; malformed and non-accepted entries are skipped. */
export function parseRioOverlay(raw: unknown): ReadonlyMap<string, RioInfo> {
  if (!Array.isArray(raw)) throw new Error('Rioplatense overlay is not a JSON array')
  const out = new Map<string, RioInfo>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const esWord = clean(e.es_word)
    const form = clean(e.rio_form)
    if (!esWord || !form || typeof e.rio_type !== 'string' || !TYPES.includes(e.rio_type)) continue
    if ('status' in e && e.status !== 'accepted') continue
    const key = esWord.toLowerCase()
    if (out.has(key)) continue
    out.set(key, {
      type: e.rio_type as RioType,
      form,
      altForm: clean(e.alt_form),
      altRegion: region(e.alt_region),
      region: region(e.region),
      register: clean(e.register) ?? 'neutral',
      notes: localized(e.notes),
      stdMeaning: localized(e.std_meaning),
      translation: localized(e.translation),
      stdUsage: stdUsage(e.std_usage),
      example: parseExample(e.example),
      confidence: clean(e.confidence) ?? 'medium',
    })
  }
  return out
}

// ---------------------------------------------------------------- finding a form (or its inflection) in a sentence

export interface FormRange {
  start: number
  end: number
}

const TOKEN = /[\p{L}\p{M}\p{N}]+/gu
const ACCENTED: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' }

function nominalForms(b: string): string[] {
  const last = b[b.length - 1]
  // apocope before a noun: alguno → algún, tercero → tercer, bueno → buen
  const apocope = b.endsWith('uno') ? [b.slice(0, -3) + 'ún'] : b.endsWith('o') && b.length > 3 ? [b.slice(0, -1)] : []
  if (/[aeiouáéíóú]/.test(last)) {
    const base = b.slice(0, -1)
    const swaps = last === 'o' ? ['o', 'a'] : last === 'a' ? ['a', 'o'] : [last]
    return [...swaps.flatMap((v) => [base + v, base + v + 's']), ...apocope]
  }
  if (last === 'z') return [b, b.slice(0, -1) + 'ces', b + 'a', b + 'as']
  // consonant ending: plural -es, which drops a written accent on -ón / -án / -én / -ín / -ús ("sillón" → "sillones"),
  // and the feminine -a / -as (francés → francesa, encantador → encantadora)
  const noAccent = b.replace(/[áéíóú](?=[ns]$)/, (m) => ACCENTED[m])
  return [b, b + 'es', b + 's', noAccent + 'es', b + 'a', b + 'as', noAccent + 'a', noAccent + 'as']
}

// Regular conjugation endings after the stem (voseo included), without a trailing clitic (apurate, levantarlo).
const VERB_ENDINGS: Record<'ar' | 'er' | 'ir', readonly string[]> = {
  ar: ['ar', 'o', 'a', 'as', 'á', 'ás', 'és', 'amos', 'emos', 'an', 'e', 'es', 'é', 'en', 'ó', 'aste', 'aron', 'ado', 'ada', 'ados', 'adas', 'ando', 'aba', 'abas', 'aban', 'ábamos', 'aré', 'arás', 'ará', 'aremos', 'arán', 'aría', 'arías', 'aríamos', 'arían', 'ara', 'aras', 'aran', 'ase', 'ases', 'asen', 'áis', 'éis'],
  er: ['er', 'o', 'e', 'es', 'é', 'emos', 'en', 'és', 'ió', 'í', 'iste', 'ieron', 'ido', 'ida', 'idos', 'idas', 'iendo', 'ía', 'ías', 'ían', 'íamos', 'erá', 'erás', 'eré', 'erán', 'ería', 'a', 'as', 'an', 'amos', 'iera', 'ieras', 'ieran'],
  ir: ['ir', 'o', 'e', 'es', 'é', 'imos', 'en', 'ís', 'ió', 'í', 'iste', 'ieron', 'ido', 'ida', 'idos', 'idas', 'iendo', 'ía', 'ías', 'ían', 'íamos', 'irá', 'irás', 'iré', 'irán', 'iría', 'a', 'as', 'an', 'amos', 'iera', 'ieras', 'ieran'],
}
const CLITICS = ['nos', 'les', 'los', 'las', 'me', 'te', 'se', 'lo', 'la', 'le']

function stripClitic(ending: string): string {
  // "ate" is the imperative -á with -te (apurate); every other ending keeps its form
  for (const c of CLITICS) if (ending.length > c.length && ending.endsWith(c)) return ending.slice(0, -c.length).replace(/^at$|^et$|^it$/, (m) => m[0])
  return ending
}

/**
 * The stems a verb can take when it conjugates, beyond the plain one: the stem vowel change (sentir → sient-/sint-,
 * morir → muer-/mur-, pedir → pid-, jugar → jueg-) and the spelling changes (llegar → llegu-, empezar → empec-,
 * coger → coj-, conocer → conozc-, tener → teng-, salir → salg-, seguir → sig-, construir → construy-).
 */
export function verbStems(stem: string): string[] {
  // a stem ending in gu keeps it while the vowel before it changes (seguir: segu- → sigu- → sig-)
  const suffix = stem.endsWith('gu') ? 'gu' : ''
  const base = suffix ? stem.slice(0, -2) : stem
  const vowelChanges: string[] = [stem]
  const lastVowel = Math.max(base.lastIndexOf('e'), base.lastIndexOf('o'), base.lastIndexOf('u'))
  const tail = lastVowel >= 0 ? base.slice(lastVowel + 1) : ''
  if (lastVowel >= 0 && tail.length <= 2 && !/[aeiouáéíóú]/.test(tail)) {
    const head = base.slice(0, lastVowel)
    const v = base[lastVowel]
    if (v === 'e') vowelChanges.push(head + 'ie' + tail + suffix, head + 'i' + tail + suffix)
    if (v === 'o') vowelChanges.push(head + 'ue' + tail + suffix, head + 'u' + tail + suffix)
    if (v === 'u' && !suffix) vowelChanges.push(head + 'ue' + tail)
  }
  const out = new Set<string>()
  for (const v of vowelChanges) {
    out.add(v)
    if (v.endsWith('gu')) out.add(v.slice(0, -2) + 'g').add(v.slice(0, -2) + 'gü')
    if (v.endsWith('g')) out.add(v + 'u').add(v.slice(0, -1) + 'j')
    if (v.endsWith('c')) out.add(v.slice(0, -1) + 'qu').add(v.slice(0, -1) + 'z').add(v.slice(0, -1) + 'zc')
    if (v.endsWith('z')) out.add(v.slice(0, -1) + 'c')
    if (v.endsWith('n') || v.endsWith('l')) out.add(v + 'g')
    if (v.endsWith('u')) out.add(v + 'y')
  }
  return [...out]
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * One sentence word against one word of the form. Equal ignoring case, or an inflection: plural and
 * gender for nouns and adjectives (pelo/pelos/pela, never pelota), conjugation for verbs (apurar →
 * apuro, apurás, sentir → siento), never a different word that merely starts the same way (auto ≠ automóvil).
 * `looseAccents` also accepts a different accent (donde / dónde); it is off for overlay forms, where
 * papa and papá are different words.
 */
export function inflectionOf(token: string, formWord: string, pos: string | undefined, isFirstWord = true, looseAccents = false): boolean {
  let a = token.toLowerCase()
  let b = formWord.toLowerCase()
  if (looseAccents) {
    a = stripAccents(a)
    b = stripAccents(b)
  }
  if (a === b) return true
  if (pos === 'v' && isFirstWord) {
    // the infinitive with clitics: fiarle, levantarlo, darmelo
    if (/(ar|er|ir)$/.test(b) && a.startsWith(b) && /^(me|te|se|nos|le|les|lo|la|los|las)(lo|la|los|las)?$/.test(a.slice(b.length))) return true
    const m = b.match(/^(.{2,}?)(ar|er|ir)(se)?$/)
    if (!m || m[1].length < 3) return false
    const endings = looseAccents ? VERB_ENDINGS[m[2] as 'ar' | 'er' | 'ir'].map(stripAccents) : VERB_ENDINGS[m[2] as 'ar' | 'er' | 'ir']
    return verbStems(m[1]).some((stem) => a.startsWith(stem) && endings.includes(stripClitic(a.slice(stem.length))))
  }
  return (looseAccents ? nominalForms(b).map(stripAccents) : nominalForms(b)).includes(a)
}

/** The first place in the sentence where the form (one or several words) or an inflection of it appears as whole words. */
export function findFormRange(sentence: string, form: string, pos?: string, looseAccents = false): FormRange | null {
  const formWords = form.match(TOKEN)
  if (!formWords) return null
  const tokens = [...sentence.matchAll(TOKEN)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }))

  for (let i = 0; i + formWords.length <= tokens.length; i++) {
    let ok = true
    for (let j = 0; j < formWords.length && ok; j++) {
      const t = tokens[i + j]
      ok = inflectionOf(t.text, formWords[j], pos, j === 0, looseAccents)
      if (ok && j > 0 && !/^\s+$/.test(sentence.slice(tokens[i + j - 1].end, t.start))) ok = false
    }
    if (ok) return { start: tokens[i].start, end: tokens[i + formWords.length - 1].end }
  }
  return null
}
