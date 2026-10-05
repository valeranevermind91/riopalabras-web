import { firstGloss, pickLocalized, type Lang } from '../data/rio'
import type { Relation } from '../data/relation'
import { strings } from '../strings'
import { RegionTag } from './RegionTag'

export function RelationBlock({ relation, lang }: { relation: Relation; lang: Lang }) {
  if (!relation) return null

  const t = strings.rio.en // labels are UI chrome: English; the note and standard-meaning TEXT below follow the translation setting
  const note = pickLocalized(relation.note ?? null, lang)
  // how common the standard word is: a soft hint after it, never a claim about where it is used
  const hint = relation.standardUsage ? (t.stdUsageHint[relation.standardUsage] ?? null) : null
  const stdMeaningFull = pickLocalized(relation.stdMeaning ?? null, lang)
  const stdMeaning = stdMeaningFull ? firstGloss(stdMeaningFull) : null
  if (!relation.standardWord && !relation.rioForm && !relation.altForm && !stdMeaning && !note) return null

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
      {note && (
        <p className="wc-note">
          <span>{t.note}:</span> {note}
        </p>
      )}
    </div>
  )
}
