/**
 * What Home says to do today: one of five states, from three numbers the screen already has. The Flutter app's rule, with the same priority
 * (the most fundamental fact wins):
 *   1. reviewFirst   anything is due: always first, however many.
 *   2. allClear      nothing due, no new words left, and today's allowance spent: there is truly nothing left to do.
 *   3. poolEmpty     nothing due and no new words left, but the allowance has room: more could be learnt if there were words to feed it.
 *   4. allDoneToday  nothing due, new words are waiting, but today's allowance is spent: the one case where "tomorrow" is accurate.
 *   5. learnNew      nothing due, new words are waiting and the allowance has room.
 * "Pool empty" and "allowance spent" are told apart on purpose, so the two raw numbers are passed, never min(pool, remaining). Unlike the Flutter
 * app, no state ever offers reviews when none are due. Matching and Cloze are practice and are not part of this, with one exception: once today's allowance is spent
 * (allDoneToday) and today's words can be practised, the practice is the one thing left to do, so the Practice tile (which opens Matching and Cloze) is the one drawn as primary (see primaryTile).
 */
export type HomeAdvice = 'reviewFirst' | 'learnNew' | 'allDoneToday' | 'poolEmpty' | 'allClear'

export function homeAdvice({ reviewDue, learnPool, remainingToday }: { reviewDue: number; learnPool: number; remainingToday: number }): HomeAdvice {
  if (reviewDue > 0) return 'reviewFirst'
  if (learnPool === 0 && remainingToday === 0) return 'allClear'
  if (learnPool === 0) return 'poolEmpty'
  if (remainingToday === 0) return 'allDoneToday'
  return 'learnNew'
}

/**
 * The tile the advice points at, drawn as the primary (filled) one; the other states point at none. The one tile that is ever primary besides Review and Learn is Practice,
 * and only at the end of the day (`practiceNow`: today's new words are done, and there is practice to do on them): never a review that is not due, never Learn past the goal.
 */
export function primaryTile(advice: HomeAdvice, practiceNow = false): 'review' | 'learn' | 'practice' | null {
  if (advice === 'reviewFirst') return 'review'
  if (advice === 'learnNew') return 'learn'
  if (advice === 'allDoneToday' && practiceNow) return 'practice'
  return null
}
