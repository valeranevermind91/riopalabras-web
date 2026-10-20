import { Fragment, useEffect } from 'react'
import { ExternalLink } from '../components/ExternalLink'
import { LinkedText } from '../components/LinkedText'
import { UI_LANGUAGES, useLanguage, type UiLanguage } from '../lib/language'
import { ACCOUNT_EMAIL_EXAMPLE, AUTHOR_HANDLE, AUTHOR_URL } from '../lib/links'
import { PRIVACY_UPDATED, choosePrivacyLanguage, formatPolicyDate } from '../lib/privacy'
import { strings } from '../strings'

/** The example address, allowed to break after each @ and . so that on a narrow screen it wraps at a sensible place and not in the middle of a word. */
function AccountEmail() {
  return (
    <code className="privacy-code">
      {ACCOUNT_EMAIL_EXAMPLE.split(/(?<=[@.])/).map((piece, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {piece}
        </Fragment>
      ))}
    </code>
  )
}

/**
 * The privacy page: plain text in the app's two languages, on a page of its own. It is not the Mini App: no sign-in, no Telegram, no Supabase, no
 * bottom navigation and no back button (the only thing it imports from the app is the strings, the language and the look). It is drawn by
 * privacy-main.tsx from privacy.html, which loads nothing from any other site.
 */
export function PrivacyPage({ choose = choosePrivacyLanguage }: { choose?: (language: UiLanguage) => void }) {
  const language = useLanguage()
  const t = strings.privacy
  useEffect(() => {
    document.title = t.pageTitle
  }, [t.pageTitle])

  const parts = {
    email: <AccountEmail />,
    handle: <ExternalLink url={AUTHOR_URL}>{AUTHOR_HANDLE}</ExternalLink>,
  }

  return (
    <main className="screen privacy">
      <header className="privacy-head">
        <h1>{t.title}</h1>
        <div className="segmented" role="radiogroup" aria-label={t.language}>
          {UI_LANGUAGES.map((option) => (
            <button key={option} type="button" lang={option} className={language === option ? 'segment is-active' : 'segment'} role="radio" aria-checked={language === option} onClick={() => choose(option)}>
              {strings.settings.uiLanguageNames[option]}
            </button>
          ))}
        </div>
      </header>
      <p className="privacy-intro">{t.intro}</p>
      {t.sections.map((section) => (
        <section key={section.id} className="privacy-section" aria-labelledby={`privacy-${section.id}`}>
          <h2 id={`privacy-${section.id}`}>{section.heading}</h2>
          {section.paragraphs.map((text) => (
            <p key={text}>
              <LinkedText text={text} parts={parts} />
            </p>
          ))}
        </section>
      ))}
      <p className="privacy-updated">{t.updated(formatPolicyDate(PRIVACY_UPDATED, language))}</p>
    </main>
  )
}
