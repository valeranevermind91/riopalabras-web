import { GoalStepper } from '../components/GoalStepper'
import { LANGUAGE_CHOICES, languageChoiceOf, languageChoicePatch, type LanguageChoice } from '../data/onboarding'
import { SESSIONS_NOTE_FROM } from '../data/settingsActions'
import type { SettingsPatch, UserSettings } from '../data/types'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

const t = strings.onboarding

/** What every step is given. A step writes through `saveSetting`, the same path the Settings controls use. */
export interface StepProps {
  settings: UserSettings
  saveSetting: (patch: SettingsPatch) => void
  /** One step on the daily goal (writes `daily_new_word_limit`, like the Settings stepper). */
  stepGoal: (delta: 1 | -1) => void
  /** Opens "How it works" (the last step links to it). */
  onHow: () => void
}

export function AboutStep() {
  return (
    <div className="intro-step" data-step="about">
      <h1 className="brand intro-brand">{strings.appTitle}</h1>
      <p className="intro-text">{t.about.sentence}</p>
    </div>
  )
}

export function InsideStep() {
  return (
    <div className="intro-step" data-step="inside">
      <h1 className="intro-title">{t.inside.title}</h1>
      <ul className="intro-list">
        {t.inside.items.map((item) => (
          <li key={item.id}>
            <span className={`intro-name is-${item.tone}`}>{item.name}</span>
            <span className="intro-line">{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function TranslationStep({ settings, saveSetting }: StepProps) {
  const current = languageChoiceOf(settings)
  const choose = (choice: LanguageChoice) => {
    if (choice === current) return
    haptic('select')
    saveSetting(languageChoicePatch(settings, choice))
  }
  return (
    <div className="intro-step" data-step="translation">
      <h1 className="intro-title" id="intro-translation">
        {t.translation.title}
      </h1>
      <p className="intro-text">{t.translation.text}</p>
      <div className="segmented" role="radiogroup" aria-labelledby="intro-translation">
        {LANGUAGE_CHOICES.map((choice) => (
          <button key={choice} type="button" className={current === choice ? 'segment is-active' : 'segment'} role="radio" aria-checked={current === choice} onClick={() => choose(choice)}>
            {t.translation.names[choice]}
          </button>
        ))}
      </div>
      <p className="intro-note">{t.translation.note}</p>
    </div>
  )
}

export function GoalStep({ settings, stepGoal }: StepProps) {
  const goal = settings.dailyNewWordLimit
  return (
    <div className="intro-step" data-step="goal">
      <h1 className="intro-title">{t.goal.title}</h1>
      <div className="intro-goal">
        <span id="intro-goal-label" className="intro-text">
          {t.goal.text}
        </span>
        <GoalStepper goal={goal} onStep={stepGoal} labelledBy="intro-goal-label" />
      </div>
      {goal >= SESSIONS_NOTE_FROM && <p className="intro-note">{strings.settings.sessionsNote}</p>}
    </div>
  )
}

export function PronunciationStep({ onHow }: StepProps) {
  return (
    <div className="intro-step" data-step="pronunciation">
      <h1 className="intro-title">{t.pronunciation.title}</h1>
      <ul className="intro-facts">
        {t.pronunciation.facts.map((fact, i) => (
          <li key={i}>
            {fact.map((piece, j) =>
              piece.es ? (
                <span key={j} className="intro-es">
                  {piece.es}
                </span>
              ) : (
                piece.text
              ),
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="link-btn intro-link" onClick={onHow}>
        {t.pronunciation.link}
      </button>
    </div>
  )
}
