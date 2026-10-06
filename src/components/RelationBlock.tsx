import { firstGloss, pickLocalized, type Lang } from '../data/rio'
import type { Relation } from '../data/relation'
import { strings } from '../strings'
import { RegionTag } from './RegionTag'

function prepare(relation: Relation, lang: Lang) {
  const t = strings.rio.en // labels are UI chrome: English; the note and standard-meaning TEXT follow the translation setting
  const note = relation ? pickLocalized(relation.note ?? null, lang) : null
  const stdMeaningFull = relation ? pickLocalized(relation.stdMeaning ?? null, lang) : null
  return { t, note, stdMeaning: stdMeaningFull ? firstGloss(stdMeaningFull) : null }
}

/** The label lines: standard word (with its soft usage hint), the Rioplatense form, "also", the standard meaning. */
export function RelationLines({ relation, lang }: { relation: Relation; lang: Lang }) {
  if (!relation) return null
  const { t, stdMeaning } = prepare(relation, lang)
  // how common the standard word is: a soft hint after it, never a claim about where it is used
  const hint = relation.standardUsage ? (t.stdUsageHint[relation.standardUsage] ?? null) : null
  if (!relation.standardWord && !relation.rioForm && !relation.altForm && !stdMeaning) return null

  return (
    <div className="wc-relation">
      {relation.standardWord && (
        <p>
          {t.standard}: <span>{relation.standardWord}</span>
          {hint && <span className="wc-hint"> · {hint}</span>}
        </p>
      )}
      {relation.rioForm && (
        <p>
          {t.rioplatense}: <span>{relation.rioForm}</span> <RegionTag region={relation.region} />
        </p>
      )}
      {relation.altForm && (
        <p>
          {t.also}: <span>{relation.altForm}</span> <RegionTag region={relation.altRegion} />
        </p>
      )}
      {stdMeaning && (
        <p>
          {t.standardMeaning}: <span>{stdMeaning}</span>
        </p>
      )}
    </div>
  )
}

/** The hand-written note, in its own box (the cards put it at the bottom). */
export function RelationNote({ relation, lang }: { relation: Relation; lang: Lang }) {
  if (!relation) return null
  const { t, note } = prepare(relation, lang)
  if (!note) return null
  return (
    <p className="wc-note">
      <span>{t.note}:</span> {note}
    </p>
  )
}

/** Lines and note together, in one wrapper (the pieces are what the cards use). */
export function RelationBlock({ relation, lang }: { relation: Relation; lang: Lang }) {
  if (!relation) return null
  const { stdMeaning, note } = prepare(relation, lang)
  if (!relation.standardWord && !relation.rioForm && !relation.altForm && !stdMeaning && !note) return null
  return (
    <div className="wc-relation-block">
      <RelationLines relation={relation} lang={lang} />
      <RelationNote relation={relation} lang={lang} />
    </div>
  )
}
