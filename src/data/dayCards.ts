import { dayPatch } from './daily'
import { isReviewDue } from './stats'
import type { SettingsPatch, UserSettings, Word } from './types'

export interface DayCardsDeps {
  getSettings: () => UserSettings
  /** Optimistic: mirror the patch into the in-memory settings. */
  applySettings: (patch: SettingsPatch) => void
  queue: { enqueueSettings: (patch: SettingsPatch) => void }
  /**
   * The words as they are now, right after the event (for "no review is due"). Without it the light-day half of the rule cannot hold and only the
   * ten-card half counts the day.
   */
  getWords?: () => readonly Word[]
}

/** Whether no review is due at `now`, once whatever just happened is in. False when the words are not known. */
export function nothingDueNow(getWords: DayCardsDeps['getWords'], now: Date): boolean {
  if (!getWords) return false
  return !getWords().some((w) => isReviewDue(w, now))
}

/**
 * One card (or `cards` of them) done, in any mode: counts it toward today's streak and writes the streak the moment the day first qualifies (see
 * dayPatch for the rule). A settings write through the queue, only while the day has not counted yet. Returns whether it wrote anything.
 */
export function recordCards(deps: DayCardsDeps, cards: number, now: Date = new Date(), learnedNow?: number): boolean {
  const patch = dayPatch(deps.getSettings(), now, { cards, nothingDue: nothingDueNow(deps.getWords, now), learnedNow })
  if (!patch) return false
  deps.applySettings(patch)
  deps.queue.enqueueSettings(patch)
  return true
}
