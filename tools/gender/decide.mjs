// Gender study, full run, step 2: the rules. Reads the model answers (out/full-llm-high.json) and writes, all in tools/gender/out/ (nothing goes into public/ yet):
//   noun_gender.json       public-ready: only the settled nouns, { key: { d: display, g: gender } }
//   noun_gender.full.json  every noun, with status, class, reasons and the three signals (for the merge of your decisions)
//   gender-lists.json/.md  the sense-dependent nouns, the proper-name leftovers, the not-a-noun rows
//   review-rows.json       the REVIEW rows, for tools/gender/review-xlsx.py
// `node tools/gender/decide.mjs`
import fs from 'node:fs'
import path from 'node:path'
import { OUT_DIR, loadData, displayed, articleSignal, suffixSignal, fold } from './lib.mjs'

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'))
const data = loadData()
const llmAll = readJson('full-llm-high.json')
const sensesRows = readJson('senses-high.json').rows

// The sense-dependent nouns: the model's "different meaning" ones from the senses study, less the three I judged false positives (a masculine word with its own feminine word).
const NOT_SENSE_DEPENDENT = new Set(['cerdo', 'dios', 'puto'])
const senseKeys = new Map(sensesRows.filter((r) => r.llm?.kind === 'different_meaning' && !NOT_SENSE_DEPENDENT.has(r.key)).map((r) => [r.key, r]))
// Added by hand (not from the model): modelo is el modelo (pattern, example) and la modelo (a woman who models). The glosses are mine.
const MANUAL_SENSE = {
  modelo: { llm: { kind: 'different_meaning', gloss_shows: 'm', example_shows: 'unclear', senses: [{ article: 'el modelo', gender: 'm', gloss_en: 'model, pattern, example', gloss_ru: 'модель, образец' }, { article: 'la modelo', gender: 'f', gloss_en: 'fashion model (a woman)', gloss_ru: 'фотомодель, манекенщица' }] } },
}
for (const [k, v] of Object.entries(MANUAL_SENSE)) senseKeys.set(k, v)

// Feminine nouns that start with a stressed a- (el agua, un hacha): the display is "el X" by rule and the article in our example says nothing.
const STRESSED_A = new Set(['agua', 'aguila', 'alma', 'arma', 'area', 'hacha', 'hambre', 'ala', 'alba', 'acta', 'alza', 'ave', 'hada', 'aula', 'ancla', 'ansia', 'arpa', 'asma', 'hampa', 'aspa', 'algebra', 'haya', 'ama', 'habla', 'asa', 'ascua', 'aya', 'agora', 'alga', 'anima', 'anfora', 'ancora', 'arca', 'alfa', 'haba', 'harpa', 'asta', 'ara', 'alca', 'alsa', 'aria', 'ala', 'hacha', 'hampa'])

const artGender = (display) => { const a = fold((display ?? '').trim().split(/\s+/)[0] ?? ''); return a === 'el' || a === 'los' ? 'm' : a === 'la' || a === 'las' ? 'f' : null }

