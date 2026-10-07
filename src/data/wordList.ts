import { searchWords, type MatchVia } from './search'
import type { Word } from './types'
import { hasProgress, wordState, type WordState } from './wordState'
import { compareByRank } from './words'

/** The three lists: words with progress, every word, and the words marked as known (hidden). */
export type Segment = 'learned' | 'all' | 'hidden'
export type StateFilter = 'new' | 'learning' | 'established' | 'due'
export type PosFilter = 'verb' | 'noun' | 'adj' | 'adv'

export interface ListFilters {
  /** One state at a time (tap again to clear). */
  state: StateFilter | null
  favourites: boolean
  /** One part of speech at a time. */
  pos: PosFilter | null
}

/** Everything the Words screen remembers while a word's detail is open. */
export interface ListView {
  segment: Segment
  filters: ListFilters
  query: string
  scrollTop: number
}

/** Holds the list's view between visits to a word's detail (a plain holder: reading and writing it never re-renders anything). */
export function createViewStore() {
  let view: ListView | null = null
  return {
    get: (): ListView | null => view,
    set: (next: ListView) => {
      view = next
    },
  }
}

export const NO_FILTERS: ListFilters = { state: null, favourites: false, pos: null }

/** The first time the list opens: the learned words (buildWordList shows every word instead while nothing has been learned). */
export function initialListView(): ListView {
  return { segment: 'learned', filters: NO_FILTERS, query: '', scrollTop: 0 }
}

export interface ListRow {
  word: Word
  state: WordState
  /** How a search matched, when there is a query. */
  via: MatchVia | null
}

export interface BuiltList {
  rows: ListRow[]
  /** The segment actually shown: "learned" falls back to "all" while nothing has been learned. */
  segment: Segment
  fellBack: boolean
  /** True when a query is overriding the segment. */
  searching: boolean
}

const POS_CODES: Record<PosFilter, readonly string[]> = {
  verb: ['v', 'verb'],
  noun: ['n', 'noun'],
  adj: ['adj', 'adjective'],
  adv: ['adv', 'adverb'],
}

const matchesPos = (word: Word, pos: PosFilter) => POS_CODES[pos].includes(word.pos.toLowerCase())

/** Due words first, then the soonest next review (none last), then the most common. */
function compareLearned(now: Date) {
  const time = (w: Word) => w.nextReview?.getTime() ?? Number.POSITIVE_INFINITY
  const due = (w: Word) => (wordState(w, now) === 'due' ? 0 : 1)
  return (a: Word, b: Word) => due(a) - due(b) || time(a) - time(b) || compareByRank(a, b)
}

/**
 * The rows for a view. Without a query: the segment's words (learned: due first, then soonest next review; all and hidden:
 * most common first), narrowed by the filters. With a query: every word, whatever the segment, ranked by how well it
 * matches (Spanish, Rioplatense form, English and Russian, accent-insensitive, no cap) and narrowed by the same filters.
 */
export function buildWordList(words: readonly Word[], view: Pick<ListView, 'segment' | 'filters' | 'query'>, now: Date): BuiltList {
  const query = view.query.trim()
  const searching = query !== ''
  const anyLearned = words.some((w) => !w.isHidden && hasProgress(w))
  const fellBack = !searching && view.segment === 'learned' && !anyLearned
  const segment: Segment = fellBack ? 'all' : view.segment

  let rows: ListRow[]
  if (searching) {
    rows = searchWords(words, query, Number.POSITIVE_INFINITY, { translations: true }).map((hit) => ({ word: hit.word, state: wordState(hit.word, now), via: hit.via }))
  } else {
    const inSegment = words.filter((w) => (segment === 'hidden' ? w.isHidden : segment === 'learned' ? !w.isHidden && hasProgress(w) : true))
    const sorted = segment === 'learned' ? [...inSegment].sort(compareLearned(now)) : [...inSegment].sort(compareByRank)
    rows = sorted.map((word) => ({ word, state: wordState(word, now), via: null }))
  }

  const { state, favourites, pos } = view.filters
  // In the hidden list every word is "hidden", so a state chip has nothing to say there.
  if (state && segment !== 'hidden') rows = rows.filter((r) => r.state === state)
  if (favourites) rows = rows.filter((r) => r.word.isFavorite)
  if (pos) rows = rows.filter((r) => matchesPos(r.word, pos))

  return { rows, segment, fellBack, searching }
}
