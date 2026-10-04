import type { Lang } from '../data/rio'
import { strings } from '../strings'

/** A small muted label for how the headword sounds ("informal", "pejorative"). Renders nothing for neutral or unknown registers. */
export function RegisterLabel({ register, lang }: { register: string | null | undefined; lang: Lang }) {
  const text = register ? strings.rio[lang].register[register] : undefined
  if (!text) return null
  return <span className="wc-register">{text}</span>
}
