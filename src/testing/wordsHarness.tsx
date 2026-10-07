// A page for the real-browser Words test (src/lib/words.browser.test.ts): the real Words list and word detail over the
// real 4,753-word dictionary, with a little progress, a few favourites and some hidden words, and a write queue whose
// senders just record what they are given (window.__sent). The list and the detail swap the way App swaps them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { parseDictionary } from '../data/dictionary'
import { applyFavoriteFlag, applyHiddenFlag, applyProgressUpdates } from '../data/mutations'
import { parseRioOverlay } from '../data/rio'
import { isReferenceOnly } from '../data/wordState'
import { parseSettings } from '../data/settings'
import { createViewStore } from '../data/wordList'
import { wordKey } from '../data/words'
import { createWriteQueue } from '../data/writeQueue'
import type { Word } from '../data/types'
import { WordDetail } from '../screens/WordDetail'
import { WordsScreen } from '../screens/Words'

const sent: { favorites: unknown[]; hidden: unknown[] } = { favorites: [], hidden: [] }
;(window as never as { __sent: typeof sent }).__sent = sent

const queue = createWriteQueue(
  { sendProgress: async () => {}, sendSettings: async () => {}, sendFavorites: async (ops) => void sent.favorites.push(...ops), sendHidden: async (ops) => void sent.hidden.push(...ops) },
  { retryDelaysMs: [1], sleep: async () => {} },
)
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
  ;(window as never as { __fixture: unknown }).__fixture = { lapsed: lapsed.esWord, hidden: [base[100].esWord, base[101].esWord], favourite: base[0].esWord }
  createRoot(document.getElementById('root')!).render(<Harness start={start} />)
  ;(window as never as { __ready: boolean }).__ready = true
}

export function Harness({ start }: { start: readonly Word[] }) {
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
  const settings = useMemo(() => parseSettings({ daily_new_word_limit: 10 }), [])
  const applyFavorite = useCallback((esWords: readonly string[], favorite: boolean) => setWords((w) => applyFavoriteFlag(w, esWords, favorite)), [])
  const applyHidden = useCallback((esWords: readonly string[], hidden: boolean) => setWords((w) => applyHiddenFlag(w, esWords, hidden)), [])
  const data = { words, settings, applyFavorite, applyHidden } as never

  const opened = open ? words.find((w) => wordKey(w.esWord) === open) : undefined
  if (opened) return <WordDetail word={opened} data={data} queue={queue} onBack={() => setOpen(null)} />
  return <WordsScreen data={data} queue={queue} savedView={viewStore.get()} onViewChange={viewStore.set} registerBack={registerBack} onOpen={setOpen} />
}

void boot()
