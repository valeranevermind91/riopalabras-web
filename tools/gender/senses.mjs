// Gender study, part 2: nouns whose gender changes the meaning (el capital / la capital), found across ALL nouns. `node tools/gender/senses.mjs [--fresh]`
// Pass 1: every noun, one yes/no (does this spelling exist as a noun of both genders?). Pass 2: for the yes answers PLUS a known list, both senses with RU/EN glosses and which sense
// our gloss and example show. Writes tools/gender/out/senses.json (gitignored); report.mjs turns it into the markdown.
import fs from 'node:fs'
import path from 'node:path'
import { OUT_DIR, loadData, displayed, articleSignal } from './lib.mjs'
import { askJson, loadKey, pool, usage, cost, MODEL } from './gemini.mjs'

// the user's list first, then more that came to mind (the model pass is what finds the rest)
export const KNOWN_LIST = ['capital', 'orden', 'corte', 'cura', 'frente', 'guía', 'policía', 'cometa', 'coma', 'radio', 'parte', 'final', 'editorial', 'margen', 'clave', 'banda', 'pico',
  'pendiente', 'cólera', 'mar', 'vocal', 'terminal', 'papa', 'mañana', 'cabeza', 'moral', 'lente', 'trompa', 'vela', 'arte', 'azúcar', 'sartén', 'delta', 'cuarta', 'mango', 'pila', 'cañón', 'testigo', 'tarde', 'rosa', 'cobra', 'cólera', 'barroca', 'resta', 'llama', 'génesis', 'doblez', 'puntal', 'tema', 'pie', 'vista', 'cuento', 'segundo', 'minuta', 'cometa', 'colon', 'ordenanza', 'ala', 'cargo', 'sal', 'foco', 'bolsa']

const SYSTEM1 = `You are a Spanish lexicographer. For each noun decide: does this exact spelling exist as a noun with BOTH a masculine and a feminine article, where the two genders mean different things (el capital = money / la capital = capital city; el cura = priest / la cura = a cure; el orden / la orden; el corte / la corte; el frente / la frente; el guía / la guía; el policía / la policía; el cometa / la cometa)? Count real, standard dictionary cases only.
Do NOT flag: a person noun that just follows the person's sex with the same meaning (el/la estudiante, el/la artista), a pair that differs in its ending (niño/niña), a noun with one gender, or a word that is only feminine or only masculine in everyday use.
Do flag when the second gender is rare but the meaning really differs. Answer for every entry.`
const schema1 = { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, two_genders: { type: 'BOOLEAN' } }, required: ['id', 'two_genders'] } }

const SYSTEM2 = `You are a careful Spanish lexicographer. Each entry is a Spanish noun that may exist in both genders. Return:
- senses: the genders the spelling really has, each with its own short English and Russian gloss (a few words), the singular article and the word ("el capital", "la capital"). One item per gender and meaning; at most 4 items. Use standard Spanish; add a Rioplatense difference only in note.
- kind: different_meaning (the genders mean different things), same_meaning (one meaning, the gender varies by region or register: el/la mar, el/la azúcar), epicene (a person noun that follows the person's sex: el/la ayudante), single_gender (it has only one gender in standard use: the entry was a false alarm).
- gloss_shows: which of our current glosses' sense it is, by gender: m, f, both (the gloss mixes both senses), or neither (it is some other sense).
- example_shows: the gender of the sense our example sentence uses: m, f, or unclear.
- note: at most 15 words, only if useful.`
const schema2 = { type: 'ARRAY', items: { type: 'OBJECT', properties: {
  id: { type: 'INTEGER' },
  kind: { type: 'STRING', format: 'enum', enum: ['different_meaning', 'same_meaning', 'epicene', 'single_gender'] },
  senses: { type: 'ARRAY', items: { type: 'OBJECT', properties: { article: { type: 'STRING' }, gender: { type: 'STRING', format: 'enum', enum: ['m', 'f'] }, gloss_en: { type: 'STRING' }, gloss_ru: { type: 'STRING' } }, required: ['article', 'gender', 'gloss_en', 'gloss_ru'] } },
  gloss_shows: { type: 'STRING', format: 'enum', enum: ['m', 'f', 'both', 'neither'] },
  example_shows: { type: 'STRING', format: 'enum', enum: ['m', 'f', 'unclear'] },
  note: { type: 'STRING' },
}, required: ['id', 'kind', 'senses', 'gloss_shows', 'example_shows', 'note'] } }

