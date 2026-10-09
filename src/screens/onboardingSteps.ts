import type { ComponentType } from 'react'
import { effectiveLanguage, languagePatch } from '../lib/language'
import { AboutStep, GoalStep, LanguageStep, InsideStep, PronunciationStep, TranslationStep, type StepProps } from './OnboardingStepBodies'
import { OnboardingPlacement } from './OnboardingPlacement'

export type { StepProps }

export interface OnboardingStep {
  id: 'language' | 'about' | 'inside' | 'translation' | 'placement' | 'goal' | 'pronunciation'
  Body: ComponentType<StepProps>
  /** Whether Continue is available; a step with nothing to finish leaves it out. */
  canContinue?: (props: StepProps) => boolean
  /** The step draws its own Back / Continue (the placement test, which has sets of its own): the shell leaves its footer out. */
  ownsFooter?: boolean
  /** Runs when Continue is tapped, before the next step shows (with the latest settings). */
  onContinue?: (props: StepProps) => void
}

/**
 * The intro's seven steps, in order: the language first, so everything after it is in that language. The shell (Onboarding.tsx) draws the
 * progress, Back, Continue and the final write around them; the placement test draws its own buttons (`ownsFooter`).
 */
export const STEPS: readonly OnboardingStep[] = [
  {
    id: 'language',
    Body: LanguageStep,
    // Going on with the preselected language is choosing it: written exactly as tapping its option writes it. Otherwise the account would keep
    // following Telegram's language and show a different interface on a device whose Telegram is set differently.
    onContinue: ({ settings, saveSetting }) => {
      if (settings.uiLanguage === null) saveSetting(languagePatch(effectiveLanguage(null)))
    },
  },
  { id: 'about', Body: AboutStep },
  { id: 'inside', Body: InsideStep },
  { id: 'translation', Body: TranslationStep },
  { id: 'placement', Body: OnboardingPlacement, ownsFooter: true },
  { id: 'goal', Body: GoalStep },
  { id: 'pronunciation', Body: PronunciationStep },
]
