import type { MouseEvent, ReactNode } from 'react'
import { openInTelegram } from '../lib/links'

/**
 * A link to somewhere outside the app. Inside Telegram it is opened with Telegram's own opener (openTelegramLink for t.me, openLink for the rest),
 * so the Mini App's page stays where it is; anywhere else the anchor opens a new tab, with no opener and no referrer.
 */
export function ExternalLink({ url, className, children }: { url: string; className?: string; children: ReactNode }) {
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (openInTelegram(url)) e.preventDefault()
  }
  return (
    <a className={className} href={url} target="_blank" rel="noopener noreferrer" onClick={open}>
      {children}
    </a>
  )
}
