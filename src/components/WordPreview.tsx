import { useEffect, useMemo, useState } from 'react'
import { loadDictionary } from '../data/dictionary'
import { effectiveExample, headword, headwordDecision, highlightTarget, type HeadwordDecision } from '../data/headword'
import { translationsFor } from '../data/relation'
import { type Lang } from '../data/rio'
import { searchWords } from '../data/search'
import type { Word } from '../data/types'
import { strings } from '../strings'
import { ReviewCard } from './ReviewCard'
import { WordCard } from './WordCard'

const QUICK_WORDS = ['aquí', 'cigarrillo', 'metro', 'coger', 'autobús', 'foco', 'guapo', 'portero']
const t = strings.debug.preview

function explain(word: Word, decision: HeadwordDecision): string {
  const r = t.reason
  switch (decision.reason) {
    case 'no-overlay':
      return r['no-overlay']
    case 'legacy':
      return r.legacy
    case 'not-replacement':
      return r['not-replacement'](word.rio?.type ?? '')
    case 'unclean-form':
      return r['unclean-form']
    case 'same-as-es-word':
      return r['same-as-es-word']
    case 'overlay-example-has-form':
      return r['overlay-example-has-form'](word.rio?.form ?? '', decision.matched ?? '')
    case 'dictionary-example-has-form':
      return r['dictionary-example-has-form'](word.rio?.form ?? '', decision.matched ?? '')
    case 'no-example-has-form':
      return r['no-example-has-form'](word.rio?.form ?? '')
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function RawBlock({ word }: { word: Word }) {
  const head = headword(word)
  const decision = headwordDecision(word)
  const translations = translationsFor(word)
  const example = effectiveExample(word)
  const highlight = highlightTarget(word)
  const highlighted = highlight.range ? highlight.sentence.slice(highlight.range.start, highlight.range.end) : null
  const overridden = translations.en !== word.enTranslation || translations.ru !== word.ruTranslation
  const rio = word.rio
  const r = t.rows

  return (
    <dl className="wp-raw">
      <Row label={r.esWord}>{word.esWord}</Row>
      <Row label={r.posRank}>
        {word.pos} / {word.rank ?? '-'}
      </Row>
      <Row label={r.overlay}>
        {rio ? `${rio.type} / ${rio.form} / ${rio.region ?? 'both'} / ${t.status}` : t.noOverlay}
      </Row>
      <Row label={r.stdUsage}>{rio ? (rio.stdUsage ?? t.none) : t.none}</Row>
      <Row label={r.alt}>{rio?.altForm ? `${rio.altForm} (${rio.altRegion ?? '-'})` : t.none}</Row>
      <Row label={r.registerConfidence}>{rio ? `${rio.register} / ${rio.confidence}` : t.none}</Row>
      <Row label={r.legacy}>{word.esRioplatense ?? t.none}</Row>
      <Row label={r.wordForm}>{word.wordFormInExample ?? t.none}</Row>
      <Row label={r.exampleUsed}>{t.exampleUsed[example.source]}</Row>
      <Row label={r.sentence}>{example.sentence || t.none}</Row>
      {example.source !== 'dictionary' && (
        <Row label={r.overlayTranslations}>
          {example.en} / {example.ru}
        </Row>
      )}
      <Row label={r.headword}>
        {head.text} ({head.form})
      </Row>
      <Row label={r.decision}>{explain(word, decision)}</Row>
      <Row label={r.translation}>
        {translations.en} / {translations.ru} ({t.translationOverride(overridden)})
      </Row>
      <Row label={r.highlight}>{highlighted ?? t.none}</Row>
    </dl>
  )
}

/** Dev tool: previews a dictionary word with the overlay applied exactly as in Learn and Review. Writes nothing. */
export function WordPreview({ defaultLang }: { defaultLang: Lang }) {
  const [words, setWords] = useState<readonly Word[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Word | null>(null)
  const [lang, setLang] = useState<Lang>(defaultLang)
  const [revealed, setRevealed] = useState(true)
  const [flip, setFlip] = useState(0) // remounts the Review card so "flip back" replays from the front

  useEffect(() => {
    let cancelled = false
    loadDictionary()
      .then((loaded) => {
        if (!cancelled) setWords(loaded)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const hits = useMemo(() => (words ? searchWords(words, query) : []), [words, query])
  const overlayCount = useMemo(() => words?.filter((w) => w.rio).length ?? 0, [words])

  const select = (word: Word) => {
    setSelected(word)
    setRevealed(true)
    setFlip((n) => n + 1)
  }
  const quick = (esWord: string) => {
    const word = words?.find((w) => w.esWord === esWord)
    if (!word) return
    setQuery(esWord)
    select(word)
  }

  return (
    <section className="card wp">
      <h2>{t.title}</h2>

      {error && <p className="error">{t.loadFailed(error)}</p>}
      {!words && !error && <p>{t.loading}</p>}

      {words && (
        <>
          <p className={overlayCount > 0 ? 'hint' : 'error'}>{overlayCount > 0 ? t.overlayLoaded(overlayCount) : t.overlayMissing}</p>

          <div className="wp-quick">
            {QUICK_WORDS.map((w) => (
              <button key={w} type="button" className="btn-small" onClick={() => quick(w)}>
                {w}
              </button>
            ))}
          </div>

          <label className="wp-label" htmlFor="wp-search">
            {t.searchLabel}
          </label>
          <input
            id="wp-search"
            className="wp-input"
            type="search"
            value={query}
            placeholder={t.searchPlaceholder}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />

          {query.trim() !== '' && (
            <ul className="wp-results">
              {hits.length === 0 && <li className="hint">{t.noMatch}</li>}
              {hits.map(({ word, via }) => (
                <li key={word.esWord}>
                  <button type="button" className={selected?.esWord === word.esWord ? 'wp-hit is-selected' : 'wp-hit'} onClick={() => select(word)}>
                    <span>{word.esWord}</span>
                    {word.rio && <span className="wp-hit-rio">{via === 'rio_form' ? t.viaRioForm(word.rio.form) : `→ ${word.rio.form}`}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!selected && <p className="hint">{t.noWord}</p>}

          {selected && (
            <>
              <div className="wp-lang" role="group" aria-label={t.language}>
                {(['ru', 'en'] as const).map((l) => (
                  <button key={l} type="button" className={lang === l ? 'btn-small' : 'btn-small wp-off'} onClick={() => setLang(l)}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>

              <h3>{t.learnCard}</h3>
              <WordCard word={selected} lang={lang} />

              <h3>{t.reviewBack}</h3>
              <div className="review-slot">
                <ReviewCard key={`${selected.esWord}-${flip}`} word={selected} lang={lang} revealed={revealed} onReveal={() => setRevealed(true)} />
              </div>
              <button
                type="button"
                className="btn-small wp-off"
                onClick={() => {
                  setRevealed(false)
                  setFlip((n) => n + 1)
                }}
              >
                {t.showFront}
              </button>

              <h3>{t.raw}</h3>
              <RawBlock word={selected} />
            </>
          )}
        </>
      )}
    </section>
  )
}