const data = loadData()
const nouns = data.words.filter((w) => w.pos === 'n').map((w, id) => ({ id, w, key: w.es_word.trim().toLowerCase() }))
fs.mkdirSync(OUT_DIR, { recursive: true })
const cache = (name) => { const p = path.join(OUT_DIR, name); return { p, v: !process.argv.includes('--fresh') && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {} } }
const batchesOf = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))
const key = loadKey()
const LEVEL = (process.argv.find((a) => a.startsWith('--level=')) ?? '--level=low').slice(8)

// pass 1: at low always; at the pass-2 level too when that is higher (the low pass missed parte, final, mañana)
const pass1 = {}
for (const level of LEVEL === 'low' ? ['low'] : ['low', LEVEL]) {
  const c1 = cache(level === 'low' ? 'senses-pass1.json' : `senses-pass1-${level}.json`)
  const todo1 = nouns.filter((n) => !(n.key in c1.v))
  await pool(batchesOf(todo1, 60), 4, async (batch) => {
    const user = batch.map((n) => JSON.stringify({ id: n.id, word: n.w.es_word, gloss_en: n.w.en_translation })).join('\n')
    const answers = await askJson({ system: SYSTEM1, user: `Entries (one JSON object per line):\n${user}`, schema: schema1, key, level })
    for (const a of answers) { const n = batch.find((b) => b.id === a.id); if (n) c1.v[n.key] = a.two_genders }
    fs.writeFileSync(c1.p, JSON.stringify(c1.v))
  })
  pass1[level] = c1.v
}
const flaggedAt = (level) => nouns.filter((n) => pass1[level]?.[n.key] === true)
const flagged = nouns.filter((n) => Object.values(pass1).some((v) => v[n.key] === true))
const known = KNOWN_LIST.map((k) => nouns.find((n) => n.key === k.toLowerCase())).filter(Boolean)
const knownAbsent = [...new Set(KNOWN_LIST)].filter((k) => !nouns.some((n) => n.key === k.toLowerCase()))
const candidates = [...new Map([...flagged, ...known].map((n) => [n.key, n])).values()]

// pass 2
const c2 = cache(`senses-pass2-${LEVEL}.json`)
const todo2 = candidates.filter((n) => !(n.key in c2.v))
await pool(batchesOf(todo2, 15), 3, async (batch) => {
  const user = batch.map((n) => { const d = displayed(n.w, data); return JSON.stringify({ id: n.id, word: n.w.es_word, our_gloss_en: n.w.en_translation, our_gloss_ru: n.w.ru_translation, our_example: d.example.sentence }) }).join('\n')
  const answers = await askJson({ system: SYSTEM2, user: `Entries (one JSON object per line):\n${user}`, schema: schema2, key, level: LEVEL })
  for (const a of answers) { const n = batch.find((b) => b.id === a.id); if (n) c2.v[n.key] = a }
  fs.writeFileSync(c2.p, JSON.stringify(c2.v, null, 1))
})

const rows = candidates.map((n) => {
  const d = displayed(n.w, data)
  return { key: n.key, rank: n.w.rank, word: n.w.es_word, en: n.w.en_translation, ru: n.w.ru_translation, example: d.example.sentence, article: articleSignal(d.example, d.headword), fromKnownList: known.includes(n), fromPass1: flagged.includes(n), fromPass1Low: flaggedAt('low').includes(n), fromPass1Level: LEVEL === 'low' ? null : flaggedAt(LEVEL).includes(n), llm: c2.v[n.key] ?? null }
})
const out = { model: MODEL, level: LEVEL, nounsTotal: nouns.length, pass1Flagged: flagged.length, pass1FlaggedLow: flaggedAt('low').length, pass1FlaggedLevel: LEVEL === 'low' ? null : flaggedAt(LEVEL).length, knownListPresent: known.length, knownAbsent, candidates: rows.length, usage: { ...usage, cost_usd: cost() }, rows }
fs.writeFileSync(path.join(OUT_DIR, `senses-${LEVEL}.json`), JSON.stringify(out, null, 1))
console.log(`nouns ${nouns.length}; pass 1 flagged ${flagged.length}; known list present ${known.length} (absent: ${knownAbsent.join(', ')}); candidates ${rows.length}; missing pass-2 answers ${rows.filter((r) => !r.llm).length}`)
console.log(`this run: ${usage.calls} calls, in ${usage.input} out ${usage.output} thinking ${usage.thoughts}, $${cost().toFixed(4)}`)
