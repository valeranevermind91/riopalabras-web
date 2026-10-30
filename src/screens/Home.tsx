import { useEffect, useMemo, type ReactNode } from 'react'
import { UnsavedNotice } from '../components/UnsavedNotice'
import { Notice } from '../components/Notice'
import { ScreenHeader } from '../components/ScreenHeader'
import type { MetricsRecorder } from '../data/metrics'
import { PRACTICE_MIN_WORDS, batchPracticeAvailable, clozeEligibleCount, matchingEligibleCount } from '../data/practice'
import { REVIEW_SESSION_SIZE } from '../data/review'
import { computeStats, type Stats } from '../data/stats'
import { homeAdvice, primaryTile, type HomeAdvice } from '../data/advice'
import { cardsToday, learnedToday, streakCards, streakCountedToday } from '../data/daily'
import { learnedTodayKeys, tomorrowPreview } from '../data/dayEnd'
import { WHATS_NEW, hasUnreadNews, type NewsEntry } from '../data/whatsNew'
import { wordKey } from '../data/words'
import { activityDots } from '../data/streakDots'
import type { Word } from '../data/types'
import type { DataState, UserData } from '../data/useUserData'
import { wordOfTheDay, type WordOfTheDay } from '../data/wordOfDay'
import type { WriteQueue } from '../data/writeQueue'
import type { AuthState } from '../lib/auth'
import { haptic } from '../lib/telegram'
import { useDueClock } from '../lib/useDueClock'
import { strings } from '../strings'

interface HomeScreenProps {
  auth: AuthState
  data: DataState
  onLearn: () => void
  onReview: () => void
  onMatching: () => void
  onCloze: () => void
  /** At the end of the day, Matching and Cloze on the words learned today (App builds the rounds / the scope). Without them the tiles open the usual practice. */
  onMatchingToday?: () => void
  onClozeToday?: () => void
  /** Opens a word's full card (the word of the day's "See the card"). */
  onOpenWord?: (word: Word) => void
  /** Opens the Words screen. */
  onWords?: () => void
  /** Opens Settings (theme, daily goal, translation, About, and Debug for those allowed). */
  onSettings?: () => void
  /** The "What's new" entries, for a test; the real ones otherwise. */
  news?: readonly NewsEntry[]
  queue: WriteQueue | null
  metrics: Pick<MetricsRecorder, 'captureStartOfDaySnapshotIfNeeded'> & Partial<Pick<MetricsRecorder, 'today'>> | null
  /** Dates with activity in the last days, read from the server (user_daily_metrics); null hides the dots. */
  activity?: ReadonlySet<string> | null
  /** "Now", injectable so the word of the day and the dots are testable. */
  now?: Date
}

