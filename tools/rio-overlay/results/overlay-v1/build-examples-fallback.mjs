// Publishes the pass-3 fallback examples: reads examples.fallback.json (written by
// `node tools/rio-overlay/generate-examples.mjs --pass fallback --run NAME`), re-checks every sentence against the
// CURRENT dictionary and overlay with the same validator, and writes public/examples_fallback.json for the client.
// Nothing is repaired: a sentence that no longer passes, or whose word is no longer in scope, is dropped and listed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectFallbackScope, validateFallback } from '../../fallback.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..', '..')
const read = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'))

const generated = read(HERE, 'examples.fallback.json')
const dictionary = read(ROOT, 'public', 'words_enriched.json')
const overlay = read(ROOT, 'public', 'rio_overlay.json')
const { scope } = selectFallbackScope(dictionary, overlay)
const byWord = new Map(scope.map((i) => [i.es_word, i]))

const published = []
const dropped = []
for (const [esWord, e] of Object.entries(generated.examples)) {
  const item = byWord.get(esWord)
  if (!item) {
    dropped.push(`${esWord}: no longer in scope (it entered the overlay, or its dictionary example changed)`)
    continue
  }
  const check = validateFallback({ es_word: esWord, example_es: e.es, example_en: e.en, example_ru: e.ru, word_form_in_example: e.word_form }, item)
  if (check.errors.length) {
    dropped.push(`${esWord}: ${check.errors.join('; ')}`)
    continue
  }
  published.push({ es_word: esWord, es: e.es, en: e.en, ru: e.ru, word_form: e.word_form })
}
published.sort((a, b) => a.es_word.localeCompare(b.es_word, 'es'))

fs.writeFileSync(path.join(ROOT, 'public', 'examples_fallback.json'), JSON.stringify(published, null, 2))
console.log(`public/examples_fallback.json: ${published.length} examples (of ${Object.keys(generated.examples).length} generated; ${scope.length} words in scope now)`)
const missing = scope.filter((i) => !published.some((p) => p.es_word === i.es_word)).map((i) => i.es_word)
if (missing.length) console.log(`in scope but without a published example: ${missing.join(', ')}`)
for (const d of dropped) console.log(`dropped: ${d}`)
