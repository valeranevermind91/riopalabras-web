import { useEffect, useRef, type ReactNode } from 'react'
import { activeFilterCount, type ListFilters, type PosFilter, type Segment, type SortKey, type StateFilter } from '../data/wordList'
import { strings } from '../strings'

const t = strings.words
const s = t.sheet

const STATES: readonly StateFilter[] = ['new', 'learning', 'established', 'due']
const POS: readonly PosFilter[] = ['verb', 'noun', 'adj', 'adv']
const SORTS: readonly SortKey[] = ['frequency', 'az', 'due', 'recent', 'random']

/**
 * A sheet that rises from the bottom over a dimmed screen. Tapping the dimmed part, pressing Escape, or (in the app)
 * Telegram's back button closes it; the screen behind keeps its place.
 */
export function BottomSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => {
    sheet.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <div className="sheet-grip" aria-hidden="true" />
        {children}
      </div>
    </div>
  )
}

function Option({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" className={active ? 'chip is-active' : 'chip'} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  )
}

interface FiltersSheetProps {
  filters: ListFilters
  segment: Segment
  searching: boolean
  onChange: (patch: Partial<ListFilters>) => void
  onClearAll: () => void
  onClose: () => void
}

/** The filters, grouped: how far along a word is, a show-only switch, and the part of speech. Changes apply at once. */
export function FiltersSheet({ filters, segment, searching, onChange, onClearAll, onClose }: FiltersSheetProps) {
  const count = activeFilterCount(filters, segment, searching)
  const showProgress = segment !== 'hidden' || searching
  return (
    <BottomSheet label={s.filtersTitle} onClose={onClose}>
      <div className="sheet-head">
        <h2>{s.filtersTitle}</h2>
        <button type="button" className="link-btn" disabled={count === 0} onClick={onClearAll}>
          {s.clearAll}
        </button>
      </div>

      {showProgress && (
        <section className="sheet-group" aria-labelledby="sheet-progress">
          <h3 id="sheet-progress">{s.progress}</h3>
          <div className="sheet-options">
            <Option active={filters.state === null} onClick={() => onChange({ state: null })}>
              {s.anyProgress}
            </Option>
            {STATES.map((state) => (
              <Option key={state} active={filters.state === state} onClick={() => onChange({ state })}>
                {t.states[state]}
              </Option>
            ))}
          </div>
        </section>
      )}

      <section className="sheet-group" aria-labelledby="sheet-show-only">
        <h3 id="sheet-show-only">{s.showOnly}</h3>
        <div className="sheet-options">
          <Option active={filters.favourites} onClick={() => onChange({ favourites: !filters.favourites })}>
            {t.favourites}
          </Option>
          <Option active={filters.queued} onClick={() => onChange({ queued: !filters.queued })}>
            {t.queued}
          </Option>
        </div>
      </section>

      <section className="sheet-group" aria-labelledby="sheet-pos">
        <h3 id="sheet-pos">{s.partOfSpeech}</h3>
        <div className="sheet-options">
          {POS.map((pos) => (
            <Option key={pos} active={filters.pos === pos} onClick={() => onChange({ pos: filters.pos === pos ? null : pos })}>
              {t.pos[pos]}
            </Option>
          ))}
        </div>
      </section>
    </BottomSheet>
  )
}

/** The five orders. Choosing one applies it and closes the sheet; choosing Random again shuffles again. */
export function SortSheet({ sort, onSelect, onClose }: { sort: SortKey; onSelect: (sort: SortKey) => void; onClose: () => void }) {
  return (
    <BottomSheet label={s.sortTitle} onClose={onClose}>
      <div className="sheet-head">
        <h2>{s.sortTitle}</h2>
      </div>
      <div className="sheet-list" role="radiogroup" aria-label={s.sortTitle}>
        {SORTS.map((key) => (
          <button key={key} type="button" className={sort === key ? 'sheet-row is-active' : 'sheet-row'} role="radio" aria-checked={sort === key} onClick={() => onSelect(key)}>
            <span>{t.sorts[key]}</span>
            {sort === key && (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}
