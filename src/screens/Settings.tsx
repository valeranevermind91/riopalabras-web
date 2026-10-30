import type { MouseEvent } from 'react'
import { GoalStepper } from '../components/GoalStepper'
import { ScreenHeader } from '../components/ScreenHeader'
import { WHATS_NEW, currentNews, hasUnreadNews, type NewsEntry } from '../data/whatsNew'
import { SESSIONS_NOTE_FROM, debugUnlockedPatch, isLastLanguage, saveSetting, setLanguage, stepDailyLimit } from '../data/settingsActions'
import type { UserData } from '../data/useUserData'
import type { WriteQueue } from '../data/writeQueue'
import { botHandle, botLink } from '../lib/botLink'
import { UI_LANGUAGES, effectiveLanguage, languagePatch, type UiLanguage } from '../lib/language'
import type { RemindersControl } from '../lib/useReminders'
import { getWebApp, haptic } from '../lib/telegram'
import { THEME_CHOICES, type ThemeChoice } from '../lib/theme'
import { strings } from '../strings'

const t = strings.settings

interface SettingsScreenProps {
  data: UserData
  queue: WriteQueue
  theme: { choice: ThemeChoice; set: (choice: ThemeChoice) => void }
  onOpenDebug: () => void
  /** The daily reminder (App owns it so the time zone is kept current at every open). Without it the Notifications section shows the toggle off and disabled. */
  reminders?: RemindersControl
  /** Runs the placement test on its own (Learning). Without it the row is left out. */
  onTakePlacement?: () => void
  /** Opens the About screen: who made the app, where its words come from, the privacy policy, the version. Without it the row is left out. */
  onOpenAbout?: () => void
  /** Opens "How it works" (About). Without it the row is left out. */
  onOpenHow?: () => void
  /** Opens "What's new". Without it, or with no current entry, the row is left out. */
  onOpenWhatsNew?: () => void
  /** The entries and the moment, for a test; the real ones otherwise. */
  news?: readonly NewsEntry[]
  now?: Date
  /** Replays the intro from step 1 (About). Without it the row is left out. */
  onRunIntro?: () => void
  /** Opens the form for a note to the developer (About). Without it (signed out) the row is left out. */
  onOpenFeedback?: () => void
  /** A message has just been sent from here: a line under the row says so. */
  feedbackSent?: boolean
  /** VITE_BOT_USERNAME; no usable value (unset, empty, REPLACE_ME) leaves the link row out. */
  botUsername?: string
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
}

/**
 * Settings: the daily goal and the translation languages (new controls on settings the Flutter app also keeps, same keys
 * and meaning), the theme, a placeholder for reminders, About, and Debug for those allowed to see it. Changes apply at
 * once and go through the write queue like any other settings change.
 */
// Read when drawn, not when the module loads: the strings follow the interface language.
const noticeText = (notice: NonNullable<RemindersControl['notice']>) => ({ declined: t.reminderDeclined, failed: t.reminderFailed, paused: t.reminderPaused, unreachable: t.reminderUnreachable })[notice]

const NO_REMINDERS: RemindersControl = { status: 'loading', shown: false, busy: false, notice: null, set: async () => {} }

