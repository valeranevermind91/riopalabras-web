import { useEffect, useMemo, useRef, useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { WordForm, type SubmitResult } from '../components/WordForm'
import { UnsavedNotice } from '../components/UnsavedNotice'
import { VirtualList } from '../components/VirtualList'
import { LEARN_SOONER_HINT_ID, WORD_ROW_HEIGHT, WordRow } from '../components/WordRow'
import { FiltersSheet, SortSheet } from '../components/WordsSheets'
import { blankValues } from '../data/customWords'
import type { UserData } from '../data/useUserData'
import { addCustomWord } from '../data/customWords'
import { noEnrichment, type EnrichResult } from '../data/enrich'
import { canStar } from '../data/starred'
import { NO_FILTERS, activeFilterCount, buildWordList, initialListView, type ListFilters, type ListView, type Segment } from '../data/wordList'
import { wordStatus } from '../data/wordState'
import type { WriteQueue } from '../data/writeQueue'
import { wordKey } from '../data/words'
import { newSeed } from '../lib/random'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

const t = strings.words

/** How long "Added, and set to learn sooner." stays: long enough to read, short enough not to still be there when the list has moved on. */
export const NOTICE_MS = 6000

const SEGMENTS: readonly Segment[] = ['all', 'started', 'hidden']

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
  /** Fills in a typed word's translations (the proxy's /enrich). Without it every word is typed by hand. */
  enrich?: (input: { word: string; pos: string | null }) => Promise<EnrichResult>
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
}

