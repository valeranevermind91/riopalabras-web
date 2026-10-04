// The typed Rioplatense overlay (public/rio_overlay.json): what the client knows about a word's
// Rioplatense side. Only accepted, non-"none" entries are ever in the file; the parser still skips
// anything that is not.

export type RioType = 'replacement' | 'meaning_shift' | 'regional_only' | 'form'
export type RioRegion = 'uy' | 'ar'
export type Lang = 'en' | 'ru'

export interface Localized {
  readonly en: string
  readonly ru: string
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
  readonly confidence: string
}

const TYPES: readonly string[] = ['replacement', 'meaning_shift', 'regional_only', 'form']

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const region = (v: unknown): RioRegion | null => (v === 'uy' || v === 'ar' ? v : null)

function localized(v: unknown): Localized | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const en = clean(o.en) ?? ''
  const ru = clean(o.ru) ?? ''
  return en || ru ? { en, ru } : null
}

/** The note/meaning in the user's language, falling back to the other language; null if there is none. */
export function pickLocalized(value: Localized | null, lang: Lang): string | null {
  if (!value) return null
  return clean(value[lang]) ?? clean(value[lang === 'en' ? 'ru' : 'en'])
}

/** Which language the user reads: Russian unless they switched the Russian translation off. */
export function langFromSettings(settings: { readonly showRuTranslation: boolean }): Lang {
  return settings.showRuTranslation ? 'ru' : 'en'
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
  if (/[aeiouáéíóú]/.test(last)) {
    const base = b.slice(0, -1)
    const swaps = last === 'o' ? ['o', 'a'] : last === 'a' ? ['a', 'o'] : [last]
    return swaps.flatMap((v) => [base + v, base + v + 's'])
  }
  if (last === 'z') return [b, b.slice(0, -1) + 'ces']
  // consonant ending: plural -es, which drops a written accent on -ón / -án / -én / -ín / -ús ("sillón" → "sillones")
  const noAccent = b.replace(/[áéíóú](?=[ns]$)/, (m) => ACCENTED[m])
  return [b, b + 'es', b + 's', noAccent + 'es']
}

// Regular conjugation endings after the stem (voseo included), without a trailing clitic (apurate, levantarlo).
const VERB_ENDINGS: Record<'ar' | 'er' | 'ir', readonly string[]> = {
  ar: ['ar', 'o', 'a', 'as', 'á', 'ás', 'és', 'amos', 'an', 'e', 'es', 'é', 'en', 'ó', 'aste', 'aron', 'ado', 'ada', 'ados', 'adas', 'ando', 'aba', 'abas', 'aban', 'ábamos', 'aré', 'arás', 'ará', 'aremos', 'arán', 'aría', 'arías', 'aríamos', 'arían', 'ara', 'aras', 'aran', 'ase', 'ases', 'asen', 'áis', 'éis'],
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
 * One sentence word against one word of the form. Equal ignoring case, or an inflection: plural and
 * gender for nouns and adjectives (pelo/pelos/pela, never pelota), conjugation for verbs (apurar →
 * apuro, apurás), never a different word that merely starts the same way (auto ≠ automóvil).
 */
export function inflectionOf(token: string, formWord: string, pos: string | undefined, isFirstWord = true): boolean {
  const a = token.toLowerCase()
  const b = formWord.toLowerCase()
  if (a === b) return true
  if (pos === 'v' && isFirstWord) {
    const m = b.match(/^(.{2,}?)(ar|er|ir)(se)?$/)
    if (!m || m[1].length < 3 || !a.startsWith(m[1])) return false
    return VERB_ENDINGS[m[2] as 'ar' | 'er' | 'ir'].includes(stripClitic(a.slice(m[1].length)))
  }
  return nominalForms(b).includes(a)
}

/** The first place in the sentence where the form (one or several words) or an inflection of it appears as whole words. */
export function findFormRange(sentence: string, form: string, pos?: string): FormRange | null {
  const formWords = form.match(TOKEN)
  if (!formWords) return null
  const tokens = [...sentence.matchAll(TOKEN)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }))

  for (let i = 0; i + formWords.length <= tokens.length; i++) {
    let ok = true
    for (let j = 0; j < formWords.length && ok; j++) {
      const t = tokens[i + j]
      ok = inflectionOf(t.text, formWords[j], pos, j === 0)
      if (ok && j > 0 && !/^\s+$/.test(sentence.slice(tokens[i + j - 1].end, t.start))) ok = false
    }
    if (ok) return { start: tokens[i].start, end: tokens[i + formWords.length - 1].end }
  }
  return null
}
