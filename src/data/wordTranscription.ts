import type { UiLanguage } from '../lib/language'
import { headword } from './headword'
import { transcribe, type Piece } from './transcription'
import type { Word } from './types'

/** Whether a card shows the transcription: the Russian interface and the switch on. A card that was given no setting for it does not. */
export const wantsTranscription = (settings: { readonly showTranscription?: boolean }, language: UiLanguage): boolean => language === 'ru' && settings.showTranscription === true

/**
 * The transcription of the headword a card shows (the Rioplatense form when that leads), or null: a word the person added is not transcribed in v1 (the text is theirs and
 * may not be Spanish), and neither is a form the converter cannot read. The article is not part of the headword and is not transcribed.
 */
export function transcriptionFor(word: Pick<Word, 'esWord' | 'wordFormInExample' | 'esRioplatense' | 'isCustom'> & Partial<Word>): readonly Piece[] | null {
  if (word.isCustom === true) return null
  return transcribe(headword(word).text)
}
