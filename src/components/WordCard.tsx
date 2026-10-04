import { headword } from '../data/headword'
import { posLabel, showPosBadge } from '../data/pos'
import { headwordRegion, relationFor, translationsFor } from '../data/relation'
import type { Lang } from '../data/rio'
import type { Word } from '../data/types'
import { strings } from '../strings'
import { HighlightedSentence } from './HighlightedSentence'
import { RegionTag } from './RegionTag'
import { RelationBlock } from './RelationBlock'

export function TranslationRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="wc-row">
      <span className="wc-row-label">{label}:</span>
      <span className="wc-row-text">{text}</span>
    </div>
  )
}

/** Highlighted example sentence with its EN/RU translations; renders nothing when there is no example. */
export function ExampleBlock({ word }: { word: Word }) {
  if (word.exampleSentence.trim() === '') return null

  return (
    <section className="wc-example">
      <HighlightedSentence word={word} />
      {word.exampleTranslationEn.trim() !== '' && <p className="wc-translation">{word.exampleTranslationEn}</p>}
      {word.exampleTranslationRu.trim() !== '' && <p className="wc-translation">{word.exampleTranslationRu}</p>}
    </section>
  )
}

/** A word's full card. Shared by Learn now; Review and the Words tab reuse it. */
export function WordCard({ word, lang }: { word: Word; lang: Lang }) {
  const head = headword(word)
  const translations = translationsFor(word)

  return (
    <article className="word-card">
      <h2 className="wc-headword">{head.text}</h2>

      <div className="wc-meta">
        {showPosBadge(word) && <span className="wc-pos">{posLabel(word.pos)}</span>}
        {head.form === 'rioplatense' && <span className="wc-rio">{strings.card.rioplatensePill}</span>}
        <RegionTag region={headwordRegion(word)} lang={lang} />
      </div>

      <RelationBlock relation={relationFor(word)} lang={lang} />

      <TranslationRow label={strings.card.en} text={translations.en} />
      <TranslationRow label={strings.card.ru} text={translations.ru} />

      <ExampleBlock word={word} />
    </article>
  )
}
