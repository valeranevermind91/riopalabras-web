import { ScreenHeader } from '../components/ScreenHeader'
import { strings } from '../strings'

/** Placeholder until Review lands; Home's Review button is disabled, so nothing navigates here yet. */
export function ReviewScreen({ onBack }: { onBack?: () => void }) {
  return (
    <main className="screen">
      <ScreenHeader title={strings.review.title} onBack={onBack} />
      <section className="card">
        <p>{strings.review.placeholder}</p>
      </section>
    </main>
  )
}
