// A page for the real-browser Words test (src/lib/words.browser.test.ts): the real Words list and word detail over the
// real 4,753-word dictionary, with a little progress, a few favourites and some hidden words, and a write queue whose
// senders just record what they are given (window.__sent). The list and the detail swap the way App swaps them.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { effectiveLanguage, setLanguage, useLanguage } from '../lib/language'
import '../index.css'
import { parseDictionary } from '../data/dictionary'
import { createTombstoneClearer } from '../data/customWords'
import type { EnrichResult } from '../data/enrich'
import { applyFavoriteFlag, applyHiddenFlag, applyProgressUpdates, applySettingsPatch, removeCustomWord, upsertCustomWord } from '../data/mutations'
import { parseRioOverlay } from '../data/rio'
import { isInLearnPool } from '../data/stats'
import { isReferenceOnly } from '../data/wordState'
import { parseSettings } from '../data/settings'
import { createViewStore } from '../data/wordList'
import { wordKey } from '../data/words'
import { createWriteQueue } from '../data/writeQueue'
import type { CustomWordOp, Word } from '../data/types'
import { WordDetail } from '../screens/WordDetail'
import { WordsScreen } from '../screens/Words'

const sent: { favorites: unknown[]; hidden: unknown[]; settings: Record<string, unknown>[]; words: CustomWordOp[]; order: string[] } = { favorites: [], hidden: [], settings: [], words: [], order: [] }
;(window as never as { __sent: typeof sent }).__sent = sent

// Deleted words' tombstones are cleared once the delete went through, as in the app.
const tombstones = createTombstoneClearer()
const queue = createWriteQueue(
  {
    sendProgress: async () => {},
    sendSettings: async (patch) => {
      sent.settings.push(patch)
      sent.order.push(`settings:${Object.keys(patch).sort().join(',')}`)
    },
    sendFavorites: async (ops) => void sent.favorites.push(...ops),
    sendHidden: async (ops) => void sent.hidden.push(...ops),
    sendWords: async (ops) => {
      sent.words.push(...ops)
      for (const op of ops) sent.order.push(`words:${op.kind}`)
    },
  },
  { retryDelaysMs: [1], sleep: async () => {}, onWordsDeleted: tombstones.clear },
)

// The proxy's /enrich is stubbed: a test sets window.__enrichImpl to say what comes back (or never does); every request is recorded.
const enrichCalls: { word: string; pos: string | null }[] = []
;(window as never as { __enrichCalls: typeof enrichCalls }).__enrichCalls = enrichCalls
const enrich = (input: { word: string; pos: string | null }): Promise<EnrichResult> => {
  enrichCalls.push(input)
  const impl = (window as never as { __enrichImpl?: (i: typeof input) => Promise<EnrichResult> }).__enrichImpl
  return impl
    ? impl(input)
    : Promise.resolve({
        ok: true,
        value: { enTranslation: 'little squash', ruTranslation: 'кабачок', exampleSentence: 'Me gusta el zapallito.', exampleTranslationEn: 'I like little squash.', exampleTranslationRu: 'Мне нравится кабачок.', esRioplatense: null, isRioplatenseVariant: false, region: null, register: null, esStandard: null },
      })
}
;(window as never as { __queue: typeof queue }).__queue = queue

