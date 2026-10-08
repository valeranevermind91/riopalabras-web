export type Screen = 'home' | 'learn' | 'review' | 'matching' | 'cloze' | 'words' | 'word' | 'settings' | 'debug' | 'onboarding' | 'how'

/**
 * Where Back leads from a screen: a word goes back to where it was opened (the word of the day on Home, or the Words
 * list), Debug, "How it works" and the replayed intro go back to Settings, which is their only way in, and every other screen goes Home.
 */
export function backTarget(screen: Screen, wordOpenedFrom: 'home' | 'words' | null): Screen {
  if (screen === 'word') return wordOpenedFrom ?? 'home'
  if (screen === 'debug' || screen === 'onboarding' || screen === 'how') return 'settings'
  return 'home'
}
