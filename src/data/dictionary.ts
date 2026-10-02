import type { Word } from './types'
import { wordKey } from './words'

const DICTIONARY_URL = '/words_enriched.json'

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toBaseWord(entry: unknown): Word | null {
  if (!entry || typeof entry !== 'object') return null
  const e = entry as Record<string, unknown>

  const esWord = typeof e.es_word === 'string' ? e.es_word.trim() : ''
  const pos = typeof e.pos === 'string' ? e.pos.trim() : ''
  if (!esWord || !pos || typeof e.rank !== 'number' || typeof e.frequency !== 'number') return null

  return Object.freeze({
    esWord,
    esRioplatense: optionalText(e.es_rioplatense),
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

async function fetchDictionary(): Promise<readonly Word[]> {
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
  if (!Array.isArray(raw)) throw new Error('Dictionary is not a JSON array')

  const seen = new Set<string>()
  const words: Word[] = []
  for (const entry of raw) {
    const word = toBaseWord(entry)
    if (!word) continue
    const key = wordKey(word.esWord)
    if (seen.has(key)) continue
    seen.add(key)
    words.push(word)
  }

  if (words.length === 0) throw new Error('Dictionary contained no valid words')
  return Object.freeze(words)
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
