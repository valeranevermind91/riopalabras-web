import { genderArticle } from '../data/gender'
import { headword } from '../data/headword'
import type { Word } from '../data/types'
import { transcriptionFor } from '../data/wordTranscription'

/**
 * The title of a word card: the headword, with a noun's article in front of it in a lighter hand ("la casa", "el agua", "el/la estudiante"). The article is part of what is
 * read and copied, but not of the word: `headword()` is still the bare word and everything else is built on that. `className` adds to "wc-headword" (the review card's front).
 *
 * `transcribe`: the Cyrillic transcription follows the headword on the same line, small and muted, in square brackets ("llevar [шеба́р]"), the stressed vowel in a span of its own.
 * The card decides whether it is wanted (the Russian interface, the switch on); a word the person added, and the article, are never transcribed. It is decoration for the eye: a
 * screen reader reads the Spanish word, not the Russian letters that approximate it.
 */
export function CardHeadword({ word, className, transcribe = false }: { word: Word; className?: string; transcribe?: boolean }) {
  const article = genderArticle(word)
  const pieces = transcribe ? transcriptionFor(word) : null
  return (
    <h2 className={className ? `wc-headword ${className}` : 'wc-headword'}>
      {article && (
        <>
          <span className="wc-article">{article}</span>{' '}
        </>
      )}
      {headword(word).text}
      {pieces && (
        <>
          {' '}
          <span className="wc-tr" translate="no" aria-hidden="true">
            [
            {pieces.map((piece, i) =>
              piece.stressed ? (
                <span key={i} className="tr-stress">
                  {piece.text}
                </span>
              ) : (
                piece.text
              ),
            )}
            ]
          </span>
        </>
      )}
    </h2>
  )
}