export function SettingsScreen({ data, queue, theme, onOpenDebug, reminders = NO_REMINDERS, onTakePlacement, onOpenAbout, onOpenHow, onOpenWhatsNew, news = WHATS_NEW, now, onRunIntro, onOpenFeedback, feedbackSent = false, botUsername = import.meta.env.VITE_BOT_USERNAME, onBack }: SettingsScreenProps) {
  const { settings } = data
  const deps = { getSettings: data.getSettings, applySettings: data.applySettings, queue }
  const goal = settings.dailyNewWordLimit
  const link = botLink(botUsername)
  // "What's new": while something in it is unread the row leads the screen (a dot on the gear that led here must not point at a row at the bottom); once it has been opened it settles into About.
  const when = now ?? new Date()
  const unreadNews = hasUnreadNews(settings, when, news)
  const newsRow =
    onOpenWhatsNew && currentNews(when, news).length > 0 ? (
      <button type="button" className="setting-row setting-nav" aria-label={unreadNews ? t.whatsNewUnread : undefined} onClick={onOpenWhatsNew}>
        <span className="setting-label">
          {t.whatsNew}
          {unreadNews && <span className="news-dot news-dot-inline" aria-hidden="true" />}
        </span>
        <span className="setting-chevron" aria-hidden="true">
          ›
        </span>
      </button>
    ) : null

  const step = (delta: 1 | -1) => {
    if (stepDailyLimit(delta, deps)) haptic('select')
  }
  const toggleLanguage = (which: 'ru' | 'en', on: boolean) => {
    if (setLanguage(which, on, deps)) haptic('select')
  }
  // The interface language (not the translations a word shows): saved like any setting; the app switches when the setting changes.
  const uiLanguage = effectiveLanguage(settings.uiLanguage)
  const chooseUiLanguage = (language: UiLanguage) => {
    if (settings.uiLanguage === language) return
    haptic('select')
    saveSetting(languagePatch(language), deps)
  }
  // Debug is unlocked by seven quick taps on the version row, which lives on the About screen (src/screens/About.tsx); here it can only be locked again.
  const lockDebug = () => {
    haptic('select')
    saveSetting(debugUnlockedPatch(false), deps)
  }
  const openLink = (e: MouseEvent<HTMLAnchorElement>) => {
    const open = getWebApp().webApp.openTelegramLink
    if (!link || !open) return // outside Telegram the anchor just opens the page
    e.preventDefault()
    open.call(getWebApp().webApp, link)
  }

  return (
    <main className="screen settings">
      <ScreenHeader title={t.title} onBack={onBack} />

      {unreadNews && newsRow && (
        <section className="settings-section" aria-label={t.whatsNew}>
          <div className="settings-group">{newsRow}</div>
        </section>
      )}

      <section className="settings-section" aria-labelledby="settings-learning">
        <h2 id="settings-learning" className="settings-label">
          {t.learning}
        </h2>
        <div className="settings-group">
          <div className="setting-row" role="group" aria-labelledby="goal-label">
            <div className="setting-text">
              <span id="goal-label" className="setting-label">
                {t.dailyGoal}
              </span>
              <span className="setting-hint">{t.dailyGoalHint}</span>
            </div>
            <GoalStepper goal={goal} onStep={step} labelledBy="goal-label" />
          </div>
          <p className="setting-note">{t.dailyGoalWhy}</p>
          {goal >= SESSIONS_NOTE_FROM && <p className="setting-note">{t.sessionsNote}</p>}

          <div className="setting-row setting-row-head">
            <div className="setting-text">
              <span id="translation-label" className="setting-label">
                {t.translation}
              </span>
              <span className="setting-hint">{t.translationHint}</span>
            </div>
          </div>
          <div role="group" aria-labelledby="translation-label">
            <div className="setting-row">
              <label htmlFor="language-ru" className="setting-label">
                {t.russian}
              </label>
              <input
                id="language-ru"
                type="checkbox"
                role="switch"
                className="switch"
                checked={settings.showRuTranslation}
                disabled={isLastLanguage(settings, 'ru')}
                onChange={(e) => toggleLanguage('ru', e.target.checked)}
              />
            </div>
            <div className="setting-row">
              <label htmlFor="language-en" className="setting-label">
                {t.english}
              </label>
              <input
                id="language-en"
                type="checkbox"
                role="switch"
                className="switch"
                checked={settings.showEnTranslation}
                disabled={isLastLanguage(settings, 'en')}
                onChange={(e) => toggleLanguage('en', e.target.checked)}
              />
            </div>
          </div>

          {onTakePlacement && (
            <button type="button" className="setting-row setting-nav" onClick={onTakePlacement}>
              <span className="setting-text">
                <span className="setting-label">{t.placementTest}</span>
                <span className="setting-hint">{settings.startRank === null ? t.placementNone : t.placementDone}</span>
              </span>
              <span className="setting-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          )}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-language">
        <h2 id="settings-language" className="settings-label">
          {t.language}
        </h2>
        <div className="settings-group">
          <div className="setting-row setting-row-stack">
            <span id="ui-language-label" className="setting-label">
              {t.uiLanguage}
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="ui-language-label">
              {UI_LANGUAGES.map((language) => (
                <button
                  key={language}
                  type="button"
                  lang={language}
                  className={uiLanguage === language ? 'segment is-active' : 'segment'}
                  role="radio"
                  aria-checked={uiLanguage === language}
                  onClick={() => chooseUiLanguage(language)}
                >
                  {t.uiLanguageNames[language]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-appearance">
        <h2 id="settings-appearance" className="settings-label">
          {t.appearance}
        </h2>
        <div className="settings-group">
          <div className="setting-row setting-row-stack">
            <span id="theme-label" className="setting-label">
              {t.theme}
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="theme-label">
              {THEME_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className={theme.choice === choice ? 'segment is-active' : 'segment'}
                  role="radio"
                  aria-checked={theme.choice === choice}
                  onClick={() => theme.set(choice)}
                >
                  {strings.theme.names[choice]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-notifications">
        <h2 id="settings-notifications" className="settings-label">
          {t.notifications}
        </h2>
        <div className="settings-group">
          <div className="setting-row">
            <div className="setting-text">
              <label htmlFor="daily-reminder" className="setting-label">
                {t.reminder}
              </label>
              <span id="daily-reminder-hint" className="setting-hint">
                {t.reminderHint}
              </span>
            </div>
            <input
              id="daily-reminder"
              type="checkbox"
              role="switch"
              className="switch"
              aria-describedby={reminders.notice ? 'daily-reminder-hint daily-reminder-note' : 'daily-reminder-hint'}
              checked={reminders.shown}
              disabled={reminders.status !== 'ready' || reminders.busy}
              onChange={(e) => reminders.set(e.target.checked)}
            />
          </div>
          {reminders.notice && (
            <p id="daily-reminder-note" className="setting-note" role="status">
              {noticeText(reminders.notice)}
            </p>
          )}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-about">
        <h2 id="settings-about" className="settings-label">
          {t.about}
        </h2>
        <div className="settings-group">
          {onOpenAbout && (
            <button type="button" className="setting-row setting-nav" onClick={onOpenAbout}>
              <span className="setting-label">{t.aboutApp}</span>
              <span className="setting-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          )}
          {onOpenHow && (
            <button type="button" className="setting-row setting-nav" onClick={onOpenHow}>
              <span className="setting-label">{t.howItWorks}</span>
              <span className="setting-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          )}
          {!unreadNews && newsRow}
          {onRunIntro && (
            <button type="button" className="setting-row setting-nav" onClick={onRunIntro}>
              <span className="setting-label">{t.runIntro}</span>
              <span className="setting-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          )}
          {onOpenFeedback && (
            <button type="button" className="setting-row setting-nav" onClick={onOpenFeedback}>
              <span className="setting-text">
                <span className="setting-label">{strings.feedback.open}</span>
                <span className="setting-hint">{strings.feedback.openHint}</span>
              </span>
              <span className="setting-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          )}
          {link && (
            <a className="setting-row setting-link" href={link} target="_blank" rel="noopener noreferrer" onClick={openLink}>
              <span className="setting-label">{t.bot}</span>
              <span className="setting-value">{botHandle(link)}</span>
            </a>
          )}
        </div>
        {feedbackSent && (
          <p className="setting-note" role="status">
            {strings.feedback.sent}
          </p>
        )}
        <p className="settings-about">{t.aboutText}</p>
      </section>

      {settings.debugUnlocked && (
        <section className="settings-section" aria-labelledby="settings-debug">
          <h2 id="settings-debug" className="settings-label">
            {t.debug}
          </h2>
          <div className="settings-group">
            <button type="button" className="setting-row setting-nav" onClick={onOpenDebug}>
              <span className="setting-label">{t.debug}</span>
              <span className="setting-chevron" aria-hidden="true">
                ›
              </span>
            </button>
            {settings.debugUnlocked && (
              <button type="button" className="setting-row setting-nav" onClick={lockDebug}>
                <span className="setting-label">{t.debugLock}</span>
              </button>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
