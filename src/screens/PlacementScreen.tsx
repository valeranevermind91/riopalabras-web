import { PlacementTest } from '../components/PlacementTest'
import { ScreenHeader } from '../components/ScreenHeader'
import { savePlacement } from '../data/placement'
import type { UserData } from '../data/useUserData'
import type { WriteQueue } from '../data/writeQueue'
import { strings } from '../strings'

interface PlacementScreenProps {
  data: UserData
  queue: WriteQueue
  /** Leaves the test, to Settings (finished or skipped). */
  onExit: () => void
  /** Lets Back step back through the sets before it leaves. */
  registerBack?: (handler: (() => boolean) | null) => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
}

/** The placement test on its own, from Settings: the same test as in the intro, and it returns to Settings. */
export function PlacementScreen({ data, queue, onExit, registerBack, onBack }: PlacementScreenProps) {
  return (
    <main className="screen fill onboarding" data-mode="standalone">
      <ScreenHeader title={strings.onboarding.placement.title} onBack={onBack} />
      <div className="intro-body">
        <PlacementTest
          words={data.words}
          onSave={(result) => savePlacement(result, { getSettings: data.getSettings, applyHidden: data.applyHidden, applySettings: data.applySettings, queue })}
          onDone={onExit}
          onSkip={onExit}
          onBack={onExit}
          showSkipNote={false}
          interceptBack={registerBack}
        />
      </div>
    </main>
  )
}
