import { OVERRIDES } from './transcriptionOverrides'

// A Spanish headword written in Russian letters, as Rioplatense Spanish is said, with the stressed vowel marked: «llevar» → «шеба́р». It is a guide for a beginner, not a phonetic
// transcription, and it is built from the spelling alone by the rules below. Where the rules cannot know (a loan word, a letter's name, an abbreviation) or the owner has said they are
// wrong, transcriptionOverrides.ts has the form written by hand and it wins.
//
// The choices, each one the owner's:
//   - sheísmo: ll and y before a vowel are «ш»; seseo: c before e/i and z are «с»; the s is never aspirated.
//   - e is «е» after a consonant and «э» at the start of a word or after a vowel (or the glide у): «меса», «поэта», «уэбо».
//   - a glide after a consonant is «ья/ье/ьо/ью», after a vowel or at the start «й»; ñ is «нь», and «нья», «ни», «ньо», «нью».
//   - l at the end of a word or before a consonant is «ль» (альто, а́рболь), before a vowel «л».
//   - an adverb in -mente has two stresses, the base word's and «ме́нте» (ра́пидаме́нте).
//   - x is «кс» everywhere except at the start of a word («с»: xilófono); México, Texas, Oaxaca: «х». xc before e/i is one «кс».
//
// Nothing here reads the environment or the page: it is a function of a string, so it is tested on a list, and a script can run it over the whole dictionary.

/** The combining acute that marks the stressed vowel in the TEXT form (tests, the review sheet, the overrides). The page draws the stress as a styled vowel, never with this. */
export const STRESS = '́'

/** Why a form is worth a second look: the review sheet lists the forms that have any. */
export type TranscriptionFlag = 'x' | 'mente' | 'h' | 'ps' | 'hie' | 'loan' | 'triphthong' | 'phrase' | 'override' | 'abbreviation' | 'foreign'

/** A run of the transcription: the stressed vowel is a piece of its own, so the page can set it apart. Unstressed runs are merged. */
export interface Piece {
  readonly text: string
  readonly stressed: boolean
}

const STRONG = 'aeoáéó'
const WEAK = 'iuíúü'
const ACCENTED = 'áéíóú'
const FRONT = 'eiéí'
const isVowel = (c: string | undefined): boolean => c !== undefined && c !== '' && (STRONG.includes(c) || WEAK.includes(c))
const isFront = (c: string | undefined): boolean => c !== undefined && c !== '' && FRONT.includes(c)

interface ConsonantToken {
  readonly kind: 'c'
  cyr: string
}
interface VowelToken {
  readonly kind: 'v'
  /** The vowel without its accent: a e i o u (ü is u). */
  readonly ch: string
  readonly accent: boolean
  /** Written y (final, or before a consonant): never a vowel of its own after a strong one. */
  readonly y: boolean
}
/** A silent h between two vowels: it renders nothing and keeps them in separate syllables. */
interface BreakToken {
  readonly kind: 'b'
}
type Token = ConsonantToken | VowelToken | BreakToken

const baseVowel = (c: string): string => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u' })[c] ?? c

