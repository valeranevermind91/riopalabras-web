import { firstGloss } from '../data/rio'
import { pickLocalizedAll, type TranslationFlags } from '../data/translations'
import type { Relation } from '../data/relation'
import { strings } from '../strings'
import { RegionTag } from './RegionTag'

function prepare(relation: Relation, settings: TranslationFlags) {
  const t = strings.rio.en // labels are UI chrome: English; the note and standard-meaning TEXT follow the translation flags
  // Both are blocks with room for every enabled language: one paragraph each, RU first (a standard meaning is cut to its first gloss).
  const notes = relation ? pickLocalizedAll(relation.note ?? null, settings) : []
  const stdMeanings = (relation ? pickLocalizedAll(relation.stdMeaning ?? null, settings) : []).map(firstGloss)
  return { t, notes, stdMeanings }
}

/** The label lines: standard word (with its soft usage hint), the Rioplatense form, "also", the standard meaning. */
export function RelationLines({ relation, settings }: { relation: Relation; settings: TranslationFlags }) {
  if (!relation) return null
  const { t, stdMeanings } = prepare(relation, settings)
  // how common the standard word is: a soft hint after it, never a claim about where it is used
  const hint = relation.standardUsage ? (t.stdUsageHint[relation.standardUsage] ?? null) : null
  if (!relation.standardWord && !relation.rioForm && !relation.altForm && stdMeanings.length === 0) return null

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
      {stdMeanings.map((meaning, i) => (
        <p key={i}>
          {i === 0 ? `${t.standardMeaning}: ` : ''}
          <span>{meaning}</span>
        </p>
      ))}
    </div>
  )
}

/** The hand-written note, in its own box (the cards put it at the bottom). */
export function RelationNote({ relation, settings }: { relation: Relation; settings: TranslationFlags }) {
  if (!relation) return null
  const { t, notes } = prepare(relation, settings)
  if (notes.length === 0) return null
  return (
    <div className="wc-note">
      {notes.map((note, i) => (
        <p key={i}>
          {i === 0 && <span>{t.note}: </span>}
          {note}
        </p>
      ))}
    </div>
  )
}

/** Lines and note together, in one wrapper (the pieces are what the cards use). */
export function RelationBlock({ relation, settings }: { relation: Relation; settings: TranslationFlags }) {
  if (!relation) return null
  const { stdMeanings, notes } = prepare(relation, settings)
  if (!relation.standardWord && !relation.rioForm && !relation.altForm && stdMeanings.length === 0 && notes.length === 0) return null
  return (
    <div className="wc-relation-block">
      <RelationLines relation={relation} settings={settings} />
      <RelationNote relation={relation} settings={settings} />
    </div>
  )
}
