import { ScreenHeader } from '../components/ScreenHeader'
import { WordCard } from '../components/WordCard'
import { langFromSettings } from '../data/rio'
import type { Word } from '../data/types'
import type { UserData } from '../data/useUserData'
import { strings } from '../strings'

/** One word's full card (the same card Learn and the Debug preview render), opened from the word of the day. */
export function WordScreen({ word, data, onBack }: { word: Word; data: UserData; onBack?: () => void }) {
  return (
    <main className="screen">
      <ScreenHeader title={strings.home.wotdTitle} onBack={onBack} />
      <WordCard word={word} lang={langFromSettings(data.settings)} />
    </main>
  )
}
