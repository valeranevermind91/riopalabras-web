// A page for the real-browser review-log test (src/lib/reviewLog.browser.test.ts): ONE of the four real screens (Review, Learn, Matching or Cloze) over
// the real write queue, the real review log and its real learned-at store; the queue's sender only records what it is given. Everything the log
// sends is in window.__log (the entries, in order); progress rows are in window.__progress. Query: screen=review|learn|matching|cloze (default review),
// logfail=1 (the log's send always fails, as with a table that cannot be reached), learned=N (how many learned words, default 12), fresh=N (how many
// new words Learn can teach, default 12), interval=N and reps=N (the learned words' interval in days and repetitions, default 3 and 2: interval=0 reps=1 is a word
// introduced by Learn and not reviewed yet, which has no schedule in days), native=1 (the screen draws no Back arrow of its own: the back press is window.__nativeBack(),
// as with Telegram's BackButton). Besides the log and the progress rows, window.__sent records every settings patch, hidden-word and favourite write the queue is
// given and how many times today was marked active, and window.__state() is the words' scheduling fields and the settings as they are now. report=1 gives the Learn
// screen a sender for "Report a problem" (as for a signed-in user) that records every report in window.__reports and answers ok. verbs=1 makes the learned words twelve real verbs
// (tener, poder ...) whose example shows the voseo form (Vos tenés tiempo), for Cloze answered in another form of the verb.
// shape=one|wrap|glosses|tall makes the Cloze card taller or shorter (see SHAPES below), for the on-screen keyboard tests.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { applyProgressUpdates, applySettingsPatch } from '../data/mutations'
import type { FeedbackReport } from '../data/feedback'
import { createLearnedAtStore, createReviewLog, type ReviewLogEntry } from '../data/reviewLog'
import { parseSettings } from '../data/settings'
import { computeStats } from '../data/stats'
import type { ProgressUpdate, SettingsPatch, Word } from '../data/types'
import { createWriteQueue } from '../data/writeQueue'
import { wordKey } from '../data/words'
import { ClozeScreen } from '../screens/Cloze'
import { LearnScreen } from '../screens/Learn'
import { MatchingScreen } from '../screens/Matching'
import { ReviewScreen } from '../screens/Review'
import { makeWord } from './makeWord'
import { VOSEO_VERBS } from './voseoVerbs'

const params = new URLSearchParams(location.search)
const screen = params.get('screen') ?? 'review'
const reports: FeedbackReport[] = []
;(window as never as { __reports: FeedbackReport[] }).__reports = reports
const sent: { log: ReviewLogEntry[]; progress: ProgressUpdate[]; logAttempts: number; settings: SettingsPatch[]; hidden: unknown[]; favorites: unknown[]; active: number; seen: number[] } = {
  log: [],
  progress: [],
  logAttempts: 0,
  settings: [],
  hidden: [],
  favorites: [],
  active: 0,
  seen: [],
}
;(window as never as { __log: ReviewLogEntry[]; __progress: ProgressUpdate[]; __sent: typeof sent }).__log = sent.log
;(window as never as { __progress: ProgressUpdate[] }).__progress = sent.progress
;(window as never as { __sent: typeof sent }).__sent = sent

const queue = createWriteQueue(
  {
    sendProgress: async (updates) => void sent.progress.push(...updates),
    sendSettings: async (patch) => void sent.settings.push(patch),
    sendHidden: async (ops) => void sent.hidden.push(...ops),
    sendFavorites: async (ops) => void sent.favorites.push(...ops),
    sendLog: async (entries) => {
      sent.logAttempts++
      if (params.get('logfail') === '1') throw new Error('review_log is unreachable')
      sent.log.push(...entries)
    },
  },
  { retryDelaysMs: [1], logRetryDelaysMs: [1, 1], sleep: async () => {} },
)
const memory = () => {
  const items = new Map<string, string>()
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) }
}
const reviewLog = createReviewLog({ enqueue: queue.enqueueLog, learnedAt: createLearnedAtStore('harness-user', memory()) })

