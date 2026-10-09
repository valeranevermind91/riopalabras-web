import type { MouseEvent } from 'react'
import { GoalStepper } from '../components/GoalStepper'
import { ScreenHeader } from '../components/ScreenHeader'
import { SESSIONS_NOTE_FROM, isLastLanguage, saveSetting, setLanguage, stepDailyLimit } from '../data/settingsActions'
import type { UserData } from '../data/useUserData'
import type { WriteQueue } from '../data/writeQueue'
import { botHandle, botLink } from '../lib/botLink'
import { UI_LANGUAGES, effectiveLanguage, languagePatch, type UiLanguage } from '../lib/language'
import { VERSION_LABEL } from '../lib/buildInfo'
import { getWebApp, haptic } from '../lib/telegram'
import { THEME_CHOICES, type ThemeChoice } from '../lib/theme'
import { strings } from '../strings'

const t = strings.settings

interface SettingsScreenProps {
  data: UserData
  queue: WriteQueue
  theme: { choice: ThemeChoice; set: (choice: ThemeChoice) => void }
  /** Whether this user may open Debug. When false the Debug section is not rendered at all. */
  debugAllowed: boolean
  onOpenDebug: () => void
  /** Opens "How it works" (About). Without it the row is left out. */
  onOpenHow?: () => void
  /** Replays the intro from step 1 (About). Without it the row is left out. */
  onRunIntro?: () => void
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
export function SettingsScreen({ data, queue, theme, debugAllowed, onOpenDebug, onOpenHow, onRunIntro, botUsername = import.meta.env.VITE_BOT_USERNAME, onBack }: SettingsScreenProps) {
  const { settings } = data
  const deps = { getSettings: data.getSettings, applySettings: data.applySettings, queue }
  const goal = settings.dailyNewWordLimit
  const link = botLink(botUsername)

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
  const openLink = (e: MouseEvent<HTMLAnchorElement>) => {
    const open = getWebApp().webApp.openTelegramLink
    if (!link || !open) return // outside Telegram the anchor just opens the page
    e.preventDefault()
    open.call(getWebApp().webApp, link)
  }

  return (
    <main className="screen settings">
      <ScreenHeader title={t.title} onBack={onBack} />

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
          <div className="setting-row is-disabled">
            <div className="setting-text">
              <span className="setting-label">{t.reminders}</span>
              <span className="setting-hint">{t.remindersHint}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-about">
        <h2 id="settings-about" className="settings-label">
          {t.about}
        </h2>
        <div className="settings-group">
          {onOpenHow && (
            <button type="button" className="setting-row setting-nav" onClick={onOpenHow}>
              <span className="setting-label">{t.howItWorks}</span>
              <span className="setting-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          )}
          {onRunIntro && (
            <button type="button" className="setting-row setting-nav" onClick={onRunIntro}>
              <span className="setting-label">{t.runIntro}</span>
              <span className="setting-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          )}
          <div className="setting-row">
            <span className="setting-label">{t.version}</span>
            <span className="setting-value">{VERSION_LABEL}</span>
          </div>
          {link && (
            <a className="setting-row setting-link" href={link} target="_blank" rel="noopener noreferrer" onClick={openLink}>
              <span className="setting-label">{t.bot}</span>
              <span className="setting-value">{botHandle(link)}</span>
            </a>
          )}
        </div>
        <p className="settings-about">{t.aboutText}</p>
      </section>

      {debugAllowed && (
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
          </div>
        </section>
      )}
    </main>
  )
}
