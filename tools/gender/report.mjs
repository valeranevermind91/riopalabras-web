// Gender study: turns out/sample.json and out/senses.json into ~/Desktop/gender-sample.md. `node tools/gender/report.mjs`
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { OUT_DIR, fold } from './lib.mjs'

const sample = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'sample.json'), 'utf8'))
const readOpt = (f) => (fs.existsSync(path.join(OUT_DIR, f)) ? JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8')) : null)
const senses = readOpt('senses-high.json')
const sensesLow = readOpt('senses-low.json')
const sampleHigh = readOpt('sample-high.json')
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** The gender a model answer commits to: m/f, or for a plural-only noun the gender of its plural article. */
function modelGender(llm) {
  if (llm.gender === 'm' || llm.gender === 'f') return llm.gender
  if (llm.gender === 'plural') { const a = fold(llm.article_display.split(/\s+/)[0]); return a === 'los' ? 'm' : a === 'las' ? 'f' : null }
  return null
}

/** AGREE / REVIEW with the reasons. AGREE = the model commits to m or f, and every signal that applies concurs, and at least one signal besides the model applies. */
function judge(e) {
  const llm = e.llm
  const reasons = []
  let tier = 'AGREE'
  const review = (code, text) => { tier = 'REVIEW'; reasons.push({ code, text }) }
  if (!llm) return { tier: 'REVIEW', reasons: [{ code: 'no-answer', text: 'no model answer' }] }
  const g = modelGender(llm)
  const art = e.article, suf = e.suffix
  const artUsable = art.gender && art.sameWord
  if (art.gender && !art.sameWord) reasons.push({ code: 'other-word-example', text: `the example shows another word (${art.form}); its article is ignored` })
  if (llm.gender === 'mf') review('model-mf', 'epicene (mf): a human picks the display')
  else if (llm.gender === 'both') review('model-both', 'two genders with different meanings: see the senses section')
  else if (llm.gender === 'none') review('model-none', 'the model says this is not a noun')
  else if (llm.gender === 'plural' && g === null) review('model-plural', 'plural-only, gender unclear')
  const artGender = (display) => { const a = fold((display ?? '').trim().split(/\s+/)[0] ?? ''); return a === 'el' || a === 'los' ? 'm' : a === 'la' || a === 'las' ? 'f' : null }
  const stdG = e.d.switched ? artGender(llm.standard_article) : null
  if (e.d.switched && llm.standard_article && stdG && g && stdG !== g) review('differs-from-standard', `the standard word (${llm.standard_article}) has the other gender`)
  else if (e.d.switched && llm.standard_article && !stdG) reasons.push({ code: 'std-unclear', text: `standard word: ${llm.standard_article}` })
  if (g) {
    let other = 0
    if (artUsable) {
      other++
      const stressedA = art.gender === 'm' && g === 'f' && !art.plural && /^h?a/.test(fold(e.d.headword))
      if (art.gender !== g) review(stressedA ? 'stressed-a' : 'article-vs-model', stressedA ? `el/un before a feminine noun that starts with a-: stressed-a (article ${art.article})` : `article "${art.article}" (${art.gender}) vs model (${g})`)
      else if (art.distance === 1) reasons.push({ code: 'gap-article', text: 'the article is one word before the form' })
    }
    if (suf.gender === 'mf') { review('suffix-epicene', `suffix ${suf.rule} says epicene, the model says ${g}`) }
    else if (suf.gender) {
      other++
      if (suf.gender !== g) {
        if (artUsable && art.gender === g) reasons.push({ code: 'suffix-exception', text: `suffix ${suf.rule} says ${suf.gender}; article and model say ${g}` })
        else review('suffix-vs-model', `suffix ${suf.rule} says ${suf.gender}, the model ${g}`)
      }
    }
    if (other === 0 && tier === 'AGREE') review('model-alone', 'the model is the only signal (no article, no suffix rule)')
  }
  return { tier, reasons }
}

const rows = sample.entries.map((e) => ({ e, ...judge(e) }))
const agree = rows.filter((r) => r.tier === 'AGREE')
const review = rows.filter((r) => r.tier === 'REVIEW')
const clean = agree.filter((r) => !r.reasons.some((x) => x.code === 'suffix-exception'))
const odd = agree.filter((r) => r.reasons.some((x) => x.code === 'suffix-exception'))
const tally = {}
for (const r of review) for (const x of r.reasons.filter((x) => x.code !== 'other-word-example' && x.code !== 'gap-article' && x.code !== 'suffix-exception')) tally[x.code] = (tally[x.code] ?? 0) + 1
const byStratum = {}
for (const r of rows) for (const s of r.e.strata) { (byStratum[s] ??= { n: 0, agree: 0 }).n++; if (r.tier === 'AGREE') byStratum[s].agree++ }
const displayOf = (r) => (r.e.llm?.article_display ?? '').trim()
const sig = (e) => `${e.article.article ? `${e.article.article}${e.article.sameWord ? '' : ' (other word)'}${e.article.distance === 1 ? ' (gap)' : ''}` : '–'}`

const L = []
const p = (s = '') => L.push(s)
p('# Gender sample: 200 nouns, three signals')
p()
p(`Model: \`${sample.model}\`, thinking level \`${sample.thinking}\`, structured JSON. Scripts: \`tools/gender/\` (not wired into the app). Nothing was changed in the app.`)
p()
p('## Summary')
p()
p(`- **${agree.length} AGREE, ${review.length} REVIEW** (of ${rows.length}).`)
p(`  - AGREE = the model commits to m or f, every signal that applies concurs, and at least one signal besides the model applies. ${clean.length} are agreed by all that apply; ${odd.length} are agreed by the article and the model while the suffix rule is the odd one out (the suffix rule has no exceptions list on purpose).`)
p(`  - The model sees our example sentence, so its answer is not independent of the article signal; the suffix rule is the only independent check. Counted as agreement, "article + model" is therefore weaker than it looks.`)
p(`- **Model cost for this sample: $${sample.usage.cost_usd.toFixed(4)}** (${sample.usage.calls} calls, ${sample.usage.input} input / ${sample.usage.output} output / ${sample.usage.thoughts} thinking tokens; at $0.30 in / $2.50 out per million, the price in the proxy's \`scripts/check-enrich-quality.js\`). Full 2568 nouns ≈ 13× this, about $${(sample.usage.cost_usd * 2568 / 200).toFixed(2)}.`)
p('- Strata (a word can be in several; the 200 are distinct words):')
p()
p('| stratum | words | AGREE |')
p('|---|---|---|')
for (const [s, v] of Object.entries(byStratum)) p(`| ${s} | ${v.n} | ${v.agree} |`)
p()
const c = sample.counts
p(`Sample build notes: stressed-a: only ${c.stressed_a} exist as nouns in the dictionary (asked 15); article/suffix disagreements under the suffix rule used here: ${c.disagreements_available} exist among all nouns (the earlier "43" counted a looser rule), and all of them are in the sample (${c.disagreements} added for this stratum, the rest already came in through other strata); ${c.topup} random words topped it up to 200.`)
p()
p('### REVIEW reasons (a row can have several)')
p()
p('| code | rows | meaning |')
p('|---|---|---|')
const meaning = { 'model-mf': 'epicene / common gender', 'model-both': 'two genders, two meanings', 'model-none': 'model says not a noun', 'model-plural': 'plural-only, no gender', 'stressed-a': 'el/un before a feminine a- noun', 'article-vs-model': 'article contradicts the model', 'suffix-epicene': 'suffix says -ista (epicene), model says m or f', 'suffix-vs-model': 'suffix rule contradicts the model; no article support', 'model-alone': 'only the model speaks', 'differs-from-standard': 'overlay form and standard word differ in gender', 'no-answer': 'model returned nothing' }
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) p(`| ${k} | ${n} | ${meaning[k] ?? ''} |`)
p()
p('### Error classes seen')
p()
p(`1. **Epicene / common-gender nouns (${tally['model-mf'] ?? 0} REVIEW rows).** colega, acompañante, gobernante, periodista, ayudante, vigilante, terrorista, pariente, amante, guarda, psiquiatra, juez, espía, demócrata, canalla, linyera… Our example shows one person, so the article signal is a coin toss ("un acompañante", "el vigilante", "la periodista") and the suffix rule is wrong or silent. The model answers mf and a display "el/la X". Two traps: at \`low\` it also says mf for nouns that have a feminine form of their own (investigador → investigadora, juez → jueza, gordo), where \`high\` says m; and the model sees the example, so an "una investigadora" in the example pulls the headword toward f. The display for these is a decision (always "el/la X"?), not data.`)
p(`2. **Stressed-a feminines (13 in the dictionary; ${tally['stressed-a'] ?? 0} show up as an article conflict).** águila, hambre, alma, arma, área, hacha, alba, acta, alza, ave, hada, agua, ala. The article in our example is el/un/al (masculine-looking) for a feminine noun. The model is right on all 13 and writes "el agua", so this class is safe to automate with a rule (starts with a-/ha-, model says f, article is el/un → f, display "el"), but it must not be fed to the article signal. **arte** is the opposite trap: m in the singular, f in the plural; \`low\` answered "both: el arte / la artes", \`high\` "f: el arte", both wrong.`)
p(`3. **Sense-dependent nouns (${tally['model-both'] ?? 0} "both" rows, and the model is inconsistent on them at \`low\`).** orden came back as gender f with display "el orden" (note: "masculine"); parte only f; policía and guía only mf; at \`high\` policía → both, parte, final and margen get their second gender. See the sense-dependent section.`)
p(`4. **Suffix-rule exceptions (${odd.length} words where article and model agree and the suffix is the odd one out, plus planeta).** mapa, planeta, sofá, mediodía, sida (-a, m), foto, moto, mano (-o, f), flor, labor (-or, f), pez, pie. All exceptions of the textbook kind; the article/model pair is right every time here. The suffix rule alone would be wrong on these, so it must only ever be a cross-check.`)
p(`5. **The model is the only signal (${tally['model-alone'] ?? 0} rows): no article in our example, no suffix rule.** ${review.filter((r) => r.reasons.some((x) => x.code === 'model-alone')).map((r) => r.e.d.headword).join(', ')}. By my reading the model is right on the plain ones (detalle m, padre m, salud f, adiós m); they are REVIEW only because nothing independent confirms them. For the full run this class (about ${Math.round(100 * (tally['model-alone'] ?? 0) / 200)}% of a sample) is better served by a second model opinion (another level or prompt) than by a human.`)
p(`6. **Not a noun, or not a common noun (${tally['model-none'] ?? 0} "none" rows, and some that slipped through).** te, mi, mía, tuya (and carajo in the first run) are correctly marked none. But **Rosa** is AGREE as "la Rosa" and **charles** at \`high\` is "el Charles" (proper names tagged n), and **respecto** gets "el respecto" (it only lives in "con respecto a / respecto a"). The "none" answer catches mis-tagged function words, not proper names or fixed-phrase nouns.`)
p(`7. **Overlay headwords (15).** The model judges the displayed form: 13 AGREE (valija, pollera, ruta, nafta, manteca, costo, básquet, placard, gurí, auto, competencia, galletita, salud pública), and only **lentes** (los lentes, m) differs from its standard word (las gafas, f). In the full overlay the gender differences I expected (pastel → torta, ayuntamiento → municipalidad, ordenador → computadora, rostro → cara) were not in this random 15; the stratum is too small to say how many of the 64 differ. Also: "lentes" is the displayed headword of two dictionary entries (gafas and lentes itself).`)
p(`8. **Plural-only and -s nouns (10).** The stratum mostly caught invariable singulars (martes, jueves, virus, tenis, campus, hipótesis), which are fine. Only lentes, felicitaciones (overlay) and gracias (the odd-rows stratum) are plural-only, so this class was under-sampled: the dictionary has a few dozen (gafas, pantalones, celos, afueras…), mostly absent from a random 10.`)
p(`9. **Instability.** Two runs at \`low\` (with a one-line prompt change between them) disagreed on carajo (none → m), and \`low\` vs \`high\` disagree on 7 words (table below). A Gemini 3 model takes no temperature, so a full run should store its answers and review them once, not re-run and compare.`)
p(`10. **The 27 article/suffix disagreements, by class (my reading).** 11 plain suffix exceptions (mano, pie, foto, flor, pez, mapa, labor, sofá, moto, mediodía, sida: article and model right), 7 epicene (juez, guarda, espía, psiquiatra, demócrata, canalla, linyera), 6 stressed-a (área, águila, alza, acta, alba, hacha), 2 sense-dependent (cura, radio), and 1 where the example shows an inflection of the headword (investigador ← "una investigadora"). So the disagreement list needs no new class: it is classes 1, 2, 3 and 4 again.`)
p()
if (sampleHigh) {
  const hi = new Map(sampleHigh.entries.map((e) => [e.key, e]))
  const diff = sample.entries.filter((e) => e.llm && hi.get(e.key)?.llm && (e.llm.gender !== hi.get(e.key).llm.gender || e.llm.article_display.toLowerCase() !== hi.get(e.key).llm.article_display.toLowerCase()))
  const hiRows = sampleHigh.entries.map((e) => ({ e, ...judge(e) }))
  p('### Thinking low vs high (extra, not requested)')
  p()
  p(`The same 200 at thinking level \`high\`: ${hiRows.filter((r) => r.tier === 'AGREE').length} AGREE / ${hiRows.filter((r) => r.tier === 'REVIEW').length} REVIEW (low: ${agree.length} / ${review.length}); cost $${sampleHigh.usage.cost_usd.toFixed(4)} (low: $${sample.usage.cost_usd.toFixed(4)}). The two answers differ on **${diff.length}** words:`)
  p()
  p('| word | low | high |')
  p('|---|---|---|')
  for (const e of diff) { const h = hi.get(e.key).llm; p(`| ${esc(e.d.headword)} | ${esc(e.llm.gender)}: ${esc(e.llm.article_display)} | ${esc(h.gender)}: ${esc(h.article_display)}${h.note ? ` — ${esc(h.note)}` : ''} |`) }
  p()
}
p('## Review rows')
p()
p('Columns: headword shown · strata · **article** before the example form (the example shows a different word → marked) · **suffix** rule · **model** (gender, display) · proposed display · reasons. "Proposed" is the model\'s display; for a REVIEW row it is only a proposal.')
p()
p('| # | word | strata | article | suffix | model | proposed display | flag: reasons |')
p('|---|---|---|---|---|---|---|---|')
const line = (r, i) => `| ${i + 1} | **${esc(r.e.d.headword)}**${r.e.d.switched ? ` (std ${esc(r.e.d.standard)})` : ''} | ${esc(r.e.strata.join('; '))} | ${esc(sig(r.e))}${r.e.article.gender ? ` → ${r.e.article.gender}` : ''} | ${r.e.suffix.gender ? `${r.e.suffix.gender} ${esc(r.e.suffix.rule)}` : '–'} | ${esc(r.e.llm?.gender)}${r.e.llm?.note ? ` — ${esc(r.e.llm.note)}` : ''} | ${esc(displayOf(r))} | ${r.tier}${r.reasons.length ? `: ${esc(r.reasons.map((x) => x.text).join('; '))}` : ''} |`
review.forEach((r, i) => p(line(r, i)))
p()
p(`## AGREE rows (${agree.length}) — skim only`)
p()
p('| # | word | strata | article | suffix | model | proposed display | flag: reasons |')
p('|---|---|---|---|---|---|---|---|')
agree.forEach((r, i) => p(line(r, i)))
p()

