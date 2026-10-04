import type { SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import { ScreenHeader } from '../components/ScreenHeader'
import { WordCard } from '../components/WordCard'
import { langFromSettings } from '../data/rio'
import { learnedToday } from '../data/daily'
import { createBatchFinisher, selectLearnBatch } from '../data/learn'
import type { UserData } from '../data/useUserData'
import { confirmDialog, haptic } from '../lib/telegram'
import { useSwipe } from '../lib/useSwipe'
import { strings } from '../strings'

type Phase = 'reading' | 'saving' | 'error' | 'done'
type LeaveGuard = () => boolean | Promise<boolean>

interface LearnScreenProps {
  data: UserData
  client: SupabaseClient
  userId: string
  onHome: () => void
  onReview: () => void
  /** Only passed where Telegram's native BackButton isn't available. */
  onBack?: () => void
  registerLeaveGuard: (guard: LeaveGuard | null) => void
}

export function LearnScreen({ data, client, userId, onHome, onReview, onBack, registerLeaveGuard }: LearnScreenProps) {
  const buildSession = (source: UserData) => {
    const batch = selectLearnBatch(source.words, source.settings, new Date())
    const finish = createBatchFinisher(batch, {
      client,
      userId,
      getSettings: source.getSettings,
      applyProgress: source.applyProgress,
      applySettings: source.applySettings,
    })
    return { batch, finish }
  }

  const [session, setSession] = useState(() => buildSession(data))
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const [phase, setPhase] = useState<Phase>(() => (session.batch.words.length > 0 ? 'reading' : 'done'))
  const [error, setError] = useState<string | null>(null)

  const words = session.batch.words
  const lastIndex = words.length - 1
  const reading = phase === 'reading'

  useEffect(() => {
    registerLeaveGuard(() => {
      if (phase === 'saving') return false
      if (phase === 'error') return confirmDialog(strings.learn.leaveUnsaved)
      return true
    })
    return () => registerLeaveGuard(null)
  }, [phase, registerLeaveGuard])

  const go = (delta: 1 | -1) => {
    const next = index + delta
    if (!reading || next < 0 || next > lastIndex) return
    setDirection(delta > 0 ? 'next' : 'prev')
    setIndex(next)
    haptic('select')
  }

  const goRef = useRef(go)
  useEffect(() => {
    goRef.current = go
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goRef.current(1)
      else if (e.key === 'ArrowLeft') goRef.current(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const swipe = useSwipe({
    onNext: () => go(1),
    onPrevious: () => go(-1),
    canNext: index < lastIndex,
    canPrevious: index > 0,
    enabled: reading,
  })

  const finish = async () => {
    haptic('tap')
    setPhase('saving')
    setError(null)
    try {
      await session.finish()
      haptic('success')
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
      haptic('error')
    }
  }

  const startNextBatch = () => {
    haptic('tap')
    const next = buildSession(data)
    setSession(next)
    setIndex(0)
    setDirection('next')
    setError(null)
    setPhase(next.batch.words.length > 0 ? 'reading' : 'done')
  }

  if (phase === 'done') {
    return (
      <main className="screen">
        <ScreenHeader title={strings.learn.title} onBack={onBack} />
        <PostBatch data={data} onNextBatch={startNextBatch} onReview={onReview} onHome={onHome} />
      </main>
    )
  }

  const onLastCard = index >= lastIndex
  const progress = ((index + 1) / words.length) * 100

  return (
    <main className="screen">
      <ScreenHeader title={strings.learn.title} onBack={onBack} />

      <div className="learn-progress">
        <span>{strings.learn.wordNofM(index + 1, words.length)}</span>
        <div className="bar" role="progressbar" aria-valuemin={1} aria-valuemax={words.length} aria-valuenow={index + 1}>
          <div className="bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="swipe-area" style={swipe.style} {...swipe.handlers}>
        <div key={index} className={`card-enter card-enter-${direction}`}>
          <WordCard word={words[index]} lang={langFromSettings(data.settings)} />
        </div>
      </div>

      <div className="learn-nav">
        <button type="button" className="btn btn-icon" aria-label={strings.learn.previous} disabled={!reading || index === 0} onClick={() => go(-1)}>
          ‹
        </button>
        <span className="hint">{strings.learn.swipeHint}</span>
        <button type="button" className="btn btn-icon" aria-label={strings.learn.next} disabled={!reading || onLastCard} onClick={() => go(1)}>
          ›
        </button>
      </div>

      {onLastCard && (
        <div className="learn-finish">
          {error && (
            <p className="error" role="alert">
              {strings.learn.saveFailed(error)}
            </p>
          )}
          <button type="button" className="btn btn-primary" disabled={phase === 'saving'} onClick={finish}>
            {phase === 'saving' ? strings.common.saving : phase === 'error' ? strings.common.retry : strings.learn.finishBatch}
          </button>
        </div>
      )}
    </main>
  )
}

function PostBatch({
  data,
  onNextBatch,
  onReview,
  onHome,
}: {
  data: UserData
  onNextBatch: () => void
  onReview: () => void
  onHome: () => void
}) {
  const { stats, settings } = data

  let title: string
  let subtitle: string | null = null
  let canContinue = false

  if (stats.learnPool === 0) {
    title = strings.learn.poolEmptyTitle
    subtitle = strings.learn.poolEmptySubtitle
  } else if (stats.remainingToday === 0) {
    title = strings.learn.capReachedTitle
    subtitle = strings.learn.capReachedSubtitle
  } else {
    title = strings.learn.newWordsToday(learnedToday(settings, new Date()), settings.dailyNewWordLimit)
    canContinue = true
  }

  const canReview = stats.reviewDue > 0
  // Exactly one primary button: the first action offered.
  const secondary = (primary: boolean) => (primary ? 'btn btn-primary' : 'btn btn-secondary')

  return (
    <section className="post-batch">
      <h2>{title}</h2>
      {subtitle && <p className="subtitle">{subtitle}</p>}
      <div className="post-batch-actions">
        {canContinue && (
          <button type="button" className={secondary(true)} onClick={onNextBatch}>
            {strings.learn.learnNextBatch}
          </button>
        )}
        {canReview && (
          <button type="button" className={secondary(!canContinue)} onClick={onReview}>
            {strings.learn.reviewDueWords(stats.reviewDue)}
          </button>
        )}
        <button type="button" className={secondary(!canContinue && !canReview)} onClick={onHome}>
          {strings.common.backToHome}
        </button>
      </div>
    </section>
  )
}
