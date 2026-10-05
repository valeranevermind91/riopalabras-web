import { headword, highlightTarget, type HighlightRange } from './headword'
import type { MetricsRecorder } from './metrics'
import { streakPatch } from './daily'
import { translationsFor } from './relation'
import { firstGloss } from './rio'
import { shuffle } from './review'
import type { SettingsPatch, UserSettings, Word } from './types'
import { hasTranslations, isReviewablePos, wordKey } from './words'
import type { WriteQueue } from './writeQueue'

// Matching and Cloze: reinforcement practice. Nothing here touches SM-2, the daily new-word limit
// or the Review queue; a finished group or session only updates the streak and marks the day active.

/** Both exercises need at least this many eligible words. */
export const PRACTICE_MIN_WORDS = 5

const EXCLUDED_POS = new Set(['letter', 'interj'])

const norm = (s: string) => s.trim().toLowerCase()

/** The words practice draws from: learned, and the same gates Review uses (visible, enriched, reviewable, translated); never letters or interjections. */
export function isPracticeWord(word: Word): boolean {
  return (
    !word.isHidden &&
    word.repetitions > 0 &&
    word.isEnriched &&
    isReviewablePos(word.pos) &&
    !EXCLUDED_POS.has(norm(word.pos)) &&
    hasTranslations(word)
  )
}

/** Display-only: drops everything from the first "(" on ("эмпанада (вид пирожка)" → "эмпанада"). */
export function stripParenthetical(text: string): string {
  const i = text.indexOf('(')
  return (i === -1 ? text : text.slice(0, i)).trim()
}

