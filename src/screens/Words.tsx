import { useMemo, useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { UnsavedNotice } from '../components/UnsavedNotice'
import { VirtualList } from '../components/VirtualList'
import { WORD_ROW_HEIGHT, WordRow } from '../components/WordRow'
import { langFromSettings } from '../data/rio'
import type { UserData } from '../data/useUserData'
import { buildWordList, initialListView, type ListFilters, type ListView, type PosFilter, type Segment, type StateFilter } from '../data/wordList'
import { hasProgress } from '../data/wordState'
import type { WriteQueue } from '../data/writeQueue'
import { wordKey } from '../data/words'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

const t = strings.words

const SEGMENTS: readonly Segment[] = ['learned', 'all', 'hidden']
const STATES: readonly StateFilter[] = ['new', 'learning', 'established', 'due']
const POS: readonly PosFilter[] = ['verb', 'noun', 'adj', 'adv']

interface WordsScreenProps {
  data: UserData
  queue: WriteQueue
  /** What the screen looked like when it was last left (or null the first time): kept by the app while a word is open. */
  savedView: ListView | null
  onViewChange: (view: ListView) => void
  onOpen: (esWord: string) => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
}

/** Browse, search and filter every word. Rendering is windowed; everything is read from memory. */
export function WordsScreen({ data, queue, savedView, onViewChange, onOpen, onBack }: WordsScreenProps) {
  const [view, setViewState] = useState<ListView>(() => savedView ?? initialListView())
  const now = useMemo(() => new Date(), [])
  const lang = langFromSettings(data.settings)

  const setView = (next: ListView) => {
    setViewState(next)
    onViewChange(next)
  }
  // Changing what is listed starts it from the top; scrolling only reports its place.
  const change = (patch: Partial<Pick<ListView, 'segment' | 'filters' | 'query'>>) => setView({ ...view, ...patch, scrollTop: 0 })
  const setFilters = (patch: Partial<ListFilters>) => change({ filters: { ...view.filters, ...patch } })

  const list = useMemo(() => buildWordList(data.words, view, now), [data.words, view.segment, view.filters, view.query, now]) // eslint-disable-line react-hooks/exhaustive-deps
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

  const showStates = list.segment !== 'hidden' || list.searching
  const emptyText = list.rows.length > 0 ? null : view.query.trim() !== '' || view.filters.state || view.filters.favourites || view.filters.pos ? t.emptyFiltered : list.segment === 'hidden' ? t.emptyHidden : list.segment === 'learned' ? t.emptyLearned : t.emptyAll
  const listKey = `${list.segment}|${view.query}|${view.filters.state}|${view.filters.favourites}|${view.filters.pos}`

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
            className={!list.searching && list.segment === segment ? 'segment is-active' : 'segment'}
            aria-pressed={!list.searching && list.segment === segment}
            onClick={() => change(segment === 'hidden' ? { segment, filters: { ...view.filters, state: null } } : { segment })}
          >
            {t.segments[segment]} <span className="segment-count">{counts[segment]}</span>
          </button>
        ))}
      </div>

      <div className="chips" role="group" aria-label={t.filtersLabel}>
        {showStates &&
          STATES.map((state) => (
            <Chip key={state} active={view.filters.state === state} onClick={() => setFilters({ state: view.filters.state === state ? null : state })}>
              {t.states[state]}
            </Chip>
          ))}
        <Chip active={view.filters.favourites} onClick={() => setFilters({ favourites: !view.filters.favourites })}>
          {t.favourites}
        </Chip>
        {POS.map((pos) => (
          <Chip key={pos} active={view.filters.pos === pos} onClick={() => setFilters({ pos: view.filters.pos === pos ? null : pos })}>
            {t.pos[pos]}
          </Chip>
        ))}
      </div>

      <UnsavedNotice queue={queue} />
      {list.fellBack && <p className="words-note">{t.nothingLearnedYet}</p>}
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
          onScrollTop={(top) => onViewChange({ ...view, scrollTop: top })}
          getKey={(i) => wordKey(list.rows[i].word.esWord)}
          renderRow={(i) => <WordRow row={list.rows[i]} lang={lang} onOpen={onOpen} onToggleFavourite={toggleFavourite} onBringBack={bringBack} />}
        />
      )}
    </main>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" className={active ? 'chip is-active' : 'chip'} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  )
}
