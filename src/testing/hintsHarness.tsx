// A page for the real-browser hints test (src/lib/hints.browser.test.ts): the real Home, word page, Learn and Settings, as App swaps them, over the real dictionary, with a write queue whose
// senders only record (window.__sent.settings). Query: user=new|returning (returning has learned words and some due), seen=tour,word-queue (the hints_seen already in the blob),
// stars=1 (words already in the learning queue), wordqueued=1 (the Word page's own word is in it), lang=ru|en, goal=5 (the daily goal), word=plata (the word the Word page opens on), screen=home|word|learn|settings.
// window.__notice(true) puts a data-loading notice between the advice card and the Word of the day (which moves the tiles where the page is tight); window.__screen() names the screen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { localYesterdayKey } from '../data/dates'
import { parseDictionary } from '../data/dictionary'
import { parseNounGender } from '../data/gender'
import { applyFavoriteFlag, applyHiddenFlag, applyProgressUpdates, applySettingsPatch } from '../data/mutations'
import { parseFallbackExamples, parseRioOverlay } from '../data/rio'
import { parseSettings } from '../data/settings'
import { computeStats } from '../data/stats'
import { isReferenceOnly } from '../data/wordState'
import { wordKey } from '../data/words'
import { createWriteQueue } from '../data/writeQueue'
import type { ProgressUpdate, SettingsPatch, Word } from '../data/types'
import { effectiveLanguage, setLanguage, useLanguage } from '../lib/language'
import { HomeScreen } from '../screens/Home'
import { LearnScreen } from '../screens/Learn'
import { SettingsScreen } from '../screens/Settings'
import { WordDetail } from '../screens/WordDetail'

const params = new URLSearchParams(location.search)
const userKind = params.get('user') ?? 'new'
const startScreen = (params.get('screen') ?? 'home') as 'home' | 'word' | 'learn' | 'settings'
const WORD = params.get('word') ?? 'plata'

const sent: { settings: SettingsPatch[] } = { settings: [] }
;(window as never as { __sent: typeof sent }).__sent = sent
const queue = createWriteQueue(
  { sendProgress: async () => {}, sendSettings: async (patch) => void sent.settings.push(patch), sendFavorites: async () => {}, sendHidden: async () => {}, sendWords: async () => {} },
  { retryDelaysMs: [1], sleep: async () => {} },
)
// every patch that reaches the queue is recorded as it is made, in order (the queue sends them later and may merge them)
const enqueueSettings = queue.enqueueSettings.bind(queue)
const made: SettingsPatch[] = []
;(window as never as { __made: typeof made }).__made = made
queue.enqueueSettings = (patch: SettingsPatch) => {
  made.push(patch)
  return enqueueSettings(patch)
}

async function boot() {
  const [dictionary, rio, fallback, gender] = await Promise.all(['words_enriched', 'rio_overlay', 'examples_fallback', 'noun_gender'].map((f) => fetch(`/${f}.json`).then((r) => r.json())))
  const base = parseDictionary(dictionary, parseRioOverlay(rio), parseFallbackExamples(fallback), parseNounGender(gender))
  const day = 24 * 3600_000
  const now = Date.now()
  let words: readonly Word[] = base
  if (userKind === 'returning') {
    // 40 words learned, 7 of them due now
    const learned = base.filter((w) => !isReferenceOnly(w) && wordKey(w.esWord) !== WORD).slice(0, 40)
    const updates: ProgressUpdate[] = learned.map((w, i) => ({ esWord: w.esWord, easeFactor: 2.5, interval: i % 3 === 0 ? 1 : i % 3 === 1 ? 12 : 5, repetitions: i % 3 === 0 ? 1 : i % 3 === 1 ? 3 : 2, nextReview: new Date(now + (i < 7 ? -day / 2 : (i - 5) * day)) }))
    words = applyProgressUpdates(words, updates)
  }
  const stars = Number(params.get('stars') ?? 0)
  if (stars > 0) words = applyFavoriteFlag(words, base.filter((w) => !isReferenceOnly(w) && wordKey(w.esWord) !== WORD).slice(100, 100 + stars).map((w) => w.esWord), true, now)
  if (params.get('wordqueued') === '1') words = applyFavoriteFlag(words, [WORD], true, now)
  createRoot(document.getElementById('root')!).render(<Harness start={words} />)
  document.body.dataset.ready = '1'
}

