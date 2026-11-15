// Gender study, part 1: the 200-noun sample with three signals. `node tools/gender/sample.mjs` (add --fresh to ignore the saved model answers).
// Writes tools/gender/out/sample.json (gitignored); tools/gender/report.mjs turns it into the markdown.
import fs from 'node:fs'
import path from 'node:path'
import { OUT_DIR, loadData, displayed, articleSignal, suffixSignal, buildSample } from './lib.mjs'
import { askJson, loadKey, pool, usage, cost, MODEL } from './gemini.mjs'

const SYSTEM = `You are a careful Spanish lexicographer. For each entry give the grammatical gender of the headword AS SHOWN, for the meaning given by the English gloss, in standard and Rioplatense Spanish.
gender is one of:
 m, f      one gender for this meaning.
 mf        the same word and meaning for either gender, the article follows the person or animal (el/la estudiante, el/la artista).
 both      the same spelling is masculine in one meaning and feminine in another (el capital / la capital). Give the meaning of the gloss first.
 plural    used only in the plural for this meaning (las gafas, los pantalones, las ganas). Use the plural article.
 none      not a noun in this meaning (a pronoun, adjective, verb, adverb, interjection), so no gender.
article_display is the definite article with the word as shown: "la casa", "el agua" (a feminine noun that starts with a stressed a- takes el in the singular; say so in note), "el/la estudiante", "el capital / la capital", "las gafas". Use the headword exactly as shown, including a Rioplatense form.
Judge the headword shown, not the standard word it replaces. When a standard word is also given, put the standard word's own definite article and the word in standard_article ("la galleta", "las gafas", "el coche"), so the two can be compared; otherwise leave standard_article empty.
note: at most 12 words, only when the case is not plain (epicene, stressed a-, sense-dependent, different from the standard word, mis-tagged). Otherwise empty.`

const schema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'INTEGER' },
      gender: { type: 'STRING', format: 'enum', enum: ['m', 'f', 'mf', 'both', 'plural', 'none'] },
      article_display: { type: 'STRING' },
      standard_article: { type: 'STRING' },
      note: { type: 'STRING' },
    },
    required: ['id', 'gender', 'article_display', 'standard_article', 'note'],
  },
}

const LEVEL = (process.argv.find((a) => a.startsWith('--level=')) ?? '--level=low').slice(8)
const SUFFIX = LEVEL === 'low' ? '' : `-${LEVEL}`
const data = loadData()
const sample = buildSample(data)
const entries = sample.items.map(({ word, strata }, i) => {
  const d = displayed(word, data)
  return { id: i, key: word.es_word.trim().toLowerCase(), rank: word.rank, pos: word.pos, strata, d, article: articleSignal(d.example, d.headword), suffix: suffixSignal(d.headword), en: word.en_translation, ru: word.ru_translation }
})

const cachePath = path.join(OUT_DIR, `sample-llm${SUFFIX}.json`)
fs.mkdirSync(OUT_DIR, { recursive: true })
const cache = !process.argv.includes('--fresh') && fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {}
const todo = entries.filter((e) => !cache[e.key])

if (todo.length) {
  const key = loadKey()
  const batches = []
  for (let i = 0; i < todo.length; i += 20) batches.push(todo.slice(i, i + 20))
  await pool(batches, 3, async (batch) => {
    const user = batch.map((e) => JSON.stringify({ id: e.id, headword: e.d.headword, ...(e.d.switched ? { standard_word: e.d.standard } : {}), gloss_en: e.en, gloss_ru: e.ru, example: e.d.example.sentence })).join('\n')
    const answers = await askJson({ system: SYSTEM, user: `Entries (one JSON object per line):\n${user}`, schema, key, level: LEVEL })
    for (const a of answers) { const e = batch.find((b) => b.id === a.id); if (e) cache[e.key] = a }
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1))
  })
}
const missing = entries.filter((e) => !cache[e.key])
const out = { model: MODEL, thinking: LEVEL, counts: sample.counts, disagreementsTotal: sample.disagreementsTotal, usage: { ...usage, cost_usd: cost() }, entries: entries.map((e) => ({ ...e, llm: cache[e.key] ?? null })) }
fs.writeFileSync(path.join(OUT_DIR, `sample${SUFFIX}.json`), JSON.stringify(out, null, 1))
console.log(`sample: ${entries.length} nouns; model answers missing for ${missing.length}; this run: ${usage.calls} calls, in ${usage.input} out ${usage.output} thinking ${usage.thoughts} tokens, $${cost().toFixed(4)}`)
console.log('strata:', JSON.stringify(sample.counts))
