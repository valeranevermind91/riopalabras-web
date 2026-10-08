import { strings } from '../strings'

const t = strings.onboarding.placement

/**
 * PLACEMENT TEST: THIS IS THE PLACEHOLDER STEP (step 4 of the intro).
 *
 * The real test replaces this file's body and nothing else: the intro's steps are a list in Onboarding.tsx, and this component
 * is the fourth entry (`id: 'placement'`). It gets the same props as every step (`StepProps`: the settings, a way to save a
 * setting) and the shell draws the progress, Back and Continue around it. A test that must be finished before moving on can
 * say so in that list with `canContinue`; a result that has to be kept goes through `saveSetting` like any other setting.
 */
export function OnboardingPlacement() {
  return (
    <div className="intro-step" data-step="placement">
      <h1 className="intro-title">{t.title}</h1>
      <p className="intro-text">{t.text}</p>
    </div>
  )
}