/** Letters to tokens, left to right. `w` is one lower-case word of Spanish letters. */
function tokenize(w: string): Token[] {
  const out: Token[] = []
  const c = (cyr: string) => out.push({ kind: 'c', cyr })
  const cs = Array.from(w)
  const mexican = /mexic|texas|oaxac/.test(w)
  for (let i = 0; i < cs.length; i++) {
    const ch = cs[i]
    const n = cs[i + 1]
    const n2 = cs[i + 2]
    const p = cs[i - 1]
    if (isVowel(ch)) {
      out.push({ kind: 'v', ch: baseVowel(ch), accent: ACCENTED.includes(ch), y: false })
      continue
    }
    switch (ch) {
      case 'c':
        if (n === 'h') {
          c('ч')
          i++
        } else if (n === 'c' && isFront(n2)) {
          c('кс')
          i++
        } else if (n === 'k') {
          // ck, in a loan (shock): one sound
        } else c(isFront(n) ? 'с' : 'к')
        break
      case 'q':
        c('к')
        if (n === 'u' && isFront(n2)) i++ // que, qui: the u is only spelling
        break
      case 'g':
        if (n === 'u' && isFront(n2)) {
          c('г')
          i++ // gue, gui
        } else c(isFront(n) ? 'х' : 'г')
        break
      case 'h':
        if (isVowel(p) && isVowel(n)) out.push({ kind: 'b' }) // ahora, prohibir: no diphthong across a silent h
        break
      case 'j':
        c('х')
        break
      case 'l':
        if (n === 'l') {
          c('ш')
          i++
        } else {
          // at the end of a word or before a consonant the Spanish l is clear, not the hard Russian «л»: «ль». Before a vowel (also across a silent h) it is «л».
          const after = n === 'h' ? n2 : n
          c(after === undefined || !isVowel(after) ? 'ль' : 'л')
        }
        break
      case 'r':
        if (n === 'r') {
          c('рр')
          i++
        } else c('р')
        break
      case 's':
        if (n === 'c' && isFront(n2)) {
          c('с')
          i++ // escena: one sound
        } else if (n === 's') {
          c('с')
          i++
        } else if (n === 'h' && !(i === 2 && w.startsWith('des'))) {
          c('ш') // a loan: shock. (deshacer is des + hacer)
          i++
        } else c('с')
        break
      case 'x':
        if (mexican) c('х')
        else if (i === 0) c('с')
        else if (n === 'c' && isFront(n2)) {
          c('кс')
          i++ // excelente: the x and the c are one «кс», not «ксс»
        } else c('кс') // always «кс», careful speech as it is spelled: examen, texto, extranjero, taxi
        break
      case 'y':
        if (n !== undefined && isVowel(n)) c('ш') // yo, ayer, playa
        else out.push({ kind: 'v', ch: 'i', accent: false, y: true }) // hoy, muy, Uruguay; the word y
        break
      case 'z':
        c('с')
        break
      case 'ñ':
        c('нь')
        break
      case 'b':
      case 'v':
        if (p !== 'b' && p !== 'v') c('б') // b and v are one sound: bv (obviamente, subvención) is one «б», not «бб»
        break
      case 'w':
        c('у')
        break
      case 'k':
        c('к')
        break
      case 'd':
        c('д')
        break
      case 'f':
        c('ф')
        break
      case 'm':
        c('м')
        break
      case 'n':
        c('н')
        break
      case 'p':
        if (i === 0 && n === 's') break // psicología: said without the p
        c('п')
        break
      case 't':
        c('т')
        break
      default:
        c(ch)
    }
  }
  return out
}

/** The vowel tokens grouped into syllable nuclei: two strong vowels, an accented weak one beside a vowel, or a silent h between them, are separate. Returns token index lists. */
function nuclei(tokens: readonly Token[]): number[][] {
  const groups: number[][] = []
  let current: number[] = []
  const flush = () => {
    if (current.length) groups.push(current)
    current = []
  }
  tokens.forEach((t, k) => {
    if (t.kind !== 'v') {
      flush()
      return
    }
    const prev = current.length ? (tokens[current[current.length - 1]] as VowelToken) : null
    if (prev) {
      const strongBoth = STRONG.includes(prev.ch) && STRONG.includes(t.ch)
      const stressedWeak = (prev.accent && WEAK.includes(prev.ch)) || (t.accent && WEAK.includes(t.ch))
      if (strongBoth || stressedWeak) flush()
    }
    current.push(k)
  })
  flush()
  return groups
}

interface Rendered {
  readonly text: string
  readonly stressed: boolean
}

