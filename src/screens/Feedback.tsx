import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BottomSheet } from '../components/WordsSheets'
import { ScreenHeader } from '../components/ScreenHeader'
import { MAX_MESSAGE, buildReport, checkMessage, feedbackContext, newFeedbackId, showsCount, type FeedbackContext, type FeedbackKind, type FeedbackReport, type FeedbackScreen, type SendResult } from '../data/feedback'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

interface FeedbackProps {
  kind: FeedbackKind
  /** What the report names, as stored and sent to the author (a word report only): the word on the card, and the standard form after it when they differ (reportedWord). */
  esWord: string | null
  /** What the person is shown on the form for it: just the word they saw. Without it the form shows `esWord`. */
  shownWord?: string | null
  /** The screen the form was opened from; it goes with the message. */
  from: FeedbackScreen
  send: (report: FeedbackReport) => Promise<SendResult>
  /** The message went: the screen closes. */
  onSent: () => void
  /** Leave without sending. */
  onClose: () => void
  /** The form takes Back (Telegram's or the page's) while it is open: with something typed it asks before leaving. */
  registerBack?: (handler: (() => boolean) | null) => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
  /** What is collected is read from the app; a test names it. */
  context?: Partial<FeedbackContext>
}

type Phase = 'writing' | 'sending' | 'failed'

/**
 * A short form for a note to the developer. It says in one line what goes with the text; the word, for a report about one, is shown on the form.
 * Sending does not hold the screen: the form stays as it is (the text can still be read, and Back still works) and the button says it is sending.
 * A failure keeps every word and says so; a retry of the same text carries the same id, so it cannot make a second row. Changing the text makes it a new
 * report with a new id.
 */
export function FeedbackScreen({ kind, esWord, shownWord, from, send, onSent, onClose, registerBack, onBack, context }: FeedbackProps) {
  const t = strings.feedback
  const word = kind === 'word' ? esWord : null // what is sent
  const seen = kind === 'word' ? (shownWord ?? esWord) : null // what is shown: the word the person saw
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>('writing')
  const [empty, setEmpty] = useState(false)
  const [asking, setAsking] = useState(false)
  // What is sent besides the text, collected once when the form opens: the line on the form and the report are made from the same values.
  const [collected] = useState(() => feedbackContext(from, context))
  // The id of the last report tried and its text: the same text again is the same report.
  const attempt = useRef<{ id: string; message: string } | null>(null)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  const dirty = text.trim() !== ''
  useEffect(() => {
    if (!registerBack) return
    registerBack(() => {
      if (asking) setAsking(false)
      else if (dirty && phase !== 'sending') setAsking(true)
      else onClose()
      return true
    })
    return () => registerBack(null)
  }, [registerBack, asking, dirty, phase, onClose])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (phase === 'sending') return
    const checked = checkMessage(text)
    if (!checked.ok) {
      setEmpty(true)
      haptic('error')
      return
    }
    setEmpty(false)
    const id = attempt.current?.message === checked.message ? attempt.current.id : newFeedbackId()
    attempt.current = { id, message: checked.message }
    const built = buildReport({ id, kind, esWord: word, text, context: collected })
    if (!built.ok) return
    setPhase('sending')
    const result = await send(built.report)
    if (!mounted.current) return
    if (result.ok) {
      haptic('success')
      onSent()
    } else {
      haptic('error')
      setPhase('failed')
    }
  }

  const requestClose = () => {
    if (dirty && phase !== 'sending') setAsking(true)
    else onClose()
  }

  const sending = phase === 'sending'
  return (
    <main className="screen feedback">
      <ScreenHeader title={kind === 'word' ? t.titleWord : t.titleGeneral} onBack={onBack} />
      <form className="word-form" onSubmit={submit} noValidate>
        {seen !== null && (
          <p className="form-word">
            <span className="form-label">{t.aboutWord}</span>
            <strong>{seen}</strong>
          </p>
        )}
        <label className="form-field">
          <span className="form-label">{kind === 'word' ? t.fieldWord : t.fieldGeneral}</span>
          <textarea
            className="form-input"
            rows={6}
            value={text}
            maxLength={MAX_MESSAGE}
            readOnly={sending}
            placeholder={kind === 'word' ? t.placeholderWord : t.placeholderGeneral}
            aria-describedby="feedback-sends"
            aria-invalid={empty}
            onChange={(e) => {
              setText(e.target.value)
              setEmpty(false)
              if (phase === 'failed') setPhase('writing')
            }}
          />
          {showsCount(text.length) && (
            <span className={text.length >= MAX_MESSAGE ? 'form-count is-full' : 'form-count'} aria-live="polite">
              {t.count(text.length, MAX_MESSAGE)}
            </span>
          )}
        </label>
        <p id="feedback-sends" className="form-hint">
          {t.sentWith({ word: seen, version: collected.appVersion, language: t.languages[collected.uiLanguage], screen: t.screens[collected.screen], platform: collected.platform })}
        </p>
        {empty && (
          <div className="form-note is-error" role="alert">
            <p>{t.empty}</p>
          </div>
        )}
        {phase === 'failed' && (
          <div className="form-note is-error" role="alert">
            <p>{t.failed}</p>
          </div>
        )}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" aria-busy={sending} disabled={sending}>
            {sending ? t.sending : t.send}
          </button>
          <button type="button" className="btn btn-secondary" onClick={requestClose}>
            {t.cancel}
          </button>
        </div>
        {asking && (
          <BottomSheet label={t.discardTitle} onClose={() => setAsking(false)}>
            <div className="confirm-delete">
              <h2>{t.discardTitle}</h2>
              <p>{t.discardBody}</p>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary btn-danger" onClick={onClose}>
                  {t.discard}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>
                  {t.keepWriting}
                </button>
              </div>
            </div>
          </BottomSheet>
        )}
      </form>
    </main>
  )
}
