// A page for the real-browser swipe test (src/lib/swipe.touch.test.ts): the real Learn screen over synthetic words,
// with options in the query string:
//   long=1  the cards have a lot of content, so the card itself scrolls
//   wrap=1  the whole screen sits inside another scrollable container
//   raw=1   drops the app's touch-action rule for the swipe area (to show the test notices the failure it guards against)
import { createRoot } from 'react-dom/client'
import '../index.css'
import { createWriteQueue } from '../data/writeQueue'
import { parseSettings } from '../data/settings'
import { LearnScreen } from '../screens/Learn'
import { makeWord } from './makeWord'

const q = new URLSearchParams(location.search)
const long = q.get('long') === '1'
const filler = Array.from({ length: 14 }, (_, i) => `Frase de relleno número ${i + 1}, bastante larga para que la tarjeta tenga que desplazarse.`).join(' ')

const words = Array.from({ length: 30 }, (_, i) =>
  makeWord(`palabra${String(i + 1).padStart(2, '0')}`, {
    rank: i + 1,
    exampleSentence: long ? `Esta es la palabra${String(i + 1).padStart(2, '0')}. ${filler}` : `Esta es la palabra${String(i + 1).padStart(2, '0')} del día.`,
    wordFormInExample: `palabra${String(i + 1).padStart(2, '0')}`,
    exampleTranslationEn: long ? filler : 'This is the word of the day.',
    exampleTranslationRu: long ? filler : 'Это слово дня.',
  }),
)
const settings = parseSettings({ daily_new_word_limit: 10 })
const queue = createWriteQueue({ sendProgress: async () => {}, sendSettings: async () => {}, sendHidden: async () => {} })
const data = { words, settings, getSettings: () => settings, applySettings: () => {}, applyProgress: () => {}, applyHidden: () => {} } as never

// What the browser actually delivers, counted at the document, before any app handler.
const log: Record<string, number> = {}
;(window as never as { __log: Record<string, number> }).__log = log
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel'])
  document.addEventListener(type, () => (log[type] = (log[type] ?? 0) + 1), { capture: true, passive: true })

if (q.get('raw') === '1') {
  const style = document.createElement('style')
  style.textContent = '.swipe-area, .swipe-area * { touch-action: auto !important; } .swipe-area { touch-action: pan-y !important; }'
  document.head.append(style)
}

const screen = <LearnScreen data={data} queue={queue} metrics={null} onHome={() => {}} onReview={() => {}} />
createRoot(document.getElementById('root')!).render(
  q.get('wrap') === '1' ? <div id="outer" style={{ height: '100dvh', overflowY: 'auto' }}>{screen}</div> : screen,
)
