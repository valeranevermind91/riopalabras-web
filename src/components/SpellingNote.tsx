import { strings } from '../strings'

interface SpellingNoteProps {
  /** The word as the user typed it. */
  typed: string
  /** The likely spelling, or null when there is no plausible guess. */
  suggestion: string | null
  /** Replace the typed word with the suggestion (and look everything up again for it). */
  onUse: () => void
  /** Dismiss the question and keep the word as typed. */
  onKeep: () => void
}

/**
 * What the form says when the lookup did not recognise the typed word: with a likely spelling it asks "Did you mean ...?" and offers both
 * ways on, without one it only says so. It never blocks anything: the user can always save what they typed.
 */
export function SpellingNote({ typed, suggestion, onUse, onKeep }: SpellingNoteProps) {
  const s = strings.words.form.spelling
  if (suggestion === null) {
    return (
      <p className="form-note" role="status">
        {s.notRecognisedSave(typed)}
      </p>
    )
  }
  return (
    <div className="form-note" role="status">
      <p>
        <strong>{s.didYouMean(suggestion)}</strong>
      </p>
      <p>{s.notRecognised(typed)}</p>
      <div className="form-note-actions">
        <button type="button" className="link-btn" onClick={onUse}>
          {s.use(suggestion)}
        </button>
        <button type="button" className="link-btn" onClick={onKeep}>
          {s.keep(typed)}
        </button>
      </div>
    </div>
  )
}