function decide(w) {
  const key = w.es_word.trim().toLowerCase()
  const d = displayed(w, data)
  const head = d.headword
  const llm = llmAll[key] ?? null
  const art = articleSignal(d.example, head)
  const suf = suffixSignal(head)
  const row = { key, rank: w.rank, word: head, standard: d.switched ? d.standard : null, gloss: `${w.en_translation} / ${w.ru_translation}`, example: d.example.sentence, articleSignal: art, suffix: suf, llm }
  const out = (status, cls, g, display, reasons = []) => ({ ...row, status, cls, g, display, reasons })

  if (/^\p{Lu}/u.test(head) || /^\p{Lu}/u.test(w.es_word)) return out('proper', 'capitalised / proper-name leftover', null, null, [llm ? `model: ${llm.gender} ${llm.article_display}` : 'no model answer'])
  if (senseKeys.has(key)) return out('sense', 'sense-dependent', null, null)
  if (!llm) return out('review', 'no model answer', null, null, ['no model answer'])

  const a = (text) => text.trim()
  const reviewWith = (cls, reasons, g = null, display = null) => out('review', cls, g, display, reasons)
  const build = (g) => (g === 'm' ? `el ${head}` : g === 'f' ? `la ${head}` : null)

  if (llm.gender === 'none') return reviewWith('not a noun', [`the model says not a noun${llm.note ? ` (${a(llm.note)})` : ''}`])
  if (llm.gender === 'both') return reviewWith('two genders, not in the sense list', [`the model says two genders: ${a(llm.article_display)}${llm.note ? ` (${a(llm.note)})` : ''}`], 'both', a(llm.article_display))
  // An epicene noun ending in -o/-or/-ón has a feminine form of its own (la médica, la luchadora): masculine "el X", not "el/la X".
  if (llm.gender === 'mf' && /(o|or|ón)$/.test(fold(head))) return out('agree', 'epicene ending -o/-or: masculine (has its own feminine)', 'm', `el ${head}`)
  if (llm.gender === 'mf') return out('agree', 'epicene (mf)', 'mf', `el/la ${head}`)

  let g = llm.gender === 'plural' ? artGender(llm.article_display) : llm.gender
  const plural = llm.gender === 'plural'
  const fold_ = fold(head)
  if (STRESSED_A.has(fold_)) {
    if (llm.gender === 'f') return out('agree', 'stressed-a feminine (rule)', 'f', `el ${head}`)
    return reviewWith('stressed-a: model disagrees', [`known stressed-a feminine, but the model says ${llm.gender}`], g, build(g))
  }
  if (llm.gender === 'f' && artGender(llm.article_display) === 'm') return reviewWith('el + f, not a known stressed-a', [`the model says f with "${a(llm.article_display)}" (stressed-a? arte-type?)`], 'f', a(llm.article_display))
  let display
  if (plural) {
    if (!g) return reviewWith('plural-only, gender unclear', ['plural-only; the gender of the plural article is unclear'], null, a(llm.article_display))
    const shown = a(llm.article_display)
    const word = shown.split(/\s+/).slice(1).join(' ')
    if (fold(word) !== fold(head)) return reviewWith('plural-only: the headword is not the plural', [`model: "${shown}"; the card's headword is "${head}"`], `pl-${g}`, shown)
    display = shown
  } else display = build(g)
  const gTag = plural ? `pl-${g}` : g

  const reasons = []
  const artUsable = art.gender && art.sameWord
  let other = 0
  if (artUsable) {
    other++
    if (art.gender !== g) return reviewWith('article contradicts the model', [`article "${art.article}" (${art.gender}) vs model (${g})`], gTag, display)
    if (art.distance === 1) reasons.push('the article is one word before the form')
  }
  if (suf.gender && suf.gender !== 'mf') {
    if (suf.gender === g) other++
    else if (artUsable && art.gender === g) reasons.push(`suffix ${suf.rule} says ${suf.gender}: article and model say ${g} (the suffix loses)`)
    else return reviewWith('suffix contradicts the model', [`suffix ${suf.rule} says ${suf.gender}, the model ${g}; no article to decide`], gTag, display)
  }
  if (other === 0) return reviewWith('model alone', ['no article in our example and no suffix rule: only the model speaks'], gTag, display)
  const cls = plural ? 'plural-only' : artUsable ? (suf.gender === g ? 'article + suffix + model' : suf.gender && suf.gender !== 'mf' ? 'article + model (suffix exception)' : 'article + model') : 'suffix + model'
  return out('agree', cls, gTag, display, reasons)
}

const rows = data.words.filter((w) => w.pos === 'n').map(decide)
fs.writeFileSync(path.join(OUT_DIR, 'noun_gender.full.json'), JSON.stringify(rows, null, 1))

const settled = rows.filter((r) => r.status === 'agree')
fs.writeFileSync(path.join(OUT_DIR, 'noun_gender.json'), JSON.stringify({ model: 'gemini-3.5-flash-lite', thinking: 'high', note: 'key = dictionary es_word, lower-cased; d = display (built from the headword as the card shows it); g = m | f | mf | pl-m | pl-f', entries: Object.fromEntries(settled.map((r) => [r.key, { d: r.display, g: r.g }])) }))

