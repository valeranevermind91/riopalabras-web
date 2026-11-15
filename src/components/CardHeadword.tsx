import { genderArticle } from '../data/gender'
import { headword } from '../data/headword'
import type { Word } from '../data/types'

/**
 * The title of a word card: the headword, with a noun's article in front of it in a lighter hand ("la casa", "el agua", "el/la estudiante"). The article is part of what is
 * read and copied, but not of the word: `headword()` is still the bare word and everything else is built on that. `className` adds to "wc-headword" (the review card's front).
 */
export function CardHeadword({ word, className }: { word: Word; className?: string }) {
  const article = genderArticle(word)
  return (
    <h2 className={className ? `wc-headword ${className}` : 'wc-headword'}>
      {article && (
        <>
          <span className="wc-article">{article}</span>{' '}
        </>
      )}
      {headword(word).text}
    </h2>
  )
}