export function Harness({ start }: { start: readonly Word[] }) {
  useLanguage()
  const [words, setWords] = useState(start)
  const latestWords = useRef(start)
  const [screen, setScreen] = useState<'home' | 'word' | 'learn' | 'settings'>(startScreen)
  const [replayTour, setReplayTour] = useState(false)
  const [notice, setNotice] = useState(false)
  const seen = (params.get('seen') ?? '').split(',').filter(Boolean)
  const [settings, setSettings] = useState(() =>
    parseSettings({
      ui_language: params.get('lang') ?? 'ru',
      daily_new_word_limit: Number(params.get('goal') ?? 5),
      ...(seen.length > 0 ? { hints_seen: seen } : {}),
      ...(userKind === 'returning' ? { streak_count: 6, streak_last_activity_date: localYesterdayKey(new Date()) } : {}),
    }),
  )
  const latest = useRef(settings)
  useEffect(() => {
    setLanguage(effectiveLanguage(settings.uiLanguage))
  }, [settings.uiLanguage])
  useEffect(() => {
    ;(window as never as { __notice: (on: boolean) => void }).__notice = setNotice
    ;(window as never as { __screen: () => string }).__screen = () => screen
  }, [screen])
  const applySettings = useCallback((patch: SettingsPatch) => {
    latest.current = applySettingsPatch(latest.current, patch)
    setSettings(latest.current)
  }, [])
  const apply = useCallback((fn: (w: readonly Word[]) => readonly Word[]) => {
    latestWords.current = fn(latestWords.current)
    setWords(latestWords.current)
  }, [])
  const applyProgress = useCallback((updates: readonly ProgressUpdate[]) => apply((w) => applyProgressUpdates(w, updates)), [apply])
  const applyFavorite = useCallback((esWords: readonly string[], favorite: boolean) => apply((w) => applyFavoriteFlag(w, esWords, favorite)), [apply])
  const applyHidden = useCallback((esWords: readonly string[], hidden: boolean) => apply((w) => applyHiddenFlag(w, esWords, hidden)), [apply])
  const data = useMemo(
    () => ({ words, settings, stats: computeStats(words, settings, new Date()), getSettings: () => latest.current, getWords: () => latestWords.current, applyProgress, applySettings, applyFavorite, applyHidden, degraded: notice ? ['user_hidden_words'] : [], retryDegraded: () => {}, upsertCustomWord: () => {}, removeCustomWord: () => {}, diagnostics: {} }) as never,
    [words, settings, applyProgress, applySettings, applyFavorite, applyHidden, notice],
  )

  const opened = words.find((w) => wordKey(w.esWord) === WORD)!
  if (screen === 'settings') {
    return (
      <SettingsScreen
        data={data}
        queue={queue}
        theme={{ choice: 'system', set: () => {} }}
        onOpenDebug={() => {}}
        onShowHints={() => {
          setReplayTour(true)
          setScreen('home')
        }}
        onBack={() => setScreen('home')}
      />
    )
  }
  if (screen === 'word') return <WordDetail word={opened} data={data} queue={queue} onOpenLearn={() => setScreen('learn')} onBack={() => setScreen('home')} />
  if (screen === 'learn') return <LearnScreen data={data} queue={queue} metrics={null} onHome={() => setScreen('home')} onReview={() => {}} onBack={() => setScreen('home')} />
  return (
    <HomeScreen
      auth={{ status: 'no-telegram' }}
      data={{ status: 'ready', data } as never}
      onLearn={() => setScreen('learn')}
      onReview={() => {}}
      onOpenWord={() => setScreen('word')}
      onMatching={() => {}}
      onCloze={() => {}}
      onWords={() => {}}
      onSettings={() => setScreen('settings')}
      news={[]}
      queue={queue}
      metrics={null}
      replayTour={replayTour}
      onTourEnd={() => setReplayTour(false)}
    />
  )
}

void boot()
