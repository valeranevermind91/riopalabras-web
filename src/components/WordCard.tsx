import { effectiveExample, headword } from '../data/headword'
import { posLabel, showPosBadge } from '../data/pos'
import { headwordRegion, headwordRegister, relationFor, translationsFor } from '../data/relation'
import { translationLines, type TranslationFlags } from '../data/translations'
import type { Word } from '../data/types'
import { strings } from '../strings'
import { HighlightedSentence } from './HighlightedSentence'
import { RegionTag } from './RegionTag'
import { RegisterLabel } from './RegisterLabel'
import { RelationLines, RelationNote } from './RelationBlock'

export function TranslationRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="wc-row">
      <span className="wc-row-label">{label}:</span>
      <span className="wc-row-text">{text}</span>
    </div>
  )
}

/** Highlighted example sentence with its translations, one line per enabled language (the overlay's example when there is one); renders nothing when there is no example. */
export function ExampleBlock({ word, settings }: { word: Word; settings: TranslationFlags }) {
  const example = effectiveExample(word)
  if (example.sentence.trim() === '') return null

  return (
    <section className="wc-example">
      <HighlightedSentence word={word} />
      {translationLines({ ru: example.ru, en: example.en }, settings).map((line) => (
        <p key={line.lang} className="wc-translation">
          {line.text}
        </p>
      ))}
    </section>
  )
}

/** The word's translation rows, one per enabled language that has text (RU first), the language that has text if none does. */
export function TranslationRows({ word, settings }: { word: Word; settings: TranslationFlags }) {
  const lines = translationLines(translationsFor(word), settings)
  if (lines.length === 0) return null
  return (
    <div className="wc-translations">
      {lines.map((line) => (
        <TranslationRow key={line.lang} label={line.label} text={line.text} />
      ))}
    </div>
  )
}

/** A word's full card: pills, headword, the standard-word line, then the example, the translations and the note. Shared by Learn, the Review answer, the word of the day and the Debug preview. */
export function WordCard({ word, settings }: { word: Word; settings: TranslationFlags }) {
  const head = headword(word)
  const relation = relationFor(word)

  return (
    <article className="word-card">
      <div className="wc-meta">
        {head.form === 'rioplatense' && <span className="wc-rio">{strings.rio.en.pill}</span>}
        <RegionTag region={headwordRegion(word)} />
        {showPosBadge(word) && <span className="wc-pos">{posLabel(word.pos)}</span>}
        <RegisterLabel register={headwordRegister(word)} />
      </div>

      <h2 className="wc-headword">{head.text}</h2>

      <RelationLines relation={relation} settings={settings} />

      <hr className="wc-divider" />

      <ExampleBlock word={word} settings={settings} />

      <TranslationRows word={word} settings={settings} />

      <RelationNote relation={relation} settings={settings} />
    </article>
  )
}
