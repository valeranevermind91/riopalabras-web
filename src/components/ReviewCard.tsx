import type { KeyboardEvent } from 'react'
import { headword } from '../data/headword'
import { headwordRegion, headwordRegister, relationFor, translationsFor } from '../data/relation'
import type { Lang } from '../data/rio'
import type { Word } from '../data/types'
import { strings } from '../strings'
import { RegionTag } from './RegionTag'
import { RegisterLabel } from './RegisterLabel'
import { RelationBlock } from './RelationBlock'
import { ExampleBlock, TranslationRow } from './WordCard'

interface ReviewCardProps {
  word: Word
  lang: Lang
  revealed: boolean
  onReveal: () => void
}

/**
 * Flashcard. The front is only the word (no part of speech, no example); tapping flips it once —
 * there is no flipping back — and `revealed` flips immediately, so whatever depends on it (the
 * rating buttons) appears at the tap, not after the 450 ms animation.
 */
export function ReviewCard({ word, lang, revealed, onReveal }: ReviewCardProps) {
  const head = headword(word)
  const translations = translationsFor(word)
  const region = headwordRegion(word)
  const register = headwordRegister(word)

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
            <h2 className="wc-headword rf-headword">{head.text}</h2>
            {head.form === 'rioplatense' && <span className="wc-rio">{strings.rio[lang].pill}</span>}
            <RegionTag region={region} lang={lang} />
            <RegisterLabel register={register} lang={lang} />
          </div>
          <p className="rf-hint">{strings.review.tapToReveal}</p>
        </div>

        <div className="flip-face flip-back word-card" aria-hidden={!revealed} inert={!revealed}>
          <h2 className="wc-headword rb-headword">{head.text}</h2>
          {(region || register) && (
            <div className="wc-meta rb-meta">
              <RegionTag region={region} lang={lang} />
              <RegisterLabel register={register} lang={lang} />
            </div>
          )}
          <RelationBlock relation={relationFor(word)} lang={lang} />
          <TranslationRow label={strings.card.en} text={translations.en} />
          <TranslationRow label={strings.card.ru} text={translations.ru} />
          <ExampleBlock word={word} />
        </div>
      </div>
    </div>
  )
}