/** Browse, search and filter every word. Rendering is windowed; everything is read from memory. */
export function WordsScreen({ data, queue, savedView, onViewChange, onOpen, registerBack, enrich = noEnrichment, onBack }: WordsScreenProps) {
  const [view, setViewState] = useState<ListView>(() => savedView ?? initialListView())
  const [sheet, setSheet] = useState<'filters' | 'sort' | null>(null)
  // The add-a-word form takes the screen; it handles Back itself (and asks before throwing away what was typed).
  const [adding, setAdding] = useState(false)
  // What the last thing done said ("Added, and set to learn sooner."), until the list is changed.
  const [notice, setNotice] = useState<string | null>(null)
  // The note is a confirmation, not state: it goes by itself after NOTICE_MS (or at once when the list is changed, below).
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])
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
  const change = (patch: Partial<Pick<ListView, 'segment' | 'sort' | 'seed' | 'filters' | 'query'>>) => {
    setNotice(null)
    setView({ ...latest.current, ...patch, scrollTop: 0 })
  }
  const setFilters = (patch: Partial<ListFilters>) => change({ filters: { ...latest.current.filters, ...patch } })

  const list = useMemo(() => buildWordList(data.words, view, now), [data.words, view.segment, view.sort, view.seed, view.filters, view.query, now]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(
    () => ({
      started: data.words.filter((w) => wordStatus(w, now).started).length,
      all: data.words.length,
      hidden: data.words.filter((w) => w.isHidden).length,
    }),
    [data.words, now],
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
  const anyFilter = view.filters.stage || view.filters.due || view.filters.favourites || view.filters.custom || view.filters.pos
  const emptyBecauseFiltered = list.rows.length === 0 && (list.searching || anyFilter)
  const emptyText = list.rows.length > 0 ? null : emptyBecauseFiltered ? t.emptyFiltered : view.segment === 'hidden' ? t.emptyHidden : view.segment === 'started' ? t.emptyStarted : t.emptyAll
  const listKey = `${view.segment}|${view.sort}|${view.seed}|${view.query}|${view.filters.stage}|${view.filters.due}|${view.filters.favourites}|${view.filters.custom}|${view.filters.pos}`
  // The line about the star, only until a word has one: a person who has starred a word has understood it. Not while the stars could not be read (nothing starred
  // would then be a guess), and only over a list that has a star on it to point at.
  const showStarHint = !data.words.some((w) => w.isFavorite) && !data.degraded.includes('user_favorites') && list.rows.some((r) => canStar(r.word))
  // A search is ordered by how well it matches; the sort comes back when the search is cleared.
  const sortName = list.searching ? t.bestMatch : t.sorts[view.sort]

  if (adding) {
    const submit = (values: Parameters<typeof addCustomWord>[0]): SubmitResult => {
      const result = addCustomWord(values, {
        words: data.words,
        getSettings: data.getSettings,
        applySettings: data.applySettings,
        upsertCustomWord: data.upsertCustomWord,
        removeCustomWord: data.removeCustomWord,
        applyFavorite: data.applyFavorite,
        queue,
      })
      if (result.status === 'added') {
        haptic('success')
        setNotice(t.added)
        return { status: 'added' }
      }
      return result
    }
    return (
      <main className="screen words-form">
        <ScreenHeader title={t.form.addTitle} onBack={onBack} />
        <WordForm
          existing={null}
          words={data.words}
          initial={blankValues()}
          enrich={enrich}
          onSubmit={submit}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
          registerBack={registerBack}
          onOpenExisting={(word) => {
            setAdding(false)
            onOpen(wordKey(word.esWord))
          }}
        />
      </main>
    )
  }

  return (
    <main className="screen fill words">
      <ScreenHeader title={t.title} onBack={onBack} actions={<AddButton onClick={() => setAdding(true)} />} />

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
            onClick={() => change(segment === 'hidden' ? { segment, filters: { ...latest.current.filters, stage: null, due: false } } : { segment })}
          >
            {t.segments[segment]} <span className="segment-count">{counts[segment]}</span>
          </button>
        ))}
      </div>

      <div className="words-controls">
        <button type="button" className={filterCount > 0 ? 'control-btn is-active' : 'control-btn'} aria-haspopup="dialog" onClick={() => setSheet('filters')}>
          <span className="control-label">{t.filtersButton}</span>
          {filterCount > 0 && (
            <span className="control-count" aria-label={t.filtersActive(filterCount)}>
              {filterCount}
            </span>
          )}
        </button>
        {/* The face is an icon and the current sort alone ("Sort:" and the value do not fit side by side in Russian); the full phrase is the label. */}
        <button type="button" className="control-btn" aria-haspopup="dialog" aria-label={t.sortButton(sortName)} disabled={list.searching} onClick={() => setSheet('sort')}>
          <SortIcon />
          <span className="control-label">{sortName}</span>
        </button>
      </div>

      <UnsavedNotice queue={queue} />
      {notice && (
        <p className="words-note" role="status">
          {notice}
        </p>
      )}
      {list.searching && <p className="words-note">{t.count(list.rows.length)}</p>}
      {showStarHint && (
        <p className="words-note words-star-hint">{t.learnSoonerListHint}</p>
      )}
      {/* What every row's star does, for the screen reader: the rows have no room for words. */}
      <span id={LEARN_SOONER_HINT_ID} hidden>
        {t.learnSoonerHint}
      </span>

      {emptyText ? (
        <div className="words-empty">
          <p>{emptyText}</p>
          {emptyBecauseFiltered && (
            <button type="button" className="btn btn-secondary" onClick={() => change({ query: '', filters: NO_FILTERS })}>
              {t.clearSearchAndFilters}
            </button>
          )}
        </div>
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
          renderRow={(i) => {
            return <WordRow row={list.rows[i]} settings={data.settings} onOpen={onOpen} onToggleFavourite={toggleFavourite} onBringBack={bringBack} />
          }}
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

function SortIcon() {
  return (
    <svg className="control-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 5v14M8 5 4.5 8.5M8 5l3.5 3.5M16 19V5M16 19l-3.5-3.5M16 19l3.5-3.5" />
    </svg>
  )
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn" aria-label={t.addWord} title={t.addWord} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  )
}