/** Keeps the first of each headword; two cards leading with the same word would be indistinguishable. */
function uniqueByHeadword<T>(items: readonly T[], headOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = norm(headOf(item))
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

// ------------------------------------------------------------------------------------------------ Matching

export const MATCH_GROUP_SIZE = 5
export const WRONG_FLASH_MS = 500

export interface MatchItem {
  /** Pairs are matched by this id, never by the displayed text. */
  readonly id: string
  /** The Spanish headword, by the same rule as Learn and Review. */
  readonly spanish: string
  /** The first Russian gloss (parenthetical dropped). */
  readonly gloss: string
}

/** Collisions are judged on this: lower case, ё = е, accents ignored, punctuation and spacing ignored. */
export function glossKey(gloss: string): string {
  return gloss
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The first Russian gloss of the word as the card shows it (overlay translation included), without parentheticals. */
export function firstRussianGloss(word: Word): string {
  const full = translationsFor(word).ru
  const first = firstGloss(full)
  return stripParenthetical(first) || first.trim()
}

export function matchItem(word: Word): MatchItem {
  return { id: wordKey(word.esWord), spanish: headword(word).text, gloss: firstRussianGloss(word) }
}

/** Everything a group can be drawn from, in dictionary order: practice words with a usable gloss. */
export function matchingPool(words: readonly Word[]): MatchItem[] {
  return words.filter(isPracticeWord).map(matchItem).filter((m) => glossKey(m.gloss) !== '')
}

/** Greedy pick of non-colliding items (no shared gloss key, no shared headword) in the given order, up to `limit`. */
function pickNonColliding(items: readonly MatchItem[], limit: number): MatchItem[] {
  const glosses = new Set<string>()
  const heads = new Set<string>()
  const picked: MatchItem[] = []
  for (const item of items) {
    const g = glossKey(item.gloss)
    const h = norm(item.spanish)
    if (glosses.has(g) || heads.has(h)) continue
    glosses.add(g)
    heads.add(h)
    picked.push(item)
    if (picked.length >= limit) break
  }
  return picked
}

/**
 * How many words a group could really use: eligible words, counted so that none shares a first
 * gloss or a headword with another one counted. Home enables Matching at PRACTICE_MIN_WORDS of these,
 * so a group can always be built when the button is enabled.
 */
export function matchingEligibleCount(words: readonly Word[]): number {
  return pickNonColliding(matchingPool(words), Number.POSITIVE_INFINITY).length
}

export interface MatchGroup {
  readonly items: readonly MatchItem[]
  /** Spanish column order. */
  readonly left: readonly MatchItem[]
  /** Russian column order (shuffled separately). */
  readonly right: readonly MatchItem[]
}

/** MATCH_GROUP_SIZE random eligible words with pairwise different first glosses; null when there are not enough. Repeats across groups are fine. */
export function buildMatchingGroup(words: readonly Word[], random: () => number = Math.random): MatchGroup | null {
  const items = pickNonColliding(shuffle(matchingPool(words), random), MATCH_GROUP_SIZE)
  if (items.length < MATCH_GROUP_SIZE) return null
  return { items, left: shuffle(items, random), right: shuffle(items, random) }
}

export type MatchSide = 'left' | 'right'

export interface MatchingState {
  readonly left: readonly MatchItem[]
  readonly right: readonly MatchItem[]
  readonly matched: ReadonlySet<string>
  readonly selectedLeft: string | null
  readonly selectedRight: string | null
  /** A wrong pair is flashing: taps are ignored until clearWrong(). */
  readonly wrong: boolean
}

export function startMatching(group: MatchGroup): MatchingState {
  return { left: group.left, right: group.right, matched: new Set(), selectedLeft: null, selectedRight: null, wrong: false }
}

/** One tap. A correct pair locks; a wrong pair sets `wrong` (the caller clears it after WRONG_FLASH_MS); nothing is ever counted. */
export function tapTile(state: MatchingState, side: MatchSide, id: string): MatchingState {
  if (state.wrong || state.matched.has(id)) return state

  const key = side === 'left' ? 'selectedLeft' : 'selectedRight'
  const next = { ...state, [key]: state[key] === id ? null : id }
  if (next.selectedLeft === null || next.selectedRight === null) return next

  if (next.selectedLeft === next.selectedRight) {
    return { ...next, matched: new Set([...state.matched, next.selectedLeft]), selectedLeft: null, selectedRight: null }
  }
  return { ...next, wrong: true }
}

/** tapTile, plus: `onComplete` runs exactly once, on the tap that locks the last pair of the group. */
export function tapAndFinish(state: MatchingState, side: MatchSide, id: string, onComplete: () => void): MatchingState {
  const next = tapTile(state, side, id)
  if (isMatchingComplete(next) && !isMatchingComplete(state)) onComplete()
  return next
}

export function clearWrong(state: MatchingState): MatchingState {
  return state.wrong ? { ...state, wrong: false, selectedLeft: null, selectedRight: null } : state
}

export function isMatchingComplete(state: MatchingState): boolean {
  return state.left.length > 0 && state.matched.size === state.left.length
}

// ------------------------------------------------------------------------------------------------ Cloze

export const CLOZE_SESSION_SIZE = 10
/** Every blank is exactly this, whatever the length of the answer. */
export const CLOZE_BLANK = '_____'
const MIN_TARGET_LENGTH = 3

export interface ClozeTarget {
  /** The example sentence as the card shows it. */
  readonly sentence: string
  /** The form to type, exactly as it appears in the sentence. */
  readonly target: string
  /** Every occurrence of the target in the sentence. */
  readonly spans: readonly HighlightRange[]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Every whole-word, case-insensitive occurrence of `target` in `sentence`. No lookbehind (older iOS WebViews reject it). */
export function findAllOccurrences(sentence: string, target: string): HighlightRange[] {
  const re = new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])(${escapeRegExp(target)})(?![\\p{L}\\p{M}\\p{N}])`, 'giu')
  const spans: HighlightRange[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(sentence)) !== null) {
    const start = m.index + m[1].length
    spans.push({ start, end: start + m[2].length })
    re.lastIndex = start + m[2].length
  }
  return spans
}

/**
 * The blank for a word: the form the card highlights in its example, provided it is one word of
 * 3+ characters. Null when there is no sentence, no locatable form, a multi-word form (con vos,
 * control remoto) or a form that is too short.
 */
export function clozeTarget(word: Word): ClozeTarget | null {
  const { sentence, range } = highlightTarget(word)
  if (!range) return null
  const target = sentence.slice(range.start, range.end)
  if (/\s/.test(target) || [...target].length < MIN_TARGET_LENGTH) return null
  const spans = findAllOccurrences(sentence, target)
  if (spans.length === 0) return null
  return { sentence, target, spans }
}

/** The sentence with every occurrence of the target replaced by the fixed-length blank. */
export function blankSentence(sentence: string, spans: readonly HighlightRange[], blank: string = CLOZE_BLANK): string {
  let out = ''
  let cursor = 0
  for (const { start, end } of spans) {
    out += sentence.slice(cursor, start) + blank
    cursor = end
  }
  return out + sentence.slice(cursor)
}

export interface SentencePart {
  readonly text: string
  /** True for an occurrence of the target (shown highlighted once the answer is revealed). */
  readonly target: boolean
}

export function splitSentence(sentence: string, spans: readonly HighlightRange[]): SentencePart[] {
  const parts: SentencePart[] = []
  let cursor = 0
  for (const { start, end } of spans) {
    if (start > cursor) parts.push({ text: sentence.slice(cursor, start), target: false })
    parts.push({ text: sentence.slice(start, end), target: true })
    cursor = end
  }
  if (cursor < sentence.length) parts.push({ text: sentence.slice(cursor), target: false })
  return parts
}

export interface ClozeItem {
  readonly word: Word
  readonly target: ClozeTarget
  /** The card's headword: also accepted as an answer. */
  readonly headword: string
}

/** Learned practice words that have a usable blank, one per headword. */
export function clozePool(words: readonly Word[]): ClozeItem[] {
  const items: ClozeItem[] = []
  for (const word of words) {
    if (!isPracticeWord(word)) continue
    const target = clozeTarget(word)
    if (target) items.push({ word, target, headword: headword(word).text })
  }
  return uniqueByHeadword(items, (i) => i.headword)
}

export function clozeEligibleCount(words: readonly Word[]): number {
  return clozePool(words).length
}

/** Up to CLOZE_SESSION_SIZE random questions; null below PRACTICE_MIN_WORDS eligible words. */
export function buildClozeSession(words: readonly Word[], random: () => number = Math.random): ClozeItem[] | null {
  const pool = clozePool(words)
  if (pool.length < PRACTICE_MIN_WORDS) return null
  return shuffle(pool, random).slice(0, CLOZE_SESSION_SIZE)
}

// "ñ" is deliberately absent: it is a letter of its own (caña ≠ cana, año ≠ ano), not an accented n.
const DIACRITICS: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u' }

export function foldAccents(text: string): string {
  return [...text.normalize('NFC')].map((c) => DIACRITICS[c] ?? c).join('')
}

const canon = (s: string) => s.normalize('NFC').trim().toLowerCase()

export type ClozeKind = 'exact' | 'accent' | 'headword' | 'wrong'

export interface ClozeVerdict {
  /** Exact and accent-only answers are correct; so is the headword when it differs from the sentence form. */
  readonly outcome: 'correct' | 'wrong'
  /**
   * exact: the sentence form. accent: the sentence form with a missing or extra accent (nudge
   * with `target`). headword: the dictionary headword, typed instead of the inflected form (nudge
   * "in this sentence: <target>").
   */
  readonly kind: ClozeKind
}

/**
 * Trimmed and case-insensitive. Accepts the form in the sentence and the headword; a missing or
 * extra accent is still correct (the screen nudges); ñ is never folded to n.
 */
export function checkClozeAnswer({ typed, target, headword: head }: { typed: string; target: string; headword: string }): ClozeVerdict {
  const t = canon(typed)
  if (t === '') return { outcome: 'wrong', kind: 'wrong' }
  const form = canon(target)
  const headForm = canon(head)
  const headwordDiffers = headForm !== form

  if (t === form) return { outcome: 'correct', kind: 'exact' }
  if (headwordDiffers && t === headForm) return { outcome: 'correct', kind: 'headword' }
  if (foldAccents(t) === foldAccents(form)) return { outcome: 'correct', kind: 'accent' }
  if (headwordDiffers && foldAccents(t) === foldAccents(headForm)) return { outcome: 'correct', kind: 'headword' }
  return { outcome: 'wrong', kind: 'wrong' }
}

/** First letter, then one asterisk per remaining character. */
export function buildHint(target: string): string {
  const chars = [...target]
  return chars.length === 0 ? '' : chars[0] + '*'.repeat(chars.length - 1)
}

export interface CueLine {
  readonly label: 'RU' | 'EN'
  readonly text: string
}

/** The gloss line(s) under the sentence, RU first, per the translation settings; falls back to whichever language has text. */
export function clozeCueLines(word: Word, settings: Pick<UserSettings, 'showRuTranslation' | 'showEnTranslation'>): CueLine[] {
  const t = translationsFor(word)
  const ru = stripParenthetical(t.ru)
  const en = stripParenthetical(t.en)
  const lines: CueLine[] = []
  if (settings.showRuTranslation && ru) lines.push({ label: 'RU', text: ru })
  if (settings.showEnTranslation && en) lines.push({ label: 'EN', text: en })
  if (lines.length > 0) return lines
  if (ru) return [{ label: 'RU', text: ru }]
  if (en) return [{ label: 'EN', text: en }]
  return []
}

export type ClozeOutcome = 'correct' | 'wrong' | 'gaveUp'

export function clozeScore(outcomes: readonly ClozeOutcome[]): number {
  return outcomes.filter((o) => o === 'correct').length
}

export interface ClozeProgress {
  readonly index: number
  readonly results: readonly ClozeOutcome[]
  readonly done: boolean
}

export const startCloze = (): ClozeProgress => ({ index: 0, results: [], done: false })

/** Records one answered question and moves on; `onComplete` runs exactly once, when the last question is answered. A finished session ignores further answers. */
export function answerCloze(progress: ClozeProgress, total: number, outcome: ClozeOutcome, onComplete: () => void): ClozeProgress {
  if (progress.done) return progress
  const results = [...progress.results, outcome]
  if (progress.index >= total - 1) {
    onComplete()
    return { index: progress.index, results, done: true }
  }
  return { index: progress.index + 1, results, done: false }
}

// ------------------------------------------------------------------------------------------------ Finishing

export interface PracticeFinishDeps {
  getSettings: () => UserSettings
  /** Optimistic: mirror the streak into the in-memory settings. */
  applySettings: (patch: SettingsPatch) => void
  queue: Pick<WriteQueue, 'enqueueSettings'>
  metrics: Pick<MetricsRecorder, 'markActiveToday'> | null
}

/**
 * A finished Matching group or Cloze session, and only that: the streak (a settings write, only
 * when the day's streak actually changes) through the write queue, and today's metrics row marked
 * active. Called once per finished group or session, never per item.
 */
export function recordPracticeCompleted(deps: PracticeFinishDeps, now: Date = new Date()): void {
  const patch = streakPatch(deps.getSettings(), now)
  if (patch) {
    deps.applySettings(patch)
    deps.queue.enqueueSettings(patch)
  }
  deps.metrics?.markActiveToday(now)
}
