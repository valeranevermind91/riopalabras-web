import { useMemo } from 'react'
import { highlightTarget } from '../data/headword'
import type { Word } from '../data/types'

export function HighlightedSentence({ word }: { word: Word }) {
  const { sentence, range } = useMemo(() => highlightTarget(word), [word])

  if (!range) return <p className="wc-sentence">{sentence}</p>

  return (
    <p className="wc-sentence">
      {sentence.slice(0, range.start)}
      <mark>{sentence.slice(range.start, range.end)}</mark>
      {sentence.slice(range.end)}
    </p>
  )
}
