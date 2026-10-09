import type { KeyboardEvent } from 'react'
import { headword } from '../data/headword'
import { headwordRegion, headwordRegister, relationFor } from '../data/relation'
import type { TranslationFlags } from '../data/translations'
import type { Word } from '../data/types'
import { strings } from '../strings'
import { RegionTag } from './RegionTag'
import { RegisterLabel } from './RegisterLabel'
import { RelationLines, RelationNote } from './RelationBlock'
import { ExampleBlock, TranslationRows } from './WordCard'

interface ReviewCardProps {
  word: Word
  settings: TranslationFlags
  revealed: boolean
  onReveal: () => void
}

/**
 * Flashcard. The front is only the word (no part of speech, no example); tapping flips it once —
 * there is no flipping back — and `revealed` flips immediately, so whatever depends on it (the
 * rating buttons) appears at the tap, not after the 450 ms animation.
 */
export function ReviewCard({ word, settings, revealed, onReveal }: ReviewCardProps) {
  const head = headword(word)
  const region = headwordRegion(word)
  const register = headwordRegister(word)
  const relation = relationFor(word)

  const onKeyDown = (e: KeyboardEvent) => {
    if (revealed || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    onReveal()
  }

  return (
    <div
      className={revealed ? 'flip is-flipped' : 'flip'}
      onClick={revealed ? undefined : onReveal}
      onKeyDown={onKeyDown}
      role={revealed ? undefined : 'button'}
      tabIndex={revealed ? undefined : 0}
      aria-label={revealed ? undefined : strings.review.tapToReveal}
    >
      <div className="flip-inner">
        <div className="flip-face flip-front word-card" aria-hidden={revealed}>
          <div className="rf-center">
            <div className="wc-meta">
              {head.form === 'rioplatense' && <span className="wc-rio">{strings.rio.pill}</span>}
              <RegionTag region={region} />
              <RegisterLabel register={register} />
            </div>
            <h2 className="wc-headword rf-headword">{head.text}</h2>
          </div>
          <p className="rf-hint">{strings.review.tapToReveal}</p>
        </div>

        <div className="flip-face flip-back word-card" aria-hidden={!revealed} inert={!revealed}>
          <div className="wc-meta">
            {head.form === 'rioplatense' && <span className="wc-rio">{strings.rio.pill}</span>}
            <RegionTag region={region} />
            <RegisterLabel register={register} />
          </div>
          <h2 className="wc-headword">{head.text}</h2>
          <RelationLines relation={relation} settings={settings} />
          <hr className="wc-divider" />
          <ExampleBlock word={word} settings={settings} />
          <TranslationRows word={word} settings={settings} />
          <RelationNote relation={relation} settings={settings} />
        </div>
      </div>
    </div>
  )
}