// ------------------------------------------------------------------ sense-dependent nouns
if (senses) {
  const real = senses.rows.filter((r) => r.llm && r.llm.kind === 'different_meaning')
  const same = senses.rows.filter((r) => r.llm && r.llm.kind === 'same_meaning')
  const epi = senses.rows.filter((r) => r.llm && r.llm.kind === 'epicene')
  const single = senses.rows.filter((r) => r.llm && r.llm.kind === 'single_gender')
  const mixed = real.filter((r) => r.llm.gloss_shows === 'both')
  const neither = real.filter((r) => r.llm.gloss_shows === 'neither')
  const conflict = real.filter((r) => r.article.sameWord && r.article.gender && r.llm.example_shows !== 'unclear' && r.article.gender !== r.llm.example_shows)
  p('## Sense-dependent nouns (all 2568 nouns)')
  p()
  p(`Method: pass 1 asks the model, for every noun (2568), whether the spelling exists in both genders with different meanings. At thinking \`low\` it said yes to ${senses.pass1FlaggedLow}; at \`high\` to ${senses.pass1FlaggedLevel}; ${senses.pass1Flagged} in the union. Pass 2 takes those plus a known list of mine and yours (${senses.knownListPresent} of its words are nouns in the dictionary; not present as nouns: ${senses.knownAbsent.join(', ')}) = ${senses.candidates} candidates, and asks for both senses with RU/EN glosses and which sense our gloss and example show. Total model spend for this section, all runs: about $0.83 (low pass 1 + 2: $0.16; a first high pass 2: $0.10; high pass 1 over all nouns + the new candidates: $0.57). The high pass 1 over all nouns is the expensive step.`)
  p()
  p(`- **${real.length} different-meaning nouns** (listed below). Of them: our gloss mixes both senses in **${mixed.length}**, shows a different sense than either listed in ${neither.length}, and the example's article contradicts the model's reading of the example in ${conflict.length}.`)
  p(`- Not counted as sense-dependent: ${same.length} same-meaning (gender varies by region or register), ${epi.length} epicene person nouns, ${single.length} false alarms (one gender): listed at the end.`)
  p('- Nouns found by pass 1 only: ' + real.filter((r) => r.fromPass1 && !r.fromKnownList).length + '; by the known list only: ' + real.filter((r) => !r.fromPass1 && r.fromKnownList).length + '; by both: ' + real.filter((r) => r.fromPass1 && r.fromKnownList).length + '. (If pass 1 alone misses a word of the known list, that is a recall gap of that pass.)')
  p()
  if (sensesLow) {
    const lo = new Map(sensesLow.rows.map((r) => [r.key, r]))
    const kindDiff = senses.rows.filter((r) => lo.get(r.key)?.llm && r.llm && lo.get(r.key).llm.kind !== r.llm.kind)
    p(`- **Thinking level matters here.** The classification below is the \`high\` run. The same pass 2 at \`low\` swapped the genders of several senses (frente, cometa, mama: it put "el" on the forehead) and missed others (parte, final, margen, policía, guía, mañana); across the candidates the two runs classify ${kindDiff.length} of ${senses.rows.length} differently (${kindDiff.map((r) => `${r.word}: ${lo.get(r.key).llm.kind} → ${r.llm.kind}`).join('; ')}). Pass 1 at \`low\` also missed parte, final and mañana from the known list.`)
    p()
  }
  const listed = ['capital', 'orden', 'corte', 'cura', 'frente', 'guía', 'policía', 'cometa', 'coma', 'radio', 'parte', 'final', 'editorial', 'margen', 'clave', 'banda', 'pico']
  const notFlagged = listed.filter((w) => !real.some((r) => r.key === w))
  p(`- From your list of 17: ${listed.length - notFlagged.length} come out as different-meaning; **not** flagged: ${notFlagged.map((w) => `${w} (${senses.rows.find((r) => r.key === w)?.llm?.kind ?? 'absent'}: ${senses.rows.find((r) => r.key === w)?.llm?.senses.map((s) => s.article).join(' / ') ?? ''})`).join(', ') || '–'}.`)
  p()
  p('Not decided: the display. "Gloss shows" is the model\'s reading of our English/Russian gloss; "example shows" is its reading of our example; "article in example" is the mechanical signal.')
  p()
  p('| word | rank | our gloss (EN / RU) | senses (model) | gloss shows | example shows | article in example | flag |')
  p('|---|---|---|---|---|---|---|---|')
  for (const r of real.sort((a, b) => a.rank - b.rank)) {
    const l = r.llm
    const flags = []
    if (l.gloss_shows === 'both') flags.push('GLOSS MIXES BOTH SENSES')
    if (l.gloss_shows === 'neither') flags.push('gloss matches neither')
    if (r.article.sameWord && r.article.gender && l.example_shows !== 'unclear' && r.article.gender !== l.example_shows) flags.push('example article ≠ model reading')
    if (!r.fromPass1) flags.push('known list only')
    p(`| **${esc(r.word)}** | ${r.rank} | ${esc(r.en)} / ${esc(r.ru)} | ${l.senses.map((s) => `${esc(s.article)}: ${esc(s.gloss_en)} / ${esc(s.gloss_ru)}`).join('<br>')} | ${l.gloss_shows} | ${l.example_shows} | ${r.article.gender ? `${esc(r.article.article)}${r.article.sameWord ? '' : ' (other word)'}` : '–'} | ${flags.join('; ')}${l.note ? ` ${esc(l.note)}` : ''} |`)
  }
  p()
  p('### The rest of the candidates')
  p()
  for (const [name, list] of [['same meaning, gender varies', same], ['epicene person nouns', epi], ['false alarms (one gender)', single]]) {
    p(`- **${name} (${list.length}):** ${list.sort((a, b) => a.rank - b.rank).map((r) => r.word + (r.llm.senses.length ? ` (${r.llm.senses.map((s) => s.article).join(' / ')})` : '')).join(', ') || '–'}`)
  }
  p()
  p('Example sentences for the flagged rows (so the sense can be checked by eye):')
  p()
  for (const r of [...mixed, ...conflict].filter((r, i, a) => a.indexOf(r) === i)) p(`- **${esc(r.word)}** — ${esc(r.example)}`)
}

const text = L.join('\n') + '\n'
const target = path.join(os.homedir(), 'Desktop', 'gender-sample.md')
fs.writeFileSync(target, text)
fs.writeFileSync(path.join(OUT_DIR, 'report-stats.json'), JSON.stringify({ agree: agree.length, review: review.length, clean: clean.length, odd: odd.length, tally }, null, 1))
console.log(`wrote ${target}: ${agree.length} AGREE (${clean.length} all-signal, ${odd.length} suffix-exception), ${review.length} REVIEW; tally ${JSON.stringify(tally)}`)
