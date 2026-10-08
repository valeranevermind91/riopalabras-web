import { useEffect, useMemo, useState } from 'react'
import { BottomSheet } from '../components/WordsSheets'
import { ScreenHeader } from '../components/ScreenHeader'
import { WordForm, type SubmitResult } from '../components/WordForm'
import { deleteCustomWord, editCustomWord, valuesOf, type WordValues } from '../data/customWords'
import { noEnrichment, type EnrichResult } from '../data/enrich'
import { StarIcon } from '../components/WordRow'
import { WordCard } from '../components/WordCard'
import { headword } from '../data/headword'
import { MAX_LEARN_PICKS, isQueueable, livePicks, queuePosition, toggleQueued } from '../data/learnPicks'
import { computeRemainingToday } from '../data/stats'
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
  /** Fills in a typed word's translations (the proxy's /enrich), for editing a custom word. Without it every field is typed by hand. */
  enrich?: (input: { word: string; pos: string | null }) => Promise<EnrichResult>
  /** Lets the screen take Telegram's back button (or the in-page one) while the edit form or the delete question is open. */
  registerBack?: (handler: (() => boolean) | null) => void
  /** The word is gone (deleted): leave the screen, to where it was opened from. */
  onDeleted?: () => void
  onBack?: () => void
}

/**
 * One word in full: the same card Learn shows, a line on why it reads the way it does when that is not obvious, the
 * scheduling numbers in a collapsed footnote, then what can be done with it: favourite it, or bring it back if it was marked as known.
 */
export function WordDetail({ word, data, queue, enrich = noEnrichment, registerBack, onDeleted, onBack }: WordDetailProps) {
  const now = new Date()
  const state = wordState(word, now)
  const note = noteFor(word, state)
  const head = headword(word).text

  // The Learn queue: only a word that is not started can be in it. `said` is what the last tap said (a confirmation, or why it was refused).
  const [said, setSaid] = useState<{ esWord: string; text: string } | null>(null)
  const live = useMemo(() => livePicks(data.words, data.settings.learnPicks), [data.words, data.settings.learnPicks])
  const place = queuePosition(live, word)
  const queueable = isQueueable(word)
  const beyondToday = place !== null && place > computeRemainingToday(data.settings, now)
  const toggleQueue = () => {
    haptic('select')
    const result = toggleQueued(word, { getSettings: data.getSettings, words: data.words, applySettings: data.applySettings, queue })
    setSaid(result.done === 'queued' ? { esWord: word.esWord, text: t.queuedAt(result.position) } : result.done === 'refused' && result.reason === 'full' ? { esWord: word.esWord, text: t.queueFull(MAX_LEARN_PICKS) } : null)
  }

  // The user's own words can be edited and deleted from here.
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // (The edit form handles Back itself: it asks before throwing away what was changed.)
  useEffect(() => {
    if (!confirming || !registerBack) return
    registerBack(() => {
      setConfirming(false)
      return true
    })
    return () => registerBack(null)
  }, [confirming, registerBack])
  const customDeps = {
    words: data.words,
    getSettings: data.getSettings,
    applySettings: data.applySettings,
    upsertCustomWord: data.upsertCustomWord,
    removeCustomWord: data.removeCustomWord,
    queue,
  }
  const submitEdit = (values: WordValues): SubmitResult => {
    const result = editCustomWord(word, values, customDeps)
    return result.status === 'saved' ? { status: 'saved' } : result
  }
  const confirmDelete = () => {
    haptic('tap')
    setConfirming(false)
    if (deleteCustomWord(word, customDeps)) onDeleted?.()
  }

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

  if (editing && word.isCustom) {
    return (
      <main className="screen words-form">
        <ScreenHeader title={t.form.editTitle} onBack={onBack} />
        <WordForm
          existing={word}
          words={data.words}
          initial={valuesOf(word)}
          enrich={enrich}
          onSubmit={submitEdit}
          onDone={() => {
            haptic('success')
            setEditing(false)
            setSaid({ esWord: word.esWord, text: t.saved })
          }}
          onCancel={() => setEditing(false)}
          registerBack={registerBack}
          onOpenExisting={() => setEditing(false)}
        />
      </main>
    )
  }

  return (
    <main className="screen word-detail">
      <ScreenHeader title={t.detailTitle} onBack={onBack} />
      <WordCard word={word} settings={data.settings} />

      <section className="state-block" aria-label={d.progress}>
        {word.isCustom && <p className="custom-mark">{t.customMark}</p>}
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
        {queueable && (
          <button type="button" className={place !== null ? 'btn btn-secondary is-on' : 'btn btn-secondary'} aria-pressed={place !== null} onClick={toggleQueue}>
            {place !== null ? t.removeFromQueue : t.queueForLearn}
          </button>
        )}
        {queueable && place !== null && beyondToday && <p className="queue-note">{t.beyondToday}</p>}
        {said && said.esWord === word.esWord && (
          <p className="queue-note" role="status">
            {said.text}
          </p>
        )}
        {word.isHidden && (
          <button type="button" className="btn btn-primary" aria-label={t.bringBackWord(head)} onClick={bringBack}>
            {t.bringBack}
          </button>
        )}
        {word.isCustom && (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
              {t.editWord}
            </button>
            <button type="button" className="btn btn-secondary btn-danger" onClick={() => setConfirming(true)}>
              {t.deleteWord}
            </button>
          </>
        )}
      </div>

      {confirming && (
        <BottomSheet label={t.deleteTitle(word.esWord)} onClose={() => setConfirming(false)}>
          <div className="confirm-delete">
            <h2>{t.deleteTitle(word.esWord)}</h2>
            <p>{t.deleteBody}</p>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary btn-danger" onClick={confirmDelete}>
                {t.deleteConfirm}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
                {t.deleteCancel}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}
    </main>
  )
}
