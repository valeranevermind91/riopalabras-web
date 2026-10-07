import { rowTitle } from '../data/rowTitle'
import { translationsFor } from '../data/relation'
import { firstTranslation, translationLines, type TranslationFlags } from '../data/translations'
import type { ListRow } from '../data/wordList'
import { wordStage, type WordState } from '../data/wordState'
import { strings } from '../strings'

const t = strings.words

/** The row height in px. The windowed list lays rows out by multiplying with it, so every row is exactly this tall. */
export const WORD_ROW_HEIGHT = 72

/** A small dot for where a word stands: a ring (new), half (learning), full (established); dashed for hidden and reference-only words. */
export function StateDot({ state, stage }: { state: WordState; stage: ReturnType<typeof wordStage> }) {
  const kind = state === 'hidden' || state === 'reference' ? state : stage
  return <span className={`state-dot is-${kind}`} aria-hidden="true" />
}

export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1L3.2 9.6l6.1-.8L12 3.2z" />
    </svg>
  )
}

interface WordRowProps {
  row: ListRow
  settings: TranslationFlags
  onOpen: (esWord: string) => void
  onToggleFavourite: (esWord: string, favourite: boolean) => void
  onBringBack: (esWord: string) => void
}

/**
 * One word in the list: the title (see rowTitle: the form that matched in a search, the headword otherwise), a state dot, a part-of-speech tag, a
 * Due badge, one translation line, and on the right a favourite star, or "Bring back" for a hidden word. Tapping the row
 * opens the word; the star and the button act on their own.
 */
export function WordRow({ row, settings, onOpen, onToggleFavourite, onBringBack }: WordRowProps) {
  const { word, state, via } = row
  const { title: head, alt } = rowTitle(word, via)
  // One muted line: every enabled language that has text, RU then EN, joined with " · " (the line truncates with an ellipsis
  // rather than wrapping, so a row is always the same height). A search that matched through a translation adds that
  // language if it is switched off, so the reason for the hit is always on the row.
  const texts = translationsFor(word)
  const shown = translationLines(texts, settings)
  const matched = via === 'en' || via === 'ru' ? firstTranslation({ [via]: texts[via] }, { showRuTranslation: via === 'ru', showEnTranslation: via === 'en' }) : null
  const lines = matched && !shown.some((l) => l.lang === matched.lang) ? [...shown, matched].sort((a, b) => (a.lang === 'ru' ? -1 : b.lang === 'ru' ? 1 : 0)) : shown
  const translation = lines.map((l) => l.text).join(' · ')
  const pos = t.posTag[word.pos.toLowerCase()] ?? word.pos

  return (
    <div className="word-row">
      <button type="button" className="word-row-main" aria-label={t.open(head)} onClick={() => onOpen(word.esWord)}>
        <span className="word-row-top">
          <StateDot state={state} stage={wordStage(word)} />
          <span className="word-row-head">{head}</span>
          <span className="word-row-pos">{pos}</span>
          {state === 'due' && <span className="word-row-due">{t.due}</span>}
        </span>
        <span className="word-row-line">
          {alt && <span className="word-row-alt">{alt}</span>}
          {translation && <span className="word-row-tr">{translation}</span>}
        </span>
      </button>
      {word.isHidden ? (
        <button type="button" className="word-row-bring" aria-label={t.bringBackWord(head)} onClick={() => onBringBack(word.esWord)}>
          {t.bringBack}
        </button>
      ) : (
        <button
          type="button"
          className={word.isFavorite ? 'word-row-star is-on' : 'word-row-star'}
          aria-pressed={word.isFavorite}
          aria-label={word.isFavorite ? t.unfavourite(head) : t.favourite(head)}
          onClick={() => onToggleFavourite(word.esWord, !word.isFavorite)}
        >
          <StarIcon filled={word.isFavorite} />
        </button>
      )}
    </div>
  )
}
