// Gender study, full run: every noun (pos n) through the model at thinking `high`. `node tools/gender/full.mjs`
// Answers are saved batch by batch in tools/gender/out/full-llm-high.json (resumable); the 200 sample answers at `high` seed it. The rules are in decide.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { OUT_DIR, loadData, displayed } from './lib.mjs'
import { askJson, loadKey, pool, usage, cost } from './gemini.mjs'
import { SYSTEM, schema } from './prompt.mjs'

const LEVEL = 'high'
const data = loadData()
const nouns = data.words.filter((w) => w.pos === 'n').map((w, id) => ({ id, w, key: w.es_word.trim().toLowerCase(), d: displayed(w, data) }))
fs.mkdirSync(OUT_DIR, { recursive: true })
const cachePath = path.join(OUT_DIR, 'full-llm-high.json')
const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {})
const cache = { ...readJson(path.join(OUT_DIR, 'sample-llm-high.json')), ...readJson(cachePath) }
const todo = nouns.filter((n) => !cache[n.key])
console.log(`${nouns.length} nouns; ${nouns.length - todo.length} already answered; ${todo.length} to ask`)
const batches = Array.from({ length: Math.ceil(todo.length / 20) }, (_, i) => todo.slice(i * 20, i * 20 + 20))
const key = loadKey()
let done = 0
await pool(batches, 5, async (batch) => {
  const user = batch.map((e) => JSON.stringify({ id: e.id, headword: e.d.headword, ...(e.d.switched ? { standard_word: e.d.standard } : {}), gloss_en: e.w.en_translation, gloss_ru: e.w.ru_translation, example: e.d.example.sentence })).join('\n')
  const answers = await askJson({ system: SYSTEM, user: `Entries (one JSON object per line):\n${user}`, schema, key, level: LEVEL })
  for (const a of answers) { const e = batch.find((b) => b.id === a.id); if (e) cache[e.key] = a }
  fs.writeFileSync(cachePath, JSON.stringify(cache))
  done++
  if (done % 10 === 0) console.log(`  ${done}/${batches.length} batches, $${cost().toFixed(3)}`)
})
const missing = nouns.filter((n) => !cache[n.key]).length
fs.writeFileSync(path.join(OUT_DIR, 'full-usage.json'), JSON.stringify({ ...readJson(path.join(OUT_DIR, 'full-usage.json')), [new Date().toISOString()]: { ...usage, cost_usd: cost() } }, null, 1))
console.log(`done: ${usage.calls} calls, in ${usage.input} out ${usage.output} thinking ${usage.thoughts}, retries ${usage.retries}, $${cost().toFixed(4)}; still missing ${missing}`)
