import { PlacementTest } from '../components/PlacementTest'
import { strings } from '../strings'
import type { StepProps } from './OnboardingStepBodies'

/**
 * The placement test as a step of the intro (step 5 of 7). It draws its own Back, Continue and Skip (`ownsFooter` in the step list), because
 * it has five sets of its own to go through: Back from the first set leaves the step backwards, finishing or skipping moves on.
 */
export function OnboardingPlacement({ words, savePlacement, advance, retreat, interceptBack }: StepProps) {
  return (
    <div className="intro-step" data-step="placement">
      <h1 className="intro-title">{strings.onboarding.placement.title}</h1>
      <PlacementTest words={words} onSave={savePlacement} onDone={advance} onSkip={advance} onBack={retreat} showSkipNote interceptBack={interceptBack} />
    </div>
  )
}
