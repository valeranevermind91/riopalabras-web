import { parseFallbackExamples, parseRioOverlay, type RioExample, type RioInfo } from './rio'
import type { Word } from './types'
import { wordKey } from './words'

const DICTIONARY_URL = '/words_enriched.json'
const RIO_OVERLAY_URL = '/rio_overlay.json'
const FALLBACK_EXAMPLES_URL = '/examples_fallback.json'

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toBaseWord(entry: unknown, rio: ReadonlyMap<string, RioInfo> | null, fallback: ReadonlyMap<string, RioExample> | null): Word | null {
  if (!entry || typeof entry !== 'object') return null
  const e = entry as Record<string, unknown>

  const esWord = typeof e.es_word === 'string' ? e.es_word.trim() : ''
  const pos = typeof e.pos === 'string' ? e.pos.trim() : ''
  if (!esWord || !pos || typeof e.rank !== 'number' || typeof e.frequency !== 'number') return null

  return Object.freeze({
    esWord,
    // With the typed overlay loaded, it replaces the legacy free-text field for every dictionary word.
    esRioplatense: rio ? null : optionalText(e.es_rioplatense),
    rio: rio?.get(wordKey(esWord)) ?? null,
    fallbackExample: fallback?.get(wordKey(esWord)) ?? null,
    enTranslation: text(e.en_translation),
    ruTranslation: text(e.ru_translation),
    exampleSentence: text(e.example_sentence),
    exampleTranslationEn: text(e.example_translation_en),
    exampleTranslationRu: text(e.example_translation_ru),
    wordFormInExample: optionalText(e.word_form_in_example),
    isRioplatenseVariant: e.is_rioplatense_variant === true,
    pos,
    frequency: e.frequency,
    rank: e.rank,
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: null,
    isFavorite: false,
    isHidden: false,
    isCustom: false,
    isEnriched: true,
  })
}

/**
 * Validates the raw JSON array and returns frozen base words, skipping malformed and duplicate entries.
 * `rio` is the parsed Rioplatense overlay; without it (null: it failed to load) the legacy es_rioplatense field is kept.
 * `fallback` holds the neutral replacement examples (pass 3); without it the dictionary examples stay as they are.
 */
export function parseDictionary(
  raw: unknown,
  rio: ReadonlyMap<string, RioInfo> | null = null,
  fallback: ReadonlyMap<string, RioExample> | null = null,
): readonly Word[] {
  if (!Array.isArray(raw)) throw new Error('Dictionary is not a JSON array')

  const seen = new Set<string>()
  const words: Word[] = []
  for (const entry of raw) {
    const word = toBaseWord(entry, rio, fallback)
    if (!word) continue
    const key = wordKey(word.esWord)
    if (seen.has(key)) continue
    seen.add(key)
    words.push(word)
  }

  if (words.length === 0) throw new Error('Dictionary contained no valid words')
  return Object.freeze(words)
}

async function fetchRawDictionary(): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(DICTIONARY_URL)
  } catch {
    throw new Error('Could not download the dictionary (network error)')
  }
  if (!res.ok) throw new Error(`Dictionary download failed (HTTP ${res.status})`)

  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    throw new Error(`${DICTIONARY_URL} did not return JSON — is it deployed in public/?`)
  }
  return raw
}

/** Never throws: if the overlay can't be loaded the app runs on the legacy field instead. */
async function fetchRioOverlay(): Promise<ReadonlyMap<string, RioInfo> | null> {
  try {
    const res = await fetch(RIO_OVERLAY_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return parseRioOverlay(await res.json())
  } catch (err) {
    console.warn('Rioplatense overlay unavailable, using the legacy field:', err)
    return null
  }
}

/** Never throws: without the file every word keeps its dictionary example. */
async function fetchFallbackExamples(): Promise<ReadonlyMap<string, RioExample> | null> {
  try {
    const res = await fetch(FALLBACK_EXAMPLES_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return parseFallbackExamples(await res.json())
  } catch (err) {
    console.warn('Fallback examples unavailable, keeping the dictionary examples:', err)
    return null
  }
}

async function fetchDictionary(): Promise<readonly Word[]> {
  const [raw, rio, fallback] = await Promise.all([fetchRawDictionary(), fetchRioOverlay(), fetchFallbackExamples()])
  return parseDictionary(raw, rio, fallback)
}

// One download per page load; callers (prefetch + consumer) share the same promise.
let pending: Promise<readonly Word[]> | null = null

export function loadDictionary(): Promise<readonly Word[]> {
  if (!pending) {
    pending = fetchDictionary().catch((err) => {
      pending = null
      throw err
    })
  }
  return pending
}
