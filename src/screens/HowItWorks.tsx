import { useEffect } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { strings } from '../strings'

const t = strings.howItWorks

/**
 * What Learn, Review, Matching and Cloze each do, and when a word comes back after a day and then after a week. Shown from About in Settings and from the
 * last step of the intro (which passes its own `onBack` so the way back is always on the page). A section's text is paragraphs, split where the strings
 * break them (a blank line).
 *
 * The page is long, and Back at its top is a long scroll away from its end: so the end of the text has a Back of its own. `onDone` is what that one does
 * where the header's `onBack` is absent (Telegram's native BackButton is the header's Back there, and it is not on the page); otherwise it does what
 * `onBack` does. `section` is the id of a section to open at.
 */
export function HowItWorks({ onBack, onDone, section }: { onBack?: () => void; onDone?: () => void; section?: string }) {
  const leave = onDone ?? onBack
  // Opened at a section (the pronunciation memo, from Settings): once the page has drawn and the app has put it at the top, bring that section's heading to the top. A passive effect, so it runs after the app's scroll reset.
  useEffect(() => {
    if (section) document.getElementById(`how-${section}`)?.scrollIntoView({ block: 'start' })
  }, [section])
  return (
    <main className="screen how-it-works">
      <ScreenHeader title={t.title} onBack={onBack} />
      {t.sections.map((section) => (
        <section key={section.id} className={`how-section how-${section.id}`} aria-labelledby={`how-${section.id}`}>
          <h2 id={`how-${section.id}`}>{section.heading}</h2>
          {section.text.split('\n\n').map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </section>
      ))}
      {leave && (
        <div className="how-end">
          <button type="button" className="btn btn-secondary" onClick={leave}>
            {strings.common.back}
          </button>
        </div>
      )}
    </main>
  )
}
