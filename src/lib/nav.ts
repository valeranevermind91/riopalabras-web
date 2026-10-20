export type Screen = 'home' | 'learn' | 'review' | 'matching' | 'cloze' | 'words' | 'word' | 'settings' | 'about' | 'debug' | 'onboarding' | 'how' | 'placement' | 'feedback'

/** Where a note to the developer was started from: Settings (its own row), or the About screen (the way to ask for data to be deleted). */
export type FeedbackOrigin = 'settings' | 'about'

/**
 * Where Back leads from a screen: a word goes back to where it was opened (the word of the day on Home, or the Words
 * list), Debug, "About", "How it works", the replayed intro and the placement test go back to Settings, which is their only way in, a message to the developer goes
 * back to where it was written (the word it reports, About, or Settings), and every other screen goes Home.
 */
export function backTarget(screen: Screen, wordOpenedFrom: 'home' | 'words' | null, reportingWord = false, feedbackFrom: FeedbackOrigin = 'settings'): Screen {
  if (screen === 'word') return wordOpenedFrom ?? 'home'
  if (screen === 'feedback') return reportingWord ? 'word' : feedbackFrom
  if (screen === 'debug' || screen === 'onboarding' || screen === 'how' || screen === 'placement' || screen === 'about') return 'settings'
  return 'home'
}
