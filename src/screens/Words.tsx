import { useEffect, useMemo, useRef, useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { UnsavedNotice } from '../components/UnsavedNotice'
import { VirtualList } from '../components/VirtualList'
import { WORD_ROW_HEIGHT, WordRow } from '../components/WordRow'
import { FiltersSheet, SortSheet } from '../components/WordsSheets'
import type { UserData } from '../data/useUserData'
import { NO_FILTERS, activeFilterCount, buildWordList, initialListView, type ListFilters, type ListView, type Segment } from '../data/wordList'
import { hasProgress } from '../data/wordState'
import type { WriteQueue } from '../data/writeQueue'
import { wordKey } from '../data/words'
import { newSeed } from '../lib/random'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

const t = strings.words

const SEGMENTS: readonly Segment[] = ['all', 'learned', 'hidden']

interface WordsScreenProps {
  data: UserData
  queue: WriteQueue
  /** What the screen looked like when it was last left (or null the first time): kept by the app while a word is open. */
  savedView: ListView | null
  onViewChange: (view: ListView) => void
  onOpen: (esWord: string) => void
  /**
   * Lets the screen take Telegram's back button (or the in-page one) while a sheet is open: the handler closes the sheet and
   * returns true; with nothing open it is unregistered and back leaves the screen.
   */
  registerBack?: (handler: (() => boolean) | null) => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
}

/** Browse, search and filter every word. Rendering is windowed; everything is read from memory. */
export function WordsScreen({ data, queue, savedView, onViewChange, onOpen, registerBack, onBack }: WordsScreenProps) {
  const [view, setViewState] = useState<ListView>(() => savedView ?? initialListView())
  const [sheet, setSheet] = useState<'filters' | 'sort' | null>(null)
  const now = useMemo(() => new Date(), [])

  useEffect(() => {
    if (!sheet || !registerBack) return
    registerBack(() => {
      setSheet(null)
      return true
    })
    return () => registerBack(null)
  }, [sheet, registerBack])

  // Every change is built from the latest view, not the one this render saw, so two changes in a row both land.
  const latest = useRef(view)
  const setView = (next: ListView) => {
    latest.current = next
    setViewState(next)
    onViewChange(next)
  }
  // Changing what is listed starts it from the top; scrolling only reports its place.
  const change = (patch: Partial<Pick<ListView, 'segment' | 'sort' | 'seed' | 'filters' | 'query'>>) => setView({ ...latest.current, ...patch, scrollTop: 0 })
  const setFilters = (patch: Partial<ListFilters>) => change({ filters: { ...latest.current.filters, ...patch } })

  const list = useMemo(() => buildWordList(data.words, view, now), [data.words, view.segment, view.sort, view.seed, view.filters, view.query, now]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(
    () => ({
      learned: data.words.filter((w) => !w.isHidden && hasProgress(w)).length,
      all: data.words.length,
      hidden: data.words.filter((w) => w.isHidden).length,
    }),
    [data.words],
  )

  const toggleFavourite = (esWord: string, favourite: boolean) => {
    haptic('select')
    data.applyFavorite([esWord], favourite)
    queue.enqueueFavorite(esWord, favourite)
  }
  const bringBack = (esWord: string) => {
    haptic('tap')
    data.applyHidden([esWord], false)
    queue.enqueueHidden(esWord, false)
  }

  const filterCount = activeFilterCount(view.filters, view.segment, list.searching)
  const anyFilter = view.filters.state || view.filters.favourites || view.filters.pos
  const emptyText = list.rows.length > 0 ? null : list.searching || anyFilter ? t.emptyFiltered : view.segment === 'hidden' ? t.emptyHidden : view.segment === 'learned' ? t.emptyLearned : t.emptyAll
  const listKey = `${view.segment}|${view.sort}|${view.seed}|${view.query}|${view.filters.state}|${view.filters.favourites}|${view.filters.pos}`
  // A search is ordered by how well it matches; the sort comes back when the search is cleared.
  const sortName = list.searching ? t.bestMatch : t.sorts[view.sort]

  return (
    <main className="screen fill words">
      <ScreenHeader title={t.title} onBack={onBack} />

      <input
        type="search"
        className="words-search"
        value={view.query}
        placeholder={t.searchPlaceholder}
        aria-label={t.searchLabel}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => change({ query: e.target.value })}
      />

      <div className="segmented" role="group" aria-label={t.segmentsLabel}>
        {SEGMENTS.map((segment) => (
          <button
            key={segment}
            type="button"
            className={!list.searching && view.segment === segment ? 'segment is-active' : 'segment'}
            aria-pressed={!list.searching && view.segment === segment}
            onClick={() => change(segment === 'hidden' ? { segment, filters: { ...latest.current.filters, state: null } } : { segment })}
          >
            {t.segments[segment]} <span className="segment-count">{counts[segment]}</span>
          </button>
        ))}
      </div>

      <div className="words-controls">
        <button type="button" className={filterCount > 0 ? 'control-btn is-active' : 'control-btn'} aria-haspopup="dialog" onClick={() => setSheet('filters')}>
          {t.filtersButton}
          {filterCount > 0 && (
            <span className="control-count" aria-label={t.filtersActive(filterCount)}>
              {filterCount}
            </span>
          )}
        </button>
        <button type="button" className="control-btn" aria-haspopup="dialog" disabled={list.searching} onClick={() => setSheet('sort')}>
          {t.sortButton(sortName)}
        </button>
      </div>

      <UnsavedNotice queue={queue} />
      {list.searching && <p className="words-note">{t.count(list.rows.length)}</p>}

      {emptyText ? (
        <p className="words-empty">{emptyText}</p>
      ) : (
        <VirtualList
          key={listKey}
          label={t.title}
          count={list.rows.length}
          rowHeight={WORD_ROW_HEIGHT}
          initialScrollTop={view.scrollTop}
          onScrollTop={(top) => {
            latest.current = { ...latest.current, scrollTop: top }
            onViewChange(latest.current)
          }}
          getKey={(i) => wordKey(list.rows[i].word.esWord)}
          renderRow={(i) => <WordRow row={list.rows[i]} settings={data.settings} onOpen={onOpen} onToggleFavourite={toggleFavourite} onBringBack={bringBack} />}
        />
      )}

      {sheet === 'filters' && (
        <FiltersSheet filters={view.filters} segment={view.segment} searching={list.searching} onChange={setFilters} onClearAll={() => change({ filters: NO_FILTERS })} onClose={() => setSheet(null)} />
      )}
      {sheet === 'sort' && (
        <SortSheet
          sort={view.sort}
          onSelect={(sort) => {
            // Random is a fresh shuffle every time it is chosen, including when it is already the order; the others just apply.
            change(sort === 'random' ? { sort, seed: newSeed() } : { sort })
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </main>
  )
}
