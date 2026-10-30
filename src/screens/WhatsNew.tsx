import { useEffect, useRef, useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { WHATS_NEW, currentNews, seenNewsPatch, type NewsEntry } from '../data/whatsNew'
import { saveSetting } from '../data/settingsActions'
import type { UserData } from '../data/useUserData'
import type { WriteQueue } from '../data/writeQueue'
import { getLanguage } from '../lib/language'
import { strings } from '../strings'

interface WhatsNewProps {
  data: Pick<UserData, 'settings' | 'applySettings'>
  queue: Pick<WriteQueue, 'enqueueSettings'>
  /** The entries and the moment, for a test; the real ones otherwise. */
  news?: readonly NewsEntry[]
  now?: Date
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
}

const dateOf = (at: string): string => new Date(at).toLocaleDateString(getLanguage(), { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * "What's new": the current entries, newest first, in the person's language. Opening it marks them seen, which is what clears the dot, once (a second visit writes
 * nothing). The entries that were unread when it opened carry a "New" label for as long as it stays open: the watermark is read before the mark is written.
 */
export function WhatsNewScreen({ data, queue, news = WHATS_NEW, now, onBack }: WhatsNewProps) {
  const t = strings.whatsNew
  const lang = getLanguage()
  const [when] = useState(() => now ?? new Date())
  const entries = currentNews(when, news)
  const [seenBefore] = useState(data.settings.whatsNewSeen)
  const marked = useRef(false)

  useEffect(() => {
    if (marked.current) return
    marked.current = true
    const patch = seenNewsPatch(data.settings, when, news)
    if (patch) saveSetting(patch, { applySettings: data.applySettings, queue })
  }, [data.settings, data.applySettings, queue, when, news])

  return (
    <main className="screen settings about whats-new">
      <ScreenHeader title={t.title} onBack={onBack} />
      {entries.length === 0 && <p className="about-text">{t.empty}</p>}
      {entries.map((entry) => {
        const isNew = seenBefore === null || entry.at > seenBefore
        return (
          <section key={entry.id} className="settings-section" aria-labelledby={`news-${entry.id}`}>
            <h2 className="settings-label">
              <time dateTime={entry.at}>{dateOf(entry.at)}</time>
              {isNew && <span className="news-pill">{t.newPill}</span>}
            </h2>
            <div className="settings-group">
              <div className="setting-row setting-row-stack">
                <h3 id={`news-${entry.id}`} className="setting-label news-title">
                  {entry[lang].title}
                </h3>
                <p className="news-text">{entry[lang].text}</p>
              </div>
            </div>
          </section>
        )
      })}
    </main>
  )
}
