// A page for the real-browser test of a noun's article on the cards (src/lib/genderCards.browser.test.ts): the real dictionary, overlay and noun articles, and the real WordCard and
// ReviewCard (front and back) for the words named in the query: ?words=casa,agua,vicepresidente (dictionary keys). Each card sits in a screen, as in the app.
import { createRoot } from 'react-dom/client'
import '../index.css'
import { CardHeadword } from '../components/CardHeadword'
import { ReviewCard } from '../components/ReviewCard'
import { WordCard } from '../components/WordCard'
import { parseDictionary } from '../data/dictionary'
import { parseNounGender } from '../data/gender'
import { parseFallbackExamples, parseRioOverlay } from '../data/rio'
import { wordKey } from '../data/words'
import { setLanguage } from '../lib/language'
import { BOTH } from './translationFlags'

const query = new URLSearchParams(location.search)
const keys = (query.get('words') ?? '').split(',').filter(Boolean)
// ?lang=ru&tr=1: the Russian interface with the Cyrillic transcription on (src/lib/transcription.browser.test.ts); without them, the cards as they were
if (query.get('lang') === 'ru') setLanguage('ru', { remember: false })
const flags = query.get('tr') === '1' ? { ...BOTH, showTranscription: true } : BOTH

async function boot() {
  const [dictionary, overlay, fallback, gender] = await Promise.all(['words_enriched', 'rio_overlay', 'examples_fallback', 'noun_gender'].map((f) => fetch(`/${f}.json`).then((r) => r.json())))
  const words = parseDictionary(dictionary, parseRioOverlay(overlay), parseFallbackExamples(fallback), parseNounGender(gender))
  const chosen = keys.map((k) => words.find((w) => wordKey(w.esWord) === k)!)
  createRoot(document.getElementById('root')!).render(
    <main className="screen">
      {chosen.map((word) => (
        <section key={word.esWord} data-key={word.esWord}>
          <div className="case-learn">
            <WordCard word={word} settings={flags} />
          </div>
          <div className="case-review">
            <ReviewCard word={word} settings={flags} revealed={false} onReveal={() => {}} />
          </div>
          <div className="case-bare">
            <CardHeadword word={{ ...word, gender: null }} />
          </div>
        </section>
      ))}
    </main>,
  )
  document.body.dataset.ready = '1'
}
void boot()
