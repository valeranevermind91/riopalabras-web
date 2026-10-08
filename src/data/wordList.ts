import { headword } from './headword'
import { shuffled } from '../lib/random'
import { searchWords, type MatchVia } from './search'
import type { Word } from './types'
import { dueDate, hasProgress, lastReviewedAt, wordState, type WordState } from './wordState'
import { compareByRank, wordKey } from './words'

/** The three lists: every word, the words with progress, and the words marked as known (hidden). */
export type Segment = 'all' | 'learned' | 'hidden'
/** How the list is ordered (a search is always ordered by how well it matches instead). */
export type SortKey = 'frequency' | 'az' | 'due' | 'recent' | 'random'
export type StateFilter = 'new' | 'learning' | 'established' | 'due'
export type PosFilter = 'verb' | 'noun' | 'adj' | 'adv'

export interface ListFilters {
  /** One state at a time (tap again to clear). */
  state: StateFilter | null
  favourites: boolean
  /** Only the words queued for Learn. */
  queued: boolean
  /** One part of speech at a time. */
  pos: PosFilter | null
}

/** Everything the Words screen remembers while a word's detail is open. */
export interface ListView {
  segment: Segment
  sort: SortKey
  /** The shuffle's seed: picked when Random is chosen (again), kept while the screen is in use, so the order never changes by itself. */
  seed: number
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

const NO_KEYS: ReadonlySet<string> = new Set()

export const NO_FILTERS: ListFilters = { state: null, favourites: false, queued: false, pos: null }

/** The first time the list opens: every word, most common first. */
export function initialListView(): ListView {
  return { segment: 'all', sort: 'frequency', seed: 0, filters: NO_FILTERS, query: '', scrollTop: 0 }
}

export interface ListRow {
  word: Word
  state: WordState
  /** How a search matched, when there is a query. */
  via: MatchVia | null
}

export interface BuiltList {
  rows: ListRow[]
  /** True when a query is overriding the segment and the sort. */
  searching: boolean
}

const POS_CODES: Record<PosFilter, readonly string[]> = {
  verb: ['v', 'verb'],
  noun: ['n', 'noun'],
  adj: ['adj', 'adjective'],
  adv: ['adv', 'adverb'],
}

const matchesPos = (word: Word, pos: PosFilter) => POS_CODES[pos].includes(word.pos.toLowerCase())

const collator = new Intl.Collator('es', { sensitivity: 'base' })

/** Earlier first; a word with no time at all goes last; ties by frequency. */
function byTime(time: (w: Word) => number | null, newestFirst: boolean) {
  return (a: Word, b: Word) => {
    const ta = time(a)
    const tb = time(b)
    if (ta === null && tb === null) return compareByRank(a, b)
    if (ta === null) return 1
    if (tb === null) return -1
    return ta === tb ? compareByRank(a, b) : newestFirst ? tb - ta : ta - tb
  }
}

function comparatorFor(sort: SortKey): (a: Word, b: Word) => number {
  switch (sort) {
    case 'az':
      return (a, b) => collator.compare(headword(a).text, headword(b).text) || compareByRank(a, b)
    case 'due':
      return byTime((w) => dueDate(w)?.getTime() ?? null, false)
    case 'recent':
      return byTime((w) => lastReviewedAt(w)?.getTime() ?? null, true)
    default:
      return compareByRank
  }
}

/**
 * The rows for a view. Without a query: the segment's words in the chosen order, narrowed by the filters. With a query:
 * every word, whatever the segment, ranked by how well it matches (Spanish, Rioplatense form, English and Russian,
 * accent-insensitive, no cap) and narrowed by the same filters; the sort does not apply, the match quality does.
 */
export function buildWordList(
  words: readonly Word[],
  view: Pick<ListView, 'segment' | 'filters' | 'query'> & Partial<Pick<ListView, 'sort' | 'seed'>>,
  now: Date,
  /** The wordKey of every word queued for Learn (only needed for the Queued filter). */
  queued: ReadonlySet<string> = NO_KEYS,
): BuiltList {
  const query = view.query.trim()
  const searching = query !== ''
  const segment = view.segment

  let rows: ListRow[]
  if (searching) {
    rows = searchWords(words, query, Number.POSITIVE_INFINITY, { translations: true }).map((hit) => ({ word: hit.word, state: wordState(hit.word, now), via: hit.via }))
  } else {
    const inSegment = (w: Word) => (segment === 'hidden' ? w.isHidden : segment === 'learned' ? !w.isHidden && hasProgress(w) : true)
    // Random shuffles ALL the words once for the seed (from the plain frequency order, so a seed always gives the same
    // order), and the segment and the filters only take words out of that order. A shuffle of the segment itself would
    // be a different shuffle each time the segment changed size; this way a word that leaves the list (brought back from
    // Hidden, un-starred under Favourites) never moves any of the others, and any list is a subsequence of the same order.
    const ordered =
      view.sort === 'random'
        ? shuffled([...words].sort(compareByRank), view.seed ?? 0).filter(inSegment)
        : words.filter(inSegment).sort(comparatorFor(view.sort ?? 'frequency'))
    rows = ordered.map((word) => ({ word, state: wordState(word, now), via: null }))
  }

  const { state, favourites, queued: onlyQueued, pos } = view.filters
  // In the hidden list every word is "hidden", so a state filter has nothing to say there.
  if (state && segment !== 'hidden') rows = rows.filter((r) => r.state === state)
  if (favourites) rows = rows.filter((r) => r.word.isFavorite)
  if (onlyQueued) rows = rows.filter((r) => queued.has(wordKey(r.word.esWord)))
  if (pos) rows = rows.filter((r) => matchesPos(r.word, pos))

  return { rows, searching }
}

/** How many filters are on (a state filter does not count in the hidden list, where it is not offered). */
export function activeFilterCount(filters: ListFilters, segment: Segment, searching = false): number {
  const stateShown = segment !== 'hidden' || searching
  return (filters.state && stateShown ? 1 : 0) + (filters.favourites ? 1 : 0) + (filters.queued ? 1 : 0) + (filters.pos ? 1 : 0)
}
