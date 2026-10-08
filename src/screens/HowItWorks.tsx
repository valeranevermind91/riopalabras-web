import { ScreenHeader } from '../components/ScreenHeader'
import { strings } from '../strings'

const t = strings.howItWorks

/**
 * What Learn, Review, Matching and Cloze each do, and why a word comes back after a day and then after a week. Shown from About
 * in Settings and from the last step of the intro (which passes its own `onBack` so the way back is always on the page).
 */
export function HowItWorks({ onBack }: { onBack?: () => void }) {
  return (
    <main className="screen how-it-works">
      <ScreenHeader title={t.title} onBack={onBack} />
      {t.sections.map((section) => (
        <section key={section.id} className={`how-section how-${section.id}`} aria-labelledby={`how-${section.id}`}>
          <h2 id={`how-${section.id}`}>{section.heading}</h2>
          <p>{section.text}</p>
        </section>
      ))}
    </main>
  )
}
