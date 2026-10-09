export type Screen = 'home' | 'learn' | 'review' | 'matching' | 'cloze' | 'words' | 'word' | 'settings' | 'debug' | 'onboarding' | 'how' | 'placement'

/**
 * Where Back leads from a screen: a word goes back to where it was opened (the word of the day on Home, or the Words
 * list), Debug, "How it works", the replayed intro and the placement test go back to Settings, which is their only way in, and every other screen goes Home.
 */
export function backTarget(screen: Screen, wordOpenedFrom: 'home' | 'words' | null): Screen {
  if (screen === 'word') return wordOpenedFrom ?? 'home'
  if (screen === 'debug' || screen === 'onboarding' || screen === 'how' || screen === 'placement') return 'settings'
  return 'home'
}
