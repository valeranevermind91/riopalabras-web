import { MAX_DAILY_LIMIT, MIN_DAILY_LIMIT } from '../data/settingsActions'
import { strings } from '../strings'

const t = strings.settings

/**
 * The daily goal: − value +. One component for Settings and for the intro, so the two cannot drift; `labelledBy` is the id of
 * the element that names it. The caller decides what a step does (it writes `daily_new_word_limit`).
 */
export function GoalStepper({ goal, onStep, labelledBy }: { goal: number; onStep: (delta: 1 | -1) => void; labelledBy: string }) {
  return (
    <div className="stepper">
      <button type="button" className="stepper-btn" aria-label={t.decrease} disabled={goal <= MIN_DAILY_LIMIT} onClick={() => onStep(-1)}>
        −
      </button>
      <output className="stepper-value" aria-labelledby={labelledBy} aria-live="polite">
        {goal}
      </output>
      <button type="button" className="stepper-btn" aria-label={t.increase} disabled={goal >= MAX_DAILY_LIMIT} onClick={() => onStep(1)}>
        +
      </button>
    </div>
  )
}
