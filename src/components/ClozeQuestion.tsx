import { useRef, useState } from 'react'
import {
  CLOZE_BLANK,
  blankSentence,
  buildHint,
  checkClozeAnswer,
  clozeCueLines,
  splitSentence,
  type ClozeItem,
  type ClozeKind,
  type ClozeOutcome,
} from '../data/practice'
import type { Lang } from '../data/rio'
import type { UserSettings } from '../data/types'
import { strings } from '../strings'

interface ClozeQuestionProps {
  item: ClozeItem
  settings: Pick<UserSettings, 'showRuTranslation' | 'showEnTranslation'>
  lang: Lang
  /** Fires once, when Continue is pressed after the question was answered or given up. */
  onAnswered: (outcome: ClozeOutcome) => void
}

type Answer = { kind: ClozeKind | 'gaveUp'; outcome: ClozeOutcome }

/** One fill-in-the-blank question. Every element stays mounted in the same place, so nothing shifts when a hint or the feedback appears. */
export function ClozeQuestion({ item, settings, lang, onAnswered }: ClozeQuestionProps) {
  const t = strings.practice[lang]
  const [typed, setTyped] = useState('')
  const [hintShown, setHintShown] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const sent = useRef(false)
  const { sentence, spans, target } = item.target
  const cue = clozeCueLines(item.word, settings)

  const check = () => {
    if (answer || typed.trim() === '') return
    const verdict = checkClozeAnswer({ typed, target, headword: item.headword })
    setAnswer({ kind: verdict.kind, outcome: verdict.outcome })
  }
  const reveal = () => {
    if (!answer) setAnswer({ kind: 'gaveUp', outcome: 'gaveUp' })
  }
  const next = () => {
    if (!answer || sent.current) return
    sent.current = true
    onAnswered(answer.outcome)
  }

  const feedback = (a: Answer): { text: string; tone: 'ok' | 'bad' | 'neutral' } => {
    switch (a.kind) {
      case 'exact':
        return { text: t.correct, tone: 'ok' }
      case 'accent':
        return { text: `${t.correct} ${t.accentNudge(target)}`, tone: 'ok' }
      case 'headword':
        return { text: `${t.correct} ${t.inSentence(target)}`, tone: 'ok' }
      case 'gaveUp':
        return { text: t.gaveUp(target), tone: 'neutral' }
      default:
        return { text: t.wrong(target), tone: 'bad' }
    }
  }
  const fb = answer ? feedback(answer) : null

  return (
    <section className="cz-card">
      <div className="cz-top">
        <p className="cz-sentence">
          {answer
            ? splitSentence(sentence, spans).map((part, i) => (part.target ? <mark key={i}>{part.text}</mark> : part.text))
            : blankSentence(sentence, spans, CLOZE_BLANK)}
        </p>
        {cue.map((line) => (
          <p key={line.label} className="cz-cue">
            ({line.label}: {line.text})
          </p>
        ))}
        <p className="cz-hint">{hintShown && !answer ? buildHint(target) : ''}</p>
        <p className={`cz-feedback cz-${fb?.tone ?? 'none'}`} role="status">
          {fb?.text ?? ''}
        </p>
      </div>

      <form
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
        <div className="cz-secondary">
          <button type="button" className="btn btn-secondary" disabled={answer !== null || hintShown} onClick={() => setHintShown(true)}>
            {t.hint}
          </button>
          <button type="button" className="btn btn-secondary" disabled={answer !== null} onClick={reveal}>
            {t.reveal}
          </button>
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
