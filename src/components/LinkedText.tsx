import { Fragment, type ReactNode } from 'react'

/**
 * A string with {tokens} in it, drawn with a piece of the page in place of each token (a link, an address). The strings stay whole sentences, so each
 * language orders them as it needs to; the pieces (which are the same in both) come from `parts`. A token with no part is left as written, which a test
 * makes sure never happens.
 */
export function LinkedText({ text, parts }: { text: string; parts: Record<string, ReactNode> }) {
  return (
    <>
      {text.split(/(\{[a-z]+\})/).map((piece, i) => {
        const token = /^\{([a-z]+)\}$/.exec(piece)?.[1]
        const part = token === undefined ? undefined : parts[token]
        return part === undefined ? piece : <Fragment key={i}>{part}</Fragment>
      })}
    </>
  )
}
