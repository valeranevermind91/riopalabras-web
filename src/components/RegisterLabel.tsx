import { strings } from '../strings'

/** A small muted label for how the headword sounds ("informal", "pejorative"): UI chrome, English. Renders nothing for neutral or unknown registers. */
export function RegisterLabel({ register }: { register: string | null | undefined }) {
  const text = register ? strings.rio.register[register] : undefined
  if (!text) return null
  return <span className="wc-register">{text}</span>
}
