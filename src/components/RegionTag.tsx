import type { RioRegion } from '../data/rio'
import { strings } from '../strings'

/** A small UY / AR chip (UI chrome: English). Renders nothing without a region (null means both countries: no tag). */
export function RegionTag({ region }: { region: RioRegion | null | undefined }) {
  if (!region) return null
  const t = strings.rio
  return (
    <span className="wc-tag" title={t.tagTitle[region]}>
      {t.tag[region]}
    </span>
  )
}
