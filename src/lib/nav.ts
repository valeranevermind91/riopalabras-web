export type Screen = 'home' | 'learn' | 'review' | 'matching' | 'cloze' | 'words' | 'word' | 'settings' | 'debug'

/**
 * Where Back leads from a screen: a word goes back to where it was opened (the word of the day on Home, or the Words
 * list), Debug goes back to Settings, which is its only way in, and every other screen goes Home.
 */
export function backTarget(screen: Screen, wordOpenedFrom: 'home' | 'words' | null): Screen {
  if (screen === 'word') return wordOpenedFrom ?? 'home'
  if (screen === 'debug') return 'settings'
  return 'home'
}
