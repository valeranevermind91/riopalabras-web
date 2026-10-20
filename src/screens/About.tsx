import { useRef } from 'react'
import { ExternalLink } from '../components/ExternalLink'
import { LinkedText } from '../components/LinkedText'
import { ScreenHeader } from '../components/ScreenHeader'
import { debugUnlockedPatch, saveSetting } from '../data/settingsActions'
import type { UserData } from '../data/useUserData'
import type { WriteQueue } from '../data/writeQueue'
import { VERSION_LABEL } from '../lib/buildInfo'
import { getLanguage } from '../lib/language'
import { AUTHOR_HANDLE, AUTHOR_URL, CC_BY_SA_URL, COFFEE_URL, DOOZAN_URL, HERMITDAVE_URL, LINK_LABELS, privacyUrl } from '../lib/links'
import { DEBUG_UNLOCK_GAP_MS, DEBUG_UNLOCK_TAPS, createTapCounter } from '../lib/tapCount'
import { haptic } from '../lib/telegram'
import { strings } from '../strings'

interface AboutProps {
  data: Pick<UserData, 'settings' | 'getSettings' | 'applySettings'>
  queue: Pick<WriteQueue, 'enqueueSettings'>
  /** Opens the form for a note to the developer: the way to ask for data to be deleted. Without it (signed out) the row is left out. */
  onOpenFeedback?: () => void
  /** A message has just been sent from here: a line under the row says so. */
  feedbackSent?: boolean
  /** The address the app is served from, for the privacy page's link; the page's own origin unless a test names one. */
  origin?: string
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
}

/**
 * About: what the app is, who made it, where its words come from, what happens to the data and how to support it, and the version. Opened from
 * Settings > About. Every link goes through Telegram's own opener inside Telegram (ExternalLink), so none of them takes the Mini App's page away.
 * The version row is the one that takes the seven taps that unlock Debug for the account; nothing on screen says so.
 */
export function AboutScreen({ data, queue, onOpenFeedback, feedbackSent = false, origin, onBack }: AboutProps) {
  const t = strings.about
  const { settings } = data
  const deps = { applySettings: data.applySettings, queue }

  const taps = useRef(createTapCounter({ taps: DEBUG_UNLOCK_TAPS, gapMs: DEBUG_UNLOCK_GAP_MS }))
  const tapVersion = () => {
    if (settings.debugUnlocked || !taps.current.tap()) return
    haptic('success')
    saveSetting(debugUnlockedPatch(true), deps)
  }

  return (
    <main className="screen settings about">
      <ScreenHeader title={t.title} onBack={onBack} />

      <section className="settings-section" aria-labelledby="about-what">
        <h2 id="about-what" className="settings-label">
          {t.what.heading}
        </h2>
        <p className="about-text about-lead">{t.what.text}</p>
      </section>

      <section className="settings-section" aria-labelledby="about-author">
        <h2 id="about-author" className="settings-label">
          {t.author.heading}
        </h2>
        <div className="settings-group">
          <div className="setting-row">
            <span className="setting-label">{t.author.name}</span>
          </div>
          <ExternalLink className="setting-row setting-link" url={AUTHOR_URL}>
            <span className="setting-label">{t.author.telegram}</span>
            <span className="setting-value">{AUTHOR_HANDLE}</span>
          </ExternalLink>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="about-sources">
        <h2 id="about-sources" className="settings-label">
          {t.sources.heading}
        </h2>
        <p className="about-text">
          <LinkedText
            text={t.sources.text}
            parts={{
              doozan: <ExternalLink url={DOOZAN_URL}>{LINK_LABELS.doozan}</ExternalLink>,
              hermitdave: <ExternalLink url={HERMITDAVE_URL}>{LINK_LABELS.hermitdave}</ExternalLink>,
            }}
          />
        </p>
        <p className="about-text about-licence">
          <LinkedText text={t.sources.licence} parts={{ licence: <ExternalLink url={CC_BY_SA_URL}>{LINK_LABELS.licence}</ExternalLink> }} />
        </p>
      </section>

      <section className="settings-section" aria-labelledby="about-data">
        <h2 id="about-data" className="settings-label">
          {t.data.heading}
        </h2>
        <p className="about-text">{t.data.text}</p>
        <div className="settings-group">
          <ExternalLink className="setting-row setting-link" url={privacyUrl(getLanguage(), origin)}>
            <span className="setting-label">{t.data.privacy}</span>
            <span className="setting-chevron" aria-hidden="true">
              ›
            </span>
          </ExternalLink>
          {onOpenFeedback && (
            <button type="button" className="setting-row setting-nav" onClick={onOpenFeedback}>
              <span className="setting-text">
                <span className="setting-label">{strings.feedback.open}</span>
                <span className="setting-hint">{t.data.deleteHint}</span>
              </span>
              <span className="setting-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          )}
        </div>
        {feedbackSent && (
          <p className="setting-note" role="status">
            {strings.feedback.sent}
          </p>
        )}
      </section>

      <section className="settings-section" aria-labelledby="about-support">
        <h2 id="about-support" className="settings-label">
          {t.support.heading}
        </h2>
        <p className="about-text">
          <LinkedText text={t.support.text} parts={{ coffee: <ExternalLink url={COFFEE_URL}>{t.support.coffee}</ExternalLink> }} />
        </p>
      </section>

      <div className="settings-group">
        <div className="setting-row setting-version" onClick={tapVersion}>
          <span className="setting-label">{t.version}</span>
          <span className="setting-value">{VERSION_LABEL}</span>
        </div>
      </div>
    </main>
  )
}