async function boot() {
  const [dictionary, rio] = await Promise.all([fetch('/words_enriched.json').then((r) => r.json()), fetch('/rio_overlay.json').then((r) => r.json())])
  const base = parseDictionary(dictionary, parseRioOverlay(rio))
  const day = 24 * 60 * 60 * 1000
  const now = Date.now()
  // Progress for the 40 most common reviewable words: some due, some established, some just learned.
  const learned = base.filter((w) => !isReferenceOnly(w)).slice(0, 40)
  const updates = learned.map((w, i) => ({ esWord: w.esWord, easeFactor: 2.5, interval: i % 3 === 0 ? 0 : 5, repetitions: i % 3 === 0 ? 1 : i % 3 === 1 ? 3 : 2, nextReview: new Date(now + (i % 4 === 0 ? -day : (i + 1) * day)) }))
  // One lapsed word: learned once, rated Again, so it reads as new again but keeps a stored schedule.
  const reviewable = base.filter((w) => !isReferenceOnly(w))
  const lapsed = reviewable[60]
  updates.push({ esWord: lapsed.esWord, easeFactor: 2.18, interval: 0, repetitions: 0, nextReview: new Date(now - day) })
  // Two words that read alike on the cards: cigarro and cigarrillo are both "pucho".
  for (const esWord of ['cigarro', 'cigarrillo']) updates.push({ esWord, easeFactor: 2.5, interval: 6, repetitions: 2, nextReview: new Date(now + 3 * day) })
  const withProgress = applyProgressUpdates(base, updates)
  const hide = applyHiddenFlag(withProgress, [base[100].esWord, base[101].esWord], true)
  const start = applyFavoriteFlag(hide, [base[0].esWord], true)
  // Words that can be queued (not started, teachable), after the ones given progress; ?picks=N starts with the first N already queued.
  const fresh = start.filter(isInLearnPool).map((w) => w.esWord)
  const preQueued = Number(new URLSearchParams(location.search).get('picks') ?? 0)
  ;(window as never as { __fixture: unknown }).__fixture = { lapsed: lapsed.esWord, hidden: [base[100].esWord, base[101].esWord], favourite: base[0].esWord, fresh, learned: learned.slice(0, 3).map((w) => w.esWord) }
  createRoot(document.getElementById('root')!).render(<Harness start={start} picks={fresh.slice(0, preQueued).map((w) => w.toLowerCase())} />)
  ;(window as never as { __ready: boolean }).__ready = true
}

export function Harness({ start, picks = [] }: { start: readonly Word[]; picks?: readonly string[] }) {
  useLanguage() // as App does: everything below re-renders when the language changes
  const [words, setWords] = useState(start)
  const [open, setOpen] = useState<string | null>(null)
  const [viewStore] = useState(createViewStore)
  // Telegram's back button, as App wires it: a screen with a sheet open takes the press first.
  const backInterceptor = useRef<(() => boolean) | null>(null)
  const registerBack = useCallback((handler: (() => boolean) | null) => {
    backInterceptor.current = handler
  }, [])
  useEffect(() => {
    ;(window as never as { __pressBack: () => string }).__pressBack = () => (backInterceptor.current?.() ? 'closed-sheet' : 'left')
  }, [])
  const [settings, setSettings] = useState(() => parseSettings({ daily_new_word_limit: 10, ...(picks.length > 0 ? { learn_picks: picks } : {}), a_future_key: { kept: true }, ...(new URLSearchParams(location.search).get('lang') ? { ui_language: new URLSearchParams(location.search).get('lang') } : {}), ...(new URLSearchParams(location.search).get('ru') === '0' ? { show_ru_translation: false } : {}) }))
  useEffect(() => {
    setLanguage(effectiveLanguage(settings.uiLanguage))
  }, [settings.uiLanguage])
  const latestSettings = useRef(settings)
  const getSettings = useCallback(() => latestSettings.current, [])
  const applySettings = useCallback((patch: Record<string, unknown>) => {
    latestSettings.current = applySettingsPatch(latestSettings.current, patch)
    setSettings(latestSettings.current)
  }, [])
  const applyFavorite = useCallback((esWords: readonly string[], favorite: boolean) => setWords((w) => applyFavoriteFlag(w, esWords, favorite)), [])
  const applyHidden = useCallback((esWords: readonly string[], hidden: boolean) => setWords((w) => applyHiddenFlag(w, esWords, hidden)), [])
  const upsertCustom = useCallback((word: Word) => setWords((w) => upsertCustomWord(w, word)), [])
  const removeCustom = useCallback((esWord: string) => setWords((w) => removeCustomWord(w, esWord)), [])
  useEffect(() => {
    tombstones.use({ read: getSettings, apply: applySettings })
    return () => tombstones.use(null)
  }, [getSettings, applySettings])
  const data = { words, settings, getSettings, applySettings, applyFavorite, applyHidden, upsertCustomWord: upsertCustom, removeCustomWord: removeCustom } as never

  const opened = open ? words.find((w) => wordKey(w.esWord) === open) : undefined
  if (opened) return <WordDetail word={opened} data={data} queue={queue} registerBack={registerBack} onDeleted={() => setOpen(null)} onBack={() => setOpen(null)} />
  return <WordsScreen data={data} queue={queue} savedView={viewStore.get()} onViewChange={viewStore.set} registerBack={registerBack} enrich={enrich} onOpen={(esWord) => setOpen(wordKey(esWord))} />
}

void boot()