const DAY = 86_400_000
const LEARNED = Number(params.get('learned') ?? 12)
const FRESH = Number(params.get('fresh') ?? 12)
const INTERVAL = Number(params.get('interval') ?? 3)
const REPS = Number(params.get('reps') ?? 2)
const INFLECTED = params.get('inflected') === '1'
const VERBS = params.get('verbs') === '1'
const pad = (n: number) => String(n).padStart(2, '0')
// shape=one|wrap|glosses|tall: how tall a Cloze card is. one is the short sentence and the short glosses; wrap a sentence of two lines; glosses a sentence of two
// lines with the Russian and the English gloss each on a line of their own; tall a sentence of three lines and glosses of two lines each (the tallest card).
const SHAPE = params.get('shape') ?? 'one'
const SHAPES: Record<string, { sentence: (word: string) => string; ru?: string; en?: string }> = {
  one: { sentence: (w) => `Esta es la ${w} del día.` },
  wrap: { sentence: (w) => `Esta es la ${w} que te mostré ayer.` },
  glosses: { sentence: (w) => `Esta es la ${w} que te mostré ayer.`, ru: 'давняя знакомая, старая подруга', en: 'long-time acquaintance, old friend' },
  tall: {
    sentence: (w) => `Esta es la ${w} de la que te hablé ayer por la tarde, cuando nos vimos en la plaza.`,
    ru: 'давняя знакомая, старая подруга, с которой давно не виделись',
    en: 'long-time acquaintance, an old friend you have not seen for a long time',
  },
}
const shape = SHAPES[SHAPE] ?? SHAPES.one
const WORDS: readonly Word[] = [
  // learned and due, with an example the Cloze can blank and a translation each: Review, Matching and Cloze all use these
  ...Array.from({ length: LEARNED }, (_, i) =>
    makeWord(VERBS ? VOSEO_VERBS[i % VOSEO_VERBS.length].lemma : `vieja${pad(i + 1)}`, {
      rank: i + 1,
      repetitions: REPS,
      interval: INTERVAL,
      nextReview: new Date(Date.now() - DAY - i * 3_600_000),
      enTranslation: shape.en ?? `old${i + 1}`,
      ruTranslation: shape.ru ?? `старое${'абвгдежзиклмнопр'[i % 16]}${i + 1}`,
      // inflected=1: the example shows the plural (vieja01s), a form of the word, so Cloze can say which word it comes from
      exampleSentence: VERBS ? `Vos ${VOSEO_VERBS[i % VOSEO_VERBS.length].vos} tiempo.` : shape.sentence(`vieja${pad(i + 1)}${INFLECTED ? 's' : ''}`),
      wordFormInExample: VERBS ? VOSEO_VERBS[i % VOSEO_VERBS.length].vos : `vieja${pad(i + 1)}${INFLECTED ? 's' : ''}`,
      ...(VERBS ? { pos: 'v' } : {}),
    }),
  ),
  // new words for Learn
  ...Array.from({ length: FRESH }, (_, i) => makeWord(`nueva${pad(i + 1)}`, { rank: 100 + i, enTranslation: `new${i + 1}`, ruTranslation: `новое${i + 1}` })),
]

export function Harness() {
  const [words, setWords] = useState<readonly Word[]>(WORDS)
  const [settings, setSettings] = useState(() => parseSettings({ daily_new_word_limit: 20, onboarding_done: true }))
  const latest = useRef(settings)
  const latestWords = useRef(words)
  const applySettings = useCallback((patch: SettingsPatch) => {
    latest.current = applySettingsPatch(latest.current, patch)
    setSettings(latest.current)
  }, [])
  const applyProgress = useCallback((updates: readonly ProgressUpdate[]) => {
    latestWords.current = applyProgressUpdates(latestWords.current, updates)
    setWords(latestWords.current)
  }, [])
  const data = useMemo(
    () => ({ words, settings, stats: computeStats(words, settings, new Date()), getSettings: () => latest.current, getWords: () => latestWords.current, applySettings, applyProgress, applyHidden: () => {}, degraded: [], retryDegraded: () => {} }) as never,
    [words, settings, applySettings, applyProgress],
  )
  const backHandler = useRef<(() => boolean) | null>(null)
  useEffect(() => {
    const w = window as never as { __state: () => unknown; __nativeBack: () => void }
    w.__state = () => ({
      words: Object.fromEntries(
        latestWords.current.map((x) => [wordKey(x.esWord), { nextReview: x.nextReview?.toISOString() ?? null, interval: x.interval, repetitions: x.repetitions, easeFactor: x.easeFactor }]),
      ),
      settings: JSON.stringify(latest.current),
    })
    w.__nativeBack = () => void backHandler.current?.()
  }, [])
  const common = { data, queue, metrics: null, reviewLog, onHome: () => {} }
  if (screen === 'learn') {
    const native = params.get('native') === '1'
    const back = () => void backHandler.current?.()
    return (
      <LearnScreen
        {...common}
        metrics={{ markActiveToday: () => void sent.active++, noteLearnCardsSeen: (position: number) => void sent.seen.push(position) }}
        sendReport={params.get('report') === '1' ? async (report) => (reports.push(report), { ok: true as const }) : undefined}
        onReview={() => {}}
        onBack={native ? undefined : back}
        registerBack={(handler) => {
          backHandler.current = handler
        }}
      />
    )
  }
  if (screen === 'matching') return <MatchingScreen {...common} />
  if (screen === 'cloze') return <ClozeScreen {...common} />
  return <ReviewScreen {...common} onLearn={() => {}} />
}

createRoot(document.getElementById('root')!).render(<Harness />)
