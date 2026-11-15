// Scratch tooling for the grammatical-gender study. NOT wired into the app; nothing here is imported by src/.
// Signals for a noun: (1) the article right before the word in the example the card shows, (2) a suffix rule, (3) one model pass (gemini.mjs).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const OUT_DIR = path.join(ROOT, 'tools', 'gender', 'out')

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'))

export const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
export const strip = (s) => (s ?? '').replace(/\*+/g, '')

// ------------------------------------------------------------------ data

export function loadData() {
  const words = readJson('public/words_enriched.json').sort((a, b) => a.rank - b.rank)
  const overlay = new Map(readJson('public/rio_overlay.json').map((e) => [e.es_word.trim().toLowerCase(), e]))
  const fallback = new Map(readJson('public/examples_fallback.json').map((e) => [e.es_word.trim().toLowerCase(), e]))
  return { words, overlay, fallback }
}

const CLEAN_VARIANT = /^[\p{L}\p{M}-]+(?: [\p{L}\p{M}-]+){0,2}$/u

/**
 * What the card shows for a word, the way src/data/headword.ts decides it (re-implemented here, simplified): the Rioplatense form leads when the overlay says
 * "replacement", the form is clean and different, and the example the card shows contains it. Returns the displayed headword and the example behind it.
 */
export function displayed(word, { overlay, fallback }) {
  const key = word.es_word.trim().toLowerCase()
  const rio = overlay.get(key)
  const fb = fallback.get(key)
  const dict = { sentence: strip(word.example_sentence), form: word.word_form_in_example?.trim() || null, en: word.example_translation_en, ru: word.example_translation_ru, source: 'dictionary' }
  const ex = rio?.example ? { sentence: strip(rio.example.es), form: rio.example.word_form, en: rio.example.en, ru: rio.example.ru, source: 'overlay' }
    : fb ? { sentence: strip(fb.es), form: fb.word_form, en: fb.en, ru: fb.ru, source: 'fallback' } : dict
  let headword = word.es_word
  let switched = false
  if (rio && rio.rio_type === 'replacement' && CLEAN_VARIANT.test(rio.rio_form.trim()) && rio.rio_form.trim().toLowerCase() !== key) {
    const re = new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])${rio.rio_form.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu')
    if (re.test(ex.sentence)) { headword = rio.rio_form.trim(); switched = true }
  }
  return { headword, switched, standard: word.es_word, example: ex, overlay: rio ?? null }
}

// ------------------------------------------------------------------ signal 1: the article in the example

const MASC = new Set(['el', 'un', 'los', 'unos', 'del', 'al'])
const FEM = new Set(['la', 'una', 'las', 'unas'])
const PLURAL_ART = new Set(['los', 'unos', 'las', 'unas'])
const tokens = (sentence) => sentence.split(/([^\p{L}\p{M}\p{N}]+)/u).filter((t) => t !== '')
const isWord = (t) => /[\p{L}\p{N}]/u.test(t)

/** Does the example's word look like the headword (itself or its plural / an accent variant), rather than another word? */
export function sameWord(form, head) {
  if (!form) return false
  const a = fold(form), b = fold(head)
  if (a === b) return true
  for (const suffix of ['s', 'es']) if (a === b + suffix) return true
  if (b.endsWith('z') && a === b.slice(0, -1) + 'ces') return true
  if (b.endsWith('n') && a === b + 'es') return true
  if (a.length >= 4 && b.length >= 4 && a.startsWith(b.slice(0, -1)) && Math.abs(a.length - b.length) <= 2) return true
  return false
}

/** {article, gender: 'm'|'f'|null, plural, distance: 0 (direct) | 1 (one word between), sameWord} from the example. */
export function articleSignal(example, head) {
  const none = { article: null, gender: null, plural: false, distance: null, sameWord: false, form: example.form }
  if (!example.form) return none
  const toks = tokens(example.sentence)
  const formToks = tokens(example.form).filter(isWord).map(fold)
  if (!formToks.length) return none
  const words = toks.map((t, i) => ({ t, i })).filter((x) => isWord(x.t))
  const at = words.findIndex((w, k) => formToks.every((f, j) => words[k + j] && fold(words[k + j].t) === f))
  if (at < 0) return { ...none, sameWord: sameWord(example.form, head) }
  const same = sameWord(example.form, head)
  for (const distance of [0, 1]) {
    const prev = words[at - 1 - distance]
    if (!prev) break
    const p = fold(prev.t)
    const gender = MASC.has(p) ? 'm' : FEM.has(p) ? 'f' : null
    if (gender) return { article: prev.t.toLowerCase(), gender, plural: PLURAL_ART.has(p), distance, sameWord: same, form: example.form }
    if (distance === 0 && !/^(muy|mas|tan|buen|mal|gran|primer|ultim|mism|otr|tod|cada|su|mi|tu|nuestr|vuestr|esta|este|ese|esa|aquel|aquella|algun|ningun|cierto|cierta|mucho|poco|tanto|medio)/.test(p) && p.length > 3) break
  }
  return { ...none, sameWord: same }
}

// ------------------------------------------------------------------ signal 2: the suffix rule

/** {gender: 'm'|'f'|'mf'|null, rule}. Deliberately plain: the usual textbook endings, no exception lists, so its mistakes show what the other signals have to catch. */
export function suffixSignal(word) {
  const w = fold(word)
  const rules = [
    [/(cion|sion|xion|gion)$/, 'f', '-ción/-sión/-xión/-gión'],
    [/(dad|tad|tud|umbre)$/, 'f', '-dad/-tad/-tud/-umbre'],
    [/(itis|ez|ie)$/, 'f', '-itis/-ez/-ie'],
    [/ura$/, 'f', '-ura'],
    [/(ista)$/, 'mf', '-ista'],
    [/(aje|or|an)$|[^i]on$/, 'm', '-aje/-or/-án/-ón (not -ión)'],
    [/ma$/, null, '-ma (Greek -ma are m, others f)'],
    [/a$/, 'f', '-a'],
    [/o$/, 'm', '-o'],
  ]
  for (const [re, gender, rule] of rules) if (re.test(w)) return gender === null ? { gender: null, rule } : { gender, rule }
  return { gender: null, rule: null }
}

