import { ScreenHeader } from '../components/ScreenHeader'
import { StarIcon } from '../components/WordRow'
import { WordCard } from '../components/WordCard'
import { headword } from '../data/headword'
import type { Word } from '../data/types'
import type { UserData } from '../data/useUserData'
import { hasHistory, wordState, type WordState } from '../data/wordState'
import type { WriteQueue } from '../data/writeQueue'
import { haptic } from '../lib/telegram'
import { formatInterval } from '../sm2/sm2'
import { hasTranslations } from '../data/words'
import { strings } from '../strings'

const t = strings.words
const d = t.detail

const date = (when: Date) => when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** What the state block says beyond the numbers: why a word reads the way it does, when that is not obvious. */
function noteFor(word: Word, state: WordState): string | null {
  if (state === 'hidden') return d.noteHidden
  if (state === 'reference') return d.noteReference(hasTranslations(word) ? d.reasonPos : d.reasonNoTranslation)
  if (hasHistory(word)) return d.noteLapsed(word.easeFactor.toFixed(2), word.nextReview ? date(word.nextReview) : '—')
  return null
}

interface WordDetailProps {
  word: Word
  data: UserData
  queue: WriteQueue
  onBack?: () => void
}

/**
 * One word in full: the same card Learn shows, a line on why it reads the way it does when that is not obvious, the
 * scheduling numbers in a collapsed footnote, then what can be done with it: favourite it, or bring it back if it was marked as known.
 */
export function WordDetail({ word, data, queue, onBack }: WordDetailProps) {
  const now = new Date()
  const state = wordState(word, now)
  const note = noteFor(word, state)
  const head = headword(word).text

  const toggleFavourite = () => {
    haptic('select')
    data.applyFavorite([word.esWord], !word.isFavorite)
    queue.enqueueFavorite(word.esWord, !word.isFavorite)
  }
  const bringBack = () => {
    haptic('tap')
    data.applyHidden([word.esWord], false)
    queue.enqueueHidden(word.esWord, false)
  }

  return (
    <main className="screen word-detail">
      <ScreenHeader title={t.detailTitle} onBack={onBack} />
      <WordCard word={word} settings={data.settings} />

      <section className="state-block" aria-label={d.progress}>
        {note && <p className="state-note">{note}</p>}
        {/* The scheduler's numbers, as a footnote: closed on every open (a plain <details>, nothing remembers it). */}
        <details className="sched">
          <summary>{d.scheduling}</summary>
          <dl>
            <dt>{d.state}</dt>
            <dd>{t.stateName[state]}</dd>
            <dt>{d.repetitions}</dt>
            <dd>{word.repetitions}</dd>
            <dt>{d.interval}</dt>
            <dd>{word.interval > 0 ? formatInterval(word.interval) : '—'}</dd>
            <dt>{d.nextReview}</dt>
            <dd>
              {word.nextReview ? date(word.nextReview) : d.notScheduled}
              {state === 'due' ? ` · ${d.dueNow}` : ''}
            </dd>
            <dt>{d.ease}</dt>
            <dd>{word.easeFactor.toFixed(2)}</dd>
          </dl>
        </details>
      </section>

      <div className="detail-actions">
        <button type="button" className={word.isFavorite ? 'btn btn-secondary is-on' : 'btn btn-secondary'} aria-pressed={word.isFavorite} onClick={toggleFavourite}>
          <StarIcon filled={word.isFavorite} /> {word.isFavorite ? t.removeFavourite : t.addFavourite}
        </button>
        {word.isHidden && (
          <button type="button" className="btn btn-primary" aria-label={t.bringBackWord(head)} onClick={bringBack}>
            {t.bringBack}
          </button>
        )}
      </div>
    </main>
  )
}