/** One lower-case word of Spanish letters → its Cyrillic runs, the stressed vowel apart. */
function renderWord(w: string): Rendered[] {
  const tokens = tokenize(w)
  const groups = nuclei(tokens)
  const groupOf = new Map<number, number>()
  groups.forEach((g, gi) => g.forEach((k) => groupOf.set(k, gi)))

  // Which syllable is stressed (none for one syllable).
  let stressGroup = -1
  if (groups.length > 1) {
    const written = groups.findIndex((g) => g.some((k) => (tokens[k] as VowelToken).accent))
    if (written >= 0) stressGroup = written
    else {
      const endsVowel = /[aeiouáéíóúü]$/.test(w)
      const endsNS = w.endsWith('n') || (w.endsWith('s') && isVowel(w[w.length - 2]))
      stressGroup = endsVowel || endsNS ? groups.length - 2 : groups.length - 1
    }
  }
  const stressedToken = (() => {
    if (stressGroup < 0) return -1
    const g = groups[stressGroup]
    const accented = g.find((k) => (tokens[k] as VowelToken).accent)
    if (accented !== undefined) return accented
    const strong = g.find((k) => STRONG.includes((tokens[k] as VowelToken).ch))
    return strong ?? g[g.length - 1]
  })()

  const prevEffective = (k: number): Token | undefined => {
    for (let j = k - 1; j >= 0; j--) if (tokens[j].kind !== 'b') return tokens[j]
    return undefined
  }
  const nextInGroup = (k: number): VowelToken | null => {
    const g = groups[groupOf.get(k)!]
    const at = g.indexOf(k)
    return at >= 0 && at + 1 < g.length ? (tokens[g[at + 1]] as VowelToken) : null
  }
  const prevInGroup = (k: number): VowelToken | null => {
    const g = groups[groupOf.get(k)!]
    const at = g.indexOf(k)
    return at > 0 ? (tokens[g[at - 1]] as VowelToken) : null
  }
  /** A weak i or u that is not the heart of its syllable: it comes before a vowel of the same syllable (ia, ue), or after a strong one (ai, au). */
  const isGlide = (k: number): boolean => {
    const t = tokens[k] as VowelToken
    if (!WEAK.includes(t.ch) || t.accent) return false
    const next = nextInGroup(k)
    const prev = prevInGroup(k)
    if (next) return true // before another vowel of the syllable (for two weak ones the first is the glide)
    return prev !== null && STRONG.includes(prev.ch)
  }

  const out: { cyr: string; stressed: boolean }[] = []
  tokens.forEach((t, k) => {
    if (t.kind === 'b') return
    if (t.kind === 'c') {
      out.push({ cyr: t.cyr, stressed: false })
      return
    }
    const prev = prevEffective(k)
    const prevIsVowel = prev?.kind === 'v'
    const prevIsNy = prev?.kind === 'c' && prev.cyr === 'нь'
    const inSame = prevInGroup(k)
    const next = nextInGroup(k)
    let cyr: string
    switch (t.ch) {
      case 'a': {
        const glideBefore = inSame !== null && inSame.ch === 'i' && isGlide(k - 1)
        cyr = prevIsNy || (glideBefore && prevEffective(k - 1)?.kind === 'c') ? 'я' : 'а' // ia after a consonant is «я» (the i wrote nothing)
        break
      }
      case 'o':
        cyr = 'о'
        break
      case 'e':
        if (inSame && inSame.ch === 'i' && isGlide(k - 1)) cyr = 'е' // ie: «ье» / «йе»
        else if (prevIsNy) cyr = 'е'
        else if (prev === undefined || prevIsVowel) cyr = 'э'
        else cyr = 'е'
        break
      case 'i':
        if (t.y && !next && inSame) cyr = 'й' // hoy, muy, Uruguay: the y closes the syllable
        else if (isGlide(k)) {
          const before = prev
          const afterStrong = inSame !== null && STRONG.includes(inSame.ch)
          if (afterStrong) cyr = 'й'
          else if (prevIsNy) cyr = ''
          else if (before?.kind === 'c') cyr = 'ь' // ia, ie, io, iu after a consonant: «ья ье ьо ью», the vowel after the soft sign is written as after any soft consonant
          else cyr = 'й'
        } else cyr = 'и'
        break
      default: {
        // u
        if (isGlide(k)) cyr = 'у'
        else if (inSame && inSame.ch === 'i' && isGlide(k - 1)) cyr = 'ю' // iu: the i gave the soft sign
        else if (prevIsNy) cyr = 'ю'
        else cyr = 'у'
      }
    }
    // «нь» + и is «ни»
    if (prevIsNy && cyr === 'и') {
      for (let j = out.length - 1; j >= 0; j--) {
        if (out[j].cyr === 'нь') {
          out[j].cyr = 'н'
          break
        }
      }
    }
    out.push({ cyr, stressed: k === stressedToken })
  })
  // an iu (ью) where the i was written «ь» before it: the u gave «ю», fine; two soft signs cannot happen
  const merged: Rendered[] = []
  for (const piece of out) {
    if (piece.cyr === '' && !piece.stressed) continue
    const last = merged[merged.length - 1]
    if (!piece.stressed && last && !last.stressed) merged[merged.length - 1] = { text: last.text + piece.cyr, stressed: false }
    else merged.push({ text: piece.cyr, stressed: piece.stressed })
  }
  return merged
}

// ---- forms: overrides, phrases, capitals ------------------------------------------------------------------------------------------

/** An override value (stress as U+0301) as runs. */
function fromMarked(marked: string): Rendered[] {
  const out: Rendered[] = []
  const cs = Array.from(marked)
  let plain = ''
  const flush = () => {
    if (plain) out.push({ text: plain, stressed: false })
    plain = ''
  }
  for (let i = 0; i < cs.length; i++) {
    if (cs[i + 1] === STRESS) {
      flush()
      out.push({ text: cs[i], stressed: true })
      i++
    } else plain += cs[i]
  }
  flush()
  return out
}

const capitalise = (pieces: Rendered[]): Rendered[] => {
  if (pieces.length === 0 || pieces[0].text === '') return pieces
  const [first, ...rest] = pieces
  return [{ text: first.text[0].toUpperCase() + first.text.slice(1), stressed: first.stressed }, ...rest]
}

const SPANISH_WORD = /^[a-záéíóúüñ]+$/
const ABBREVIATION = /^[A-ZÁÉÍÓÚÑ]{2,}$|\./
const HAS_VOWEL = /[aeiouyáéíóúü]/
const ONE_LETTER_WORDS = 'aeouyáéíóú'

