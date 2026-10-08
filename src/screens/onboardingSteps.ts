import type { ComponentType } from 'react'
import { AboutStep, GoalStep, InsideStep, PronunciationStep, TranslationStep, type StepProps } from './OnboardingStepBodies'
import { OnboardingPlacement } from './OnboardingPlacement'

export type { StepProps }

export interface OnboardingStep {
  id: 'about' | 'inside' | 'translation' | 'placement' | 'goal' | 'pronunciation'
  Body: ComponentType<StepProps>
  /** Whether Continue is available; a step with nothing to finish leaves it out. */
  canContinue?: (props: StepProps) => boolean
}

/**
 * The intro's steps, in order. Adding the placement test is a change to ONE entry here: the `placement` entry's body (see
 * OnboardingPlacement.tsx, the marked placeholder). The shell (Onboarding.tsx) does the rest: progress, Back, Continue and the final write.
 */
export const STEPS: readonly OnboardingStep[] = [
  { id: 'about', Body: AboutStep },
  { id: 'inside', Body: InsideStep },
  { id: 'translation', Body: TranslationStep },
  { id: 'placement', Body: OnboardingPlacement }, // PLACEMENT TEST GOES HERE
  { id: 'goal', Body: GoalStep },
  { id: 'pronunciation', Body: PronunciationStep },
]