export function HomeScreen({ auth, data, onLearn, onReview, onMatching, onCloze, onMatchingToday, onClozeToday, onWords, onSettings, news = WHATS_NEW, onOpenWord, queue, metrics, activity = null, now: nowProp }: HomeScreenProps) {
  // The time the counts are taken at: when Home is shown (it remounts on navigation), so "due" and "today" are never stale. A word rated Again is
  // due in ten minutes and the Review count does not hold it until then (Review would not hand it out): so that the number does not stay as it
  // was while Home stays open, the counts are taken again the moment the next such word comes due, and when the app comes back to the foreground
  // (a Mini App left open overnight would otherwise keep yesterday's date, and with it yesterday's word of the day and yesterday's counts).
  // The same clock the Review end screen counts from (useDueClock).
  const { asOf } = useDueClock(data.status === 'ready' ? data.data.words : null, { timed: !nowProp })
  const at = nowProp ?? asOf
  const stats = useMemo(() => (data.status === 'ready' ? computeStats(data.data.words, data.data.settings, at) : null), [data, at])

  // How many words each practice exercise can use, and today's word.
  const extras = useMemo(() => {
    if (data.status !== 'ready') return null
    return {
      matching: matchingEligibleCount(data.data.words, data.data.settings),
      cloze: clozeEligibleCount(data.data.words),
    }
  }, [data])
  // Today's word, for the date Home was last taken at (see asOf above), so it moves on when the app returns on a new day.
  const wotd = useMemo(() => (data.status === 'ready' ? wordOfTheDay(data.data.words, data.data.settings, at) : null), [data, at])

  // The start-of-day snapshot (due / pool / limit), captured the first time Home shows each day; a no-op after that.
  useEffect(() => {
    if (stats && metrics) {
      metrics.captureStartOfDaySnapshotIfNeeded({ reviewDue: stats.reviewDue, learnPool: stats.learnPool, dailyLimit: stats.dailyLimit })
    }
  }, [stats, metrics])

  const advice = stats ? homeAdvice({ reviewDue: stats.reviewDue, learnPool: stats.learnPool, remainingToday: stats.remainingToday }) : null
  // The end of the day (src/data/dayEnd.ts): once today's new words are done, Home says what was done and what tomorrow brings, and the practice on today's words is the one
  // thing left to do. Nothing is offered that is not due, and nothing past the goal. Only worked out in that state, and only when some new words were learned today.
  const day = useMemo(() => {
    if (advice !== 'allDoneToday' || data.status !== 'ready') return null
    const { words, settings } = data.data
    const learned = learnedToday(settings, at)
    if (learned === 0) return null
    const keys = learnedTodayKeys(words, at)
    return {
      learned,
      tomorrow: tomorrowPreview(words, settings, at),
      matching: keys.size > 0 && batchPracticeAvailable(words, keys, settings),
      cloze: keys.size > 0 && clozeEligibleCount(words.filter((w) => keys.has(wordKey(w.esWord)))) >= PRACTICE_MIN_WORDS,
    }
  }, [advice, data, at])
  const practiceNow = day !== null && (day.matching || (extras?.matching ?? 0) >= PRACTICE_MIN_WORDS)
  const tiles = extras && stats ? buildTiles(stats, extras, { onLearn, onReview, onMatching, onCloze, onMatchingToday, onClozeToday }, advice ? primaryTile(advice, practiceNow) : null, day) : []
  const now = nowProp ?? new Date()

  return (
    <main className="screen home">
      <ScreenHeader brand title={strings.appTitle} actions={
          (onWords || onSettings) && (
            <>
              {onWords && <WordsButton onClick={onWords} />}
              {onSettings && <SettingsButton onClick={onSettings} unread={data.status === 'ready' && hasUnreadNews(data.data.settings, now, news)} />}
            </>
          )
        }
      />

      {stats && data.status === 'ready' ? (
        <>
          <StatusRow
            streak={stats.streak}
            activity={activity}
            todayActive={metrics?.today?.(now)?.active === true}
            now={now}
            today={streakCountedToday(data.data.settings, now) ? null : { done: cardsToday(data.data.settings, now), needed: streakCards(data.data.settings.dailyNewWordLimit) }}
          />

          {advice && <p className="home-advice">{adviceText(advice, stats, day)}</p>}

          {queue && <UnsavedNotice queue={queue} />}
          {data.data.degraded.length > 0 && <DegradedNotice data={data.data} />}

          {wotd ? <WordOfTheDayCard wotd={wotd} onOpen={onOpenWord} /> : <div className="home-spacer" />}

          <div className="home-grid">
            {tiles.map((tile) => (
              <button
                key={tile.id}
                type="button"
                className={`tile tile-${tile.id}${tile.primary ? ' is-primary' : ''}`}
                data-tile={tile.id}
                disabled={tile.disabled}
                onClick={() => {
                  haptic('tap')
                  tile.onPress()
                }}
              >
                <svg className="tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {TILE_ICONS[tile.id]}
                </svg>
                <span className="tile-text">
                  <span className="tile-label">{tile.label}</span>
                  <span className="tile-sub">{tile.disabled ? tile.reason : tile.es}</span>
                </span>
                {!tile.disabled && tile.count !== null && <span className="tile-count">{tile.count}</span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <section className="card">
          <HomeStatus auth={auth} data={data} />
        </section>
      )}

    </main>
  )
}

/**
 * The streak and the week of dots. They are two readings of two sources and are not reconciled: the number is the stored
 * streak (streak_count with streak_last_activity_date, in the settings: the one both apps write; it has no cap and does not
 * depend on metrics rows landing), the dots are the last seven days that user_daily_metrics says were active. A day the
 * stored streak counted whose metrics row never arrived shows as a gap under a number that keeps counting.
 *
 * The number is shown whenever the settings are (a 0 is a real 0); without them (`streak` null) it is left out rather than shown
 * as 0. The dots are left out while their data is not there (still loading, or the read failed), and the number stays.
 */
function StatusRow({ streak, activity, todayActive, now, today }: { streak: number | null; activity: ReadonlySet<string> | null; todayActive: boolean; now: Date; today: { done: number; needed: number } | null }) {
  if (streak === null && !activity) return null
  const dots = activity ? activityDots(now, activity, todayActive) : null
  return (
    <div className="home-status">
      <div className="streak">
        {dots && (
          <span className="streak-dots" role="img" aria-label={strings.home.streakDots(dots.filter((d) => d.active).length)}>
            {dots.map((d) => (
              <span key={d.date} className={d.today ? 'streak-day is-today' : 'streak-day'} data-date={d.date}>
                <span className={`streak-dot${d.active ? ' is-active' : ''}${d.today ? ' is-today' : ''}`} />
                <span className="streak-letter">{d.letter}</span>
              </span>
            ))}
          </span>
        )}
        {streak !== null && <span>{strings.home.streak(streak)}</span>}
        {/* How far today is from counting (the daily goal in cards, up to 10; see streakCards and dayPatch), as a few words, not a bar: nothing once the day counts. */}
        {streak !== null && today && <span className="streak-today">{strings.home.streakToday(today.done, today.needed)}</span>}
      </div>
    </div>
  )
}

function WordOfTheDayCard({ wotd, onOpen }: { wotd: WordOfTheDay; onOpen?: (word: Word) => void }) {
  const { sentence, range } = wotd
  return (
    <section className="wotd" aria-label={strings.home.wotdTitle}>
      <div className="wotd-head">
        <h2 className="wotd-word">{wotd.headword}</h2>
        <span className="pill">{strings.home.wotdPill}</span>
      </div>
      <p className="wotd-sentence">
        {sentence.slice(0, range.start)}
        <mark>{sentence.slice(range.start, range.end)}</mark>
        {sentence.slice(range.end)}
      </p>
      <hr className="wotd-divider" />
      {wotd.translations.length > 0 && <p className="wotd-translation">{wotd.translations.join(' · ')}</p>}
      {onOpen && (
        <button type="button" className="link-btn" onClick={() => onOpen(wotd.word)}>
          {strings.home.seeCard}
        </button>
      )}
    </section>
  )
}

export type TileId = 'learn' | 'review' | 'matching' | 'cloze'

/** What Home knows at the end of the day: today's new words, what tomorrow brings, and whether Matching / Cloze can run on today's words. */
interface DayEnd {
  learned: number
  tomorrow: { reviews: number; fresh: number }
  matching: boolean
  cloze: boolean
}

interface Tile {
  id: TileId
  label: string
  /** The Spanish word under the label. */
  es: string
  /** Learn and Review show a count; the practice tiles do not. */
  count: number | null
  disabled: boolean
  /** Why a disabled tile is disabled, shown in place of the Spanish word. */
  reason: string
  /** The one tile the advice points at: drawn filled, where the others are soft. */
  primary: boolean
  onPress: () => void
}

/** The line of advice, with the numbers it needs: how many are due (all of them, not one session's worth; past one session it also says how many a session holds), and how many new words a batch would offer. */
function adviceText(advice: HomeAdvice, stats: Stats, day: DayEnd | null): string {
  const t = strings.home.advice
  switch (advice) {
    case 'reviewFirst':
      return t.reviewFirst(stats.reviewDue, REVIEW_SESSION_SIZE)
    case 'learnNew':
      return t.learnNew(stats.newToLearn)
    case 'allDoneToday':
      // what was done and what comes next, and a pointer to the practice when today's words can be practised; the plain line when nothing new was learned today (the goal is 0)
      return day ? [t.doneToday(day.learned, day.tomorrow.reviews, day.tomorrow.fresh), day.matching || day.cloze ? t.practiceToday : null].filter(Boolean).join(' ') : t.allDoneToday
    case 'poolEmpty':
      return t.poolEmpty
    case 'allClear':
      return t.allClear
  }
}

/** The four action tiles, in grid order: Learn, Review / Matching, Cloze. */
function buildTiles(
  stats: Stats,
  practice: { matching: number; cloze: number },
  on: { onLearn: () => void; onReview: () => void; onMatching: () => void; onCloze: () => void; onMatchingToday?: () => void; onClozeToday?: () => void },
  primary: TileId | null,
  day: DayEnd | null,
): Tile[] {
  const t = strings.home.tiles
  const need = strings.practice.needWords
  return [
    {
      id: 'learn',
      label: t.learn.label,
      es: t.learn.es,
      count: stats.newToLearn,
      disabled: stats.newToLearn === 0,
      reason: stats.learnPool === 0 ? strings.home.learnPoolEmpty : stats.dailyLimit === 0 ? strings.home.learnGoalOff : strings.home.learnCapReached,
      primary: primary === 'learn',
      onPress: on.onLearn,
    },
    { id: 'review', label: t.review.label, es: t.review.es, count: stats.reviewDue, disabled: stats.reviewDue === 0, reason: strings.home.reviewNothingDue, primary: primary === 'review', onPress: on.onReview },
    // at the end of the day Matching (and Cloze) open on today's words, when they can run on them; otherwise, and at any other time, the usual practice
    { id: 'matching', label: t.matching.label, es: t.matching.es, count: null, disabled: practice.matching < PRACTICE_MIN_WORDS, reason: need, primary: primary === 'matching', onPress: day?.matching && on.onMatchingToday ? on.onMatchingToday : on.onMatching },
    { id: 'cloze', label: t.cloze.label, es: t.cloze.es, count: null, disabled: practice.cloze < PRACTICE_MIN_WORDS, reason: need, primary: false, onPress: day?.cloze && on.onClozeToday ? on.onClozeToday : on.onCloze },
  ]
}

const TILE_ICONS: Record<TileId, ReactNode> = {
  learn: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z" />
    </>
  ),
  review: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v5h-5" />
    </>
  ),
  matching: (
    <>
      <rect x="3" y="4" width="7" height="6" rx="1.5" />
      <rect x="14" y="14" width="7" height="6" rx="1.5" />
      <path d="M10 7h2a2 2 0 0 1 2 2v6" />
    </>
  ),
  cloze: (
    <>
      <path d="M4 7h4M12 7h8M4 12h8M16 12h4M4 17h6" />
      <path d="M10 17h4" strokeDasharray="1 2.5" />
    </>
  ),
}

/** Favorites / hidden words didn't load yet and are being retried in the background. */
function DegradedNotice({ data }: { data: UserData }) {
  const names = data.degraded.map((table) => strings.home.degradedTables[table] ?? table)
  return (
    <Notice actionLabel={strings.home.retryNow} onAction={data.retryDegraded}>
      {strings.home.degraded(names)}
      {data.degraded.includes('user_hidden_words') && ` ${strings.home.degradedHiddenWarning}`}
    </Notice>
  )
}

/** The way into the Words screen: a round icon button in the header, left of the gear. */
function WordsButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn" aria-label={strings.home.wordsButton} title={strings.home.wordsButton} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 6h12M8 12h12M8 18h12" />
        <path d="M4 6h.01M4 12h.01M4 18h.01" />
      </svg>
    </button>
  )
}

/** The way into Settings: a gear, the last button in the header. */
function SettingsButton({ onClick, unread }: { onClick: () => void; unread: boolean }) {
  const label = unread ? strings.home.settingsButtonNew : strings.home.settingsButton
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={onClick}>
      {unread && <span className="news-dot news-dot-corner" aria-hidden="true" />}
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    </button>
  )
}

function HomeStatus({ auth, data }: { auth: AuthState; data: DataState }) {
  if (auth.status === 'error') return <p className="error">{strings.debug.signInFailed(auth.message)}</p>
  if (auth.status === 'no-telegram') return <p>{strings.common.signInPrompt}</p>
  if (auth.status === 'loading' || data.status === 'loading') return <p>{strings.common.loading}</p>
  if (data.status === 'error') {
    return (
      <>
        <p className="error">{strings.common.loadFailed(data.message)}</p>
        <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
          {strings.common.reload}
        </button>
      </>
    )
  }
  return <p>{strings.common.loading}</p>
}
