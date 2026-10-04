import type { Lang, RioRegion } from '../data/rio'
import { strings } from '../strings'

/** A small UY / AR chip. Renders nothing without a region (null means both countries: no tag). */
export function RegionTag({ region, lang }: { region: RioRegion | null | undefined; lang: Lang }) {
  if (!region) return null
  const t = strings.rio[lang]
  return (
    <span className="wc-tag" title={t.tagTitle[region]}>
      {t.tag[region]}
    </span>
  )
}
