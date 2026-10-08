import { useEffect, useState } from 'react'
import { finishOnboardingPatch } from '../data/onboarding'
import { saveSetting, stepDailyLimit } from '../data/settingsActions'
import type { UserData } from '../data/useUserData'
import type { WriteQueue } from '../data/writeQueue'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'
import { HowItWorks } from './HowItWorks'
import { STEPS, type StepProps } from './onboardingSteps'

const t = strings.onboarding

interface OnboardingProps {
  data: UserData
  queue: WriteQueue
  /**
   * `first`: the account's first open, shown instead of Home; there is nowhere to go back to from step 1, and finishing writes
   * `onboarding_done`. `replay`: opened from Settings; Back from step 1 and finishing both leave to Settings, and nothing the
   * user has set is reset (every step opens with the current values).
   */
  mode: 'first' | 'replay'
  /** Leaves the intro (replay: back to Settings). Called after finishing and from step 1's Back. */
  onExit?: () => void
  /** Lets Telegram's back button (or the in-page one) step back through the intro. */
  registerBack?: (handler: (() => boolean) | null) => void
}

/** Six steps, forward and back, with a progress indicator. Settings written in a step apply at once, as in Settings. */
export function Onboarding({ data, queue, mode, onExit, registerBack }: OnboardingProps) {
  const [step, setStep] = useState(0)
  const [showHow, setShowHow] = useState(false)
  const deps = { getSettings: data.getSettings, applySettings: data.applySettings, queue }
  const last = step === STEPS.length - 1
  const canGoBack = step > 0 || mode === 'replay'

  const props: StepProps = {
    settings: data.settings,
    saveSetting: (patch) => saveSetting(patch, deps),
    stepGoal: (delta) => {
      if (stepDailyLimit(delta, deps)) haptic('select')
    },
    onHow: () => setShowHow(true),
  }
  const { Body, canContinue } = STEPS[step]
  const canNext = canContinue ? canContinue(props) : true

  const back = () => {
    if (step > 0) setStep(step - 1)
    else if (mode === 'replay') onExit?.()
  }
  const next = () => {
    if (!canNext) return
    if (!last) {
      haptic('tap')
      setStep(step + 1)
      return
    }
    // Finishing writes `onboarding_done: true` once (it reads the latest settings, so a second tap finds it already there).
    const patch = finishOnboardingPatch(data.getSettings())
    if (patch) saveSetting(patch, deps)
    haptic('success')
    onExit?.()
  }

  // Telegram's back button steps back through the intro; from step 1 a replay leaves (the app takes it to Settings), a first run stays.
  useEffect(() => {
    if (!registerBack) return
    registerBack(() => {
      if (showHow) {
        setShowHow(false)
        return true
      }
      if (step > 0) {
        setStep(step - 1)
        return true
      }
      return mode === 'first'
    })
    return () => registerBack(null)
  }, [registerBack, showHow, step, mode])

  if (showHow) return <HowItWorks onBack={() => setShowHow(false)} />

  return (
    <main className="screen fill onboarding" data-mode={mode}>
      <div className="intro-progress">
        <span>{t.stepOf(step + 1, STEPS.length)}</span>
        <div className="bar" role="progressbar" aria-label={t.progress} aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
          <div className="bar-fill" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>

      <div className="intro-body">
        <Body {...props} />
      </div>

      <div className="intro-footer">
        {canGoBack ? (
          <button type="button" className="btn btn-secondary" onClick={back}>
            {t.back}
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
        <button type="button" className="btn btn-primary" disabled={!canNext} onClick={next}>
          {last ? t.done : t.continue}
        </button>
      </div>
    </main>
  )
}