const sense = rows.filter((r) => r.status === 'sense').map((r) => ({ key: r.key, word: r.word, rank: r.rank, gloss: r.gloss, senses: senseKeys.get(r.key).llm.senses, gloss_shows: senseKeys.get(r.key).llm.gloss_shows, example_shows: senseKeys.get(r.key).llm.example_shows }))
const proper = rows.filter((r) => r.status === 'proper').map((r) => ({ key: r.key, word: r.word, rank: r.rank, gloss: r.gloss, model: r.reasons[0] }))
const review = rows.filter((r) => r.status === 'review')
const epiSuspects = rows.filter((r) => r.cls.startsWith('epicene ending -o'))
fs.writeFileSync(path.join(OUT_DIR, 'gender-lists.json'), JSON.stringify({ senseDependent: sense, capitalised: proper, epiceneEndingO: epiSuspects.map((r) => r.word), notANoun: review.filter((r) => r.cls === 'not a noun').map((r) => ({ key: r.key, word: r.word, gloss: r.gloss })) }, null, 1))

const md = ['# Gender study: the separate lists', '', `## Sense-dependent (${sense.length}): no article for now`, '', ...sense.sort((a, b) => a.rank - b.rank).map((r) => `- **${r.word}** (${r.rank}) — ${r.senses.map((s) => `${s.article}: ${s.gloss_en} / ${s.gloss_ru}`).join('; ')}. Our gloss: ${r.gloss} (shows: ${r.gloss_shows}).`), '', `## Capitalised headwords / proper-name leftovers (${proper.length}): no article, for a later cleanup`, '', ...proper.map((r) => `- **${r.word}** (${r.rank}) — ${r.gloss}; ${r.model}`), '', `## Epicene (mf) nouns ending in -o/-or/-ón (${epiSuspects.length}): masculine "el X" (they have a feminine form of their own)`, '', epiSuspects.map((r) => r.word).join(', '), '', `## Marked "not a noun" by the model (${review.filter((r) => r.cls === 'not a noun').length}): in the review sheet`, '', ...review.filter((r) => r.cls === 'not a noun').map((r) => `- **${r.word}** — ${r.gloss}`)]
fs.writeFileSync(path.join(OUT_DIR, 'gender-lists.md'), md.join('\n') + '\n')

const sigArticle = (e) => (e.articleSignal.gender ? `${e.articleSignal.article} → ${e.articleSignal.gender}${e.articleSignal.sameWord ? '' : ' (other word)'}${e.articleSignal.distance === 1 ? ' (gap)' : ''}` : e.articleSignal.form && !e.articleSignal.sameWord ? `(example shows ${e.articleSignal.form})` : '–')
const order = ['model alone', 'article contradicts the model', 'suffix contradicts the model', 'el + f, not a known stressed-a', 'stressed-a: model disagrees', 'two genders, not in the sense list', 'plural-only, gender unclear', 'plural-only: the headword is not the plural', 'not a noun', 'no model answer']
review.sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls) || a.rank - b.rank)
fs.writeFileSync(path.join(OUT_DIR, 'review-rows.json'), JSON.stringify(review.map((r) => ({ key: r.key, head: r.word, cls: r.cls, plural: r.llm?.gender === 'plural', word: r.standard ? `${r.word} (std ${r.standard})` : r.word, gloss: r.gloss, example: r.example, article: sigArticle(r), suffix: r.suffix.gender ? `${r.suffix.gender} ${r.suffix.rule}` : '–', model: r.llm ? `${r.llm.gender}: ${r.llm.article_display}${r.llm.note ? ` — ${r.llm.note}` : ''}` : '–', proposed: r.display ?? '—', why: `${r.cls}: ${r.reasons.join('; ')}` })), null, 1))

const count = {}
for (const r of rows) { const k = `${r.status}: ${r.cls}`; count[k] = (count[k] ?? 0) + 1 }
const totals = { all: rows.length, agree: settled.length, review: review.length, sense: sense.length, proper: proper.length }
fs.writeFileSync(path.join(OUT_DIR, 'decide-counts.json'), JSON.stringify({ totals, count }, null, 1))
console.log(JSON.stringify(totals))
for (const [k, v] of Object.entries(count).sort()) console.log(String(v).padStart(5), k)