/** One token of a form (a word, no spaces). null when it is not Spanish spelling. */
function transcribeToken(token: string): Rendered[] | null {
  const lower = token.toLowerCase()
  const override = OVERRIDES[lower]
  const startsUpper = token[0] !== token[0].toLowerCase()
  if (override !== undefined) {
    const pieces = fromMarked(override)
    return startsUpper ? capitalise(pieces) : pieces
  }
  if (ABBREVIATION.test(token)) return null // an initialism or an abbreviation has none: OK, ADN, Sr.
  if (!SPANISH_WORD.test(lower)) return null
  if (!HAS_VOWEL.test(lower)) return null // pm, km: an abbreviation in lower case
  if (lower.length === 1 && !ONE_LETTER_WORDS.includes(lower)) return null // a letter of the alphabet (s, i, m, j…) is not a word to read: only a, e, o, u, y are
  const pieces = ADVERB.test(lower) ? renderAdverb(lower) : renderWord(lower)
  return startsUpper ? capitalise(pieces) : pieces
}

/** An adverb in -mente: the adjective it is made from (at least four letters, so mente and demente are not one) and the ending. */
const ADVERB = /^[a-záéíóúüñ]{4,}mente$/

/** An adverb in -mente is said with two stresses: the base word's own (rápida → «ра́пида») and the ending's («ме́нте»): «ра́пидаме́нте». */
function renderAdverb(w: string): Rendered[] {
  return [...renderWord(w.slice(0, -5)), ...renderWord('mente')]
}

/**
 * The transcription of a Spanish form as runs (the stressed vowel apart), or null when it is not something to transcribe: not Spanish spelling (digits, other punctuation), or an
 * abbreviation (OK, ADN, Sr., pm), or a letter of the alphabet (s, i, m…). A phrase is done word by word, the spaces kept; a one-syllable word has no stress mark.
 */
export function transcribe(spanish: string): readonly Piece[] | null {
  const form = spanish.trim()
  if (form === '') return null
  const whole = OVERRIDES[form.toLowerCase()]
  if (whole !== undefined) {
    const pieces = fromMarked(whole)
    return join(form[0] !== form[0].toLowerCase() ? capitalise(pieces) : pieces)
  }
  const parts = form.split(/([ -]+)/)
  const all: Rendered[] = []
  for (const part of parts) {
    if (part === '') continue
    if (/^[ -]+$/.test(part)) {
      all.push({ text: part, stressed: false })
      continue
    }
    const pieces = transcribeToken(part)
    if (pieces === null) return null
    all.push(...pieces)
  }
  return join(all)
}

function join(pieces: Rendered[]): Piece[] {
  const merged: Piece[] = []
  for (const piece of pieces) {
    const last = merged[merged.length - 1]
    if (!piece.stressed && last && !last.stressed) merged[merged.length - 1] = { text: last.text + piece.text, stressed: false }
    else merged.push({ text: piece.text, stressed: piece.stressed })
  }
  return merged
}

/** The transcription as text, the stressed vowel followed by the combining acute (for tests, the review sheet and the overrides file); null as transcribe(). */
export function transcriptionText(spanish: string): string | null {
  const pieces = transcribe(spanish)
  return pieces === null ? null : pieces.map((p) => (p.stressed ? p.text + STRESS : p.text)).join('')
}

/** Why a form is worth a second look (empty for one the rules are sure of). */
export function transcriptionFlags(spanish: string): readonly TranscriptionFlag[] {
  const form = spanish.trim()
  const flags = new Set<TranscriptionFlag>()
  const tokens = form.split(/[ -]+/).filter(Boolean)
  if (tokens.length > 1) flags.add('phrase')
  if (OVERRIDES[form.toLowerCase()] !== undefined || tokens.some((t) => OVERRIDES[t.toLowerCase()] !== undefined)) flags.add('override')
  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (ABBREVIATION.test(token)) flags.add('abbreviation')
    if (!SPANISH_WORD.test(lower)) {
      if (!ABBREVIATION.test(token)) flags.add('foreign')
      continue
    }
    if (/x/.test(lower) && !/mexic|texas|oaxac/.test(lower)) flags.add('x')
    if (ADVERB.test(lower)) flags.add('mente')
    if (/[aeiouáéíóú]h[aeiouáéíóú]/.test(lower)) flags.add('h')
    if (/^ps/.test(lower)) flags.add('ps')
    if (/^hi[aeo]/.test(lower)) flags.add('hie') // hielo, hierro: «йе» or «ше» by speaker
    if (/[kw]|sh|ph|th|ck/.test(lower.replace(/^des(?=h)/, 'des_'))) flags.add('loan')
    if (/[aeiouáéíóú]{3}/.test(lower.replace(/qu(?=[eiéí])|gu(?=[eiéí])/g, (m) => m[0]))) flags.add('triphthong')
  }
  return [...flags]
}
