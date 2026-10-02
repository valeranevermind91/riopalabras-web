import type { Relation } from '../data/relation'
import { strings } from '../strings'

export function RelationBlock({ relation }: { relation: Relation }) {
  if (!relation) return null

  switch (relation.type) {
    case 'replacement':
      return relation.standardWord ? (
        <p className="wc-relation">
          {strings.card.standardWord}: <span>{relation.standardWord}</span>
        </p>
      ) : null

    // TODO(data pass): 'meaning_shift' (same word, different sense), 'regional_only' (no standard
    // equivalent) and 'form' (conjugation/inflection note) get their UI here once the dictionary
    // carries that data. Intentionally no placeholder markup until then.
    default:
      return null
  }
}
