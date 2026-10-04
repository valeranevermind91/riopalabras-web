import { firstGloss, pickLocalized, type Lang } from '../data/rio'
import type { Relation } from '../data/relation'
import { strings } from '../strings'
import { RegionTag } from './RegionTag'

export function RelationBlock({ relation, lang }: { relation: Relation; lang: Lang }) {
  if (!relation) return null

  const t = strings.rio[lang]
  const note = pickLocalized(relation.note ?? null, lang)
  const stdMeaningFull = pickLocalized(relation.stdMeaning ?? null, lang)
  const stdMeaning = stdMeaningFull ? firstGloss(stdMeaningFull) : null
  if (!relation.standardWord && !relation.rioForm && !relation.altForm && !stdMeaning && !note) return null

  return (
    <div className="wc-relation">
      {relation.standardWord && (
        <p>
          {strings.card.standardWord}: <span>{relation.standardWord}</span>
        </p>
      )}
      {relation.rioForm && (
        <p>
          {t.rioplatense}: <span>{relation.rioForm}</span> <RegionTag region={relation.region} lang={lang} />
        </p>
      )}
      {relation.altForm && (
        <p>
          {t.also}: <span>{relation.altForm}</span> <RegionTag region={relation.altRegion} lang={lang} />
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
