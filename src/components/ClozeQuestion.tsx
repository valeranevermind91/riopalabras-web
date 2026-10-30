import { useRef, useState } from 'react'
import {
  CLOZE_BLANK,
  blankSentence,
  buildHint,
  checkClozeAnswer,
  clozeCueLines,
  clozeVerbForms,
  cueLang,
  splitSentence,
  type ClozeItem,
  type ClozeKind,
  type ClozeOutcome,
} from '../data/practice'
import { clozeFeedback } from '../data/clozeFeedback'
import { lemmaOfForm } from '../data/lemmaNote'
import type { UserSettings } from '../data/types'
import { useKeepInView } from '../lib/useKeyboardInset'
import { strings } from '../strings'

interface ClozeQuestionProps {
  item: ClozeItem
  settings: Pick<UserSettings, 'showRuTranslation' | 'showEnTranslation'>
  /** How much of the page the on-screen keyboard covers (0 when none, or when the page shrinks for it): the dock is kept above it. */
  keyboardInset?: number
  /** Fires once, when Continue is pressed after the question was answered or given up. */
  onAnswered: (outcome: ClozeOutcome, kind: ClozeKind | 'gaveUp') => void
  /** The moment the answer is committed (Check, or giving up), before the feedback is read: where the time spent on the question ends. */
  onChecked?: () => void
}

type Answer = { kind: ClozeKind | 'gaveUp'; outcome: ClozeOutcome }

/** One fill-in-the-blank question. Every element stays mounted in the same place, so nothing shifts when a hint or the feedback appears. */
export function ClozeQuestion({ item, settings, keyboardInset = 0, onAnswered, onChecked }: ClozeQuestionProps) {
  const t = strings.practice
  const dock = useRef<HTMLFormElement>(null)
  const [typed, setTyped] = useState('')
  const [hintShown, setHintShown] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  // While the answer field is in use, the field, Hint, Reveal and Check/Continue must all be in the part of the page that can be seen, whether the keyboard
  // is drawn over the page (the screen then pads for it) or the page itself shrinks for it: the dock is scrolled up to just above the keyboard. It runs for
  // each new question too, since the keyboard stays up between them, and again when the visible part changes.
  useKeepInView(dock, keyboardInset, answer)
  const sent = useRef(false)
  const { sentence, spans, target } = item.target
  const cue = clozeCueLines(item.word, settings)

  const check = () => {
    if (answer || typed.trim() === '') return
    const verdict = checkClozeAnswer({ typed, target, headword: item.headword, forms: clozeVerbForms(item.word, item.headword) })
    setAnswer({ kind: verdict.kind, outcome: verdict.outcome })
    onChecked?.()
  }
  const reveal = () => {
    if (!answer) {
      setAnswer({ kind: 'gaveUp', outcome: 'gaveUp' })
      onChecked?.()
    }
  }
  const next = () => {
    if (!answer || sent.current) return
    sent.current = true
    onAnswered(answer.outcome, answer.kind)
  }

  const fb = answer ? clozeFeedback(answer.kind, target, cueLang(item.word, settings)) : null
  // Where the answer is shown for the person to learn from (given up, or wrong), not after a correct one: the word the form comes from, when it is a form of it.
  const lemma = answer && (answer.kind === 'gaveUp' || answer.kind === 'wrong') ? lemmaOfForm(item.word, target) : null

  return (
    <section className="cz-card">
      <div className="cz-top">
        {/* The blank is a fixed-width rule: it never reflects the length of the answer. aria-label carries the plain-text blank for screen readers. */}
        <p className="cz-sentence" aria-label={answer ? undefined : blankSentence(sentence, spans, CLOZE_BLANK)}>
          {splitSentence(sentence, spans).map((part, i) =>
            part.target ? (
              answer ? (
                <mark key={i}>{part.text}</mark>
              ) : (
                <span key={i} className="cz-blank" aria-hidden="true" />
              )
            ) : (
              part.text
            ),
          )}
        </p>
        {cue.length > 0 && (
          <p className="cz-cue">
            {cue.map((line) => (
              <span key={line.label} className="cz-cue-line">
                <span className="cz-cue-pill">{line.label}</span> {line.text}{' '}
              </span>
            ))}
          </p>
        )}
        {/* One slot for both: the hint is spent once the question is answered, and the note takes its place, so nothing moves. */}
        <p className={lemma ? 'cz-hint cz-lemma' : 'cz-hint'}>{lemma ? t.lemmaNote(target, lemma) : hintShown && !answer ? buildHint(target) : ''}</p>
      </div>

      <form
        ref={dock}
        className="cz-dock"
        onSubmit={(e) => {
          e.preventDefault()
          check()
        }}
      >
        <input
          className="cz-input"
          type="text"
          value={typed}
          disabled={answer !== null}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={t.answerLabel}
          aria-label={t.answerLabel}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        {/* One row for two things that are never there together: Hint and Reveal before the answer, the feedback after it. Hint and Reveal are hidden, not removed
            (Continue stays where the thumb was going for Check), and the feedback sits over them, so the card has no slot of its own for it. */}
        <div className="cz-row">
          <div className={answer ? 'cz-secondary is-spent' : 'cz-secondary'}>
            <button type="button" className="btn btn-secondary" disabled={answer !== null || hintShown} onClick={() => setHintShown(true)}>
              {t.hint}
            </button>
            <button type="button" className="btn btn-secondary" disabled={answer !== null} onClick={reveal}>
              {t.reveal}
            </button>
          </div>
          <p className={`cz-feedback cz-${fb?.tone ?? 'none'}`} role="status">
            {fb?.text ?? ''}
          </p>
        </div>
        {answer ? (
          <button type="button" className="btn btn-primary" onClick={next}>
            {t.continue}
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={typed.trim() === ''}>
            {t.check}
          </button>
        )}
      </form>
    </section>
  )
}