// ------------------------------------------------------------------ the noun classes used to build the sample

export const KNOWN = {
  stressedA: ['agua', 'águila', 'hambre', 'alma', 'arma', 'área', 'hacha', 'ala', 'alba', 'acta', 'alza', 'ave', 'hada', 'aula', 'ancla', 'ansia', 'arpa', 'asma', 'hampa', 'aspa', 'álgebra', 'haya', 'ama', 'habla', 'asa', 'ascua'],
  senseDependent: ['capital', 'orden', 'corte', 'cura', 'frente', 'guía', 'policía', 'cometa', 'coma', 'radio', 'parte', 'final', 'editorial', 'margen', 'clave', 'banda', 'pico',
    'pendiente', 'cólera', 'mar', 'vocal', 'terminal', 'papa', 'mañana', 'cabeza', 'moral', 'lente', 'tema', 'trompa', 'llama', 'pie', 'fantasma', 'modelo', 'cuarta', 'barrio', 'génesis', 'pez', 'vela', 'cargo', 'canal', 'cometa', 'tarde', 'cuenta', 'mono', 'turno', 'bolsa', 'caso', 'ciencia', 'flor', 'ladrón', 'doblez', 'finanza', 'pila', 'frente', 'vista'],
  oddRows: ['te', 'mía', 'rica', 'gordo', 'gracias', 'adiós', 'mi', 'tuya', 'cuarta'],
}

const REGEX_ISTA_ANTE_ENTE = /(ista|ante|ente)$/

const mulberry32 = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
export const shuffled = (arr, seed) => { const rnd = mulberry32(seed); const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

/** Rows that carry a non-noun meaning though tagged "n": a heuristic for the "mis-tagged / odd" stratum. */
export function looksOdd(word) {
  const w = fold(word.es_word), en = (word.en_translation ?? '').toLowerCase()
  return KNOWN.oddRows.map(fold).includes(w) || /^to [a-z]/.test(en) || /mente$/.test(w) || /(ar|er|ir)$/.test(w) && /^to /.test(en) || /^(my|your|his|her|our|thank|hello|please)\b/.test(en) || /\b(and|or)$/.test(en)
}

export function buildSample(data, { seed = 2026 } = {}) {
  const { words } = data
  const nouns = words.filter((w) => w.pos === 'n')
  const byWord = new Map(nouns.map((w) => [w.es_word.trim().toLowerCase(), w]))
  const chosen = new Map() // key -> { word, strata: [] }
  const take = (w, stratum) => { const k = w.es_word.trim().toLowerCase(); if (!chosen.has(k)) chosen.set(k, { word: w, strata: [] }); const c = chosen.get(k); if (!c.strata.includes(stratum)) c.strata.push(stratum); return c }
  const known = (list) => list.map((x) => byWord.get(x.toLowerCase())).filter(Boolean)
  const fill = (candidates, n, stratum) => { let got = 0; for (const w of candidates) { if (got >= n) break; const k = w.es_word.trim().toLowerCase(); if (chosen.has(k)) continue; take(w, stratum); got++ } return got }
  const counts = {}

  const top = shuffled(nouns.filter((w) => w.rank <= 1500), seed)
  counts.random_top1500 = fill(top, 100, 'random top-1500')
  counts.stressed_a = fill([...known(KNOWN.stressedA)], 15, 'stressed-a')
  counts.ista_ante_ente = fill(shuffled(nouns.filter((w) => REGEX_ISTA_ANTE_ENTE.test(fold(w.es_word)) && w.es_word.length > 4), seed + 1), 15, '-ista/-ante/-ente')
  counts.sense_dependent = fill(known(KNOWN.senseDependent), 15, 'sense-dependent')
  const sNouns = nouns.filter((w) => w.es_word.endsWith('s') && w.es_word.length > 4 && !byWord.has(w.es_word.slice(0, -1).toLowerCase()) && !byWord.has(w.es_word.slice(0, -2).toLowerCase()))
  counts.plural_or_s = fill(shuffled(sNouns, seed + 2), 10, 'plural-only / -s')
  const overlayNouns = nouns.filter((w) => { const d = displayed(w, data); return d.overlay && d.switched })
  counts.overlay_displayed = fill(shuffled(overlayNouns, seed + 3), 15, 'overlay (displayed form)')
  counts.odd = fill(nouns.filter(looksOdd), 10, 'mis-tagged / odd')
  // the article/suffix disagreements, as many as the 200 allow
  const disagreements = nouns.filter((w) => {
    const d = displayed(w, data)
    const a = articleSignal(d.example, d.headword), s = suffixSignal(d.headword)
    return a.gender && a.sameWord && a.distance === 0 && s.gender && s.gender !== 'mf' && a.gender !== s.gender
  })
  counts.disagreements_available = disagreements.length
  counts.disagreements = fill(shuffled(disagreements, seed + 4), 200 - chosen.size, 'article vs suffix disagree')
  // anything still short (overlaps freed slots): more random nouns
  counts.topup = fill(shuffled(nouns.filter((w) => w.rank > 1500), seed + 5), 200 - chosen.size, 'random top-up')
  return { items: [...chosen.values()], counts, disagreementsTotal: disagreements.length }
}
